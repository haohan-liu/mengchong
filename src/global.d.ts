import type { ActivityRule, ActivitySnapshot, AgentToolCall, AppNotification, ChatChunk, ChatMessagePage, ChatSession, ChatSessionSummary, ChatStatus, ContentContext, PetRuntimeStatus, PetSpeechEvent, PetSpeechKind, Settings, StatisticsSummary, UpdateStatus } from "./types";

declare global {
  interface Window {
    petAPI: {
      pet: {
        startDrag(origin: { x: number; y: number }, point: { x: number; y: number }): Promise<boolean>;
        stopDrag(): Promise<void>;
        openConsole(): Promise<void>;
        openChat(): Promise<void>;
        hide(): Promise<void>;
        quit(): Promise<void>;
        setAction(action: string): Promise<boolean>;
        setState(state: string): Promise<boolean>;
        getRuntime(): Promise<PetRuntimeStatus>;
        pauseSensing(minutes: number): Promise<void>;
        resumeSensing(): Promise<void>;
        nextSpeech(kind: PetSpeechKind): Promise<string>;
        previewScale(scale: number, bubbleScale: number): void;
        acknowledgeVisibility(visible: boolean): Promise<boolean>;
        onRuntimeChanged(listener: (status: PetRuntimeStatus) => void): () => void;
        onActivity(listener: (snapshot: ActivitySnapshot) => void): () => void;
        onAction(listener: (action: string) => void): () => void;
        onSpeech(listener: (speech: PetSpeechEvent) => void): () => void;
        onScalePreview(listener: (value: { scale: number; bubbleScale: number }) => void): () => void;
        onScaleFrame(listener: (value: { scale: number }) => void): () => void;
        onVisibilityChanged(listener: (visible: boolean) => void): () => void;
        notifyAnimationEnd(action: string): void;
      };
      console: { open(section?: "home" | "appearance" | "states" | "privacy" | "reminders" | "ai" | "stats" | "storage" | "updates"): Promise<void>; close(): Promise<void>; initialTab(): Promise<string>; syncTitle(name: string): Promise<void>; onNavigate(listener: (section: string) => void): () => void; };
      settings: {
        get(): Promise<Settings>;
        update(settings: Settings): Promise<Settings>;
        onChanged(listener: (settings: Settings) => void): () => void;
        chooseDataDirectory(): Promise<string | null>;
        resetPosition(): Promise<void>;
        setApiKey(value: string): Promise<boolean>;
        hasApiKey(): Promise<boolean>;
        openDeepSeekApiSignup(): Promise<void>;
        testDeepSeek(): Promise<string>;
      };
      statistics: {
        get(days: number): Promise<StatisticsSummary>;
        clear(): Promise<boolean>;
      };
      activityRules: {
        list(): Promise<ActivityRule[]>;
        update(id: string, changes: Partial<Pick<ActivityRule, "activityKind" | "applicationLabel" | "pinned">>): Promise<ActivityRule | null>;
        delete(id: string): Promise<boolean>;
        clear(): Promise<boolean>;
      };
      storage: { clearChats(): Promise<boolean>; resetAll(): Promise<boolean>; clearAll(): Promise<boolean>; };
      updates: {
        status(): Promise<UpdateStatus>;
        check(): Promise<UpdateStatus>;
        download(): Promise<UpdateStatus>;
        install(): Promise<boolean>;
        openReleases(): Promise<void>;
        onChanged(listener: (status: UpdateStatus) => void): () => void;
      };
      updatePopup: { close(): Promise<void>; };
      notificationPopup: {
        current(): Promise<AppNotification>;
        close(): Promise<void>;
        openReminders(): Promise<void>;
        openChat(): Promise<void>;
        onChanged(listener: (notification: AppNotification) => void): () => void;
      };
      chat: {
        open(): Promise<void>;
        close(): Promise<void>;
        send(sessionId: string, text: string): Promise<string>;
        cancel(requestId: string): Promise<void>;
        list(): Promise<ChatSessionSummary[]>;
        messages(sessionId: string, cursor?: number, limit?: number): Promise<ChatMessagePage>;
        create(title?: string): Promise<ChatSession>;
        rename(sessionId: string, title: string): Promise<ChatSession | null>;
        delete(sessionId: string): Promise<boolean>;
        status(): Promise<ChatStatus>;
        suggestions(): Promise<Array<{ title: string; detail: string; prompt: string; icon: "context" | "message" | "search" }>>;
        contextPreview(): Promise<ContentContext>;
        syncTitle(name: string): Promise<void>;
        onChunk(listener: (chunk: ChatChunk) => void): () => void;
      };
      agentApproval: {
        resolve(id: string, approved: boolean, allowConversation?: boolean, conversationId?: string): Promise<void>;
        clear(): Promise<void>;
        onRequest(listener: (call: AgentToolCall) => void): () => void;
      };
    };
  }
}

export {};
