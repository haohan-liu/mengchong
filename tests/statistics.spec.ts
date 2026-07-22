import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DataStore } from "../electron/services/DataStore";
import type { ActivitySnapshot, ChatActionCard } from "../src/types";

const paths: string[] = [];
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const localDay = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const snapshot = (timestamp: number, keyboard = 0, clicks = 0, wheel = 0): ActivitySnapshot => ({
  timestamp, foregroundProcess: "Code.exe", foregroundPath: "", windowTitle: "", documentTitle: "",
  activityKind: "developing", activityLabel: "开发中", applicationLabel: "VS Code",
  classificationSource: "builtin", classificationConfidence: .96, presenceState: "active",
  activeAppSeconds: 65, appSwitches5m: 0,
  keyboardCount1s: keyboard, keyboardCount10s: keyboard, keyboardPulse: keyboard > 0,
  mouseClicks1s: clicks, mouseClicks10s: clicks, mouseClickPulse: clicks > 0,
  mouseWheel1s: wheel, mouseWheel10s: wheel, mouseDistance1s: 0, mouseDistance10s: 0,
  idleSeconds: 0, fullscreen: false, locked: false, meeting: false, microphoneActive: false,
  online: true, batteryPercent: 100, charging: true, sensorSource: "compat",
  performance: { systemCpuPercent: 10, systemMemoryPercent: 30, petCpuPercent: 1, petMemoryMb: 80, petProcessCount: 4, sensorMemoryMb: 8, eventLoopLagMs: 0 }
});

describe("statistics aggregation", () => {
  it("records only new one-second input counts and fills the selected date range", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    const now = Date.now();
    store.recordActivity(snapshot(now - 1000));
    store.recordActivity(snapshot(now, 4, 2, 1));
    await store.flush();
    const summary = store.getStatistics(7);
    expect(summary.days).toHaveLength(7);
    expect(summary.today.inputEvents).toBe(7);
    expect(summary.today.activeSeconds).toBe(1);
    expect(summary.today.restSeconds).toBe(0);
    expect(summary.today.productiveSeconds).toBe(1);
    const persisted = JSON.parse(await readFile(join(root, "statistics.json"), "utf8"));
    expect(persisted.version).toBe(5);
  });

  it("repairs legacy rolling-window input totals once", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-legacy-")); paths.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "statistics.json"), JSON.stringify([{ date: localDay(), activeSeconds: 60, focusSeconds: 0, inputEvents: 100, appSwitches: 0, categories: {} }]));
    const store = new DataStore(() => root);
    await store.load();
    expect(store.getStatistics(1).today.inputEvents).toBe(10);
    await store.flush();
  });

  it("classifies browser-hosted work from the window title", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-category-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    const now = Date.now();
    const figma = { ...snapshot(now - 1000), foregroundProcess: "msedge.exe", windowTitle: "Dashboard – Figma", activityKind: "designing" as const, activityLabel: "设计中", applicationLabel: "Edge" };
    store.recordActivity(figma);
    store.recordActivity({ ...figma, timestamp: now });
    expect(store.getStatistics(1).today.categories.designing).toBe(1);
  });

  it("records locked or idle time as rest without counting it as active work", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-rest-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    const now = Date.now();
    store.recordActivity({ ...snapshot(now - 1_000), presenceState: "resting" });
    store.recordActivity({ ...snapshot(now), presenceState: "resting" });
    const today = store.getStatistics(1).today;
    expect(today.restSeconds).toBe(1);
    expect(today.activeSeconds).toBe(0);
  });

  it("counts the AI quota by calendar month", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-quota-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    store.increment("aiCalls");
    expect(store.getCurrentMonthAiCalls()).toBe(1);
    await store.clearStatistics();
    expect(store.getCurrentMonthAiCalls()).toBe(1);
    await store.flush();
  });

  it("backfills an unknown segment even if AI resolves after the user goes away", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-backfill-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    const now = Date.now();
    const pending = { ...snapshot(now - 2_000), activityKind: "other" as const, activityLabel: "其他", classificationSource: "fallback" as const, classificationConfidence: -1 };
    store.recordActivity(pending);
    store.recordActivity({ ...pending, timestamp: now - 1_000 });
    store.recordActivity({ ...snapshot(now), presenceState: "away" });
    const today = store.getStatistics(1).today;
    expect(today.activeSeconds).toBe(1);
    expect(today.categories.developing).toBe(1);
    expect(today.productiveSeconds).toBe(1);
  });

  it("persists the daily proactive speech limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-stats-proactive-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    expect(store.getProactiveCount()).toBe(0);
    expect(store.incrementProactive()).toBe(1);
    await store.flush();
    const reloaded = new DataStore(() => root);
    await reloaded.load();
    expect(reloaded.getProactiveCount()).toBe(1);
  });

  it("keeps independent chat topics with rename, history and deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-chat-topics-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    const first = await store.createChat();
    const second = await store.createChat("计划讨论");
    await store.appendChat(first.id,
      { role: "user", content: "第一个话题", createdAt: Date.now() },
      { role: "assistant", content: "我记住了", createdAt: Date.now(), source: "local" });
    expect(await store.conversation(first.id)).toHaveLength(2);
    expect((await store.chat(first.id))?.title).toBe("第一个话题");
    await store.renameChat(first.id, "重新命名");
    expect((await store.chat(first.id))?.title).toBe("重新命名");
    expect(await store.deleteChat(second.id)).toBe(true);
    await store.flush();
    const reloaded = new DataStore(() => root);
    await reloaded.load();
    expect(await reloaded.listChats()).toHaveLength(1);
    expect((await reloaded.messages(first.id)).messages[1]?.source).toBe("local");
  });

  it("persists action cards beside their assistant reply and records cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-chat-actions-")); paths.push(root);
    const store = new DataStore(() => root);
    await store.load();
    const session = await store.createChat("计划草案");
    const card = {
      id: "card-1", conversationId: session.id, type: "plan", revision: 1,
      title: "整理项目资料", description: "内容：整理文件并列出缺失项\n时间：明天 09:00",
      payload: { title: "整理项目资料" },
      actions: [{ id: "create", label: "确认创建", style: "primary" }, { id: "cancel", label: "取消", style: "quiet" }],
      status: "pending", createdAt: Date.now()
    } satisfies ChatActionCard;
    await store.appendChat(session.id,
      { role: "user", content: "帮我安排计划", createdAt: Date.now() },
      { role: "assistant", content: "请核对下面的草案。", createdAt: Date.now(), source: "api", actionCards: [card] });
    expect((await store.messages(session.id)).messages[1]?.actionCards?.[0]?.title).toBe("整理项目资料");
    const cancelled = { ...card, status: "cancelled", result: "已取消，没有更改任何设置或计划", revision: 2 } satisfies ChatActionCard;
    expect(await store.updateChatActionCard(session.id, cancelled)).toBe(true);
    await store.flush();
    const reloaded = new DataStore(() => root);
    await reloaded.load();
    expect((await reloaded.messages(session.id)).messages[1]?.actionCards?.[0]).toEqual(expect.objectContaining({ status: "cancelled", result: cancelled.result }));
  });

  it("lazily migrates legacy chats and pages messages from newest to oldest", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-chat-pages-")); paths.push(root);
    const now = Date.now();
    const messages = Array.from({ length: 120 }, (_, index) => ({ id: `m-${index}`, role: index % 2 ? "assistant" as const : "user" as const, content: `消息 ${index}`, createdAt: now + index }));
    await writeFile(join(root, "chats.json"), JSON.stringify([{ id: "legacy", title: "旧话题", messages, createdAt: now, updatedAt: now + 120 }]), "utf8");
    const store = new DataStore(() => root);
    await store.load();
    const summaries = await store.listChats();
    expect(summaries).toEqual([expect.objectContaining({ id: "legacy", messageCount: 120, lastMessagePreview: "消息 119" })]);
    const newest = await store.messages("legacy", 0, 50);
    expect(newest.messages).toHaveLength(50);
    expect(newest.messages[0]?.content).toBe("消息 70");
    expect(newest.nextCursor).toBe(50);
    const older = await store.messages("legacy", newest.nextCursor!, 50);
    expect(older.messages[0]?.content).toBe("消息 20");
    expect(older.hasMore).toBe(true);
    const oldest = await store.messages("legacy", older.nextCursor!, 50);
    expect(oldest.messages).toHaveLength(20);
    expect(oldest.hasMore).toBe(false);
  });
});
