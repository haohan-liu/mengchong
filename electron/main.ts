import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { ActivitySnapshot, AppNotification, NotificationAction, NotificationKind, PetRuntimeStatus, PetSpeechKind, PetState, Settings, UpdateStatus } from "../src/types.js";
import { isDirectionalDragAction } from "../src/types.js";
import { DRAG_RELEASE_SAMPLE_WINDOW_MS, dragGlideForRelease, type TimedDragPoint } from "../src/drag-motion.js";
import { SettingsStore } from "./services/SettingsStore.js";
import { DataStore } from "./services/DataStore.js";
import { SensorService } from "./services/SensorService.js";
import { DeepSeekAgent } from "./services/DeepSeekAgent.js";
import { migrateDataDirectory } from "./services/StorageMigration.js";
import { AgentTools } from "./services/AgentTools.js";
import { ReminderScheduler } from "./services/ReminderScheduler.js";
import { UpdateService } from "./services/UpdateService.js";
import { ActivityRuleStore } from "./services/ActivityRuleStore.js";
import { ActivityClassifier } from "./services/ActivityClassifier.js";
import { PlanService } from "./services/PlanService.js";
import { WellbeingService } from "./services/WellbeingService.js";
import { shouldAutoShowOnboarding } from "../src/shared/onboarding.js";

const APP_STATES = new Set<PetState>(["BOOT", "APPEAR", "IDLE", "LISTENING", "USER_TYPING", "THINKING", "RESPONDING", "SUCCESS", "ERROR", "OFFLINE", "LOW_BATTERY", "SLEEP", "DRAGGING", "REACTION", "DISAPPEAR"]);
const RELEASES_URL = "https://github.com/haohan-liu/mengchong-exe/releases";
const DEEPSEEK_API_SIGNUP_URL = "https://platform.deepseek.com/api_keys";
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
const PET_TOPMOST_LEVEL = "screen-saver" as const;
const PET_TOPMOST_RELATIVE_LEVEL = 1;
const DRAG_TRACKING_INTERVAL_MS = 8;
const DRAG_GLIDE_FRAME_INTERVAL_MS = 8;
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
let updatePopupWindow: BrowserWindow | null = null;
let notificationPopupWindow: BrowserWindow | null = null;
let notificationPopupTimer: NodeJS.Timeout | null = null;
let notificationPopupHovered = false;
let currentAppNotification: AppNotification = { id: "empty", title: "提醒", body: "", kind: "reminder", priority: "normal", actions: [], createdAt: Date.now() };
let notificationQueue: AppNotification[] = [];
let tray: Tray | null = null;
let settingsStore: SettingsStore;
let dataStore: DataStore;
let sensor: SensorService;
let agent: DeepSeekAgent;
let agentTools: AgentTools;
let updateService: UpdateService;
let activityClassifier: ActivityClassifier;
let planService: PlanService;
let wellbeingService: WellbeingService;
const reminderScheduler = new ReminderScheduler();
interface ScreenPoint { x: number; y: number; }
interface DragSession {
  offset: ScreenPoint;
  lastPoint: ScreenPoint;
  lastPosition: ScreenPoint;
  samples: TimedDragPoint[];
}
let dragSession: DragSession | null = null;
let dragTrackingTimer: NodeJS.Timeout | null = null;
let dragMomentumTimer: NodeJS.Timeout | null = null;
let manualStateTimer: NodeJS.Timeout | null = null;
let sensingPauseTimer: NodeJS.Timeout | null = null;
let lastEnergySnapshotAt = 0;
let lastProactiveAt = 0;
let proactivePending = false;
let writesPaused = false;
let flushingQuit = false;
let petVisibilityTarget = true;
let pendingVisibilityAcknowledge: { visible: boolean; resolve: () => void } | null = null;
let lastUpdatePopupPhase = "";
let visibilityAnimationToken = 0;
let petPositionAnimationToken = 0;
let petPositionAnimationActive = false;
let petScaleAnimationTimer: NodeJS.Timeout | null = null;
let petScaleAnimation: { targetScale: number; anchorRight: number; anchorBottom: number } | null = null;

const runtime: PetRuntimeStatus = {
  state: "BOOT", action: "idle_breath", source: "startup", sensingPausedUntil: null,
  activity: {
    timestamp: Date.now(), foregroundProcess: "unknown", foregroundPath: "", windowTitle: "", documentTitle: "",
    activityKind: "other", activityLabel: "其他", applicationLabel: "未知软件",
    classificationSource: "fallback", classificationConfidence: 0, presenceState: "active",
    activeAppSeconds: 0, appSwitches5m: 0,
    keyboardCount1s: 0, keyboardCount10s: 0, keyboardPulse: false,
    mouseClicks1s: 0, mouseClicks10s: 0, mouseClickPulse: false,
    mouseWheel1s: 0, mouseWheel10s: 0, mouseDistance1s: 0, mouseDistance10s: 0,
    idleSeconds: 0, fullscreen: false, locked: false, meeting: false,
    microphoneActive: false, online: true, batteryPercent: 100, charging: true, sensorSource: "fallback",
    performance: { systemCpuPercent: 0, systemMemoryPercent: 0, petCpuPercent: 0, petMemoryMb: 0, petProcessCount: 0, sensorMemoryMb: 0, eventLoopLagMs: 0 }
  },
  sensorHealthy: false,
  aiHealthy: false,
  wellbeing: { vitality: 70, mood: 70, state: "learning", estimated: false, baselineDays: 0, updatedAt: Date.now() }
};

function appRoot(): string { return app.getAppPath(); }
function preloadPath(): string { return join(appRoot(), "dist-electron", "electron", "preload.cjs"); }
function appIconPath(): string {
  const extension = process.platform === "win32" ? "ico" : "png";
  return app.isPackaged
    ? join(process.resourcesPath, `app-icon.${extension}`)
    : join(appRoot(), "assets", "icons", `app-icon.${extension}`);
}
function appIcon() {
  const icon = nativeImage.createFromPath(appIconPath());
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

function reportRendererHealth(window: BrowserWindow, label: "pet" | "console" | "chat" | "update" | "notification"): void {
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

async function loadRenderer(window: BrowserWindow, page: "index.html" | "console.html" | "chat.html" | "update.html" | "notification.html"): Promise<void> {
  const devUrl = process.env.PET_DEV_URL;
  if (devUrl) await window.loadURL(`${devUrl}/${page}`);
  else await window.loadFile(join(appRoot(), "dist", page));
}

function clampPetToWorkArea(): void {
  // setBounds emits move events. Clamping every animation frame competes with
  // resizing on Windows and is visible as a small shake at the window edge.
  if (petScaleAnimationTimer || petPositionAnimationActive) return;
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
  if (x !== bounds.x || y !== bounds.y) petWindow.setPosition(x, y, false);
}

function applyPetTopmost(settings: Settings): void {
  const window = petWindow;
  if (!window || window.isDestroyed()) return;
  if (!settings.appearance.alwaysOnTop) {
    window.setAlwaysOnTop(false);
    return;
  }
  // "floating" can sit below another app's higher native level during login
  // startup. The screen-saver level stays above ordinary application windows;
  // the small relative level keeps us deterministic among same-level windows.
  window.setAlwaysOnTop(true, PET_TOPMOST_LEVEL, PET_TOPMOST_RELATIVE_LEVEL);
  if (window.isVisible()) window.moveTop();
}

function reassertPetTopmost(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  applyPetTopmost(settingsStore.get());
}

function isScreenPoint(value: unknown): value is ScreenPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<ScreenPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function clampPetPosition(position: ScreenPoint, referencePoint: ScreenPoint): ScreenPoint {
  if (!petWindow || petWindow.isDestroyed()) return position;
  const bounds = petWindow.getBounds();
  const area = screen.getDisplayNearestPoint(referencePoint).workArea;
  const maxX = Math.max(area.x, area.x + area.width - bounds.width);
  const maxY = Math.max(area.y, area.y + area.height - bounds.height);
  return {
    x: Math.round(Math.min(Math.max(position.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(position.y, area.y), maxY))
  };
}

function clearDragMomentum(): void {
  if (dragMomentumTimer) clearTimeout(dragMomentumTimer);
  dragMomentumTimer = null;
}

function clearDragTracking(): void {
  if (dragTrackingTimer) clearTimeout(dragTrackingTimer);
  dragTrackingTimer = null;
}

function updateDragSession(session: DragSession, point: ScreenPoint, now = Date.now()): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  session.lastPoint = point;
  session.samples.push({ point, at: now });
  const cutoff = now - DRAG_RELEASE_SAMPLE_WINDOW_MS;
  while (session.samples.length > 2 && session.samples[0]!.at < cutoff) session.samples.shift();
  const position = clampPetPosition({ x: point.x - session.offset.x, y: point.y - session.offset.y }, point);
  if (position.x === session.lastPosition.x && position.y === session.lastPosition.y) return;
  session.lastPosition = position;
  petWindow.setPosition(position.x, position.y, false);
}

function startDragTracking(session: DragSession): void {
  clearDragTracking();
  const track = () => {
    dragTrackingTimer = null;
    if (dragSession !== session || !petWindow || petWindow.isDestroyed()) return;
    updateDragSession(session, screen.getCursorScreenPoint());
    dragTrackingTimer = setTimeout(track, DRAG_TRACKING_INTERVAL_MS);
  };
  dragTrackingTimer = setTimeout(track, 0);
}

function finishDragWithInertia(session: DragSession): void {
  const window = petWindow;
  if (!window || window.isDestroyed()) return;
  const glide = dragGlideForRelease(session.samples, Date.now());
  if (!glide) {
    clampPetToWorkArea();
    return;
  }
  const start = window.getBounds();
  const target = clampPetPosition({
    x: start.x + glide.velocity.x / glide.speed * glide.distance,
    y: start.y + glide.velocity.y / glide.speed * glide.distance
  }, session.lastPoint);
  const deltaX = target.x - start.x;
  const deltaY = target.y - start.y;
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
  const startedAt = Date.now();
  const finalDecay = 1 - Math.exp(-glide.duration / glide.decayTime);
  const move = () => {
    if (!petWindow || petWindow.isDestroyed()) { dragMomentumTimer = null; return; }
    const elapsed = Math.min(glide.duration, Date.now() - startedAt);
    const progress = elapsed / glide.duration;
    // Exponential velocity decay preserves the release direction and gives a
    // continuous fast-to-slow tail instead of spending most travel in frame 1.
    const eased = (1 - Math.exp(-elapsed / glide.decayTime)) / finalDecay;
    petWindow.setPosition(Math.round(start.x + deltaX * eased), Math.round(start.y + deltaY * eased), false);
    if (progress < 1) dragMomentumTimer = setTimeout(move, DRAG_GLIDE_FRAME_INTERVAL_MS);
    else { dragMomentumTimer = null; clampPetToWorkArea(); }
  };
  // Arm the timer before moving the native window so its move event cannot
  // mistake the first glide frame for an external move and clamp against it.
  dragMomentumTimer = setTimeout(move, 0);
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
    reassertPetTopmost();
  }
  // Also send the restore signal when a hide animation is cancelled midway.
  // In that case the native window never became hidden, but the renderer may
  // already have released its frames in response to the prior hide request.
  if (visible) await notifyPetRendererVisibility(window, true);
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
    await notifyPetRendererVisibility(window, false);
    if (token !== visibilityAnimationToken || window.isDestroyed()) return;
    window.hide();
    window.setOpacity(1);
  }
}

async function notifyPetRendererVisibility(window: BrowserWindow, visible: boolean): Promise<void> {
  if (window.isDestroyed()) return;
  pendingVisibilityAcknowledge?.resolve();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (pendingVisibilityAcknowledge?.resolve === finish) pendingVisibilityAcknowledge = null;
      resolve();
    }, 180);
    const finish = () => { clearTimeout(timeout); resolve(); };
    pendingVisibilityAcknowledge = { visible, resolve: finish };
    window.webContents.send("pet:visibility-changed", visible);
  });
}

async function animatePetMoveAndLand(window: BrowserWindow, target: ScreenPoint, source: string, duration: number): Promise<void> {
  if (window.isDestroyed()) return;
  const token = ++petPositionAnimationToken;
  petPositionAnimationActive = true;
  dragSession = null;
  clearDragTracking();
  clearDragMomentum();
  const start = window.getBounds();
  runtime.state = "DRAGGING";
  runtime.source = source;
  sendPetAction("dragged");
  broadcastRuntimeStatus();
  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    const move = () => {
      if (window.isDestroyed() || token !== petPositionAnimationToken) { resolve(); return; }
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
  if (window.isDestroyed() || token !== petPositionAnimationToken) return;
  window.setPosition(Math.round(target.x), Math.round(target.y), false);
  runtime.state = "REACTION";
  runtime.source = source;
  sendPetAction("drop_landing");
  broadcastRuntimeStatus();
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  if (token === petPositionAnimationToken) petPositionAnimationActive = false;
}

async function animatePetEntrance(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;
  await waitForRendererElement(window, ".pet-hit");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (window.isDestroyed()) return;
  const start = window.getBounds();
  const area = screen.getDisplayMatching(start).workArea;
  await animatePetMoveAndLand(window, {
    x: area.x + area.width - start.width - 24,
    y: area.y + area.height - start.height - 24
  }, "startup-entrance", 1_900);
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
  applyPetTopmost(settings);
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
  petWindow.on("move", () => {
    // Drag and inertia already clamp their own target position. Re-clamping on
    // every native move event was doing an extra synchronous bounds read per
    // frame and visibly fought the drag at the screen edge.
    if (!dragSession && !dragMomentumTimer) clampPetToWorkArea();
  });
  petWindow.on("show", reassertPetTopmost);
  petWindow.on("restore", reassertPetTopmost);
  petWindow.webContents.once("did-finish-load", reassertPetTopmost);
  petWindow.on("closed", () => {
    petPositionAnimationToken += 1;
    petPositionAnimationActive = false;
    dragSession = null;
    clearDragTracking();
    clearDragMomentum();
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
    reassertPetTopmost();
    await animatePetEntrance(window);
    reassertPetTopmost();
    // Explorer and login-started applications can still finish their initial
    // z-order work just after this window is shown. One delayed reassertion
    // closes that startup race without a permanent polling timer.
    setTimeout(reassertPetTopmost, 700);
  }
}

async function openConsole(tab = "home"): Promise<void> {
  consoleRequestedTab = tab;
  if (consoleWindow && !consoleWindow.isDestroyed()) { syncWindowCaption(consoleWindow, "console"); consoleWindow.show(); consoleWindow.focus(); consoleWindow.webContents.send("console:navigate", tab); return; }
  const petName = settingsStore.get().petName;
  consoleWindow = new BrowserWindow({
    // The extra 32 px preserve the original 1080 x 760 content area while
    // providing a 16 px transparent canvas for rounded corners and shadow.
    width: 1112, height: 792, minWidth: 932, minHeight: 672, show: false,
    title: `${petName}桌宠控制台`,
    icon: appIcon(),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const window = consoleWindow;
  reportRendererHealth(window, "console");
  attachWindowStateNotifications(window);
  consoleWindow.setMenu(null);
  const reveal = () => {
    if (!window.isDestroyed()) { window.show(); window.focus(); }
  };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", () => syncWindowCaption(window, "console"));
  window.on("focus", () => syncWindowCaption(window, "console"));
  consoleWindow.on("closed", () => { consoleWindow = null; });
  await loadRenderer(window, "console.html");
}

async function openChat(): Promise<void> {
  if (chatWindow && !chatWindow.isDestroyed()) { syncWindowCaption(chatWindow, "chat"); chatWindow.show(); chatWindow.focus(); return; }
  const petName = settingsStore.get().petName;
  chatWindow = new BrowserWindow({
    width: 1212, height: 812, minWidth: 932, minHeight: 652, show: false,
    title: `和${petName}聊天`,
    icon: appIcon(),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const window = chatWindow;
  reportRendererHealth(window, "chat");
  attachWindowStateNotifications(window);
  window.setMenu(null);
  const reveal = () => { if (!window.isDestroyed()) { window.show(); window.focus(); } };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", () => syncWindowCaption(window, "chat"));
  window.on("focus", () => syncWindowCaption(window, "chat"));
  window.on("closed", () => { chatWindow = null; });
  await loadRenderer(window, "chat.html");
}

function updatePopupPosition(width: number, height: number): { x: number; y: number } {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: area.x + area.width - width - 22,
    y: area.y + area.height - height - 22
  };
}

function notificationPopupPosition(width: number, height: number): { x: number; y: number } {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  // 更新卡片始终占据最底部；普通提醒在它出现时顺延到上方，避免两个全局提示互相遮挡。
  const updateOffset = updatePopupWindow && !updatePopupWindow.isDestroyed() && updatePopupWindow.isVisible() ? 290 : 0;
  return { x: area.x + area.width - width - 22, y: area.y + area.height - height - 22 - updateOffset };
}

const NOTIFICATION_MIN_WIDTH = 316;
const NOTIFICATION_START_WIDTH = 340;
const NOTIFICATION_MAX_WIDTH = 480;
const NOTIFICATION_HEIGHT = 84;

function notificationActions(kind: NotificationKind): NotificationAction[] {
  if (kind === "hydration") return [{ id: "hydrate", label: "喝好啦", style: "primary" }, { id: "snooze", label: "稍后 10 分钟", style: "secondary", snoozeMinutes: 10 }];
  if (kind === "break") return [{ id: "start-break", label: "开始休息", style: "primary" }, { id: "snooze", label: "稍后 15 分钟", style: "secondary", snoozeMinutes: 15 }];
  if (kind === "plan") return [{ id: "complete", label: "完成", style: "primary" }, { id: "snooze", label: "稍后 10 分钟", style: "secondary", snoozeMinutes: 10 }];
  if (kind === "assistant") return [{ id: "chat", label: "聊天台", style: "secondary" }, { id: "acknowledge", label: "知道了", style: "primary" }];
  return [{ id: "acknowledge", label: "知道了", style: "primary" }];
}

function normalizeNotification(input: Partial<AppNotification> & Pick<AppNotification, "title" | "body">): AppNotification {
  const kind = input.kind ?? "general";
  return {
    id: input.id || crypto.randomUUID(), sourceId: input.sourceId, occurrenceId: input.occurrenceId,
    title: String(input.title).slice(0, 120), body: String(input.body).slice(0, 500), kind,
    priority: input.priority ?? "normal", actions: input.actions?.length ? input.actions : notificationActions(kind),
    createdAt: input.createdAt ?? Date.now(), expiresAt: input.expiresAt ?? Date.now() + 15_000
  };
}

function clearNotificationTimer(): void { if (notificationPopupTimer) clearTimeout(notificationPopupTimer); notificationPopupTimer = null; }
function raiseNotificationPopup(): void {
  const window = notificationPopupWindow;
  if (!window || window.isDestroyed()) return;
  // Reminder actions must stay above the companion itself: the pet uses the
  // screen-saver level with relative level 1, so reserve the next level here.
  window.setAlwaysOnTop(true, PET_TOPMOST_LEVEL, PET_TOPMOST_RELATIVE_LEVEL + 1);
  if (window.isVisible()) window.moveTop();
}
function scheduleNotificationClose(): void {
  clearNotificationTimer();
  if (notificationPopupHovered || currentAppNotification.id === "empty") return;
  notificationPopupTimer = setTimeout(closeNotificationPopup, Math.max(1_000, (currentAppNotification.expiresAt ?? Date.now() + 15_000) - Date.now()));
}
function closeNotificationPopup(): void {
  clearNotificationTimer();
  currentAppNotification = { id: "empty", title: "提醒", body: "", kind: "reminder", priority: "normal", actions: [], createdAt: Date.now() };
  if (notificationPopupWindow && !notificationPopupWindow.isDestroyed()) notificationPopupWindow.close();
  const next = notificationQueue.shift();
  if (next) void showAppNotification(next);
}

async function showAppNotification(input: Partial<AppNotification> & Pick<AppNotification, "title" | "body">): Promise<void> {
  const notification = normalizeNotification(input);
  if (currentAppNotification.id !== "empty") {
    if (notification.sourceId && notification.sourceId === currentAppNotification.sourceId) {
      currentAppNotification = notification;
      notificationPopupWindow?.webContents.send("notification-popup:changed", notification);
      raiseNotificationPopup();
      scheduleNotificationClose();
      return;
    }
    const duplicate = notification.sourceId && notificationQueue.some((item) => item.sourceId === notification.sourceId);
    if (!duplicate) {
      notificationQueue.push(notification);
      notificationQueue.sort((left, right) => (right.priority === "high" ? 2 : right.priority === "normal" ? 1 : 0) - (left.priority === "high" ? 2 : left.priority === "normal" ? 1 : 0));
    }
    return;
  }
  currentAppNotification = notification;
  dataStore.increment("notificationsShown");
  // Keep companion notices unobtrusive: this window sits above the taskbar,
  // so it should read like a compact prompt rather than a full-size panel.
  const width = NOTIFICATION_START_WIDTH, height = NOTIFICATION_HEIGHT;
  if (notificationPopupWindow && !notificationPopupWindow.isDestroyed()) {
    const position = notificationPopupPosition(width, height);
    // A popup may already be open while its visual design changes. Keep its
    // native bounds in sync with the content so the rounded card is never cut off.
    notificationPopupWindow.setSize(width, height, false);
    notificationPopupWindow.setPosition(position.x, position.y, false);
    notificationPopupWindow.webContents.send("notification-popup:changed", notification);
    notificationPopupWindow.showInactive();
    raiseNotificationPopup();
  } else {
    const position = notificationPopupPosition(width, height);
    notificationPopupWindow = new BrowserWindow({
      width, height, x: position.x, y: position.y, useContentSize: true, show: false,
      frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, icon: appIcon(),
      webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const window = notificationPopupWindow;
    reportRendererHealth(window, "notification");
    window.setMenu(null);
    raiseNotificationPopup();
    const reveal = () => { if (!window.isDestroyed()) { window.showInactive(); raiseNotificationPopup(); } };
    window.once("ready-to-show", reveal);
    window.webContents.once("did-finish-load", reveal);
    window.on("closed", () => { if (notificationPopupWindow === window) notificationPopupWindow = null; });
    await loadRenderer(window, "notification.html");
  }
  scheduleNotificationClose();
}

async function showUpdatePopup(): Promise<void> {
  if (updatePopupWindow && !updatePopupWindow.isDestroyed()) {
    updatePopupWindow.showInactive();
    return;
  }
  const width = 520;
  const height = 116;
  const position = updatePopupPosition(width, height);
  if (notificationPopupWindow && !notificationPopupWindow.isDestroyed()) {
    const bounds = notificationPopupWindow.getBounds();
    const notificationPosition = notificationPopupPosition(bounds.width, bounds.height);
    notificationPopupWindow.setPosition(notificationPosition.x, notificationPosition.y, false);
  }
  updatePopupWindow = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    icon: appIcon(),
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const window = updatePopupWindow;
  reportRendererHealth(window, "update");
  window.setMenu(null);
  window.setAlwaysOnTop(true, "floating");
  const reveal = () => { if (!window.isDestroyed()) window.showInactive(); };
  window.once("ready-to-show", reveal);
  window.webContents.once("did-finish-load", reveal);
  window.on("closed", () => { if (updatePopupWindow === window) updatePopupWindow = null; });
  await loadRenderer(window, "update.html");
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
  const settings = settingsStore.get();
  const energySaving = settings.manualMode === "energy_saving";
  const sensingEnabled = settings.firstRunConsent && settings.sensing.enabled && !runtime.sensingPausedUntil;
  return Menu.buildFromTemplate([
    { label: "打开控制台", click: () => void openConsole() },
    { label: `和${petName}聊天`, click: () => void openChat() },
    { label: "说句话", click: () => void setPetVisibility(true).then(() => showPetSpeech("proactive")) },
    { type: "separator" },
    { label: `节能：${energySaving ? "开" : "关"}`, click: () => void toggleEnergySaving() },
    { label: `感知：${sensingEnabled ? "开" : "关"}`, click: () => void toggleTraySensing() },
    { type: "separator" },
    { label: petVisibilityTarget ? "隐藏桌宠" : "显示桌宠", click: () => void setPetVisibility(!petVisibilityTarget) },
    { label: "退出桌宠", click: () => app.quit() }
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

async function toggleTraySensing(): Promise<void> {
  const settings = settingsStore.get();
  const currentlyEnabled = settings.firstRunConsent && settings.sensing.enabled && !runtime.sensingPausedUntil;
  if (currentlyEnabled) {
    settings.sensing.enabled = false;
  } else {
    settings.firstRunConsent = true;
    settings.sensing.enabled = true;
    setSensingPausedUntil(null);
  }
  const saved = await settingsStore.save(settings);
  syncSensorForSettings(saved);
  runtime.activity = filterActivity(runtime.activity, saved);
  broadcastRuntimeStatus();
  petWindow?.webContents.send("settings:changed", saved);
  consoleWindow?.webContents.send("settings:changed", saved);
  chatWindow?.webContents.send("settings:changed", saved);
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

function attachWindowStateNotifications(window: BrowserWindow): void {
  const emit = () => {
    if (!window.isDestroyed()) window.webContents.send("window:maximized-changed", window.isMaximized());
  };
  window.on("maximize", emit);
  window.on("unmaximize", emit);
  window.on("restore", emit);
  window.webContents.once("did-finish-load", emit);
}

function sendPetAction(action: string): void {
  if (!actionIds.has(action) && !isDirectionalDragAction(action)) return;
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
  tray?.setContextMenu(buildTrayMenu(settingsStore.get().petName));
}

function broadcastRuntimeStatus(): void {
  const snapshot = structuredClone(runtime);
  petWindow?.webContents.send("pet:runtime-changed", snapshot);
  consoleWindow?.webContents.send("pet:runtime-changed", snapshot);
  chatWindow?.webContents.send("pet:runtime-changed", snapshot);
  consoleWindow?.webContents.send("wellbeing:changed", snapshot.wellbeing);
  chatWindow?.webContents.send("wellbeing:changed", snapshot.wellbeing);
}

function broadcastPlans(): void {
  const snapshot = planService.snapshot();
  consoleWindow?.webContents.send("plans:changed", snapshot);
  chatWindow?.webContents.send("plans:changed", snapshot);
}

async function saveAgentSettings(mutator: (settings: Settings) => void): Promise<boolean> {
  const next = settingsStore.get();
  mutator(next);
  const saved = await settingsStore.save(next);
  applyAppearance(saved); applyBranding(saved);
  petWindow?.webContents.send("settings:changed", saved);
  consoleWindow?.webContents.send("settings:changed", saved);
  chatWindow?.webContents.send("settings:changed", saved);
  updatePopupWindow?.webContents.send("settings:changed", saved);
  notificationPopupWindow?.webContents.send("settings:changed", saved);
  return true;
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  consoleWindow?.webContents.send("updates:changed", status);
  chatWindow?.webContents.send("updates:changed", status);
  updatePopupWindow?.webContents.send("updates:changed", status);
  if (status.phase === lastUpdatePopupPhase) return;
  lastUpdatePopupPhase = status.phase;
  if (status.phase === "available" || status.phase === "downloaded") void showUpdatePopup();
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

async function resetLocalData(removeMarkedCustomDirectory: boolean): Promise<Settings> {
  writesPaused = true;
  sensor?.stop();
  activityClassifier?.cancelPending();
  const previousDirectory = settingsStore.get().dataDirectory;
  try {
    await Promise.all([dataStore.clearChats(), dataStore.clearStatistics(), dataStore.clearUsage(), activityClassifier.clear(), planService.clear(), wellbeingService.reset()]);
    const saved = await settingsStore.clearAndReset();
    activityClassifier.setApiConfigured(false);
    if (removeMarkedCustomDirectory && previousDirectory !== saved.dataDirectory) {
      try {
        await access(join(previousDirectory, ".qpet-data-root"));
        await rm(previousDirectory, { recursive: true, force: true });
      } catch {
        // External directories without the application marker are never removed recursively.
      }
    }
    await dataStore.load();
    await planService.load();
    await wellbeingService.load();
    runtime.wellbeing = wellbeingService.snapshot();
    await activityClassifier.rules.load();
    await syncUninstallDataPath(saved.dataDirectory);
    runtime.activity = filterActivity(runtime.activity, saved);
    return saved;
  } finally {
    writesPaused = false;
  }
}

function setSensingPausedUntil(until: number | null): void {
  if (sensingPauseTimer) { clearTimeout(sensingPauseTimer); sensingPauseTimer = null; }
  runtime.sensingPausedUntil = until && until > Date.now() ? until : null;
  if (runtime.sensingPausedUntil) {
    sensingPauseTimer = setTimeout(() => {
      sensingPauseTimer = null;
      runtime.sensingPausedUntil = null;
      syncSensorForSettings(settingsStore.get());
      broadcastRuntimeStatus();
    }, Math.max(1, runtime.sensingPausedUntil - Date.now() + 50));
  }
  syncSensorForSettings(settingsStore.get());
  broadcastRuntimeStatus();
  tray?.setContextMenu(buildTrayMenu(settingsStore.get().petName));
}

function filterActivity(snapshot: ActivitySnapshot, settings: Settings): ActivitySnapshot {
  const active = shouldRunSensor(settings);
  const result = structuredClone(snapshot);
  if (!active || !settings.sensing.foregroundApp) {
    result.foregroundProcess = "unknown"; result.foregroundPath = "";
    result.activityKind = "other"; result.activityLabel = "其他"; result.applicationLabel = "未知软件";
    result.classificationSource = "fallback"; result.classificationConfidence = 0;
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

function shouldRunSensor(settings: Settings): boolean {
  // Energy-saving mode keeps the pet visible and interactive, but releases
  // the separate native sensing process until the user returns to auto mode.
  return settings.firstRunConsent && settings.sensing.enabled && !runtime.sensingPausedUntil && settings.manualMode !== "energy_saving";
}

function syncSensorForSettings(settings: Settings): void {
  if (shouldRunSensor(settings)) sensor.start();
  else sensor.stop();
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

async function showPetSpeech(kind: PetSpeechKind): Promise<string | null> {
  const window = petWindow;
  if (!window || window.isDestroyed() || !window.isVisible()) return null;
  const text = await agent.nextCompanionLine(kind);
  if (!text.trim() || window.isDestroyed()) return null;
  window.webContents.send("pet:speech", { text, kind });
  return text;
}

async function maybeSendProactive(snapshot: ActivitySnapshot, settings: Settings): Promise<void> {
  const now = Date.now();
  const cooldownMs = Math.max(1, settings.reminders.proactiveCooldownMinutes) * 60_000;
  const limit = Math.max(0, Math.round(settings.reminders.proactiveDailyLimit));
  const sensingActive = shouldRunSensor(settings);
  const silent = isScheduledSilent(settings) || snapshot.locked || snapshot.idleSeconds >= 60
    || (settings.reminders.meetingSilent && snapshot.meeting)
    || (settings.reminders.fullscreenSilent && snapshot.fullscreen);
  // 内置陪伴文案不依赖网络；离线时也应继续按用户设置陪伴，而不是让“主动次数”静默失效。
  if (proactivePending || settings.manualMode !== "auto" || !sensingActive || silent
    || limit === 0 || dataStore.getProactiveCount(now) >= limit || now - lastProactiveAt < cooldownMs) return;
  proactivePending = true;
  lastProactiveAt = now;
  try {
    const text = await showPetSpeech("proactive");
    if (text) {
      dataStore.incrementProactive(now);
      void showAppNotification({ title: `${settings.petName}在陪你`, body: text, kind: "assistant" });
    }
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
  const onboardingResult = await consoleWindow.webContents.executeJavaScript(`(async () => {
    const wait = () => new Promise(resolve => setTimeout(resolve, 40));
    const waitFor = async (selector, timeout = 2500) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { const element = document.querySelector(selector); if (element) return element; await wait(); }
      return null;
    };
    if (!document.querySelector('[data-onboarding]')) return { completed: false, smoothContinuation: false, reason: 'missing-onboarding' };
    document.querySelector('[data-onboarding-next]')?.click();
    let smoothContinuation = false; const transitionDeadline = Date.now() + 600;
    while (!smoothContinuation && Date.now() < transitionDeadline) {
      const resumedMask = document.querySelector('[data-onboarding]'); const resumedSpotlight = resumedMask?.querySelector('.tour-spotlight');
      smoothContinuation = Boolean(resumedMask?.classList.contains('tour-resume') && resumedSpotlight instanceof HTMLElement && getComputedStyle(resumedMask).animationName === 'none' && getComputedStyle(resumedSpotlight).transitionDuration !== '0s');
      if (!smoothContinuation) await wait();
    }
    const enable = document.querySelector('[data-command="onboarding-enable"]');
    if (!(enable instanceof HTMLButtonElement)) return { completed: false, smoothContinuation, reason: 'missing-enable' };
    enable.click();
    const later = await waitFor('[data-command="onboarding-ai-later"]');
    if (!(later instanceof HTMLButtonElement)) return { completed: false, smoothContinuation, reason: 'missing-ai-later' };
    later.click();
    const finish = await waitFor('[data-command="finish-onboarding"]');
    if (!(finish instanceof HTMLButtonElement)) return { completed: false, smoothContinuation, reason: 'missing-finish' };
    finish.click();
    const deadline = Date.now() + 2000;
    while (document.querySelector('[data-onboarding]') && Date.now() < deadline) await wait();
    return { completed: !document.querySelector('[data-onboarding]'), smoothContinuation, reason: 'finished' };
  })()`, true) as { completed: boolean; smoothContinuation: boolean; reason: string };
  if (!onboardingResult.completed || !onboardingResult.smoothContinuation) throw new Error(`First-run onboarding did not complete its consent flow: ${JSON.stringify(onboardingResult)}`);
  const sensorDeadline = Date.now() + 4_000;
  while (runtime.activity.sensorSource === "fallback" && Date.now() < sensorDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  if (runtime.activity.sensorSource === "fallback") throw new Error("Native/compatibility input sensor did not start");
  if (runtime.activity.performance.petMemoryMb <= 0) throw new Error("Performance telemetry did not report pet memory");
  const layoutReady = await consoleWindow.webContents.executeJavaScript(`(() => {
    const appWindow = document.querySelector('.app-window'); const shell = document.querySelector('.console-shell'); const main = document.querySelector('.console-shell > main');
    const performance = document.querySelector('[data-live="pet-memory"]');
    if (!(appWindow instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(main instanceof HTMLElement) || !performance) return false;
    const appRect = appWindow.getBoundingClientRect(); const shellRect = shell.getBoundingClientRect();
    return getComputedStyle(main).overflowY === 'auto' && Math.abs(appRect.width - (innerWidth - 32)) <= 1 && Math.abs(appRect.height - (innerHeight - 32)) <= 1 && Math.abs(shellRect.height - (appRect.height - 38)) <= 1;
  })()`, true) as boolean;
  if (!layoutReady) throw new Error("Console rounded-window content dimensions are not preserved");
  if (process.env.PET_SMOKE_CAPTURE_HOME) await writeFile(process.env.PET_SMOKE_CAPTURE_HOME, (await consoleWindow.webContents.capturePage()).toPNG());
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
  const directionalDragPreview = await consoleWindow.webContents.executeJavaScript(`(() => {
    const action = document.querySelector('[data-action="dragged_left"]');
    if (!(action instanceof HTMLButtonElement)) return false;
    action.click();
    return true;
  })()`, true) as boolean;
  if (!directionalDragPreview) throw new Error("Console directional drag preview was not found");
  const directionDeadline = Date.now() + 2_000;
  while (String(runtime.action) !== "dragged_left" && Date.now() < directionDeadline) await new Promise((resolve) => setTimeout(resolve, 30));
  if (String(runtime.action) !== "dragged_left") throw new Error("Directional drag preview did not reach the pet renderer");
  const dragIpc = await petWindow.webContents.executeJavaScript(`(() => {
    const point = { x: window.screenX + innerWidth / 2, y: window.screenY + innerHeight / 2 };
    return window.petAPI.pet.startDrag(point, point).then(async value => { await window.petAPI.pet.stopDrag(); return value; });
  })()`, true) as boolean;
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
  for (const tab of ["home", "appearance", "states", "privacy", "reminders", "plans", "ai", "stats", "updates"]) {
    await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="${tab}"]')?.click()`, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const before = await consoleWindow.webContents.executeJavaScript(`(() => { const main=document.querySelector('.workspace'); if(!(main instanceof HTMLElement))return -1; main.scrollTop=Math.min(main.scrollHeight, Math.max(0, main.scrollHeight-main.clientHeight)); return main.scrollTop; })()`, true) as number;
    consoleWindow.webContents.send("pet:activity", runtime.activity);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const after = await consoleWindow.webContents.executeJavaScript(`document.querySelector('.workspace')?.scrollTop ?? -1`, true) as number;
    if (Math.abs(after - before) > 2) throw new Error(`Console ${tab} page moved after activity update: ${before} -> ${after}`);
    const horizontalLayout = await consoleWindow.webContents.executeJavaScript(`(() => {
      const workspace = document.querySelector('.workspace'); const page = workspace?.querySelector('.page');
      if (!(workspace instanceof HTMLElement) || !(page instanceof HTMLElement)) return { contained: false, reason: 'missing-layout' };
      const pageRight = page.getBoundingClientRect().right;
      const overflow = [...page.querySelectorAll('*')].filter((child) => child instanceof HTMLElement && child.getBoundingClientRect().right > pageRight + 1).slice(0, 12).map((child) => ({ tagName: child.tagName, className: child.className, right: Math.round(child.getBoundingClientRect().right), pageRight: Math.round(pageRight), width: Math.round(child.getBoundingClientRect().width) }));
      return { contained: workspace.scrollWidth <= workspace.clientWidth + 1 && page.scrollWidth <= page.clientWidth + 1, workspace: [workspace.clientWidth, workspace.scrollWidth], page: [page.clientWidth, page.scrollWidth], overflow };
    })()`, true) as { contained: boolean; workspace?: [number, number]; page?: [number, number]; overflow?: unknown[]; reason?: string };
    if (!horizontalLayout.contained) throw new Error(`Console ${tab} page overflowed horizontally in its available content area: ${JSON.stringify(horizontalLayout)}`);
  }
  if (process.env.PET_SMOKE_CAPTURE_STATS) {
    await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="stats"]')?.click()`, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(process.env.PET_SMOKE_CAPTURE_STATS, (await consoleWindow.webContents.capturePage()).toPNG());
  }
  if (process.env.PET_SMOKE_CAPTURE_PLANS) {
    await consoleWindow.webContents.executeJavaScript(`(async () => {
      const now = Date.now(); const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await window.petAPI.plans.upsert({ id: 'smoke-plan-high', title: '完成本周项目复盘', notes: '整理本周进展、风险与下周优先事项，输出简短复盘结论。', startAt: now + 3_600_000, dueAt: now + 3_600_000, timezone, priority: 'high', tags: [], recurrence: { kind: 'once' }, reminderOffsets: [0], status: 'active', lastTriggeredAt: null, snoozedUntil: null });
      await window.petAPI.plans.upsert({ id: 'smoke-plan-normal', title: '整理会议行动项', notes: '把讨论结果转成可执行的待办，并同步给相关同事。', startAt: now + 86_400_000, dueAt: now + 86_400_000, timezone, priority: 'normal', tags: [], recurrence: { kind: 'weekly', weekdays: [1] }, reminderOffsets: [0], status: 'active', lastTriggeredAt: null, snoozedUntil: null });
      document.querySelector('[data-tab="plans"]')?.click(); await new Promise(resolve => setTimeout(resolve, 350));
    })()`, true);
    await writeFile(process.env.PET_SMOKE_CAPTURE_PLANS, (await consoleWindow.webContents.capturePage()).toPNG());
  }
  const planDialogContained = await consoleWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-tab="plans"]')?.click(); await new Promise(resolve => setTimeout(resolve, 100));
    document.querySelector('[data-plan-new]')?.click(); await new Promise(resolve => setTimeout(resolve, 100));
    const appWindow = document.querySelector('.app-window'); const dialog = document.querySelector('[data-plan-create-dialog]'); const footer = dialog?.querySelector('footer'); const scrim = document.querySelector('[data-console-modal-scrim]');
    if (!(appWindow instanceof HTMLElement) || !(dialog instanceof HTMLDialogElement) || !(footer instanceof HTMLElement) || !(scrim instanceof HTMLElement) || !dialog.open || scrim.hidden) return false;
    const appRect = appWindow.getBoundingClientRect(); const dialogRect = dialog.getBoundingClientRect(); const footerRect = footer.getBoundingClientRect(); const scrimRect = scrim.getBoundingClientRect();
    const contained = dialogRect.top >= appRect.top - 1 && dialogRect.left >= appRect.left - 1 && dialogRect.right <= appRect.right + 1 && dialogRect.bottom <= appRect.bottom + 1;
    const comfortableSpacing = dialogRect.top-appRect.top >= 22 && appRect.bottom-dialogRect.bottom >= 22 && Math.abs(dialogRect.height - Math.min(712, appRect.height-48)) <= 2;
    const roundedScrim = Math.abs(scrimRect.width-appRect.width) <= 1 && Math.abs(scrimRect.height-appRect.height) <= 1 && parseFloat(getComputedStyle(scrim).borderRadius) >= 10;
    return contained && comfortableSpacing && roundedScrim && footerRect.bottom <= dialogRect.bottom + 1;
  })()`, true) as boolean;
  if (!planDialogContained) throw new Error("Plan dialog lost height or escaped the rounded console content area");
  if (process.env.PET_SMOKE_CAPTURE_CONSOLE) await writeFile(process.env.PET_SMOKE_CAPTURE_CONSOLE, (await consoleWindow.webContents.capturePage()).toPNG());
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-plan-create-dialog]')?.close()`, true);
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-tab="updates"]')?.click()`, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
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
    const appWindow = document.querySelector('.app-window'); const shell = document.querySelector('.chat-shell');
    const topicList = document.querySelector('.topic-list');
    const context = document.querySelector('[data-show-context]');
    const quota = document.querySelector('[data-quota-meta]');
    if (!(appWindow instanceof HTMLElement) || !(shell instanceof HTMLElement)) return false;
    const appRect = appWindow.getBoundingClientRect(); const shellRect = shell.getBoundingClientRect();
    return Boolean(topicList && context && quota?.textContent?.includes('/') && Math.abs(appRect.width - (innerWidth - 32)) <= 1 && Math.abs(appRect.height - (innerHeight - 32)) <= 1 && Math.abs(shellRect.height - (appRect.height - 38)) <= 1);
  })()`, true) as boolean;
  if (!chatContract) throw new Error("Agent chat controls or rounded-window content dimensions were not ready");
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
  const secondTopicSent = await chatWindow.webContents.executeJavaScript(`(() => {
    const textarea = document.querySelector('.composer textarea');
    const form = document.querySelector('.composer');
    if (!(textarea instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false;
    textarea.value = '新建话题'; textarea.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true;
  })()`, true) as boolean;
  if (!secondTopicSent) throw new Error("Agent chat did not accept a first message for the new topic");
  const topicDeadline = Date.now() + 2_000;
  while ((await dataStore.listChats()).length <= initialTopicCount && Date.now() < topicDeadline) await new Promise((resolve) => setTimeout(resolve, 40));
  if ((await dataStore.listChats()).length <= initialTopicCount) throw new Error("Agent chat did not create an independent topic");
  const contextOpened = await chatWindow.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-show-context]')?.click(); await new Promise(resolve => setTimeout(resolve, 350));
    const shell = document.querySelector('.chat-shell'); const drawer = document.querySelector('.context-drawer'); const scrim = document.querySelector('.context-drawer-scrim');
    if (!(shell instanceof HTMLElement) || !(drawer instanceof HTMLDialogElement) || !(scrim instanceof HTMLElement) || !drawer.open || scrim.hidden) return false;
    const shellRect = shell.getBoundingClientRect(); const drawerRect = drawer.getBoundingClientRect();
    return drawerRect.top >= shellRect.top && drawerRect.right <= shellRect.right && drawerRect.bottom <= shellRect.bottom && drawerRect.left >= shellRect.left;
  })()`, true) as boolean;
  if (!contextOpened) throw new Error("Agent chat context detail drawer did not open inside the rounded chat shell");
  if (process.env.PET_SMOKE_CAPTURE) await writeFile(process.env.PET_SMOKE_CAPTURE, (await chatWindow.webContents.capturePage()).toPNG());
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
  ipcMain.handle("pet:start-drag", (event, payload: { origin?: ScreenPoint; point?: ScreenPoint }) => {
    if (!petWindow || settingsStore.get().appearance.lockPosition || event.sender !== petWindow.webContents) return false;
    const origin = payload?.origin;
    const point = payload?.point;
    if (!isScreenPoint(origin) || !isScreenPoint(point)) return false;
    petPositionAnimationToken += 1;
    petPositionAnimationActive = false;
    clearDragMomentum();
    clearDragTracking();
    const bounds = petWindow.getBounds();
    const now = Date.now();
    const position = clampPetPosition({ x: point.x - (origin.x - bounds.x), y: point.y - (origin.y - bounds.y) }, point);
    dragSession = {
      offset: { x: origin.x - bounds.x, y: origin.y - bounds.y },
      lastPoint: point,
      lastPosition: position,
      samples: [{ point, at: now }]
    };
    petWindow.setPosition(position.x, position.y, false);
    startDragTracking(dragSession);
    runtime.state = "DRAGGING";
    runtime.source = "pointer-drag";
    broadcastRuntimeStatus();
    return true;
  });
  ipcMain.handle("pet:stop-drag", (event) => {
    if (event.sender !== petWindow?.webContents || !dragSession) return;
    const session = dragSession;
    dragSession = null;
    clearDragTracking();
    runtime.state = "REACTION";
    runtime.source = "pointer-drag";
    broadcastRuntimeStatus();
    // The renderer owns drop_landing, so release cannot restart that action
    // midway through. The window receives only this short easing tail.
    finishDragWithInertia(session);
  });
  ipcMain.handle("pet:hide", () => setPetVisibility(false));
  ipcMain.handle("pet:visibility-ack", (event, visible: boolean) => {
    if (event.sender !== petWindow?.webContents) return false;
    if (pendingVisibilityAcknowledge?.visible !== Boolean(visible)) return false;
    const pending = pendingVisibilityAcknowledge;
    pendingVisibilityAcknowledge = null;
    pending.resolve();
    return true;
  });
  ipcMain.handle("pet:runtime", () => structuredClone(runtime));
  ipcMain.handle("pet:pause-sensing", (_event, minutes: number) => {
    setSensingPausedUntil(Date.now() + Math.max(1, Math.min(1440, Number(minutes) || 10)) * 60_000);
  });
  ipcMain.handle("pet:resume-sensing", () => setSensingPausedUntil(null));
  ipcMain.handle("pet:next-speech", (event, kind: PetSpeechKind) => {
    if (event.sender !== petWindow?.webContents) return "";
    return agent.nextCompanionLine(kind === "proactive" ? "proactive" : "click");
  });
  ipcMain.on("pet:bubble-presented", (event) => {
    if (event.sender !== petWindow?.webContents) return;
    reassertPetTopmost();
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
    if (!actionIds.has(action) && !isDirectionalDragAction(action)) return false;
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
  ipcMain.handle("window:minimize", (event, target: "console" | "chat") => {
    const window = target === "console" ? consoleWindow : target === "chat" ? chatWindow : null;
    if (event.sender === window?.webContents) window.minimize();
  });
  ipcMain.handle("window:toggle-maximize", (event, target: "console" | "chat") => {
    const window = target === "console" ? consoleWindow : target === "chat" ? chatWindow : null;
    if (event.sender !== window?.webContents) return false;
    if (window.isMaximized()) window.unmaximize(); else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle("app:quit", () => app.quit());

  ipcMain.handle("settings:get", () => settingsStore.get());
  ipcMain.handle("settings:update", async (_event, settings: Settings) => {
    const previous = settingsStore.get();
    const saved = await settingsStore.save(settings);
    if ((!previous.sensing.enabled && saved.sensing.enabled) || (!previous.firstRunConsent && saved.firstRunConsent && saved.sensing.enabled)) setSensingPausedUntil(null);
    if (shouldRunSensor(previous) !== shouldRunSensor(saved)) syncSensorForSettings(saved);
    if (previous.sensing.enabled !== saved.sensing.enabled || previous.firstRunConsent !== saved.firstRunConsent || previous.manualMode !== saved.manualMode) {
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
    updatePopupWindow?.webContents.send("settings:changed", saved);
    notificationPopupWindow?.webContents.send("settings:changed", saved);
    if (previous.manualMode !== saved.manualMode || previous.manualState !== saved.manualState || previous.manualUntil !== saved.manualUntil) applyManualMode(saved);
    return saved;
  });
  ipcMain.handle("settings:reset-position", async () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = petWindow.getBounds();
    const target = { x: area.x + area.width - bounds.width - 24, y: area.y + area.height - bounds.height - 24 };
    const distance = Math.hypot(target.x - bounds.x, target.y - bounds.y);
    await animatePetMoveAndLand(petWindow, target, "reset-position", Math.min(1_650, Math.max(720, distance * .9)));
  });
  ipcMain.handle("settings:set-api-key", async (_event, value: string) => {
    const saved = await settingsStore.setApiKey(value);
    activityClassifier.setApiConfigured(saved && Boolean(value.trim()));
    if (saved && value.trim()) void agent.warmCompanionLines(true);
    return saved;
  });
  ipcMain.handle("settings:has-api-key", () => settingsStore.hasApiKey());
  ipcMain.handle("settings:open-deepseek-api-signup", () => shell.openExternal(DEEPSEEK_API_SIGNUP_URL));
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
      await planService.load();
      await wellbeingService.load();
      runtime.wellbeing = wellbeingService.snapshot();
      activityClassifier.cancelPending();
      await activityClassifier.rules.load();
      await syncUninstallDataPath(nextPath);
      if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload();
      return nextPath;
    } finally { writesPaused = false; }
  });

  ipcMain.handle("statistics:get", (_event, days: number) => dataStore.getStatistics(Math.min(90, Math.max(1, Number(days) || 30))));
  ipcMain.handle("statistics:clear", () => dataStore.clearStatistics().then(() => true));
  ipcMain.handle("activity-rules:list", () => activityClassifier.rules.list());
  ipcMain.handle("activity-rules:update", (_event, id: string, changes: unknown) => activityClassifier.rules.update(String(id), changes as never));
  ipcMain.handle("activity-rules:delete", (_event, id: string) => activityClassifier.rules.remove(String(id)));
  ipcMain.handle("activity-rules:clear", () => activityClassifier.clear().then(() => true));
  ipcMain.handle("wellbeing:get", () => wellbeingService.snapshot());
  ipcMain.handle("plans:list", () => planService.snapshot());
  ipcMain.handle("plans:upsert", async (_event, value: unknown) => { const snapshot = await planService.upsertTask((value && typeof value === "object" ? value : {}) as never); broadcastPlans(); return snapshot; });
  ipcMain.handle("plans:complete", async (_event, id: string) => { const result = await planService.completeTask(String(id)); if (result.completed) { dataStore.increment("plansCompleted"); wellbeingService.reward("task"); runtime.wellbeing = wellbeingService.snapshot(); broadcastRuntimeStatus(); } broadcastPlans(); return result; });
  ipcMain.handle("plans:archive", async (_event, id: string) => { const snapshot = await planService.archiveTask(String(id)); broadcastPlans(); return snapshot; });
  ipcMain.handle("plans:delete", async (_event, id: string) => { const result = await planService.deleteTask(String(id)); broadcastPlans(); return result; });
  ipcMain.handle("plans:history:clear", async () => { const snapshot = await planService.clearCompletedHistory(); broadcastPlans(); return snapshot; });
  ipcMain.handle("plans:inbox:respond", async (_event, id: string, action: string, minutes?: number) => { const result = await planService.respondInbox(String(id), String(action), Number(minutes) || 10); if (result.completed) { dataStore.increment("plansCompleted"); wellbeingService.reward("task"); runtime.wellbeing = wellbeingService.snapshot(); broadcastRuntimeStatus(); } broadcastPlans(); return result; });
  ipcMain.handle("updates:status", () => updateService.status());
  ipcMain.handle("updates:check", () => updateService.check());
  ipcMain.handle("updates:download", () => updateService.download());
  ipcMain.handle("updates:install", () => updateService.install());
  ipcMain.handle("updates:open-releases", () => shell.openExternal(RELEASES_URL));
  ipcMain.handle("updates:open-link", async (_event, rawUrl: string) => {
    try {
      const url = new URL(String(rawUrl));
      if (url.protocol !== "https:") return false;
      await shell.openExternal(url.toString());
      return true;
    } catch { return false; }
  });
  ipcMain.handle("update-popup:close", (event) => {
    if (event.sender === updatePopupWindow?.webContents) updatePopupWindow.close();
  });
  ipcMain.handle("notification-popup:current", () => currentAppNotification);
  ipcMain.handle("notification-popup:resize", (event, requestedWidth: number) => {
    const window = notificationPopupWindow;
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
    const width = Math.max(NOTIFICATION_MIN_WIDTH, Math.min(NOTIFICATION_MAX_WIDTH, Math.round(Number(requestedWidth) || NOTIFICATION_START_WIDTH)));
    const position = notificationPopupPosition(width, NOTIFICATION_HEIGHT);
    window.setBounds({ x: position.x, y: position.y, width, height: NOTIFICATION_HEIGHT }, false);
    return true;
  });
  ipcMain.handle("notification-popup:close", (event) => {
    if (event.sender === notificationPopupWindow?.webContents) closeNotificationPopup();
  });
  ipcMain.handle("notification-popup:hover", (event, hovered: boolean) => {
    if (event.sender !== notificationPopupWindow?.webContents) return;
    notificationPopupHovered = Boolean(hovered);
    if (notificationPopupHovered) clearNotificationTimer(); else scheduleNotificationClose();
  });
  ipcMain.handle("notification-popup:respond", async (event, action: string, snoozeMinutes?: number) => {
    if (event.sender !== notificationPopupWindow?.webContents) return false;
    const notification = currentAppNotification;
    let handled = false;
    if (action === "chat") { await openChat(); handled = true; }
    else if (action === "view") { await openConsole(notification.kind === "plan" ? "plans" : "reminders"); handled = true; }
    else if (action === "hydrate") { dataStore.increment("hydrationCompleted"); dataStore.increment("notificationsAcknowledged"); wellbeingService.reward("rest"); handled = true; }
    else if (action === "start-break") { dataStore.increment("breaksCompleted"); dataStore.increment("notificationsAcknowledged"); wellbeingService.reward("rest"); handled = true; }
    else if (action === "acknowledge") { dataStore.increment("notificationsAcknowledged"); handled = true; }
    else if (action === "snooze") {
      const minutes = Math.max(1, Math.min(1_440, Math.round(Number(snoozeMinutes) || notification.actions.find((item) => item.id === "snooze")?.snoozeMinutes || 10)));
      if (notification.kind === "hydration") reminderScheduler.snooze("hydration", minutes);
      if (notification.kind === "break") reminderScheduler.snooze("break", minutes);
      if (notification.kind === "plan") await planService.respond(notification, "snooze", minutes);
      dataStore.increment("notificationsSnoozed"); handled = true;
    } else if (action === "complete" && notification.kind === "plan") {
      const result = await planService.respond(notification, "complete");
      if (result.completed) { dataStore.increment("plansCompleted"); dataStore.increment("notificationsAcknowledged"); wellbeingService.reward("task"); }
      broadcastPlans(); handled = true;
    }
    if (handled) { runtime.wellbeing = wellbeingService.snapshot(); broadcastRuntimeStatus(); closeNotificationPopup(); }
    return handled;
  });
  ipcMain.handle("notification-popup:open-reminders", async (event) => {
    const tab = currentAppNotification.kind === "plan" ? "plans" : "reminders";
    if (event.sender === notificationPopupWindow?.webContents) closeNotificationPopup();
    await openConsole(tab);
  });
  ipcMain.handle("notification-popup:open-chat", async (event) => {
    if (event.sender === notificationPopupWindow?.webContents) closeNotificationPopup();
    await openChat();
  });
  ipcMain.handle("storage:clear-chats", async () => {
    await dataStore.clearChats();
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload();
    return true;
  });
  ipcMain.handle("storage:reset-all", async () => {
    const saved = await resetLocalData(true);
    syncSensorForSettings(saved);
    applyAppearance(saved);
    petWindow?.webContents.send("settings:changed", saved);
    consoleWindow?.webContents.send("settings:changed", saved);
    chatWindow?.webContents.send("settings:changed", saved);
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.reload();
    return true;
  });
  ipcMain.handle("storage:clear-all", async () => {
    await resetLocalData(true);
    app.relaunch();
    setTimeout(() => app.exit(0), 100);
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
  ipcMain.handle("chat:suggestions", () => agent.suggestions());
  ipcMain.handle("chat:context-preview", () => agent.contextPreview());
  ipcMain.handle("chat:execute-action", (event, id: string, action: string) => agentTools.executeActionCard(String(id), String(action), event.sender));
  ipcMain.handle("agent:approval", (_event, id: string, approved: boolean, allowConversation?: boolean, conversationId?: string) => agentTools.resolve(id, approved, Boolean(allowConversation), String(conversationId ?? "")));
  ipcMain.handle("agent:approval:clear", (event) => agentTools.clearConversationApprovals(event.sender));
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
  planService = new PlanService(() => settingsStore.get().dataDirectory);
  await planService.load();
  wellbeingService = new WellbeingService(() => settingsStore.get().dataDirectory, dataStore);
  await wellbeingService.load();
  runtime.wellbeing = wellbeingService.snapshot();
  const activityRules = new ActivityRuleStore(() => settingsStore.get().dataDirectory);
  await activityRules.load();
  activityClassifier = new ActivityClassifier(settingsStore, dataStore, activityRules, (resolved) => {
    if (runtime.activity.foregroundProcess !== resolved.foregroundProcess) return;
    runtime.activity = {
      ...runtime.activity,
      activityKind: resolved.activityKind,
      activityLabel: resolved.activityLabel,
      applicationLabel: resolved.applicationLabel,
      classificationSource: resolved.classificationSource,
      classificationConfidence: resolved.classificationConfidence,
      presenceState: resolved.presenceState
    };
    broadcastRuntimeStatus();
    petWindow?.webContents.send("pet:activity", runtime.activity);
    consoleWindow?.webContents.send("pet:activity", runtime.activity);
    chatWindow?.webContents.send("pet:activity", runtime.activity);
  });
  await activityClassifier.initialize();
  await syncUninstallDataPath(settingsStore.get().dataDirectory);
  sensor = new SensorService();
  agentTools = new AgentTools({
    getActivity: () => runtime.activity,
    getContext: () => agent.contextPreview(),
    getSystemSummary: () => ({ activity: runtime.activity.activityLabel, wellbeing: runtime.wellbeing, update: updateService?.status(), plans: planService.summary(20) }),
    getWellbeing: () => wellbeingService.snapshot(),
    checkUpdates: () => updateService.check(),
    findPlans: (query) => {
      const needle = query.trim().toLowerCase();
      return planService.summary(20).filter((plan) => !needle || `${plan.title} ${plan.recurrence}`.toLowerCase().includes(needle));
    },
    getPetName: () => settingsStore.get().petName,
    getToolPermission: (name) => {
      const permissions = settingsStore.get().ai.toolPermissions;
      if (name === "open_url" || name === "launch_app" || name === "read_current_context") return permissions[name];
      return "ask";
    },
    setAction: (action) => { if (!actionIds.has(action) && !isDirectionalDragAction(action)) return false; sendPetAction(action); return true; },
    setAccent: (color) => saveAgentSettings((settings) => { settings.appearance.accentColor = color; settings.appearance.recentAccentColors = [color, ...settings.appearance.recentAccentColors.filter((item) => item !== color)].slice(0, 6); }),
    setScale: (scale) => saveAgentSettings((settings) => { settings.appearance.scale = scale; }),
    createPlan: async (input) => { await planService.upsertTask(input); broadcastPlans(); return true; },
    updateChatActionCard: (conversationId, card) => dataStore.updateChatActionCard(conversationId, card).then(() => undefined),
    updateAction: async (action) => {
      if (action === "open") { await openConsole("updates"); return { ok: true, message: "已打开更新页面" }; }
      if (action === "download") { const status = await updateService.download(); return { ok: status.phase === "downloading" || status.phase === "downloaded", message: status.message }; }
      if (action === "install") { const ok = await updateService.install(); return { ok, message: ok ? "已开始安装最新更新" : "当前还没有已验证的最新安装包" }; }
      return { ok: false, message: "不支持的更新操作" };
    },
    openConsole,
    showNotification: (title, body) => void showAppNotification({ title, body, kind: "assistant" })
  });
  agent = new DeepSeekAgent(settingsStore, dataStore, () => runtime.activity, agentTools, () => planService.summary(20));
  updateService = new UpdateService({
    enabled: app.isPackaged && process.platform === "win32" && !smokeMode,
    onStatus: broadcastUpdateStatus,
    beforeInstall: async () => {
      sensor?.stop();
      await Promise.all([dataStore.flush(), planService.flush(), wellbeingService.flush()]);
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
    const filtered = activityClassifier.classify(filterActivity(snapshot, settings));
    runtime.activity = filtered;
    runtime.sensorHealthy = snapshot.sensorSource !== "fallback";
    const wellbeing = wellbeingService.update(filtered, settings);
    runtime.wellbeing = wellbeing.snapshot;
    if (wellbeing.changed && settings.wellbeing.desktopHints && filtered.presenceState !== "active") {
      const copy = wellbeing.snapshot.state === "sleepy" ? "我也有点困啦，休息一下会更舒服。" : wellbeing.snapshot.state === "energized" ? "休息得不错，今天又恢复活力啦。" : "我会继续安静陪着你。";
      petWindow?.webContents.send("pet:speech", { text: copy, kind: "proactive" });
    }
    const sensingActive = settings.firstRunConsent && settings.sensing.enabled && (!runtime.sensingPausedUntil || runtime.sensingPausedUntil <= Date.now());
    if (!writesPaused && sensingActive) dataStore.recordActivity(filtered);
    void maybeSendProactive(filtered, settings);
    const interruptionsAllowed = sensingActive && !isScheduledSilent(settings) && !filtered.locked
      && !(settings.reminders.meetingSilent && filtered.meeting)
      && !(settings.reminders.fullscreenSilent && filtered.fullscreen);
    for (const reminder of reminderScheduler.tick(filtered, settings, interruptionsAllowed)) {
      const copyKind = reminder.kind;
      void agent.nextReminderLine(copyKind, reminder.body).then((body) =>
        showAppNotification({ title: `${settings.petName} · ${reminder.title}`, body, kind: reminder.kind })
      );
    }
    void planService.tick(filtered.timestamp, interruptionsAllowed).then((notifications) => notifications.forEach((notification) => void showAppNotification(notification)));
    if (settings.manualMode === "energy_saving" && filtered.timestamp - lastEnergySnapshotAt < 4_000) return;
    lastEnergySnapshotAt = filtered.timestamp;
    broadcastRuntimeStatus();
    petWindow?.webContents.send("pet:activity", filtered);
    consoleWindow?.webContents.send("pet:activity", filtered);
    chatWindow?.webContents.send("pet:activity", filtered);
  });
  syncSensorForSettings(settingsStore.get());
  if (!smokeMode && shouldAutoShowOnboarding(settingsStore.get(), app.getVersion())) void openConsole("home");
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
