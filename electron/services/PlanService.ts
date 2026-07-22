import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppNotification, PlanInboxItem, PlanOccurrence, PlansSnapshot, PlanTask, RecurrenceRule, Weekday } from "../../src/types.js";

const PLANS_VERSION = 1;
const MAX_HISTORY = 1_000;
const MAX_INBOX = 200;
const MAX_TEXT = 240;
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const cleanText = (value: unknown, fallback = "", max = MAX_TEXT) => String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const unique = <T,>(items: T[]) => [...new Set(items)];

function normalizeRule(value: Partial<RecurrenceRule> | undefined, fallback?: RecurrenceRule): RecurrenceRule {
  const rawKind = String(value?.kind ?? fallback?.kind ?? "once");
  const kind = (["once", "daily", "weekly", "monthly-date", "monthly-last-day"].includes(rawKind)
    ? rawKind : rawKind === "workdays" ? "weekly" : "once") as RecurrenceRule["kind"];
  const legacyWeekdays: Weekday[] = rawKind === "workdays" ? [1, 2, 3, 4, 5, 6] : [];
  const weekdays = unique((Array.isArray(value?.weekdays) ? value!.weekdays! : fallback?.weekdays ?? [])
    .map((day) => Math.round(Number(day))).filter((day): day is Weekday => day >= 1 && day <= 7)) as Weekday[];
  return {
    kind,
    ...((weekdays.length || legacyWeekdays.length) ? { weekdays: (weekdays.length ? weekdays : legacyWeekdays).sort((a, b) => a - b) } : {}),
    ...(kind === "monthly-date" ? { monthDay: Math.round(clamp(value?.monthDay, 1, 31, fallback?.monthDay ?? 1)) } : {}),
    ...(value?.endAt === null || fallback?.endAt === null ? { endAt: null } : Number.isFinite(Number(value?.endAt ?? fallback?.endAt)) ? { endAt: Number(value?.endAt ?? fallback?.endAt) } : {})
  };
}

function normalizeTask(value: Partial<PlanTask>, fallback?: PlanTask): PlanTask {
  const now = Date.now();
  const startAt = clamp(value.startAt, 0, Number.MAX_SAFE_INTEGER, fallback?.startAt ?? now);
  const recurrence = normalizeRule(value.recurrence, fallback?.recurrence);
  const dueAt = value.dueAt === null || fallback?.dueAt === null ? null : Number.isFinite(Number(value.dueAt ?? fallback?.dueAt)) ? Number(value.dueAt ?? fallback?.dueAt) : startAt;
  return {
    id: cleanText(value.id, fallback?.id || crypto.randomUUID(), 80) || crypto.randomUUID(),
    title: cleanText(value.title, fallback?.title || "未命名计划", 120) || "未命名计划",
    notes: cleanText(value.notes, fallback?.notes || "", 2_000),
    priority: ["low", "normal", "high"].includes(String(value.priority)) ? value.priority! : fallback?.priority ?? "normal",
    tags: unique((Array.isArray(value.tags) ? value.tags : fallback?.tags ?? []).map((tag) => cleanText(tag, "", 24)).filter(Boolean)).slice(0, 12),
    startAt,
    dueAt,
    timezone: cleanText(value.timezone, fallback?.timezone || localTimeZone(), 80) || localTimeZone(),
    recurrence,
    reminderOffsets: unique((Array.isArray(value.reminderOffsets) ? value.reminderOffsets : fallback?.reminderOffsets ?? [0]).map((offset) => Math.round(clamp(offset, 0, 43_200, 0)))).slice(0, 3).sort((a, b) => b - a),
    status: ["active", "completed", "archived", "expired"].includes(String(value.status)) ? value.status! : fallback?.status ?? "active",
    nextDueAt: value.nextDueAt === null ? null : Number.isFinite(Number(value.nextDueAt)) ? Number(value.nextDueAt) : fallback?.nextDueAt ?? dueAt,
    lastTriggeredAt: value.lastTriggeredAt === null ? null : Number.isFinite(Number(value.lastTriggeredAt)) ? Number(value.lastTriggeredAt) : fallback?.lastTriggeredAt ?? null,
    snoozedUntil: value.snoozedUntil === null ? null : Number.isFinite(Number(value.snoozedUntil)) ? Number(value.snoozedUntil) : fallback?.snoozedUntil ?? null,
    createdAt: clamp(value.createdAt, 0, Number.MAX_SAFE_INTEGER, fallback?.createdAt ?? now),
    updatedAt: now,
    revision: Math.max(1, Math.round(clamp(value.revision, 1, Number.MAX_SAFE_INTEGER, (fallback?.revision ?? 0) + 1)))
  };
}

function weekday(time: number): Weekday { return ((new Date(time).getDay() + 6) % 7 + 1) as Weekday; }
function sameTime(date: Date, sample: number): number {
  const base = new Date(sample);
  date.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), 0);
  return date.getTime();
}

function nextDue(task: PlanTask, after: number): number | null {
  const rule = task.recurrence;
  const endAt = rule.endAt ?? Number.MAX_SAFE_INTEGER;
  const start = task.dueAt ?? task.startAt;
  if (rule.kind === "once") return start > after && start <= endAt ? start : null;
  const sample = new Date(start);
  const cursor = new Date(Math.max(start, after + 1));
  cursor.setHours(0, 0, 0, 0);
  for (let dayOffset = 0; dayOffset < 800; dayOffset += 1) {
    const candidate = sameTime(new Date(cursor.getTime() + dayOffset * 86_400_000), sample.getTime());
    if (candidate < start || candidate <= after || candidate > endAt) continue;
    const date = new Date(candidate);
    if (rule.kind === "daily") return candidate;
    if (rule.kind === "weekly" && (rule.weekdays ?? [weekday(start)]).includes(weekday(candidate))) return candidate;
    if (rule.kind === "monthly-last-day") {
      const next = new Date(candidate); next.setDate(date.getDate() + 1);
      if (next.getMonth() !== date.getMonth()) return candidate;
    }
    if (rule.kind === "monthly-date") {
      const target = Math.min(rule.monthDay ?? sample.getDate(), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
      if (date.getDate() === target) return candidate;
    }
  }
  return null;
}

export class PlanService {
  private value: PlansSnapshot = { version: PLANS_VERSION, revision: 1, tasks: [], occurrences: [], inbox: [] };
  private writeChain: Promise<void> = Promise.resolve();
  private lastTickAt = 0;

  constructor(private readonly dataDirectory: () => string) {}
  private path(): string { return join(this.dataDirectory(), "plans.json"); }
  private async save(): Promise<void> {
    const snapshot = structuredClone(this.value);
    const write = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path()), { recursive: true });
      const temp = `${this.path()}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(temp, this.path());
    });
    this.writeChain = write;
    await write;
  }
  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path(), "utf8")) as Partial<PlansSnapshot>;
      this.value = {
        version: PLANS_VERSION, revision: Math.max(1, Math.round(Number(parsed.revision) || 1)),
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((item) => normalizeTask(item)) : [],
        occurrences: Array.isArray(parsed.occurrences) ? parsed.occurrences.filter((item): item is PlanOccurrence => Boolean(item?.id && item.taskId && Number.isFinite(item.dueAt))).slice(-MAX_HISTORY) : [],
        inbox: Array.isArray(parsed.inbox) ? parsed.inbox.filter((item): item is PlanInboxItem => Boolean(item?.id && item.taskId && item.occurrenceId)).slice(-MAX_INBOX) : []
      };
    } catch { this.value = { version: PLANS_VERSION, revision: 1, tasks: [], occurrences: [], inbox: [] }; }
    await this.save();
  }
  snapshot(): PlansSnapshot { return structuredClone(this.value); }
  async flush(): Promise<void> { await this.writeChain; }
  async clear(): Promise<void> {
    this.value = { version: PLANS_VERSION, revision: 1, tasks: [], occurrences: [], inbox: [] };
    this.lastTickAt = 0;
    await this.save();
  }
  private async commit(): Promise<PlansSnapshot> { this.value.revision += 1; await this.save(); return this.snapshot(); }
  async upsertTask(input: Partial<PlanTask>): Promise<PlansSnapshot> {
    const existing = this.value.tasks.find((item) => item.id === input.id);
    const task = normalizeTask(input, existing);
    if (!existing && task.startAt <= Date.now()) throw new Error("计划时间必须晚于当前时间");
    task.nextDueAt = task.status === "active" ? (task.snoozedUntil ?? nextDue(task, (task.lastTriggeredAt ?? task.startAt) - 1)) : null;
    this.value.tasks = [...this.value.tasks.filter((item) => item.id !== task.id), task].sort((a, b) => (a.nextDueAt ?? Number.MAX_SAFE_INTEGER) - (b.nextDueAt ?? Number.MAX_SAFE_INTEGER));
    return this.commit();
  }
  async archiveTask(id: string): Promise<PlansSnapshot> {
    const task = this.value.tasks.find((item) => item.id === id); if (!task) return this.snapshot();
    task.status = "archived"; task.nextDueAt = null; task.snoozedUntil = null; task.updatedAt = Date.now(); task.revision += 1;
    return this.commit();
  }
  async completeTask(id: string): Promise<{ snapshot: PlansSnapshot; completed: boolean }> {
    const task = this.value.tasks.find((item) => item.id === id);
    if (!task || task.status !== "active") return { snapshot: this.snapshot(), completed: false };
    const now = Date.now();
    const due = task.lastTriggeredAt ?? task.nextDueAt ?? task.dueAt ?? task.startAt;
    const occurrence = this.occurrence(task, due);
    occurrence.status = "completed"; occurrence.completedAt = now;
    task.snoozedUntil = null; task.updatedAt = now; task.revision += 1;
    if (task.recurrence.kind === "once") { task.status = "completed"; task.nextDueAt = null; }
    else { task.lastTriggeredAt = due; task.nextDueAt = nextDue(task, Math.max(now, due)); }
    return { snapshot: await this.commit(), completed: true };
  }
  async deleteTask(id: string): Promise<boolean> {
    const exists = this.value.tasks.some((item) => item.id === id); if (!exists) return false;
    this.value.tasks = this.value.tasks.filter((item) => item.id !== id);
    this.value.occurrences = this.value.occurrences.filter((item) => item.taskId !== id);
    this.value.inbox = this.value.inbox.filter((item) => item.taskId !== id);
    await this.commit(); return true;
  }
  async clearCompletedHistory(): Promise<PlansSnapshot> {
    const completedIds = new Set(this.value.occurrences.filter((item) => item.status === "completed").map((item) => item.id));
    if (!completedIds.size) return this.snapshot();
    this.value.occurrences = this.value.occurrences.filter((item) => !completedIds.has(item.id));
    this.value.inbox = this.value.inbox.filter((item) => !completedIds.has(item.occurrenceId));
    return this.commit();
  }
  private occurrence(task: PlanTask, dueAt: number, status: PlanOccurrence["status"] = "pending"): PlanOccurrence {
    const found = this.value.occurrences.find((item) => item.taskId === task.id && item.dueAt === dueAt);
    if (found) return found;
    const occurrence = { id: crypto.randomUUID(), taskId: task.id, dueAt, status, completedAt: null, snoozedUntil: null, createdAt: Date.now() } as PlanOccurrence;
    this.value.occurrences.push(occurrence); this.value.occurrences = this.value.occurrences.slice(-MAX_HISTORY); return occurrence;
  }
  private notification(task: PlanTask, occurrence: PlanOccurrence): AppNotification {
    return { id: crypto.randomUUID(), sourceId: task.id, occurrenceId: occurrence.id, title: task.title, body: task.notes || "计划时间到了，完成后记得打个勾。", kind: "plan", priority: task.priority === "high" ? "high" : "normal", createdAt: Date.now(), expiresAt: Date.now() + 15_000, actions: [
      { id: "complete", label: "完成", style: "primary" }, { id: "snooze", label: "稍后", style: "secondary", snoozeMinutes: 10, alternatives: [{ label: "30 分钟", minutes: 30 }, { label: "1 小时", minutes: 60 }, { label: "明天", minutes: 1_440 }] }, { id: "view", label: "查看", style: "quiet" }
    ] };
  }
  async tick(now: number, interruptionsAllowed: boolean): Promise<AppNotification[]> {
    if (now - this.lastTickAt < 25_000) return [];
    this.lastTickAt = now;
    const notifications: AppNotification[] = [];
    let changed = false;
    for (const task of this.value.tasks) {
      if (task.status !== "active") continue;
      const due = task.snoozedUntil ?? task.nextDueAt;
      if (!due || due > now) continue;
      const overdue = now - due;
      if (task.recurrence.kind === "once" && overdue > 86_400_000) {
        task.status = "expired"; task.nextDueAt = null; task.snoozedUntil = null; this.occurrence(task, due, "missed"); changed = true; continue;
      }
      const occurrence = this.occurrence(task, due);
      task.lastTriggeredAt = due; task.snoozedUntil = null;
      task.nextDueAt = nextDue(task, Math.max(now, due));
      task.updatedAt = now; task.revision += 1;
      const inbox = { id: crypto.randomUUID(), taskId: task.id, occurrenceId: occurrence.id, title: task.title, dueAt: due, read: false, createdAt: now };
      this.value.inbox = [...this.value.inbox.filter((item) => item.occurrenceId !== occurrence.id), inbox].slice(-MAX_INBOX);
      changed = true;
      // Keep a durable inbox item even while fullscreen/Do Not Disturb defers the popup.
      if (interruptionsAllowed) notifications.push(this.notification(task, occurrence));
    }
    if (changed) await this.commit();
    return notifications;
  }
  async respondInbox(id: string, action: string, snoozeMinutes = 10): Promise<{ snapshot: PlansSnapshot; completed: boolean; snoozed: boolean }> {
    const item = this.value.inbox.find((entry) => entry.id === id);
    const task = item ? this.value.tasks.find((entry) => entry.id === item.taskId) : undefined;
    const occurrence = item ? this.value.occurrences.find((entry) => entry.id === item.occurrenceId) : undefined;
    if (!item || !task || !occurrence) return { snapshot: this.snapshot(), completed: false, snoozed: false };
    return this.respond(this.notification(task, occurrence), action, snoozeMinutes);
  }
  async respond(notification: AppNotification, action: string, snoozeMinutes = 0): Promise<{ snapshot: PlansSnapshot; completed: boolean; snoozed: boolean }> {
    const task = this.value.tasks.find((item) => item.id === notification.sourceId);
    const occurrence = this.value.occurrences.find((item) => item.id === notification.occurrenceId);
    if (!task || !occurrence) return { snapshot: this.snapshot(), completed: false, snoozed: false };
    const now = Date.now();
    if (action === "complete") {
      occurrence.status = "completed"; occurrence.completedAt = now;
      if (task.recurrence.kind === "once") { task.status = "completed"; task.nextDueAt = null; }
      task.snoozedUntil = null; task.updatedAt = now; task.revision += 1;
      this.value.inbox = this.value.inbox.map((item) => item.occurrenceId === occurrence.id ? { ...item, read: true } : item);
      return { snapshot: await this.commit(), completed: true, snoozed: false };
    }
    if (action === "snooze") {
      const minutes = Math.max(1, Math.min(1_440, Math.round(snoozeMinutes || 10)));
      occurrence.status = "snoozed"; occurrence.snoozedUntil = now + minutes * 60_000;
      task.snoozedUntil = occurrence.snoozedUntil; task.nextDueAt = occurrence.snoozedUntil; task.updatedAt = now; task.revision += 1;
      this.value.inbox = this.value.inbox.map((item) => item.occurrenceId === occurrence.id ? { ...item, read: true } : item);
      return { snapshot: await this.commit(), completed: false, snoozed: true };
    }
    this.value.inbox = this.value.inbox.map((item) => item.occurrenceId === occurrence.id ? { ...item, read: true } : item);
    return { snapshot: await this.commit(), completed: false, snoozed: false };
  }
  summary(limit = 20): Array<{ id: string; title: string; nextDueAt: number | null; recurrence: string; status: string }> {
    return this.value.tasks.filter((task) => task.status === "active" || task.status === "expired").sort((a, b) => (a.nextDueAt ?? Number.MAX_SAFE_INTEGER) - (b.nextDueAt ?? Number.MAX_SAFE_INTEGER)).slice(0, limit).map((task) => ({
      id: task.id, title: task.title, nextDueAt: task.nextDueAt, recurrence: task.recurrence.kind, status: task.status
    }));
  }
}
