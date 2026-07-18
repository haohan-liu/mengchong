export type PlayMode = "loop" | "once";

export type FramePlaybackMode = "forward" | "ping-pong";
export interface AnimationPhase {
  from: number;
  to: number;
  mode?: FramePlaybackMode;
}
export interface AnimationPlayback {
  enter?: AnimationPhase;
  sustain?: AnimationPhase;
  exit?: AnimationPhase;
  interruptPolicy: "immediate" | "after-exit";
  continuityGroup?: string;
}

export interface AnimationDefinition {
  id: string;
  category: string;
  name: string;
  frames: number;
  fps: number;
  playMode: PlayMode;
  prompt: string;
  returnTo: string | null;
  playback?: AnimationPlayback;
}

export type DragDirection = "left" | "right";
export const directionalDragActions = ["dragged_left", "dragged_right"] as const;
export type DirectionalDragAction = typeof directionalDragActions[number];

export function directionalDragAction(direction: DragDirection): DirectionalDragAction {
  return direction === "left" ? "dragged_left" : "dragged_right";
}

export function isDirectionalDragAction(action: string): action is DirectionalDragAction {
  return (directionalDragActions as readonly string[]).includes(action);
}

export type PetState =
  | "BOOT" | "APPEAR" | "IDLE" | "LISTENING" | "USER_TYPING"
  | "THINKING" | "RESPONDING" | "SUCCESS" | "ERROR" | "OFFLINE"
  | "LOW_BATTERY" | "SLEEP" | "DRAGGING" | "REACTION" | "DISAPPEAR";

export const activityKinds = [
  "designing", "modeling", "rendering", "video-editing", "developing", "editing",
  "spreadsheet", "presentation", "reading", "meeting", "communicating", "browsing",
  "searching", "ai-chat", "learning", "file-management", "watching", "listening",
  "gaming", "other"
] as const;
export type ActivityKind = typeof activityKinds[number];
export type ActivityGroup = "productivity" | "collaboration" | "browser" | "files" | "media" | "other";
export type ClassificationSource = "manual" | "builtin" | "learned" | "ai" | "fallback";
export type PresenceState = "active" | "away" | "resting";

export interface PerformanceSnapshot {
  systemCpuPercent: number;
  systemMemoryPercent: number;
  petCpuPercent: number;
  petMemoryMb: number;
  petProcessCount: number;
  sensorMemoryMb: number;
  eventLoopLagMs: number;
}

export interface ActivitySnapshot {
  timestamp: number;
  foregroundProcess: string;
  foregroundPath: string;
  windowTitle: string;
  documentTitle: string;
  activityKind: ActivityKind;
  activityLabel: string;
  applicationLabel: string;
  classificationSource: ClassificationSource;
  classificationConfidence: number;
  presenceState: PresenceState;
  activeAppSeconds: number;
  appSwitches5m: number;
  keyboardCount1s: number;
  keyboardCount10s: number;
  keyboardPulse: boolean;
  mouseClicks1s: number;
  mouseClicks10s: number;
  mouseClickPulse: boolean;
  mouseWheel1s: number;
  mouseWheel10s: number;
  mouseDistance1s: number;
  mouseDistance10s: number;
  idleSeconds: number;
  fullscreen: boolean;
  locked: boolean;
  meeting: boolean;
  microphoneActive: boolean;
  online: boolean;
  batteryPercent: number;
  charging: boolean;
  sensorSource: "native" | "compat" | "fallback";
  performance: PerformanceSnapshot;
}

export interface ContentContext {
  application: string;
  category: ActivityKind;
  windowTitle: string;
  documentTitle: string;
  selectedText: string;
  clipboardText: string;
  summary: string;
  blocked: boolean;
  redactions: number;
}

export interface AppearanceSettings {
  scale: number;
  alwaysOnTop: boolean;
  lockPosition: boolean;
  animationIntensity: "full" | "soft" | "minimal";
  bubbleFontSize: number;
  bubbleScale: number;
  bubbleOpacity: number;
  bubbleDurationSeconds: number;
  theme: "cream" | "dark" | "system";
  accentColor: string;
  recentAccentColors: string[];
}

export interface SensingSettings {
  enabled: boolean;
  foregroundApp: boolean;
  windowTitle: boolean;
  keyboardMouse: boolean;
  clipboard: boolean;
  selectedText: boolean;
  meeting: boolean;
  microphone: boolean;
  power: boolean;
  network: boolean;
  autoContext: boolean;
  smartActivityLearning: boolean;
  blockedApps: string[];
  allowedApps: string[];
}

export interface ReminderSettings {
  focusMinutes: number;
  breakMinutes: number;
  hydrationMinutes: number;
  proactiveCooldownMinutes: number;
  proactiveDailyLimit: number;
  scheduledSilent: boolean;
  quietStart: string;
  quietEnd: string;
  meetingSilent: boolean;
  fullscreenSilent: boolean;
  autostart: boolean;
  startupDelaySeconds: number;
}

export interface AppNotification {
  title: string;
  body: string;
  kind: "reminder" | "assistant";
}

export interface AiSettings {
  baseUrl: string;
  model: "deepseek-v4-flash" | "deepseek-v4-pro";
  deepThinking: boolean;
  smartCompanionSpeech: boolean;
  monthlyLimit: number;
  includeContext: boolean;
  toolPermissions: {
    open_url: "ask" | "allow" | "deny";
    launch_app: "ask" | "allow" | "deny";
    read_current_context: "ask" | "allow" | "deny";
  };
}

export interface Settings {
  version: number;
  petName: string;
  firstRunConsent: boolean;
  appearance: AppearanceSettings;
  sensing: SensingSettings;
  reminders: ReminderSettings;
  ai: AiSettings;
  dataDirectory: string;
  manualMode: "auto" | "dnd" | "rest" | "energy_saving" | "low_battery" | "manual";
  manualState: PetState | null;
  manualUntil: number | null;
}

export interface DailyStatistic {
  date: string;
  activeSeconds: number;
  restSeconds: number;
  productiveSeconds: number;
  inputEvents: number;
  appSwitches: number;
  breaksCompleted: number;
  hydrationCompleted: number;
  aiCalls: number;
  localReplies: number;
  categories: Record<ActivityKind, number>;
}

export interface ActivityRule {
  id: string;
  processName: string;
  titleKeywords: string[];
  applicationLabel: string;
  activityKind: ActivityKind;
  source: "manual" | "learned";
  confidence: number;
  hitCount: number;
  lastUsedAt: number;
  pinned: boolean;
}

export interface StatisticsSummary {
  today: DailyStatistic;
  days: DailyStatistic[];
  monthlyAiCalls: number;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  source?: "api" | "local";
  error?: string;
}
export interface ChatSession { id: string; title: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; }
export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessagePreview: string;
}
export interface ChatMessagePage {
  sessionId: string;
  messages: ChatMessage[];
  total: number;
  hasMore: boolean;
  nextCursor: number | null;
}
export interface ChatChunk { requestId: string; sessionId: string; text: string; done: boolean; source: "api" | "local"; error?: string; }
export interface ChatStatus {
  petName: string;
  model: string;
  used: number;
  limit: number;
  remaining: number;
  apiConfigured: boolean;
  online: boolean;
  contextEnabled: boolean;
  contextBlocked: boolean;
  contextSummary: string;
}
export type PetSpeechKind = "click" | "proactive";
export interface PetSpeechEvent { text: string; kind: PetSpeechKind; }

export interface AgentToolCall {
  id: string;
  name: "get_activity_summary" | "create_reminder" | "complete_reminder" | "snooze_reminder" | "focus_timer" | "set_pet_action" | "show_notification" | "open_console" | "open_url" | "launch_app" | "read_current_context";
  arguments: Record<string, unknown>;
  risk: "safe" | "confirm";
}

export interface PetRuntimeStatus {
  state: PetState;
  action: string;
  source: string;
  sensingPausedUntil: number | null;
  activity: ActivitySnapshot;
  sensorHealthy: boolean;
  aiHealthy: boolean;
}

export type UpdatePhase = "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number;
  message: string;
}
