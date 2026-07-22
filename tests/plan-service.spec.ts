import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlanService } from "../electron/services/PlanService";

const paths: string[] = [];
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("persistent plan service", () => {
  it("migrates legacy workday plans to weekly reminders and removes project fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-plans-")); paths.push(root);
    const dueAt = Date.now() + 3_600_000;
    await writeFile(join(root, "plans.json"), JSON.stringify({ version: 1, revision: 2, calendars: [{ id: "workdays-single-rest", name: "公司单休", weekdays: [1, 2, 3, 4, 5, 6] }], tasks: [{ id: "legacy", title: "旧工作日提醒", startAt: dueAt, dueAt, recurrence: { kind: "workdays", workCalendarId: "workdays-single-rest" }, steps: [{ id: "step", title: "旧步骤", completed: false }], status: "active" }], occurrences: [], inbox: [] }), "utf8");
    const service = new PlanService(() => root);
    await service.load();
    const snapshot = service.snapshot();
    expect(snapshot).not.toHaveProperty("calendars");
    expect(snapshot.tasks[0]?.recurrence).toEqual(expect.objectContaining({ kind: "weekly", weekdays: [1, 2, 3, 4, 5, 6] }));
    expect(snapshot.tasks[0]).not.toHaveProperty("steps");
  });

  it("queues a due task once and supports a confirmed snooze response", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-plans-")); paths.push(root);
    const service = new PlanService(() => root);
    await service.load();
    const now = Date.now();
    const dueAt = now + 500;
    const plans = await service.upsertTask({ title: "喝水", startAt: dueAt, dueAt, recurrence: { kind: "once" }, reminderOffsets: [0] });
    const task = plans.tasks.find((item) => item.title === "喝水")!;
    const notifications = await service.tick(now + 1_000, true);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ sourceId: task.id, kind: "plan" });
    const response = await service.respond(notifications[0]!, "snooze", 30);
    expect(response.snoozed).toBe(true);
    expect(response.snapshot.tasks.find((item) => item.id === task.id)?.snoozedUntil).toBeGreaterThan(now);
  });

  it("keeps a durable inbox item when Do Not Disturb defers the popup", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-plans-")); paths.push(root);
    const service = new PlanService(() => root);
    await service.load();
    const dueAt = Date.now() + 500;
    await service.upsertTask({ title: "勿扰时提醒", startAt: dueAt, dueAt, recurrence: { kind: "once" }, reminderOffsets: [0] });
    expect(await service.tick(dueAt + 1_000, false)).toEqual([]);
    const inboxItem = service.snapshot().inbox.find((item) => item.title === "勿扰时提醒")!;
    expect(inboxItem).toEqual(expect.objectContaining({ title: "勿扰时提醒", read: false }));
    const reloaded = new PlanService(() => root);
    await reloaded.load();
    expect(reloaded.snapshot().inbox).toContainEqual(expect.objectContaining({ id: inboxItem.id, read: false }));
    const response = await reloaded.respondInbox(inboxItem.id, "snooze", 10);
    expect(response.snoozed).toBe(true);
    expect(response.snapshot.inbox.find((item) => item.id === inboxItem.id)?.read).toBe(true);
  });

  it("clears completed history without deleting plans", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-plans-")); paths.push(root);
    const service = new PlanService(() => root); await service.load();
    const dueAt = Date.now() + 500;
    const snapshot = await service.upsertTask({ title: "保留计划", startAt: dueAt, dueAt, recurrence: { kind: "once" } });
    await service.completeTask(snapshot.tasks[0]!.id);
    expect(service.snapshot().occurrences.some((item) => item.status === "completed")).toBe(true);
    const cleared = await service.clearCompletedHistory();
    expect(cleared.tasks.some((item) => item.title === "保留计划")).toBe(true);
    expect(cleared.occurrences.some((item) => item.status === "completed")).toBe(false);
  });
});
