import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { app, net, powerMonitor, screen } from "electron";
import type { ActivitySnapshot, PerformanceSnapshot } from "../../src/types.js";
import { categorize } from "../../src/shared/categorize.js";

interface CpuTimes { idle: number; total: number; }
interface SensorPayload extends Partial<ActivitySnapshot> { sensorMemoryMb?: number; }

function readCpuTimes(): CpuTimes {
  return cpus().reduce<CpuTimes>((result, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    result.idle += cpu.times.idle;
    result.total += total;
    return result;
  }, { idle: 0, total: 0 });
}

function emptyPerformance(): PerformanceSnapshot {
  return {
    systemCpuPercent: 0, systemMemoryPercent: 0, petCpuPercent: 0,
    petMemoryMb: 0, petProcessCount: 0, sensorMemoryMb: 0, eventLoopLagMs: 0
  };
}

function blankSnapshot(): ActivitySnapshot {
  return {
    timestamp: Date.now(), foregroundProcess: "unknown", foregroundPath: "", windowTitle: "", documentTitle: "",
    appCategory: "other", activeAppSeconds: 0, appSwitches5m: 0,
    keyboardCount1s: 0, keyboardCount10s: 0, keyboardPulse: false,
    mouseClicks1s: 0, mouseClicks10s: 0, mouseClickPulse: false,
    mouseWheel1s: 0, mouseWheel10s: 0, mouseDistance1s: 0, mouseDistance10s: 0,
    idleSeconds: 0, fullscreen: false, locked: false, meeting: false,
    microphoneActive: false, online: true, batteryPercent: 100, charging: true,
    sensorSource: "fallback", performance: emptyPerformance()
  };
}

export class SensorService extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private locked = false;
  private stopped = false;
  private previousCursor = { x: 0, y: 0 };
  private fallbackDistances: number[] = [];
  private previousCpu = readCpuTimes();
  private previousSampleAt = Date.now();
  snapshot: ActivitySnapshot = blankSnapshot();

  start(): void {
    powerMonitor.on("lock-screen", () => { this.locked = true; });
    powerMonitor.on("unlock-screen", () => { this.locked = false; });
    powerMonitor.on("resume", () => { this.locked = false; });
    this.previousCursor = screen.getCursorScreenPoint();
    this.startNative();
  }

  private binaryPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, "bin", "pet-sensor.exe")
      : join(app.getAppPath(), "native", "sensor", "target", "release", "pet-sensor.exe");
  }

  private performance(sensorMemoryMb = 0): PerformanceSnapshot {
    const now = Date.now();
    const currentCpu = readCpuTimes();
    const totalDelta = Math.max(1, currentCpu.total - this.previousCpu.total);
    const idleDelta = Math.max(0, currentCpu.idle - this.previousCpu.idle);
    const metrics = app.getAppMetrics();
    const result: PerformanceSnapshot = {
      systemCpuPercent: Math.round(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) * 10) / 10,
      systemMemoryPercent: Math.round((1 - freemem() / Math.max(1, totalmem())) * 1000) / 10,
      petCpuPercent: Math.round(metrics.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0) * 10) / 10,
      petMemoryMb: Math.round(metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 102.4) / 10,
      petProcessCount: metrics.length,
      sensorMemoryMb: Math.round(Math.max(0, sensorMemoryMb) * 10) / 10,
      eventLoopLagMs: Math.round(Math.max(0, now - this.previousSampleAt - 1000))
    };
    this.previousCpu = currentCpu;
    this.previousSampleAt = now;
    return result;
  }

  private normalize(payload: SensorPayload): ActivitySnapshot {
    const base = blankSnapshot();
    const source = payload.sensorSource === "compat" ? "compat" : "native";
    return {
      ...base,
      ...payload,
      timestamp: Number(payload.timestamp) || Date.now(),
      foregroundProcess: String(payload.foregroundProcess || "unknown"),
      appCategory: categorize(
        String(payload.foregroundProcess || "unknown"),
        String(payload.foregroundPath || ""),
        String(payload.windowTitle || ""),
        String(payload.documentTitle || "")
      ),
      keyboardCount1s: Number(payload.keyboardCount1s) || 0,
      keyboardPulse: Boolean(payload.keyboardPulse || payload.keyboardCount1s),
      mouseClicks1s: Number(payload.mouseClicks1s) || 0,
      mouseClickPulse: Boolean(payload.mouseClickPulse || payload.mouseClicks1s),
      mouseWheel1s: Number(payload.mouseWheel1s) || 0,
      mouseDistance1s: Number(payload.mouseDistance1s) || 0,
      locked: Boolean(payload.locked || this.locked),
      sensorSource: source,
      performance: this.performance(Number(payload.sensorMemoryMb) || 0)
    };
  }

  private startNative(): void {
    if (this.stopped) return;
    const binary = this.binaryPath();
    if (!existsSync(binary)) { this.startFallback(); return; }
    this.child = spawn(binary, [], { windowsHide: true });
    const child = this.child;
    let buffer = "";
    let ended = false;
    const recover = () => {
      if (ended) return;
      ended = true;
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      if (this.restartCount < 3) {
        const delay = 1000 * 2 ** this.restartCount++;
        setTimeout(() => this.startNative(), delay);
      } else this.startFallback();
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd < 0) break;
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;
        try {
          this.snapshot = this.normalize(JSON.parse(line) as SensorPayload);
          this.emit("snapshot", this.snapshot);
          this.restartCount = 0;
        } catch { /* malformed sidecar lines never reach the application */ }
      }
    });
    child.stderr.resume();
    child.once("error", recover);
    child.once("exit", recover);
  }

  private startFallback(): void {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => {
      const cursor = screen.getCursorScreenPoint();
      const distance = Math.round(Math.hypot(cursor.x - this.previousCursor.x, cursor.y - this.previousCursor.y));
      this.previousCursor = cursor;
      this.fallbackDistances.push(distance);
      this.fallbackDistances = this.fallbackDistances.slice(-10);
      this.snapshot = {
        ...this.snapshot,
        timestamp: Date.now(),
        keyboardCount1s: 0, keyboardCount10s: 0, keyboardPulse: false,
        mouseClicks1s: 0, mouseClicks10s: 0, mouseClickPulse: false,
        mouseWheel1s: 0, mouseWheel10s: 0,
        mouseDistance1s: distance,
        mouseDistance10s: this.fallbackDistances.reduce((sum, value) => sum + value, 0),
        idleSeconds: powerMonitor.getSystemIdleTime(), locked: this.locked,
        online: net.isOnline(), sensorSource: "fallback", performance: this.performance()
      };
      this.emit("snapshot", this.snapshot);
    }, 1000);
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
  }
}
