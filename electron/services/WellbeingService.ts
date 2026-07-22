import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ActivitySnapshot, Settings, WellbeingSnapshot, WellbeingState } from "../../src/types.js";
import type { DataStore } from "./DataStore.js";

const VERSION = 1;
const clamp = (value: number) => Math.max(0, Math.min(100, value));

type StoredWellbeing = WellbeingSnapshot & { version: number; lastRewardAt: number; lowVitalitySince: number | null };

function defaultValue(): StoredWellbeing {
  return { version: VERSION, vitality: 70, mood: 70, state: "learning", estimated: false, baselineDays: 0, updatedAt: Date.now(), lastRewardAt: 0, lowVitalitySince: null };
}

export class WellbeingService {
  private value: StoredWellbeing = defaultValue();
  private lastSnapshotAt = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly dataDirectory: () => string, private readonly data: DataStore) {}
  private path(): string { return join(this.dataDirectory(), "wellbeing.json"); }
  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path(), "utf8")) as Partial<StoredWellbeing>;
      this.value = {
        ...defaultValue(),
        vitality: clamp(Number(parsed.vitality) || 70), mood: clamp(Number(parsed.mood) || 70),
        state: ["learning", "energized", "steady", "tired", "sleepy"].includes(String(parsed.state)) ? parsed.state as WellbeingState : "learning",
        estimated: Boolean(parsed.estimated), baselineDays: Math.max(0, Math.min(14, Math.round(Number(parsed.baselineDays) || 0))),
        updatedAt: Number(parsed.updatedAt) || Date.now(), lastRewardAt: Number(parsed.lastRewardAt) || 0,
        lowVitalitySince: Number.isFinite(Number(parsed.lowVitalitySince)) ? Number(parsed.lowVitalitySince) : null
      };
      const offlineMinutes = Math.min(120, Math.max(0, (Date.now() - this.value.updatedAt) / 60_000));
      if (offlineMinutes) this.value.vitality = clamp(this.value.vitality + offlineMinutes * .8);
      this.value.updatedAt = Date.now();
    } catch { this.value = defaultValue(); }
    await this.save();
  }
  snapshot(): WellbeingSnapshot {
    const { vitality, mood, state, estimated, baselineDays, updatedAt } = this.value;
    return { vitality, mood, state, estimated, baselineDays, updatedAt };
  }
  async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    await this.save();
    await this.writeChain;
  }
  async reset(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.value = defaultValue();
    this.lastSnapshotAt = 0;
    await this.save();
  }
  private stateFor(vitality: number, baselineDays: number, previous: WellbeingState): WellbeingState {
    if (baselineDays < 3) return "learning";
    if (previous === "sleepy" && vitality < 25) return "sleepy";
    if (previous === "tired" && vitality < 45) return "tired";
    if (previous === "steady" && vitality < 75 && vitality >= 35) return "steady";
    if (vitality < 20) return "sleepy";
    if (vitality < 40) return "tired";
    if (vitality < 70) return "steady";
    return "energized";
  }
  private baseline(): { inputPerMinute: number; qualifiedDays: number } {
    const days = this.data.getStatistics(14).days.filter((day) => day.activeSeconds >= 30 * 60 && day.inputEvents > 0);
    if (!days.length) return { inputPerMinute: 0, qualifiedDays: 0 };
    const values = days.map((day) => day.inputEvents / Math.max(1, day.activeSeconds / 60));
    return { inputPerMinute: values.reduce((sum, item) => sum + item, 0) / values.length, qualifiedDays: days.length };
  }
  update(snapshot: ActivitySnapshot, settings: Settings): { snapshot: WellbeingSnapshot; changed: boolean } {
    if (!settings.wellbeing.enabled) return { snapshot: this.snapshot(), changed: false };
    const now = snapshot.timestamp;
    const elapsedSeconds = this.lastSnapshotAt ? Math.min(60, Math.max(0, (now - this.lastSnapshotAt) / 1000)) : 0;
    this.lastSnapshotAt = now;
    if (!elapsedSeconds) return { snapshot: this.snapshot(), changed: false };
    const before = this.value.state;
    const baseline = this.baseline();
    const inputPerMinute = (snapshot.keyboardCount10s + snapshot.mouseClicks10s + snapshot.mouseWheel10s) * 6;
    const estimated = snapshot.sensorSource === "fallback" || !settings.sensing.keyboardMouse;
    const active = snapshot.presenceState === "active" && !snapshot.locked;
    const resting = snapshot.locked || snapshot.presenceState === "resting" || snapshot.idleSeconds >= 120;
    const strongRest = snapshot.locked;
    const minutes = elapsedSeconds / 60;
    let vitalityDelta = 0;
    if (active) {
      vitalityDelta -= .2 * minutes;
      if (!estimated && baseline.inputPerMinute > 0) vitalityDelta -= Math.min(.3, Math.max(0, inputPerMinute / baseline.inputPerMinute - 1) * .3) * minutes;
    } else if (strongRest) vitalityDelta += 1.2 * minutes;
    else if (resting) vitalityDelta += .8 * minutes;
    else vitalityDelta += .4 * minutes;
    this.value.vitality = clamp(this.value.vitality + vitalityDelta);
    const neutralDelta = (70 - this.value.mood) * .0005 * elapsedSeconds;
    this.value.mood = clamp(this.value.mood + neutralDelta);
    if (this.value.vitality < 20) this.value.lowVitalitySince ??= now;
    else this.value.lowVitalitySince = null;
    if (this.value.lowVitalitySince && now - this.value.lowVitalitySince >= 30 * 60_000 && now - this.value.lastRewardAt >= 30 * 60_000) {
      this.value.mood = clamp(this.value.mood - 1); this.value.lastRewardAt = now;
    }
    this.value.baselineDays = baseline.qualifiedDays;
    this.value.estimated = estimated;
    this.value.updatedAt = now;
    this.value.state = this.stateFor(this.value.vitality, baseline.qualifiedDays, before);
    this.data.recordWellbeing({ vitality: this.value.vitality, mood: this.value.mood, recovering: vitalityDelta > 0, highLoad: active && this.value.vitality < 40 }, elapsedSeconds, now);
    this.scheduleSave();
    return { snapshot: this.snapshot(), changed: before !== this.value.state };
  }
  reward(kind: "task" | "rest"): WellbeingSnapshot {
    const delta = kind === "task" ? 2 : 1;
    this.value.mood = clamp(this.value.mood + delta); this.value.updatedAt = Date.now();
    this.value.state = this.stateFor(this.value.vitality, this.value.baselineDays, this.value.state); this.scheduleSave(50); return this.snapshot();
  }
  private scheduleSave(delay = 15_000): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.save(); }, delay);
  }
  async save(): Promise<void> {
    const snapshot = structuredClone(this.value);
    const write = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path()), { recursive: true }); const temp = `${this.path()}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2), "utf8"); await rename(temp, this.path());
    });
    this.writeChain = write; await write;
  }
}
