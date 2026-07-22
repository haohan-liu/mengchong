import { contextBridge, ipcRenderer } from "electron";
import type { ActivitySnapshot, AgentToolCall, AppNotification, ChatActionCard, ChatActionResult, ChatChunk, PetSpeechEvent, PetSpeechKind, PlansSnapshot, UpdateStatus, WellbeingSnapshot } from "../src/types.js";

const on = <T,>(channel: string, listener: (value: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("petAPI", {
  pet: {
    startDrag: (origin: { x: number; y: number }, point: { x: number; y: number }) => ipcRenderer.invoke("pet:start-drag", { origin, point }),
    stopDrag: () => ipcRenderer.invoke("pet:stop-drag"),
    openConsole: () => ipcRenderer.invoke("console:open"),
    openChat: () => ipcRenderer.invoke("chat:open"),
    hide: () => ipcRenderer.invoke("pet:hide"),
    quit: () => ipcRenderer.invoke("app:quit"),
    setAction: (action: string) => ipcRenderer.invoke("pet:set-action", action),
    setState: (state: string) => ipcRenderer.invoke("pet:set-state", state),
    getRuntime: () => ipcRenderer.invoke("pet:runtime"),
    pauseSensing: (minutes: number) => ipcRenderer.invoke("pet:pause-sensing", minutes),
    resumeSensing: () => ipcRenderer.invoke("pet:resume-sensing"),
    nextSpeech: (kind: PetSpeechKind) => ipcRenderer.invoke("pet:next-speech", kind),
    raiseBubble: () => ipcRenderer.send("pet:bubble-presented"),
    previewScale: (scale: number, bubbleScale: number) => ipcRenderer.send("pet:preview-scale", { scale, bubbleScale }),
    acknowledgeVisibility: (visible: boolean) => ipcRenderer.invoke("pet:visibility-ack", visible),
    onRuntimeChanged: (listener: (status: unknown) => void) => on("pet:runtime-changed", listener),
    onActivity: (listener: (snapshot: ActivitySnapshot) => void) => on("pet:activity", listener),
    onAction: (listener: (action: string) => void) => on("pet:action", listener),
    onSpeech: (listener: (speech: PetSpeechEvent) => void) => on("pet:speech", listener),
    onScalePreview: (listener: (value: { scale: number; bubbleScale: number }) => void) => on("pet:scale-preview", listener),
    onScaleFrame: (listener: (value: { scale: number }) => void) => on("pet:scale-frame", listener),
    onVisibilityChanged: (listener: (visible: boolean) => void) => on("pet:visibility-changed", listener),
    notifyAnimationEnd: (action: string) => ipcRenderer.send("pet:animation-end", action)
  },
  console: {
    open: (section?: string) => ipcRenderer.invoke("console:open", section),
    close: () => ipcRenderer.invoke("console:close"),
    initialTab: () => ipcRenderer.invoke("console:initial-tab"),
    syncTitle: (name: string) => ipcRenderer.invoke("window:sync-title", "console", name),
    onNavigate: (listener: (section: string) => void) => on("console:navigate", listener)
  },
  windowControls: {
    minimize: (target: "console" | "chat") => ipcRenderer.invoke("window:minimize", target),
    toggleMaximize: (target: "console" | "chat") => ipcRenderer.invoke("window:toggle-maximize", target),
    onMaximizedChanged: (listener: (maximized: boolean) => void) => on("window:maximized-changed", listener)
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (settings: unknown) => ipcRenderer.invoke("settings:update", settings),
    onChanged: (listener: (settings: unknown) => void) => on("settings:changed", listener),
    chooseDataDirectory: () => ipcRenderer.invoke("settings:choose-directory"),
    resetPosition: () => ipcRenderer.invoke("settings:reset-position"),
    setApiKey: (value: string) => ipcRenderer.invoke("settings:set-api-key", value),
    hasApiKey: () => ipcRenderer.invoke("settings:has-api-key"),
    openDeepSeekApiSignup: () => ipcRenderer.invoke("settings:open-deepseek-api-signup"),
    testDeepSeek: () => ipcRenderer.invoke("settings:test-ai")
  },
  statistics: {
    get: (days: number) => ipcRenderer.invoke("statistics:get", days),
    clear: () => ipcRenderer.invoke("statistics:clear")
  },
  wellbeing: {
    get: () => ipcRenderer.invoke("wellbeing:get") as Promise<WellbeingSnapshot>,
    onChanged: (listener: (snapshot: WellbeingSnapshot) => void) => on("wellbeing:changed", listener)
  },
  plans: {
    list: () => ipcRenderer.invoke("plans:list") as Promise<PlansSnapshot>,
    upsert: (value: unknown) => ipcRenderer.invoke("plans:upsert", value) as Promise<PlansSnapshot>,
    complete: (id: string) => ipcRenderer.invoke("plans:complete", id),
    archive: (id: string) => ipcRenderer.invoke("plans:archive", id) as Promise<PlansSnapshot>,
    delete: (id: string) => ipcRenderer.invoke("plans:delete", id) as Promise<boolean>,
    clearCompletedHistory: () => ipcRenderer.invoke("plans:history:clear") as Promise<PlansSnapshot>,
    respondInbox: (id: string, action: "complete" | "snooze" | "read", minutes?: number) => ipcRenderer.invoke("plans:inbox:respond", id, action, minutes),
    onChanged: (listener: (snapshot: PlansSnapshot) => void) => on("plans:changed", listener)
  },
  activityRules: {
    list: () => ipcRenderer.invoke("activity-rules:list"),
    update: (id: string, changes: unknown) => ipcRenderer.invoke("activity-rules:update", id, changes),
    delete: (id: string) => ipcRenderer.invoke("activity-rules:delete", id),
    clear: () => ipcRenderer.invoke("activity-rules:clear")
  },
  storage: {
    clearChats: () => ipcRenderer.invoke("storage:clear-chats"),
    resetAll: () => ipcRenderer.invoke("storage:reset-all"),
    clearAll: () => ipcRenderer.invoke("storage:clear-all")
  },
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    openReleases: () => ipcRenderer.invoke("updates:open-releases"),
    openLink: (url: string) => ipcRenderer.invoke("updates:open-link", url),
    onChanged: (listener: (status: UpdateStatus) => void) => on("updates:changed", listener)
  },
  updatePopup: {
    close: () => ipcRenderer.invoke("update-popup:close")
  },
  notificationPopup: {
    current: () => ipcRenderer.invoke("notification-popup:current") as Promise<AppNotification>,
    resize: (width: number) => ipcRenderer.invoke("notification-popup:resize", width) as Promise<boolean>,
    close: () => ipcRenderer.invoke("notification-popup:close"),
    openReminders: () => ipcRenderer.invoke("notification-popup:open-reminders"),
    openChat: () => ipcRenderer.invoke("notification-popup:open-chat"),
    respond: (action: string, snoozeMinutes?: number) => ipcRenderer.invoke("notification-popup:respond", action, snoozeMinutes) as Promise<boolean>,
    hover: (hovered: boolean) => ipcRenderer.invoke("notification-popup:hover", hovered),
    onChanged: (listener: (notification: AppNotification) => void) => on("notification-popup:changed", listener)
  },
  chat: {
    open: () => ipcRenderer.invoke("chat:open"),
    close: () => ipcRenderer.invoke("chat:close"),
    send: (sessionId: string, text: string) => ipcRenderer.invoke("chat:send", sessionId, text),
    cancel: (requestId: string) => ipcRenderer.invoke("chat:cancel", requestId),
    list: () => ipcRenderer.invoke("chat:list"),
    messages: (sessionId: string, cursor?: number, limit?: number) => ipcRenderer.invoke("chat:messages", sessionId, cursor, limit),
    create: (title?: string) => ipcRenderer.invoke("chat:create", title),
    rename: (sessionId: string, title: string) => ipcRenderer.invoke("chat:rename", sessionId, title),
    delete: (sessionId: string) => ipcRenderer.invoke("chat:delete", sessionId),
    status: () => ipcRenderer.invoke("chat:status"),
    suggestions: () => ipcRenderer.invoke("chat:suggestions"),
    contextPreview: () => ipcRenderer.invoke("chat:context-preview"),
    executeAction: (id: string, action: string) => ipcRenderer.invoke("chat:execute-action", id, action) as Promise<ChatActionResult>,
    syncTitle: (name: string) => ipcRenderer.invoke("window:sync-title", "chat", name),
    onChunk: (listener: (chunk: ChatChunk) => void) => on("chat:chunk", listener),
    onActionCard: (listener: (card: ChatActionCard) => void) => on("chat:action-card", listener),
    onActionResult: (listener: (card: ChatActionCard) => void) => on("chat:action-result", listener)
  },
  agentApproval: {
    resolve: (id: string, approved: boolean, allowConversation = false, conversationId = "") => ipcRenderer.invoke("agent:approval", id, approved, allowConversation, conversationId),
    clear: () => ipcRenderer.invoke("agent:approval:clear"),
    onRequest: (listener: (call: AgentToolCall) => void) => on("agent:approval-request", listener)
  }
});
