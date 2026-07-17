import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ActivitySnapshot,
  AppCategory,
  ChatMessage,
  ChatMessagePage,
  ChatSession,
  ChatSessionSummary,
  DailyStatistic,
  StatisticsSummary
} from "../../src/types.js";
import { categorize } from "../../src/shared/categorize.js";

const STATISTICS_VERSION = 3;
const CHAT_INDEX_VERSION = 2;
const MAX_CHAT_SESSIONS = 50;
const MAX_CHAT_MESSAGES = 200;
const CHAT_CACHE_SIZE = 2;
const categories: AppCategory[] = ["design", "office", "development", "communication", "entertainment", "other"];

const dayKey = (time = Date.now()): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function emptyDay(date = dayKey()): DailyStatistic {
  return {
    date, activeSeconds: 0, focusSeconds: 0, inputEvents: 0, appSwitches: 0,
    breaksCompleted: 0, hydrationCompleted: 0, aiCalls: 0, localReplies: 0,
    categories: Object.fromEntries(categories.map((key) => [key, 0])) as Record<AppCategory, number>
  };
}

function normalizeDay(value: Partial<DailyStatistic>, repairLegacyInput = false): DailyStatistic {
  const base = emptyDay(String(value.date || dayKey()));
  const inputEvents = Math.max(0, Number(value.inputEvents) || 0);
  return {
    ...base,
    ...value,
    date: String(value.date || base.date),
    activeSeconds: Math.max(0, Number(value.activeSeconds) || 0),
    focusSeconds: Math.max(0, Number(value.focusSeconds) || 0),
    inputEvents: Math.round(repairLegacyInput ? inputEvents / 10 : inputEvents),
    appSwitches: Math.max(0, Math.round(Number(value.appSwitches) || 0)),
    breaksCompleted: Math.max(0, Math.round(Number(value.breaksCompleted) || 0)),
    hydrationCompleted: Math.max(0, Math.round(Number(value.hydrationCompleted) || 0)),
    aiCalls: Math.max(0, Math.round(Number(value.aiCalls) || 0)),
    localReplies: Math.max(0, Math.round(Number(value.localReplies) || 0)),
    categories: Object.fromEntries(categories.map((key) => [key, Math.max(0, Number(value.categories?.[key]) || 0)])) as Record<AppCategory, number>
  };
}

function recentDayKeys(count: number): string[] {
  const result: string[] = [];
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    result.push(dayKey(date.getTime()));
  }
  return result;
}

function normalizeMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatMessage>;
  if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return null;
  return {
    id: String(item.id || crypto.randomUUID()),
    role: item.role,
    content: item.content.slice(0, 40_000),
    createdAt: Number(item.createdAt) || Date.now(),
    ...(item.source === "api" || item.source === "local" ? { source: item.source } : {}),
    ...(item.error ? { error: String(item.error).slice(0, 300) } : {})
  };
}

function normalizeSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatSession>;
  if (!item.id || !Array.isArray(item.messages)) return null;
  const messages = item.messages.flatMap((message) => {
    const normalized = normalizeMessage(message);
    return normalized ? [normalized] : [];
  }).slice(-MAX_CHAT_MESSAGES);
  return {
    id: String(item.id),
    title: String(item.title || "新对话").replace(/\s+/g, " ").trim().slice(0, 48) || "新对话",
    messages,
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now()
  };
}

function summarizeSession(session: ChatSession): ChatSessionSummary {
  const lastMessage = session.messages.at(-1)?.content.replace(/\s+/g, " ").trim().slice(0, 80) ?? "";
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage
  };
}

function normalizeSummary(value: unknown): ChatSessionSummary | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatSessionSummary>;
  if (!item.id) return null;
  return {
    id: String(item.id),
    title: String(item.title || "新对话").replace(/\s+/g, " ").trim().slice(0, 48) || "新对话",
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
    messageCount: Math.max(0, Math.min(MAX_CHAT_MESSAGES, Math.round(Number(item.messageCount) || 0))),
    lastMessagePreview: String(item.lastMessagePreview || "").replace(/\s+/g, " ").trim().slice(0, 80)
  };
}

export class DataStore {
  private days: DailyStatistic[] = [];
  private proactive = { date: dayKey(), count: 0 };
  private lastSnapshot: ActivitySnapshot | null = null;
  private chatIndex: ChatSessionSummary[] = [];
  private chatCache = new Map<string, ChatSession>();
  private chatsLoaded = false;
  private chatLoadPromise: Promise<void> | null = null;
  private statisticsWriteChain: Promise<void> = Promise.resolve();
  private chatWriteChain: Promise<void> = Promise.resolve();
  private statisticsSaveTimer: NodeJS.Timeout | null = null;

  constructor(private dataDirectory: () => string) {}

  async load(): Promise<void> {
    await mkdir(this.dataDirectory(), { recursive: true });
    await writeFile(join(this.dataDirectory(), ".qpet-data-root"), "com.qpet.ai\n", "utf8");
    try {
      const parsed = JSON.parse(await readFile(join(this.dataDirectory(), "statistics.json"), "utf8")) as { version?: number; days?: DailyStatistic[]; proactive?: { date?: string; count?: number } } | DailyStatistic[];
      const legacy = Array.isArray(parsed);
      const values = legacy ? parsed : (parsed.days ?? []);
      this.days = values.map((entry) => normalizeDay(entry, legacy || (parsed.version ?? 0) < 2));
      const proactive = legacy ? null : parsed.proactive;
      this.proactive = {
        date: String(proactive?.date || dayKey()),
        count: Math.max(0, Math.round(Number(proactive?.count) || 0))
      };
      if (legacy || (!legacy && parsed.version !== STATISTICS_VERSION)) this.scheduleStatisticsSave(50);
    } catch {
      this.days = [];
      this.proactive = { date: dayKey(), count: 0 };
    }
    this.lastSnapshot = null;
    this.chatIndex = [];
    this.chatCache.clear();
    this.chatsLoaded = false;
    this.chatLoadPromise = null;
    this.pruneDays();
  }

  private pruneDays(): void {
    this.days = this.days.sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  }

  private statisticsPath(): string { return join(this.dataDirectory(), "statistics.json"); }
  private chatIndexPath(): string { return join(this.dataDirectory(), "chat-index.json"); }
  private legacyChatsPath(): string { return join(this.dataDirectory(), "chats.json"); }
  private chatsDirectory(): string { return join(this.dataDirectory(), "chats"); }
  private chatPath(id: string): string {
    return join(this.chatsDirectory(), `${Buffer.from(id, "utf8").toString("base64url")}.json`);
  }

  private async atomicPath(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, path);
  }

  private saveStatistics(): Promise<void> {
    const snapshot = { version: STATISTICS_VERSION, days: structuredClone(this.days), proactive: structuredClone(this.proactive) };
    const write = this.statisticsWriteChain.catch(() => undefined).then(() => this.atomicPath(this.statisticsPath(), snapshot));
    this.statisticsWriteChain = write;
    return write;
  }

  private scheduleStatisticsSave(delayMs = 15_000): void {
    if (this.statisticsSaveTimer) return;
    this.statisticsSaveTimer = setTimeout(() => {
      this.statisticsSaveTimer = null;
      void this.saveStatistics().catch((error) => console.error("Statistics save failed:", error));
    }, delayMs);
  }

  private cacheSession(session: ChatSession): void {
    this.chatCache.delete(session.id);
    this.chatCache.set(session.id, session);
    while (this.chatCache.size > CHAT_CACHE_SIZE) {
      const oldestId = this.chatCache.keys().next().value as string | undefined;
      if (!oldestId) break;
      this.chatCache.delete(oldestId);
    }
  }

  private indexSnapshot(): { version: number; sessions: ChatSessionSummary[] } {
    return { version: CHAT_INDEX_VERSION, sessions: structuredClone(this.chatIndex) };
  }

  private upsertSummary(session: ChatSession): string[] {
    const previous = this.chatIndex.filter((item) => item.id !== session.id);
    this.chatIndex = [summarizeSession(session), ...previous]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHAT_SESSIONS);
    const retained = new Set(this.chatIndex.map((item) => item.id));
    return previous.filter((item) => !retained.has(item.id)).map((item) => item.id);
  }

  private async loadChatIndex(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.chatIndexPath(), "utf8")) as { sessions?: unknown[] } | unknown[];
      const values = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.sessions) ? parsed.sessions : []);
      this.chatIndex = values.flatMap((value) => {
        const summary = normalizeSummary(value);
        return summary ? [summary] : [];
      }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHAT_SESSIONS);
      this.chatsLoaded = true;
      return;
    } catch {
      // The legacy file is migrated lazily on first chat access.
    }

    try {
      const parsed = JSON.parse(await readFile(this.legacyChatsPath(), "utf8")) as unknown;
      const sessions = (Array.isArray(parsed) ? parsed : []).flatMap((value) => {
        const session = normalizeSession(value);
        return session ? [session] : [];
      }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHAT_SESSIONS);
      for (const session of sessions) await this.atomicPath(this.chatPath(session.id), session);
      this.chatIndex = sessions.map(summarizeSession);
      await this.atomicPath(this.chatIndexPath(), this.indexSnapshot());
      await rm(this.legacyChatsPath(), { force: true });
    } catch {
      this.chatIndex = [];
    }
    this.chatsLoaded = true;
  }

  private async ensureChatsLoaded(): Promise<void> {
    if (this.chatsLoaded) return;
    this.chatLoadPromise ??= this.loadChatIndex().finally(() => { this.chatLoadPromise = null; });
    await this.chatLoadPromise;
  }

  private async loadChat(id: string): Promise<ChatSession | null> {
    await this.ensureChatsLoaded();
    const cached = this.chatCache.get(id);
    if (cached) {
      this.cacheSession(cached);
      return cached;
    }
    if (!this.chatIndex.some((item) => item.id === id)) return null;
    try {
      const session = normalizeSession(JSON.parse(await readFile(this.chatPath(id), "utf8")));
      if (!session) return null;
      this.cacheSession(session);
      return session;
    } catch {
      return null;
    }
  }

  private async persistSession(session: ChatSession): Promise<void> {
    this.cacheSession(session);
    const evicted = this.upsertSummary(session);
    const sessionSnapshot = structuredClone(session);
    const indexSnapshot = this.indexSnapshot();
    const write = this.chatWriteChain.catch(() => undefined).then(async () => {
      await this.atomicPath(this.chatPath(session.id), sessionSnapshot);
      for (const id of evicted) {
        this.chatCache.delete(id);
        await rm(this.chatPath(id), { force: true });
      }
      await this.atomicPath(this.chatIndexPath(), indexSnapshot);
    });
    this.chatWriteChain = write;
    await write;
  }

  recordActivity(snapshot: ActivitySnapshot): void {
    const previous = this.lastSnapshot;
    const elapsed = previous ? Math.min(5, Math.max(0, (snapshot.timestamp - previous.timestamp) / 1000)) : 0;
    this.lastSnapshot = snapshot;
    let day = this.days.find((entry) => entry.date === dayKey(snapshot.timestamp));
    if (!day) { day = emptyDay(dayKey(snapshot.timestamp)); this.days.push(day); }
    const category = categorize(snapshot.foregroundProcess, snapshot.foregroundPath, snapshot.windowTitle, snapshot.documentTitle);
    if (snapshot.idleSeconds < 60) {
      day.activeSeconds += elapsed;
      day.categories[category] += elapsed;
      if (["design", "office", "development"].includes(category) && snapshot.activeAppSeconds >= 60) day.focusSeconds += elapsed;
    }
    day.inputEvents += snapshot.keyboardCount1s + snapshot.mouseClicks1s + snapshot.mouseWheel1s;
    if (previous && previous.foregroundProcess !== snapshot.foregroundProcess && previous.foregroundProcess !== "unknown") day.appSwitches += 1;
    this.pruneDays();
    this.scheduleStatisticsSave();
  }

  increment(field: "aiCalls" | "localReplies" | "breaksCompleted" | "hydrationCompleted"): void {
    let day = this.days.find((entry) => entry.date === dayKey());
    if (!day) { day = emptyDay(); this.days.push(day); }
    day[field] += 1;
    void this.saveStatistics().catch((error) => console.error("Statistics save failed:", error));
  }

  getStatistics(days: number): StatisticsSummary {
    const count = Math.min(90, Math.max(1, Math.round(days)));
    const byDate = new Map(this.days.map((entry) => [entry.date, entry]));
    const result = recentDayKeys(count).map((date) => structuredClone(byDate.get(date) ?? emptyDay(date)));
    return { today: structuredClone(byDate.get(dayKey()) ?? emptyDay()), days: result };
  }

  getCurrentMonthAiCalls(time = Date.now()): number {
    const date = new Date(time);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return this.days.filter((day) => day.date.startsWith(month)).reduce((sum, day) => sum + day.aiCalls, 0);
  }

  getProactiveCount(time = Date.now()): number {
    const date = dayKey(time);
    if (this.proactive.date !== date) this.proactive = { date, count: 0 };
    return this.proactive.count;
  }

  incrementProactive(time = Date.now()): number {
    const date = dayKey(time);
    if (this.proactive.date !== date) this.proactive = { date, count: 0 };
    this.proactive.count += 1;
    void this.saveStatistics().catch((error) => console.error("Statistics save failed:", error));
    return this.proactive.count;
  }

  async flush(): Promise<void> {
    if (this.statisticsSaveTimer) {
      clearTimeout(this.statisticsSaveTimer);
      this.statisticsSaveTimer = null;
    }
    await this.saveStatistics();
    await this.chatWriteChain;
  }

  async clearStatistics(): Promise<void> {
    this.days = [];
    this.proactive = { date: dayKey(), count: 0 };
    this.lastSnapshot = null;
    await this.saveStatistics();
  }

  async clearChats(): Promise<void> {
    await this.chatWriteChain;
    this.chatIndex = [];
    this.chatCache.clear();
    this.chatsLoaded = true;
    await rm(this.chatsDirectory(), { recursive: true, force: true });
    await rm(this.legacyChatsPath(), { force: true });
    await this.atomicPath(this.chatIndexPath(), this.indexSnapshot());
  }

  async listChats(): Promise<ChatSessionSummary[]> {
    await this.ensureChatsLoaded();
    return structuredClone(this.chatIndex);
  }

  async messages(sessionId: string, cursor = 0, limit = 50): Promise<ChatMessagePage> {
    const session = await this.loadChat(sessionId);
    const offset = Math.max(0, Math.round(Number(cursor) || 0));
    const pageSize = Math.max(1, Math.min(50, Math.round(Number(limit) || 50)));
    const total = session?.messages.length ?? 0;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - pageSize);
    const messages = session?.messages.slice(start, end) ?? [];
    const hasMore = start > 0;
    return {
      sessionId,
      messages: structuredClone(messages),
      total,
      hasMore,
      nextCursor: hasMore ? offset + messages.length : null
    };
  }

  async createChat(title = "新对话"): Promise<ChatSession> {
    await this.ensureChatsLoaded();
    const now = Date.now();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title: title.replace(/\s+/g, " ").trim().slice(0, 48) || "新对话",
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    await this.persistSession(session);
    return structuredClone(session);
  }

  async chat(id: string): Promise<ChatSession | null> {
    const session = await this.loadChat(id);
    return session ? structuredClone(session) : null;
  }

  async conversation(id: string, limit = 24): Promise<ChatMessage[]> {
    const session = await this.loadChat(id);
    return structuredClone((session?.messages ?? []).slice(-Math.max(1, Math.min(60, limit))));
  }

  async renameChat(id: string, title: string): Promise<ChatSession | null> {
    const session = await this.loadChat(id);
    if (!session) return null;
    session.title = title.replace(/\s+/g, " ").trim().slice(0, 48) || "新对话";
    session.updatedAt = Date.now();
    await this.persistSession(session);
    return structuredClone(session);
  }

  async deleteChat(id: string): Promise<boolean> {
    await this.ensureChatsLoaded();
    const length = this.chatIndex.length;
    this.chatIndex = this.chatIndex.filter((item) => item.id !== id);
    if (this.chatIndex.length === length) return false;
    this.chatCache.delete(id);
    const indexSnapshot = this.indexSnapshot();
    const write = this.chatWriteChain.catch(() => undefined).then(async () => {
      await rm(this.chatPath(id), { force: true });
      await this.atomicPath(this.chatIndexPath(), indexSnapshot);
    });
    this.chatWriteChain = write;
    await write;
    return true;
  }

  async appendChat(sessionId: string, user: ChatMessage, assistant: ChatMessage): Promise<void> {
    await this.ensureChatsLoaded();
    let session = await this.loadChat(sessionId);
    if (!session) {
      const now = Date.now();
      session = { id: sessionId || crypto.randomUUID(), title: "新对话", messages: [], createdAt: now, updatedAt: now };
    }
    const storedUser = normalizeMessage({ ...user, id: user.id || crypto.randomUUID() });
    const storedAssistant = normalizeMessage({ ...assistant, id: assistant.id || crypto.randomUUID() });
    if (!storedUser || !storedAssistant) return;
    session.messages.push(storedUser, storedAssistant);
    session.messages = session.messages.slice(-MAX_CHAT_MESSAGES);
    session.updatedAt = Date.now();
    if (session.title === "新对话" || !session.title.trim()) {
      session.title = storedUser.content.replace(/\s+/g, " ").trim().slice(0, 28) || "新对话";
    }
    await this.persistSession(session);
  }

}
