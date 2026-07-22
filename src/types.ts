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

export interface WellbeingSettings {
  enabled: boolean;
  desktopHints: boolean;
}

export type NotificationKind = "reminder" | "assistant" | "general" | "hydration" | "break" | "plan";
export type NotificationActionId = "acknowledge" | "hydrate" | "start-break" | "snooze" | "complete" | "view" | "chat";

export interface NotificationAction {
  id: NotificationActionId;
  label: string;
  style?: "primary" | "secondary" | "quiet";
  snoozeMinutes?: number;
  alternatives?: Array<{ label: string; minutes: number }>;
}

export interface AppNotification {
  id: string;
  sourceId?: string;
  occurrenceId?: string;
  title: string;
  body: string;
  kind: NotificationKind;
  priority: "low" | "normal" | "high";
  actions: NotificationAction[];
  createdAt: number;
  expiresAt?: number;
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
  onboardingLastShownVersion: string;
  suppressOnboardingAfterUpdates: boolean;
  appearance: AppearanceSettings;
  sensing: SensingSettings;
  reminders: ReminderSettings;
  wellbeing: WellbeingSettings;
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
  notificationsShown: number;
  notificationsAcknowledged: number;
  notificationsSnoozed: number;
  plansCompleted: number;
  vitalityMin: number;
  vitalitySum: number;
  vitalitySamples: number;
  moodSum: number;
  moodSamples: number;
  recoverySeconds: number;
  highLoadSeconds: number;
  categories: Record<ActivityKind, number>;
}

export type WellbeingState = "learning" | "energized" | "steady" | "tired" | "sleepy";
export interface WellbeingSnapshot {
  vitality: number;
  mood: number;
  state: WellbeingState;
  estimated: boolean;
  baselineDays: number;
  updatedAt: number;
}

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type RecurrenceKind = "once" | "daily" | "weekly" | "monthly-date" | "monthly-last-day";
export interface RecurrenceRule {
  kind: RecurrenceKind;
  weekdays?: Weekday[];
  monthDay?: number;
  endAt?: number | null;
}

export interface PlanTask {
  id: string;
  title: string;
  notes: string;
  priority: "low" | "normal" | "high";
  tags: string[];
  startAt: number;
  dueAt: number | null;
  timezone: string;
  recurrence: RecurrenceRule;
  reminderOffsets: number[];
  status: "active" | "completed" | "archived" | "expired";
  nextDueAt: number | null;
  lastTriggeredAt: number | null;
  snoozedUntil: number | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface PlanOccurrence {
  id: string;
  taskId: string;
  dueAt: number;
  status: "pending" | "completed" | "snoozed" | "skipped" | "missed";
  completedAt: number | null;
  snoozedUntil: number | null;
  createdAt: number;
}

export interface PlanInboxItem {
  id: string;
  taskId: string;
  occurrenceId: string;
  title: string;
  dueAt: number;
  read: boolean;
  createdAt: number;
}

export interface PlansSnapshot {
  version: number;
  revision: number;
  tasks: PlanTask[];
  occurrences: PlanOccurrence[];
  inbox: PlanInboxItem[];
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
  actionCards?: ChatActionCard[];
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
  name: "get_activity_summary" | "get_system_summary" | "get_wellbeing" | "check_for_updates" | "find_plans" | "propose_accent_colors" | "propose_pet_scale" | "propose_plan" | "create_reminder" | "complete_reminder" | "snooze_reminder" | "focus_timer" | "set_pet_action" | "show_notification" | "open_console" | "open_url" | "launch_app" | "read_current_context";
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
  wellbeing: WellbeingSnapshot;
}

export type ChatActionCardType = "accent-colors" | "pet-scale" | "update" | "plan" | "shortcut";
export interface ChatActionCard {
  id: string;
  /** Cards are visible only in the conversation that requested them. */
  conversationId?: string;
  type: ChatActionCardType;
  revision: number;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  actions: Array<{ id: string; label: string; style?: "primary" | "secondary" | "quiet" }>;
  status: "pending" | "executed" | "failed" | "stale" | "cancelled";
  result?: string;
  createdAt: number;
}

export interface ChatActionResult {
  ok: boolean;
  status: ChatActionCard["status"];
  message: string;
  settings?: Settings;
  plans?: PlansSnapshot;
  update?: UpdateStatus;
}

export type UpdatePhase = "disabled" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  latestVerifiedVersion: string | null;
  downloadedVersion: string | null;
  checkedAt: number | null;
  downloadVerified: boolean;
  releaseNotes: string | null;
  downloadPercent: number;
  message: string;
}
