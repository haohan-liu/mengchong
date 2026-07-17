import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from "electron";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { ActivitySnapshot, PetRuntimeStatus, PetSpeechKind, PetState, Settings, UpdateStatus } from "../src/types.js";
import { defaultSettings, SettingsStore } from "./services/SettingsStore.js";
import { DataStore } from "./services/DataStore.js";
import { SensorService } from "./services/SensorService.js";
import { DeepSeekAgent } from "./services/DeepSeekAgent.js";
import { migrateDataDirectory } from "./services/StorageMigration.js";
import { AgentTools } from "./services/AgentTools.js";
import { ReminderScheduler } from "./services/ReminderScheduler.js";
import { UpdateService } from "./services/UpdateService.js";

const APP_STATES = new Set<PetState>(["BOOT", "APPEAR", "IDLE", "LISTENING", "USER_TYPING", "THINKING", "RESPONDING", "SUCCESS", "ERROR", "OFFLINE", "LOW_BATTERY", "SLEEP", "DRAGGING", "REACTION", "DISAPPEAR"]);
const RELEASES_URL = "https://github.com/haohan-liu/mengchong-exe/releases";
const STATE_ACTIONS: Record<PetState, string[]> = {
  BOOT: ["idle_breath"], APPEAR: ["wave_hello"], IDLE: ["idle_breath", "idle_blink", "idle_look_around"], LISTENING: ["listen"],
  USER_TYPING: ["user_typing", "type_fast"], THINKING: ["thinking", "loading"], RESPONDING: ["talk_normal"], SUCCESS: ["success"],
  ERROR: ["error"], OFFLINE: ["offline"], LOW_BATTERY: ["low_battery"], SLEEP: ["stand_sleep"],
  DRAGGING: ["dragged"], REACTION: ["clicked", "multi_clicked"], DISAPPEAR: ["good_night"]
};
const smokeMode = process.argv.includes("--smoke-test");
// 只有由 Windows 登录项启动时才应用“启动延迟”；用户手动打开应用不需要等待。
// 该参数由 SettingsStore 中的 Windows 自启动登记统一写入。
const launchedAtLogin = process.argv.includes("--autostart");
if (smokeMode) {
  // CI/无完整显卡运行库的环境可能无法启动 Chromium GPU 子进程；烟雾测试使用软件渲染即可验证界面与 IPC。
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.setPath("userData", join(app.getPath("temp"), `qpet-smoke-${process.pid}`));
}
let actionIds = new Set<string>();
let petWindow: BrowserWindow | null = null;
let consoleWindow: BrowserWindow | null = null;
let consoleRequestedTab = "home";
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settingsStore: SettingsStore;
let dataStore: DataStore;
let sensor: SensorService;
let agent: DeepSeekAgent;
let agentTools: AgentTools;
let updateService: UpdateService;
const reminderScheduler = new ReminderScheduler();
let draggingTimer: NodeJS.Timeout | null = null;
let manualStateTimer: NodeJS.Timeout | null = null;
let sensingPauseTimer: NodeJS.Timeout | null = null;
let lastEnergySnapshotAt = 0;
let lastProactiveAt = 0;
let proactivePending = false;
let dragOffset = { x: 0, y: 0 };
let writesPaused = false;
let flushingQuit = false;
let petVisibilityTarget = true;
let lastUpdateNotificationPhase = "";
let visibilityAnimationToken = 0;
let petScaleAnimationTimer: NodeJS.Timeout | null = null;
let petScaleAnimation: { targetScale: number; anchorRight: number; anchorBottom: number } | null = null;

const runtime: PetRuntimeStatus = {
  state: "BOOT", action: "idle_breath", source: "startup", sensingPausedUntil: null,
  activity: {
    timestamp: Date.now(), foregroundProcess: "unknown", foregroundPath: "", windowTitle: "", documentTitle: "",
    appCategory: "other", activeAppSeconds: 0, appSwitches5m: 0,
    keyboardCount1s: 0, keyboardCount10s: 0, keyboardPulse: false,
    mouseClicks1s: 0, mouseClicks10s: 0, mouseClickPulse: false,
    mouseWheel1s: 0, mouseWheel10s: 0, mouseDistance1s: 0, mouseDistance10s: 0,
    idleSeconds: 0, fullscreen: false, locked: false, meeting: false,
    microphoneActive: false, online: true, batteryPercent: 100, charging: true, sensorSource: "fallback",
    performance: { systemCpuPercent: 0, systemMemoryPercent: 0, petCpuPercent: 0, petMemoryMb: 0, petProcessCount: 0, sensorMemoryMb: 0, eventLoopLagMs: 0 }
  },
  sensorHealthy: false,
  aiHealthy: false
};

function appRoot(): string { return app.getAppPath(); }
function preloadPath(): string { return join(appRoot(), "dist-electron", "electron", "preload.cjs"); }
function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, "app-icon.png") : join(appRoot(), "assets", "icons", "app-icon.png");
}
function appIcon() {
  const icon = nativeImage.createFromPath(appIconPath());
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

function reportRendererHealth(window: BrowserWindow, label: "pet" | "console" | "chat"): void {
  window.webContents.on("preload-error", (_event, path, error) => {
    console.error(`[${label}] preload failed: ${path}`, error);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) console.error(`[${label}] page load failed (${code}): ${description} ${url}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[${label}] renderer exited: ${details.reason} (${details.exitCode})`);
  });
  window.webContents.on("console-message", (_event, level, message, lineNumber, sourceId) => {
    if (level >= 2) console.error(`[${label}] renderer level ${level}: ${message} (${sourceId}:${lineNumber})`);
  });
}

async function loadRenderer(window: BrowserWindow, page: "index.html" | "console.html" | "chat.html"): Promise<void> {
  const devUrl = process.env.PET_DEV_URL;
  if (devUrl) await window.loadURL(`${devUrl}/${page}`);
  else await window.loadFile(join(appRoot(), "dist", page));
}

function clampPetToWorkArea(): void {
  // setBounds emits move events. Clamping every animation frame competes with
  // resizing on Windows and is visible as a small shake at the window edge.
  if (petScaleAnimationTimer) return;
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
  if (x !== bounds.x || y !== bounds.y) petWindow.setPosition(x, y, false);
}

async function setPetVisibility(visible: boolean): Promise<void> {
  const window = petWindow;
  if (!window || window.isDestroyed()) return;
  petVisibilityTarget = visible;
  if (visible && window.isVisible() && window.getOpacity() >= .999) return;
  if (!visible && !window.isVisible()) return;
  const token = ++visibilityAnimationToken;
  if (visible && !window.isVisible()) {
    window.setOpacity(0);
    window.showInactive();
  }
  const from = window.getOpacity();
  const to = visible ? 1 : 0;
  const startedAt = Date.now();
  const duration = visible ? 220 : 170;
  while (token === visibilityAnimationToken && Date.now() - startedAt < duration) {
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    window.setOpacity(from + (to - from) * eased);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (token !== visibilityAnimationToken || window.isDestroyed()) return;
  window.setOpacity(to);
  if (!visible) {
    window.hide();
    window.setOpacity(1);
  }
}

async function animatePetEntrance(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;
  await waitForRendererElement(window, ".pet-hit");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (window.isDestroyed()) return;
  const start = window.getBounds();
  const area = screen.getDisplayMatching(start).workArea;
  const target = {
    x: area.x + area.width - start.width - 24,
    y: area.y + area.height - start.height - 24
  };
  runtime.state = "DRAGGING";
  runtime.source = "startup-entrance";
  sendPetAction("dragged");
  const startedAt = Date.now();
  const duration = 1_900;
  await new Promise<void>((resolve) => {
    const move = () => {
      if (window.isDestroyed()) { resolve(); return; }
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = progress < .5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      window.setPosition(
        Math.round(start.x + (target.x - start.x) * eased),
        Math.round(start.y + (target.y - start.y) * eased),
        false
      );
      if (progress < 1) setTimeout(move, 16);
      else resolve();
    };
    move();
  });
  if (window.isDestroyed()) return;
  runtime.state = "REACTION";
  runtime.source = "startup-entrance";
  sendPetAction("drop_landing");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
}

function animatePetScale(scale: number): void {
  const window = petWindow;
  if (!window || window.isDestroyed()) return;
  const targetScale = Math.min(1.5, Math.max(.6, scale));
  const bounds = window.getBounds();
  if (!petScaleAnimation) petScaleAnimation = { targetScale, anchorRight: bounds.x + bounds.width, anchorBottom: bounds.y + bounds.height };
  else petScaleAnimation.targetScale = targetScale;
  window.webContents.send("pet:scale-frame", { scale: bounds.width / 360 });
  if (petScaleAnimationTimer) return;
  const tick = () => {
    petScaleAnimationTimer = null;
    const activeWindow = petWindow;
    const animation = petScaleAnimation;
    if (!activeWindow || activeWindow.isDestroyed() || !animation) return;
    const current = activeWindow.getBounds();
    const targetWidth = Math.round(360 * animation.targetScale);
    const targetHeight = Math.round(520 * animation.targetScale);
    // Keep one target and one bottom-right anchor throughout a wheel burst.
    // This avoids restarting a short native-window animation for every notch.
    const width = Math.abs(targetWidth - current.width) <= 1 ? targetWidth : Math.round(current.width + (targetWidth - current.width) * .42);
    const height = Math.abs(targetHeight - current.height) <= 1 ? targetHeight : Math.round(current.height + (targetHeight - current.height) * .42);
    activeWindow.setBounds({
      x: animation.anchorRight - width,
      y: animation.anchorBottom - height,
      width,
      height,
    }, false);
    activeWindow.webContents.send("pet:scale-frame", { scale: width / 360 });
    if (width !== targetWidth || height !== targetHeight) {
      petScaleAnimationTimer = setTimeout(tick, 16);
      return;
    }
    petScaleAnimation = null;
    clampPetToWorkArea();
  };
  petScaleAnimationTimer = setTimeout(tick, 0);
}

function applyAppearance(settings: Settings): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setAlwaysOnTop(settings.appearance.alwaysOnTop, "floating");
  animatePetScale(settings.appearance.scale);
}

async function createPetWindow(): Promise<void> {
  const settings = settingsStore.get();
  const width = Math.round(360 * settings.appearance.scale);
  const height = Math.round(520 * settings.appearance.scale);
  const area = screen.getPrimaryDisplay().workArea;
  petWindow = new BrowserWindow({
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: settings.appearance.alwaysOnTop,
    skipTaskbar: true,
    icon: appIcon(),
    show: false,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true }
  });
  const window = petWindow;
  reportRendererHealth(window, "pet");
  petWindow.setMenu(null);
  petWindow.on("move", clampPetToWorkArea);
  petWindow.on("closed", () => {
    if (draggingTimer) clearInterval(draggingTimer);
    draggingTimer = null;
    petWindow = null;
  });
  await loadRenderer(window, "index.html");
  if (!window.isDestroyed()) {
    // 覆盖升级沿用同一份设置，因此用户原先配置的自启动延迟不会丢失。
    // 限制在 0–30 秒，避免损坏的旧设置导致窗口长期不可见。
    if (launchedAtLogin) {
      const delayMs = Math.max(0, Math.min(30, settings.reminders.startupDelaySeconds)) * 1_000;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    petVisibilityTarget = true;
    window.showInactive();
    await animatePetEntrance(window);
  }
}

async function openConsole(tab = "home"): Promise<void> {
  consoleRequestedTab = tab;
  if (consoleWindow && !consoleWindow.isDestroyed()) { syncWindowCaption(consoleWindow, "console"); consoleWindow.show(); consoleWindow.focus(); consoleWindow.webContents.send("console:navigate", tab); return; }
  const petName = settingsStore.get().petName;
  consoleWindow = new BrowserWindow({
    width: 1080, height: 760, minWidth: 900, minHeight: 640, show: false,
    title: `${petName}桌宠控制台`,
    icon: appIcon(),
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const window = consoleWindow;
  reportRendererHealth(window, "console");
  consoleWindow.setMenu(null);
  const reveal = () => {
    if (!window.isDestroyed()) { window.show(); window.focus(); }
  };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", () => { syncWindowCaption(window, "console"); reveal(); });
  window.on("focus", () => syncWindowCaption(window, "console"));
  consoleWindow.on("closed", () => { consoleWindow = null; });
  await loadRenderer(window, "console.html");
}

async function openChat(): Promise<void> {
  if (chatWindow && !chatWindow.isDestroyed()) { syncWindowCaption(chatWindow, "chat"); chatWindow.show(); chatWindow.focus(); return; }
  const petName = settingsStore.get().petName;
  chatWindow = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 620, show: false,
    title: `和${petName}聊天`,
    icon: appIcon(),
    backgroundColor: "#fbf7f9",
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const window = chatWindow;
  reportRendererHealth(window, "chat");
  window.setMenu(null);
  const reveal = () => { if (!window.isDestroyed()) { window.show(); window.focus(); } };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", () => { syncWindowCaption(window, "chat"); reveal(); });
  window.on("focus", () => syncWindowCaption(window, "chat"));
  window.on("closed", () => { chatWindow = null; });
  await loadRenderer(window, "chat.html");
}

function createTray(): void {
  const candidates = [appIconPath(), join(appRoot(), "assets", "generated", "character-anchor.png"), join(process.resourcesPath, "character-anchor.png")];
  let icon = nativeImage.createEmpty();
  for (const path of candidates) {
    const candidate = nativeImage.createFromPath(path);
    if (!candidate.isEmpty()) { icon = candidate.resize({ width: 32, height: 32 }); break; }
  }
  tray = new Tray(icon);
  tray.setToolTip(`${settingsStore.get().petName} AI 桌宠`);
  tray.setContextMenu(buildTrayMenu(settingsStore.get().petName));
  tray.on("click", () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    void setPetVisibility(!petVisibilityTarget);
  });
}

function buildTrayMenu(petName: string): Menu {
  const energySaving = settingsStore.get().manualMode === "energy_saving";
  return Menu.buildFromTemplate([
    { label: `打开${petName}控制台`, click: () => void openConsole() },
    { label: `和${petName}聊天`, click: () => void openChat() },
    { label: `让${petName}说句话`, click: () => void setPetVisibility(true).then(() => showPetSpeech("proactive")) },
    { label: energySaving ? "退出节能模式" : "开启节能模式", type: "checkbox", checked: energySaving, click: () => void toggleEnergySaving() },
    { label: "暂停感知 10 分钟", click: () => setSensingPausedUntil(Date.now() + 600_000) },
    { type: "separator" },
    { label: "显示桌宠", click: () => void setPetVisibility(true) },
    { label: "隐藏桌宠", click: () => void setPetVisibility(false) },
    { label: "退出", click: () => app.quit() }
  ]);
}

async function toggleEnergySaving(): Promise<void> {
  const settings = settingsStore.get();
  settings.manualMode = settings.manualMode === "energy_saving" ? "auto" : "energy_saving";
  const saved = await settingsStore.save(settings);
  petWindow?.webContents.send("settings:changed", saved);
  consoleWindow?.webContents.send("settings:changed", saved);
  chatWindow?.webContents.send("settings:changed", saved);
  applyManualMode(saved);
  applyBranding(saved);
}

function applyBranding(settings: Settings): void {
  app.setName(`${settings.petName}桌宠`);
  consoleWindow?.setTitle(`${settings.petName}桌宠控制台`);
  chatWindow?.setTitle(`和${settings.petName}聊天`);
  tray?.setToolTip(`${settings.petName} AI 桌宠`);
  tray?.setContextMenu(buildTrayMenu(settings.petName));
}

function syncWindowCaption(window: BrowserWindow, target: "console" | "chat"): void {
  const name = settingsStore.get().petName;
  window.setTitle(target === "console" ? `${name}桌宠控制台` : `和${name}聊天`);
}

function sendPetAction(action: string): void {
  if (!actionIds.has(action)) return;
  runtime.action = action;
  petWindow?.webContents.send("pet:action", action);
}

function setPetState(state: PetState, source: string): void {
  runtime.state = state;
  runtime.source = source;
  const actions = STATE_ACTIONS[state];
  const candidates = actions.length > 1 ? actions.filter((action) => action !== runtime.action) : actions;
  sendPetAction(candidates[Math.floor(Math.random() * candidates.length)] ?? actions[0] ?? "idle_breath");
}

function applyManualMode(settings: Settings): void {
  if (manualStateTimer) { clearTimeout(manualStateTimer); manualStateTimer = null; }
  if (settings.manualMode === "auto") setPetState("IDLE", "automatic");
  else if (settings.manualMode === "dnd") setPetState("IDLE", "do-not-disturb");
  else if (settings.manualMode === "rest") setPetState("SLEEP", "mode-rest");
  else if (settings.manualMode === "energy_saving") setPetState("IDLE", "mode-energy-saving");
  else if (settings.manualMode === "low_battery") setPetState("LOW_BATTERY", "mode-low-battery");
  else if (settings.manualState) {
    setPetState(settings.manualState, "manual-mode");
    if (settings.manualUntil && settings.manualUntil > Date.now()) {
      manualStateTimer = setTimeout(() => {
        const current = settingsStore.get();
        if (current.manualMode !== "manual" || !current.manualUntil || current.manualUntil > Date.now()) return;
        current.manualMode = "auto"; current.manualState = null; current.manualUntil = null;
        void settingsStore.save(current).then((saved) => {
          petWindow?.webContents.send("settings:changed", saved);
          consoleWindow?.webContents.send("settings:changed", saved);
          chatWindow?.webContents.send("settings:changed", saved);
          applyManualMode(saved);
        });
      }, settings.manualUntil - Date.now() + 50);
    }
  }
  broadcastRuntimeStatus();
}

function broadcastRuntimeStatus(): void {
  const snapshot = structuredClone(runtime);
  petWindow?.webContents.send("pet:runtime-changed", snapshot);
  consoleWindow?.webContents.send("pet:runtime-changed", snapshot);
  chatWindow?.webContents.send("pet:runtime-changed", snapshot);
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  consoleWindow?.webContents.send("updates:changed", status);
  if (status.phase === lastUpdateNotificationPhase) return;
  lastUpdateNotificationPhase = status.phase;
  if (status.phase === "available") {
    const notification = new Notification({ title: `${settingsStore.get().petName}桌宠有新版本`, body: `${status.availableVersion ?? "新版本"} 已准备好，点击查看更新` });
    notification.on("click", () => void openConsole("updates"));
    notification.show();
  }
  if (status.phase === "downloaded") {
    const notification = new Notification({ title: "桌宠更新已下载", body: "点击打开控制台，重启并完成安装" });
    notification.on("click", () => void openConsole("updates"));
    notification.show();
  }
}

async function syncUninstallDataPath(dataDirectory: string): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged || smokeMode) return;
  await new Promise<void>((resolve) => {
    execFile("reg.exe", ["ADD", "HKCU\\Software\\com.qpet.ai", "/v", "DataDirectory", "/t", "REG_SZ", "/d", dataDirectory, "/f"], { windowsHide: true }, (error) => {
      if (error) console.error("Unable to record uninstall data path:", error);
      resolve();
    });
  });
}

function setSensingPausedUntil(until: number | null): void {
  if (sensingPauseTimer) { clearTimeout(sensingPauseTimer); sensingPauseTimer = null; }
  runtime.sensingPausedUntil = until && until > Date.now() ? until : null;
  if (runtime.sensingPausedUntil) {
    sensingPauseTimer = setTimeout(() => {
      sensingPauseTimer = null;
      runtime.sensingPausedUntil = null;
      broadcastRuntimeStatus();
    }, Math.max(1, runtime.sensingPausedUntil - Date.now() + 50));
  }
  broadcastRuntimeStatus();
}

function filterActivity(snapshot: ActivitySnapshot, settings: Settings): ActivitySnapshot {
  const active = settings.firstRunConsent && settings.sensing.enabled && (!runtime.sensingPausedUntil || runtime.sensingPausedUntil <= Date.now());
  const result = structuredClone(snapshot);
  if (!active || !settings.sensing.foregroundApp) {
    result.foregroundProcess = "未启用"; result.foregroundPath = ""; result.appCategory = "other";
    result.activeAppSeconds = 0; result.appSwitches5m = 0;
  }
  if (!active || !settings.sensing.windowTitle) { result.windowTitle = ""; result.documentTitle = ""; }
  if (!active || !settings.sensing.keyboardMouse) {
    result.keyboardCount1s = 0; result.keyboardCount10s = 0; result.keyboardPulse = false;
    result.mouseClicks1s = 0; result.mouseClicks10s = 0; result.mouseClickPulse = false;
    result.mouseWheel1s = 0; result.mouseWheel10s = 0; result.mouseDistance1s = 0; result.mouseDistance10s = 0;
  }
  if (!active || !settings.sensing.meeting) result.meeting = false;
  if (!active || !settings.sensing.microphone) result.microphoneActive = false;
  if (!active || !settings.sensing.power) { result.batteryPercent = 100; result.charging = true; }
  if (!active || !settings.sensing.network) result.online = true;
  return result;
}

function isScheduledSilent(settings: Settings, now = new Date()): boolean {
  if (!settings.reminders.scheduledSilent) return false;
  const toMinutes = (value: string): number | null => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]), minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  };
  const start = toMinutes(settings.reminders.quietStart);
  const end = toMinutes(settings.reminders.quietEnd);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

async function showPetSpeech(kind: PetSpeechKind): Promise<boolean> {
  const window = petWindow;
  if (!window || window.isDestroyed() || !window.isVisible()) return false;
  const text = await agent.nextCompanionLine(kind);
  if (!text.trim() || window.isDestroyed()) return false;
  window.webContents.send("pet:speech", { text, kind });
  return true;
}

async function maybeSendProactive(snapshot: ActivitySnapshot, settings: Settings): Promise<void> {
  const now = Date.now();
  const cooldownMs = Math.max(1, settings.reminders.proactiveCooldownMinutes) * 60_000;
  const limit = Math.max(0, Math.round(settings.reminders.proactiveDailyLimit));
  const sensingActive = settings.firstRunConsent && settings.sensing.enabled && (!runtime.sensingPausedUntil || runtime.sensingPausedUntil <= now);
  const silent = isScheduledSilent(settings) || snapshot.locked || snapshot.idleSeconds >= 60
    || (settings.reminders.meetingSilent && snapshot.meeting)
    || (settings.reminders.fullscreenSilent && snapshot.fullscreen);
  if (proactivePending || settings.manualMode !== "auto" || !sensingActive || silent || !snapshot.online
    || limit === 0 || dataStore.getProactiveCount(now) >= limit || now - lastProactiveAt < cooldownMs) return;
  proactivePending = true;
  lastProactiveAt = now;
  try {
    if (await showPetSpeech("proactive")) dataStore.incrementProactive(now);
  } finally {
    proactivePending = false;
  }
}

async function waitForRendererElement(window: BrowserWindow, selector: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      true
    ) as boolean;
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Renderer did not create ${selector} within ${timeoutMs}ms`);
}

async function waitForCanvasContent(window: BrowserWindow, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasPixels = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('.pet-shell canvas');
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return false;
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return false;
      for (let index = 3; index < data.length; index += 64) if (data[index] > 0) return true;
      return false;
    })()`, true) as boolean;
    if (hasPixels) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Pet canvas remained transparent for ${timeoutMs}ms`);
}

async function runSmokeTest(): Promise<void> {
  if (!petWindow) throw new Error("Pet window was not created");
  await waitForRendererElement(petWindow, ".pet-shell canvas");
  await waitForCanvasContent(petWindow);
  sendPetAction("wave_hello");
  await openConsole();
  if (!consoleWindow) throw new Error("Console window was not created");
  await waitForRendererElement(consoleWindow, ".console-shell nav");
  const onboardingReady = await consoleWindow.webContents.executeJavaScript(`(async () => {
    const wait = () => new Promise(resolve => setTimeout(resolve, 40));
    if (!document.querySelector('[data-onboarding]')) return false;
    document.querySelector('[data-onboarding-next]')?.click(); await wait();
    const enable = document.querySelector('[data-command="onboarding-enable"]');
    if (!(enable instanceof HTMLButtonElement)) return false;
    enable.click(); await wait();
    document.querySelector('[data-command="onboarding-ai-later"]')?.click(); await wait();
    document.querySelector('[data-command="finish-onboarding"]')?.click(); await wait();
    const deadline = Date.now() + 2000;
    while (document.querySelector('[data-onboarding]') && Date.now() < deadline) await wait();
    return !document.querySelector('[data-onboarding]');
  })()`, true) as boolean;
  if (!onboardingReady) throw new Error("First-run onboarding did not complete its consent flow");
  const sensorDeadline = Date.now() + 4_000;
  while (runtime.activity.sensorSource === "fallback" && Date.now() < sensorDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  if (runtime.activity.sensorSource === "fallback") throw new Error("Native/compatibility input sensor did not start");
  if (runtime.activity.performance.petMemoryMb <= 0) throw new Error("Performance telemetry did not report pet memory");
  const layoutReady = await consoleWindow.webContents.executeJavaScript(`(() => {
    const main = document.querySelector('.console-shell > main');
    const performance = document.querySelector('[data-live="pet-memory"]');
    return Boolean(main && performance && getComputedStyle(main).overflowY === 'auto');
  })()`, true) as boolean;
  if (!layoutReady) throw new Error("Console fixed navigation/performance layout is not ready");
  const sensingCycle = await consoleWindow.webContents.executeJavaScript(`(async () => {
    await window.petAPI.pet.pauseSensing(10);
    const paused = await window.petAPI.pet.getRuntime();
    await window.petAPI.pet.resumeSensing();
    const resumed = await window.petAPI.pet.getRuntime();
    return { pausedUntil: paused.sensingPausedUntil, resumedUntil: resumed.sensingPausedUntil };
  })()`, true) as { pausedUntil: number | null; resumedUntil: number | null };
  if (!sensingCycle.pausedUntil || sensingCycle.pausedUntil <= Date.now()) throw new Error("Sensing pause IPC did not update runtime state");
  if (sensingCycle.resumedUntil !== null) throw new Error("Sensing resume IPC did not clear runtime state");
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="appearance"]')?.click()`, true);
  await waitForRendererElement(consoleWindow, "[data-appearance=\"scale\"]");
  const scaleDispatched = await consoleWindow.webContents.executeJavaScript(`(() => {
    const range = document.querySelector('[data-appearance="scale"]');
    if (!(range instanceof HTMLInputElement)) return false;
    range.value = '0.76';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`, true);
  if (!scaleDispatched) throw new Error("Appearance size slider was not found");
  const sizeDeadline = Date.now() + 3_000;
  while (petWindow.getBounds().width !== 274 && Date.now() < sizeDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (petWindow.getBounds().width !== 274) throw new Error("Appearance size control did not resize the pet window");
  const wheelDispatched = await petWindow.webContents.executeJavaScript(`(() => {
    const hit = document.querySelector('.pet-hit');
    if (!(hit instanceof HTMLButtonElement)) return false;
    hit.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    return true;
  })()`, true) as boolean;
  if (!wheelDispatched) throw new Error("Pet wheel scaling target was not found");
  const wheelDeadline = Date.now() + 3_000;
  while (Math.abs(settingsStore.get().appearance.scale - .77) > .001 && Date.now() < wheelDeadline) await new Promise((resolve) => setTimeout(resolve, 40));
  let consoleScale = "";
  let consoleBubbleScale = "";
  while ((consoleScale !== "0.77" || consoleBubbleScale !== "0.91") && Date.now() < wheelDeadline) {
    consoleScale = await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-appearance="scale"]')?.value ?? ''`, true) as string;
    consoleBubbleScale = await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-appearance="bubbleScale"]')?.value ?? ''`, true) as string;
    if (consoleScale !== "0.77" || consoleBubbleScale !== "0.91") await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (consoleScale !== "0.77" || consoleBubbleScale !== "0.91") throw new Error(`Pet wheel scale did not sync both console sliders: ${consoleScale}/${consoleBubbleScale}`);
  const clickSequence = await petWindow.webContents.executeJavaScript(`(async () => {
    const hit = document.querySelector('.pet-hit');
    if (!(hit instanceof HTMLButtonElement)) return false;
    hit.click(); await new Promise(resolve => setTimeout(resolve, 80));
    hit.click(); await new Promise(resolve => setTimeout(resolve, 80));
    hit.click(); return true;
  })()`, true) as boolean;
  if (!clickSequence) throw new Error("Pet click sequence target was not found");
  const multiDeadline = Date.now() + 2_000;
  while (String(runtime.action) !== "multi_clicked" && Date.now() < multiDeadline) await new Promise((resolve) => setTimeout(resolve, 30));
  if (String(runtime.action) !== "multi_clicked") throw new Error("Rapid clicks did not promote to the multi-click action");
  const bubbleDeadline = Date.now() + 2_000;
  let bubbleReady = false;
  while (!bubbleReady && Date.now() < bubbleDeadline) {
    bubbleReady = await petWindow.webContents.executeJavaScript(`(() => {
      const anchor = document.querySelector('.pet-bubble-anchor');
      const bubble = document.querySelector('.pet-bubble');
      const name = document.querySelector('[data-bubble-name]');
      if (!(anchor instanceof HTMLElement) || !(bubble instanceof HTMLElement) || anchor.hidden) return false;
      const rect = bubble.getBoundingClientRect();
      return name?.textContent === '珊珊' && rect.top >= 7 && rect.left >= 7 && rect.right <= innerWidth - 7;
    })()`, true) as boolean;
    if (!bubbleReady) await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (!bubbleReady) throw new Error("Named top speech bubble was not presented after a click");
  const linkedChrome = await petWindow.webContents.executeJavaScript(`(async () => {
    const inspect = () => {
      const bubble = document.querySelector('.pet-bubble');
      const status = document.querySelector('.status-pill');
      if (!(bubble instanceof HTMLElement) || !(status instanceof HTMLElement)) return null;
      const rect = bubble.getBoundingClientRect();
      const statusScale = Number(getComputedStyle(status).scale);
      return {
        safe: rect.top >= 4 && rect.left >= 4 && rect.right <= innerWidth - 4,
        rect: { top: rect.top, left: rect.left, right: rect.right, width: rect.width },
        viewport: { width: innerWidth, height: innerHeight },
        bubbleScale: getComputedStyle(document.documentElement).getPropertyValue('--bubble-scale').trim(),
        statusScale,
        statusScaleValid: Number.isFinite(statusScale),
      };
    };
    const original = await window.petAPI.settings.get();
    const results = [];
    for (const scale of [.6, 1.5]) {
      const next = structuredClone(original); next.appearance.scale = scale;
      await window.petAPI.settings.update(next);
      await new Promise(resolve => setTimeout(resolve, 260));
      results.push(inspect());
    }
    const restored = structuredClone(original); restored.appearance.scale = .77;
    await window.petAPI.settings.update(restored);
    await new Promise(resolve => setTimeout(resolve, 260));
    return results;
  })()`, true) as Array<{ safe: boolean; statusScale: number; statusScaleValid: boolean } | null>;
  if (!linkedChrome[0]?.safe || !linkedChrome[1]?.safe) {
    throw new Error(`Linked bubble scaling crossed the pet window safe area: ${JSON.stringify(linkedChrome)}`);
  }
  if (!linkedChrome[0].statusScaleValid || !linkedChrome[1].statusScaleValid) throw new Error("Status information reported an invalid linked scale");
  if (linkedChrome[0].statusScale >= .96 || linkedChrome[1].statusScale <= 1.04) throw new Error("Status information did not scale moderately with the pet");
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="states"]')?.click()`, true);
  await waitForRendererElement(consoleWindow, "[data-action=\"clicked\"]");
  const actionDispatched = await consoleWindow.webContents.executeJavaScript(`(() => {
    const action = document.querySelector('[data-action="clicked"]');
    if (!(action instanceof HTMLButtonElement)) return false;
    action.click();
    return true;
  })()`, true);
  if (!actionDispatched) throw new Error("Console action preview button was not found");
  const actionDeadline = Date.now() + 2_000;
  while (runtime.action !== "clicked" && Date.now() < actionDeadline) await new Promise((resolve) => setTimeout(resolve, 30));
  if (runtime.action !== "clicked") throw new Error("Console action preview did not reach the pet renderer");
  const dragIpc = await petWindow.webContents.executeJavaScript(`window.petAPI.pet.startDrag().then(async value => { await window.petAPI.pet.stopDrag(); return value; })`, true) as boolean;
  if (!dragIpc) throw new Error("Pet drag IPC was rejected while position was unlocked");
  const energyModeDispatched = await consoleWindow.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-mode="energy_saving"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`, true) as boolean;
  if (!energyModeDispatched) throw new Error("Energy saving mode control was not found");
  const energyDeadline = Date.now() + 2_000;
  while (settingsStore.get().manualMode !== "energy_saving" && Date.now() < energyDeadline) await new Promise((resolve) => setTimeout(resolve, 30));
  if (settingsStore.get().manualMode !== "energy_saving") throw new Error("Energy saving mode did not reach settings");
  let energyLabel = "";
  const labelDeadline = Date.now() + 2_000;
  while (energyLabel !== "节能陪伴中" && Date.now() < labelDeadline) {
    energyLabel = await petWindow.webContents.executeJavaScript(`document.querySelector('.status-pill span')?.textContent ?? ''`, true) as string;
    if (energyLabel !== "节能陪伴中") await new Promise((resolve) => setTimeout(resolve, 30));
  }
  if (energyLabel !== "节能陪伴中") throw new Error(`Pet energy status label was incorrect: ${energyLabel}`);
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-mode="auto"]')?.click()`, true);
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="home"]')?.click()`, true);
  await waitForRendererElement(consoleWindow, ".hero-card");
  const scrollBefore = await consoleWindow.webContents.executeJavaScript(`(() => { const main=document.querySelector('.workspace'); if(!(main instanceof HTMLElement))return -1; main.scrollTop=main.scrollHeight; return main.scrollTop; })()`, true) as number;
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const scrollAfter = await consoleWindow.webContents.executeJavaScript(`document.querySelector('.workspace')?.scrollTop ?? -1`, true) as number;
  if (scrollBefore <= 0 || Math.abs(scrollAfter - scrollBefore) > 2) throw new Error(`Console scroll position changed without user action: ${scrollBefore} -> ${scrollAfter}`);
  for (const tab of ["home", "appearance", "states", "privacy", "reminders", "ai", "stats", "storage", "updates"]) {
    await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="${tab}"]')?.click()`, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = await consoleWindow.webContents.executeJavaScript(`(() => { const main=document.querySelector('.workspace'); if(!(main instanceof HTMLElement))return -1; main.scrollTop=Math.min(main.scrollHeight, Math.max(0, main.scrollHeight-main.clientHeight)); return main.scrollTop; })()`, true) as number;
    consoleWindow.webContents.send("pet:activity", runtime.activity);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const after = await consoleWindow.webContents.executeJavaScript(`document.querySelector('.workspace')?.scrollTop ?? -1`, true) as number;
    if (Math.abs(after - before) > 2) throw new Error(`Console ${tab} page moved after activity update: ${before} -> ${after}`);
  }
  const updatePanelReady = await consoleWindow.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-update-phase]');
    return panel?.getAttribute('data-update-phase') === 'disabled' && Boolean(panel.querySelector('button:disabled'));
  })()`, true) as boolean;
  if (!updatePanelReady) throw new Error("Console update panel did not expose the safe development state");
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="ai"]')?.click()`, true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const aiControlsContained = await consoleWindow.webContents.executeJavaScript(`(() => [...document.querySelectorAll('[data-switch-section="ai"]')].every(control => {
    const card = control.closest('.card');
    return card && control.getBoundingClientRect().right <= card.getBoundingClientRect().right - 12;
  }))()`, true) as boolean;
  if (!aiControlsContained) throw new Error("AI greeting controls overflowed their settings card");
  const baseUrlLockReady = await consoleWindow.webContents.executeJavaScript(`(async () => {
    const wait = () => new Promise(resolve => setTimeout(resolve, 60));
    const input = document.querySelector('[data-base-url]');
    const edit = document.querySelector('[data-command="edit-base-url"]');
    if (!(input instanceof HTMLInputElement) || !(edit instanceof HTMLButtonElement) || !input.readOnly) return false;
    edit.click(); await wait();
    const save = document.querySelector('[data-command="save-base-url"]');
    if (input.readOnly || !(save instanceof HTMLButtonElement)) return false;
    save.click(); await wait();
    return input.readOnly && Boolean(document.querySelector('[data-command="edit-base-url"]'));
  })()`, true) as boolean;
  if (!baseUrlLockReady) throw new Error("DeepSeek Base URL did not unlock and relock through its edit control");
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="appearance"]')?.click()`, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const accentChanged = await consoleWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('.color-picker-trigger')?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const swatch = document.querySelector('[data-color-value="#4f7fce"]');
    if (!(swatch instanceof HTMLButtonElement)) return false;
    swatch.click(); await new Promise(resolve => setTimeout(resolve, 160));
    return getComputedStyle(document.querySelector('.console-shell')).getPropertyValue('--accent').trim().toLowerCase() === '#4f7fce';
  })()`, true) as boolean;
  if (!accentChanged) throw new Error("Console emphasis color did not apply from the appearance picker");
  const petAccent = await petWindow.webContents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase()`, true) as string;
  if (petAccent !== "#4f7fce") throw new Error(`Pet emphasis color did not follow the console: ${petAccent}`);
  await openChat();
  if (!chatWindow) throw new Error("Agent chat window was not created");
  await waitForRendererElement(chatWindow, ".chat-shell .composer textarea");
  const chatContract = await chatWindow.webContents.executeJavaScript(`(() => {
    const shell = document.querySelector('.chat-shell');
    const topic = document.querySelector('.topic-list [data-topic-id]');
    const context = document.querySelector('[data-show-context]');
    const quota = document.querySelector('[data-quota-meta]');
    return Boolean(shell && topic && context && quota?.textContent?.includes('500'));
  })()`, true) as boolean;
  if (!chatContract) throw new Error("Agent chat topics, context or quota controls were not ready");
  const chatAccent = await chatWindow.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.chat-shell')).getPropertyValue('--accent').trim().toLowerCase()`, true) as string;
  if (chatAccent !== "#4f7fce") throw new Error(`Chat emphasis color did not follow the console: ${chatAccent}`);
  const chatSent = await chatWindow.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('.composer textarea');
    const form = document.querySelector('.composer');
    if (!(textarea instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false;
    textarea.value = '你好'; textarea.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true;
  })()`, true) as boolean;
  if (!chatSent) throw new Error("Agent chat composer did not accept a message");
  const chatDeadline = Date.now() + 3_000;
  while (!(await dataStore.listChats()).some((session) => session.messageCount >= 2) && Date.now() < chatDeadline) await new Promise((resolve) => setTimeout(resolve, 40));
  const storedTopics = await dataStore.listChats();
  const storedMessages = await Promise.all(storedTopics.map((session) => dataStore.messages(session.id, 0, 50)));
  if (!storedMessages.some((page) => page.messages.some((message) => message.source === "local"))) throw new Error("Agent chat did not persist its offline/local fallback reply");
  const localReplyVisible = await chatWindow.webContents.executeJavaScript(`Boolean([...document.querySelectorAll('.source.local')].some(node => node.textContent === '本地回复'))`, true) as boolean;
  if (!localReplyVisible) throw new Error("Agent chat did not label its local fallback reply");
  const initialTopicCount = (await dataStore.listChats()).length;
  await chatWindow.webContents.executeJavaScript(`document.querySelector('.new-topic')?.click()`, true);
  const topicDeadline = Date.now() + 2_000;
  while ((await dataStore.listChats()).length <= initialTopicCount && Date.now() < topicDeadline) await new Promise((resolve) => setTimeout(resolve, 40));
  if ((await dataStore.listChats()).length <= initialTopicCount) throw new Error("Agent chat did not create an independent topic");
  const contextOpened = await chatWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-show-context]')?.click(); await new Promise(resolve => setTimeout(resolve, 100));
    const drawer = document.querySelector('.context-drawer'); return drawer instanceof HTMLElement && !drawer.hidden;
  })()`, true) as boolean;
  if (!contextOpened) throw new Error("Agent chat context detail drawer did not open");
  chatWindow.close();
  if (!tray) throw new Error("Tray was not created");
  await setPetVisibility(true);
  tray.emit("click");
  await new Promise((resolve) => setTimeout(resolve, 220));
  if (petWindow.isVisible()) throw new Error("Tray click did not hide the visible pet");
  tray.emit("click");
  await new Promise((resolve) => setTimeout(resolve, 270));
  if (!petWindow.isVisible()) throw new Error("Second tray click did not restore the pet");
  console.log("Electron smoke: sensor, drag, wheel sync, multi-click, named bubble, full agent chat, tray toggle, controls, energy mode and stable renderers are ready");
}

function registerIpc(): void {
  ipcMain.handle("pet:start-drag", (event) => {
    if (!petWindow || settingsStore.get().appearance.lockPosition || event.sender !== petWindow.webContents) return false;
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    runtime.state = "DRAGGING";
    if (draggingTimer) clearInterval(draggingTimer);
    draggingTimer = setInterval(() => {
      if (!petWindow) return;
      const point = screen.getCursorScreenPoint();
      petWindow.setPosition(point.x - dragOffset.x, point.y - dragOffset.y, false);
    }, 16);
    return true;
  });
  ipcMain.handle("pet:stop-drag", () => {
    if (draggingTimer) clearInterval(draggingTimer);
    draggingTimer = null;
    clampPetToWorkArea();
    runtime.state = "REACTION";
    sendPetAction("drop_landing");
  });
  ipcMain.handle("pet:hide", () => setPetVisibility(false));
  ipcMain.handle("pet:runtime", () => structuredClone(runtime));
  ipcMain.handle("pet:pause-sensing", (_event, minutes: number) => {
    setSensingPausedUntil(Date.now() + Math.max(1, Math.min(1440, Number(minutes) || 10)) * 60_000);
  });
  ipcMain.handle("pet:resume-sensing", () => setSensingPausedUntil(null));
  ipcMain.handle("pet:next-speech", (event, kind: PetSpeechKind) => {
    if (event.sender !== petWindow?.webContents) return "";
    return agent.nextCompanionLine(kind === "proactive" ? "proactive" : "click");
  });
  ipcMain.on("pet:preview-scale", (event, value: { scale?: number; bubbleScale?: number }) => {
    if (event.sender !== petWindow?.webContents && event.sender !== consoleWindow?.webContents) return;
    const current = settingsStore.get().appearance;
    const scale = Math.min(1.5, Math.max(.6, Number(value?.scale) || current.scale));
    const bubbleScale = Math.min(1.3, Math.max(.8, Number(value?.bubbleScale) || current.bubbleScale));
    const preview = { scale, bubbleScale };
    animatePetScale(scale);
    petWindow?.webContents.send("pet:scale-preview", preview);
    consoleWindow?.webContents.send("pet:scale-preview", preview);
  });
  ipcMain.handle("pet:set-action", (event, action: string) => {
    if (!actionIds.has(action)) return false;
    runtime.action = action;
    runtime.source = event.sender === petWindow?.webContents ? "pet-state-machine" : "console-preview";
    if (event.sender !== petWindow?.webContents) sendPetAction(action);
    broadcastRuntimeStatus();
    return true;
  });
  ipcMain.handle("pet:set-state", async (event, state: PetState) => {
    if (!APP_STATES.has(state)) return false;
    if (event.sender === petWindow?.webContents) {
      // Renderer state reports are acknowledgements. Sending the mapped action
      // back here creates an IPC feedback loop that restarts the fade animation
      // continuously and keeps the renderer CPU busy.
      runtime.state = state;
      runtime.source = "pet-state-machine";
      broadcastRuntimeStatus();
    }
    else {
      const settings = settingsStore.get();
      settings.manualMode = "manual"; settings.manualState = state; settings.manualUntil = Date.now() + 30_000;
      const saved = await settingsStore.save(settings);
      petWindow?.webContents.send("settings:changed", saved);
      consoleWindow?.webContents.send("settings:changed", saved);
      chatWindow?.webContents.send("settings:changed", saved);
      applyManualMode(saved);
    }
    return true;
  });
  ipcMain.on("pet:animation-end", (event, action: string) => {
    if (event.sender !== petWindow?.webContents || runtime.action !== action) return;
    runtime.action = "idle_breath";
    broadcastRuntimeStatus();
  });

  ipcMain.handle("console:open", (_event, tab?: string) => openConsole(String(tab ?? "home")));
  ipcMain.handle("console:initial-tab", () => consoleRequestedTab);
  ipcMain.handle("console:close", () => consoleWindow?.close());
  ipcMain.handle("chat:open", () => openChat());
  ipcMain.handle("chat:close", () => chatWindow?.close());

  ipcMain.handle("settings:get", () => settingsStore.get());
  ipcMain.handle("settings:update", async (_event, settings: Settings) => {
    const previous = settingsStore.get();
    const saved = await settingsStore.save(settings);
    if ((!previous.sensing.enabled && saved.sensing.enabled) || (!previous.firstRunConsent && saved.firstRunConsent && saved.sensing.enabled)) setSensingPausedUntil(null);
    if (previous.sensing.enabled !== saved.sensing.enabled || previous.firstRunConsent !== saved.firstRunConsent) {
      runtime.activity = filterActivity(runtime.activity, saved);
      broadcastRuntimeStatus();
    }
    applyAppearance(saved);
    // Native window captions are outside the renderer DOM. Keep them in sync
    // on every saved settings snapshot, including delayed writes from sliders.
    applyBranding(saved);
    if (!previous.ai.smartCompanionSpeech && saved.ai.smartCompanionSpeech) void agent.warmCompanionLines(true);
    petWindow?.webContents.send("settings:changed", saved);
    consoleWindow?.webContents.send("settings:changed", saved);
    chatWindow?.webContents.send("settings:changed", saved);
    if (previous.manualMode !== saved.manualMode || previous.manualState !== saved.manualState || previous.manualUntil !== saved.manualUntil) applyManualMode(saved);
    return saved;
  });
  ipcMain.handle("settings:reset-position", () => {
    if (!petWindow) return;
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = petWindow.getBounds();
    petWindow.setPosition(area.x + area.width - bounds.width - 24, area.y + area.height - bounds.height - 24);
  });
  ipcMain.handle("settings:set-api-key", async (_event, value: string) => {
    const saved = await settingsStore.setApiKey(value);
    if (saved && value.trim()) void agent.warmCompanionLines(true);
    return saved;
  });
  ipcMain.handle("settings:has-api-key", () => settingsStore.hasApiKey());
  ipcMain.handle("settings:test-ai", () => agent.test());
  ipcMain.handle("window:sync-title", (event, target: string, rawName: string) => {
    const name = Array.from(String(rawName).replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 12).join("") || settingsStore.get().petName;
    if (target === "console" && event.sender === consoleWindow?.webContents) consoleWindow.setTitle(`${name}桌宠控制台`);
    if (target === "chat" && event.sender === chatWindow?.webContents) chatWindow.setTitle(`和${name}聊天`);
  });
  ipcMain.handle("settings:choose-directory", async () => {
    const result = await dialog.showOpenDialog(consoleWindow ?? petWindow!, { properties: ["openDirectory", "createDirectory"], title: "选择桌宠数据存储位置" });
    if (result.canceled || !result.filePaths[0]) return null;
    writesPaused = true;
    try {
      const nextPath = await migrateDataDirectory(settingsStore.get().dataDirectory, result.filePaths[0]);
      const next = settingsStore.get();
      next.dataDirectory = nextPath;
      await settingsStore.save(next);
      await dataStore.load();
      await syncUninstallDataPath(nextPath);
      if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload();
      return nextPath;
    } finally { writesPaused = false; }
  });

  ipcMain.handle("statistics:get", (_event, days: number) => dataStore.getStatistics(Math.min(90, Math.max(1, Number(days) || 30))));
  ipcMain.handle("statistics:clear", () => dataStore.clearStatistics().then(() => true));
  ipcMain.handle("updates:status", () => updateService.status());
  ipcMain.handle("updates:check", () => updateService.check());
  ipcMain.handle("updates:download", () => updateService.download());
  ipcMain.handle("updates:install", () => updateService.install());
  ipcMain.handle("updates:open-releases", () => shell.openExternal(RELEASES_URL));
  ipcMain.handle("storage:clear-chats", async () => {
    await dataStore.clearChats();
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload();
    return true;
  });
  ipcMain.handle("storage:reset-all", async () => {
    await Promise.all([dataStore.clearChats(), dataStore.clearStatistics()]);
    const previous = settingsStore.get();
    const next = defaultSettings();
    next.dataDirectory = previous.dataDirectory;
    next.firstRunConsent = previous.firstRunConsent;
    const saved = await settingsStore.save(next);
    applyAppearance(saved);
    petWindow?.webContents.send("settings:changed", saved);
    consoleWindow?.webContents.send("settings:changed", saved);
    chatWindow?.webContents.send("settings:changed", saved);
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload();
    return true;
  });

  ipcMain.handle("chat:create", (_event, title?: string) => dataStore.createChat(String(title ?? "新对话")));
  ipcMain.handle("chat:rename", (_event, sessionId: string, title: string) => dataStore.renameChat(String(sessionId), String(title)));
  ipcMain.handle("chat:delete", (_event, sessionId: string) => dataStore.deleteChat(String(sessionId)));
  ipcMain.handle("chat:send", async (event, sessionId: string, text: string) => {
    const content = String(text).trim();
    if (!content) throw new Error("消息不能为空");
    let id = String(sessionId || "");
    if (!await dataStore.chat(id)) id = (await dataStore.createChat()).id;
    return agent.chat(content, event.sender, id);
  });
  ipcMain.handle("chat:cancel", (_event, requestId: string) => agent.cancel(requestId));
  ipcMain.handle("chat:list", () => dataStore.listChats());
  ipcMain.handle("chat:messages", (_event, sessionId: string, cursor?: number, limit?: number) => dataStore.messages(String(sessionId), cursor, limit));
  ipcMain.handle("chat:status", () => agent.status());
  ipcMain.handle("chat:context-preview", () => agent.contextPreview());
  ipcMain.handle("agent:approval", (_event, id: string, approved: boolean) => agentTools.resolve(id, approved));
}

async function bootstrap(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(appRoot(), "animations_manifest.json"), "utf8")) as Array<{ id: string }>;
  actionIds = new Set(manifest.map((entry) => entry.id));
  settingsStore = new SettingsStore();
  await settingsStore.load();
  const recoveredSettings = settingsStore.get();
  if (recoveredSettings.manualMode === "manual" && (!recoveredSettings.manualUntil || recoveredSettings.manualUntil <= Date.now())) {
    recoveredSettings.manualMode = "auto";
    recoveredSettings.manualState = null;
    recoveredSettings.manualUntil = null;
    await settingsStore.save(recoveredSettings);
  }
  if (process.platform === "win32") app.setAppUserModelId("com.qpet.ai");
  applyBranding(settingsStore.get());
  dataStore = new DataStore(() => settingsStore.get().dataDirectory);
  await dataStore.load();
  await syncUninstallDataPath(settingsStore.get().dataDirectory);
  sensor = new SensorService();
  agentTools = new AgentTools({
    getActivity: () => runtime.activity,
    getContext: () => agent.contextPreview(),
    getPetName: () => settingsStore.get().petName,
    getToolPermission: (name) => {
      const permissions = settingsStore.get().ai.toolPermissions;
      if (name === "open_url" || name === "read_current_context") return permissions[name];
      return "ask";
    },
    setAction: (action) => { if (!actionIds.has(action)) return false; sendPetAction(action); return true; },
    openConsole
  });
  agent = new DeepSeekAgent(settingsStore, dataStore, () => runtime.activity, agentTools);
  updateService = new UpdateService({
    enabled: app.isPackaged && process.platform === "win32" && !smokeMode,
    onStatus: broadcastUpdateStatus,
    beforeInstall: async () => {
      sensor?.stop();
      await dataStore.flush();
      flushingQuit = true;
    }
  });
  void agent.warmCompanionLines();
  registerIpc();
  await createPetWindow();
  applyManualMode(settingsStore.get());
  createTray();
  updateService.start();
  lastProactiveAt = Date.now();
  sensor.on("snapshot", (snapshot) => {
    const settings = settingsStore.get();
    const filtered = filterActivity(snapshot, settings);
    runtime.activity = filtered;
    runtime.sensorHealthy = snapshot.sensorSource !== "fallback";
    const sensingActive = settings.firstRunConsent && settings.sensing.enabled && (!runtime.sensingPausedUntil || runtime.sensingPausedUntil <= Date.now());
    if (!writesPaused && sensingActive) dataStore.recordActivity(filtered);
    void maybeSendProactive(filtered, settings);
    const interruptionsAllowed = sensingActive && !isScheduledSilent(settings) && !filtered.locked
      && !(settings.reminders.meetingSilent && filtered.meeting)
      && !(settings.reminders.fullscreenSilent && filtered.fullscreen);
    for (const reminder of reminderScheduler.tick(filtered, settings, interruptionsAllowed)) {
      new Notification({ title: `${settings.petName} · ${reminder.title}`, body: reminder.body }).show();
      dataStore.increment(reminder.kind);
    }
    if (settings.manualMode === "energy_saving" && filtered.timestamp - lastEnergySnapshotAt < 4_000) return;
    lastEnergySnapshotAt = filtered.timestamp;
    petWindow?.webContents.send("pet:activity", filtered);
    consoleWindow?.webContents.send("pet:activity", filtered);
    chatWindow?.webContents.send("pet:activity", filtered);
  });
  sensor.start();
  if (!smokeMode && !settingsStore.get().firstRunConsent) void openConsole("home");
  if (smokeMode) {
    try {
      await runSmokeTest();
      sensor.stop();
      await dataStore.flush();
      app.exit(0);
    } catch (error) {
      console.error("Electron smoke failed:", error);
      sensor.stop();
      app.exit(1);
    }
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { void setPetVisibility(true); void openConsole(); });
  app.whenReady().then(bootstrap).catch((error) => {
    console.error("Pet startup failed:", error);
    if (smokeMode) app.exit(1);
    else { dialog.showErrorBox("桌宠启动失败", String(error)); app.quit(); }
  });
  app.on("window-all-closed", () => { /* tray application remains alive */ });
  app.on("before-quit", (event) => {
    sensor?.stop();
    if (flushingQuit || !dataStore) return;
    flushingQuit = true;
    event.preventDefault();
    void dataStore.flush().finally(() => app.quit());
  });
}
