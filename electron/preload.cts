import { contextBridge, ipcRenderer } from "electron";
import type { ActivitySnapshot, AgentToolCall, ChatChunk, PetSpeechEvent, PetSpeechKind, UpdateStatus } from "../src/types.js";

const on = <T,>(channel: string, listener: (value: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("petAPI", {
  pet: {
    startDrag: () => ipcRenderer.invoke("pet:start-drag"),
    stopDrag: () => ipcRenderer.invoke("pet:stop-drag"),
    openConsole: () => ipcRenderer.invoke("console:open"),
    openChat: () => ipcRenderer.invoke("chat:open"),
    hide: () => ipcRenderer.invoke("pet:hide"),
    setAction: (action: string) => ipcRenderer.invoke("pet:set-action", action),
    setState: (state: string) => ipcRenderer.invoke("pet:set-state", state),
    getRuntime: () => ipcRenderer.invoke("pet:runtime"),
    pauseSensing: (minutes: number) => ipcRenderer.invoke("pet:pause-sensing", minutes),
    resumeSensing: () => ipcRenderer.invoke("pet:resume-sensing"),
    nextSpeech: (kind: PetSpeechKind) => ipcRenderer.invoke("pet:next-speech", kind),
    previewScale: (scale: number, bubbleScale: number) => ipcRenderer.send("pet:preview-scale", { scale, bubbleScale }),
    onRuntimeChanged: (listener: (status: unknown) => void) => on("pet:runtime-changed", listener),
    onActivity: (listener: (snapshot: ActivitySnapshot) => void) => on("pet:activity", listener),
    onAction: (listener: (action: string) => void) => on("pet:action", listener),
    onSpeech: (listener: (speech: PetSpeechEvent) => void) => on("pet:speech", listener),
    onScalePreview: (listener: (value: { scale: number; bubbleScale: number }) => void) => on("pet:scale-preview", listener),
    onScaleFrame: (listener: (value: { scale: number }) => void) => on("pet:scale-frame", listener),
    notifyAnimationEnd: (action: string) => ipcRenderer.send("pet:animation-end", action)
  },
  console: {
    open: (section?: string) => ipcRenderer.invoke("console:open", section),
    close: () => ipcRenderer.invoke("console:close"),
    initialTab: () => ipcRenderer.invoke("console:initial-tab"),
    syncTitle: (name: string) => ipcRenderer.invoke("window:sync-title", "console", name),
    onNavigate: (listener: (section: string) => void) => on("console:navigate", listener)
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (settings: unknown) => ipcRenderer.invoke("settings:update", settings),
    onChanged: (listener: (settings: unknown) => void) => on("settings:changed", listener),
    chooseDataDirectory: () => ipcRenderer.invoke("settings:choose-directory"),
    resetPosition: () => ipcRenderer.invoke("settings:reset-position"),
    setApiKey: (value: string) => ipcRenderer.invoke("settings:set-api-key", value),
    hasApiKey: () => ipcRenderer.invoke("settings:has-api-key"),
    testDeepSeek: () => ipcRenderer.invoke("settings:test-ai")
  },
  statistics: {
    get: (days: number) => ipcRenderer.invoke("statistics:get", days),
    clear: () => ipcRenderer.invoke("statistics:clear")
  },
  storage: {
    clearChats: () => ipcRenderer.invoke("storage:clear-chats"),
    resetAll: () => ipcRenderer.invoke("storage:reset-all")
  },
  updates: {
    status: () => ipcRenderer.invoke("updates:status"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    openReleases: () => ipcRenderer.invoke("updates:open-releases"),
    onChanged: (listener: (status: UpdateStatus) => void) => on("updates:changed", listener)
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
    contextPreview: () => ipcRenderer.invoke("chat:context-preview"),
    syncTitle: (name: string) => ipcRenderer.invoke("window:sync-title", "chat", name),
    onChunk: (listener: (chunk: ChatChunk) => void) => on("chat:chunk", listener)
  },
  agentApproval: {
    resolve: (id: string, approved: boolean) => ipcRenderer.invoke("agent:approval", id, approved),
    onRequest: (listener: (call: AgentToolCall) => void) => on("agent:approval-request", listener)
  }
});
