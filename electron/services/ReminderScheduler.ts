import type { ActivitySnapshot, Settings } from "../../src/types.js";

export type ReminderEvent = { kind: "breaksCompleted" | "hydrationCompleted"; title: string; body: string };

export class ReminderScheduler {
  private lastAt = 0;
  private focusSeconds = 0;
  private breakUntil = 0;
  private hydrationDueAt = 0;
  private hydrationMinutes = 0;

  tick(snapshot: ActivitySnapshot, settings: Settings, interruptionsAllowed: boolean): ReminderEvent[] {
    const now = snapshot.timestamp;
    const elapsed = this.lastAt ? Math.min(5, Math.max(0, (now - this.lastAt) / 1000)) : 0;
    this.lastAt = now;
    const hydrationMinutes = Math.max(5, settings.reminders.hydrationMinutes);
    if (!this.hydrationDueAt || this.hydrationMinutes !== hydrationMinutes || this.hydrationDueAt > now + hydrationMinutes * 60_000) {
      this.hydrationMinutes = hydrationMinutes;
      this.hydrationDueAt = now + hydrationMinutes * 60_000;
    }
    if (!interruptionsAllowed || settings.manualMode !== "auto") return [];

    const events: ReminderEvent[] = [];
    if (now >= this.hydrationDueAt) {
      this.hydrationDueAt = now + hydrationMinutes * 60_000;
      events.push({ kind: "hydrationCompleted", title: "喝水提醒", body: "起来喝口水、活动一下吧。" });
    }
    const productive = ["design", "office", "development"].includes(snapshot.appCategory);
    if (now >= this.breakUntil && !snapshot.locked && snapshot.idleSeconds < 60 && productive && snapshot.activeAppSeconds >= 60) {
      this.focusSeconds += elapsed;
    }
    if (this.focusSeconds >= Math.max(1, settings.reminders.focusMinutes) * 60) {
      this.focusSeconds = 0;
      this.breakUntil = now + Math.max(1, settings.reminders.breakMinutes) * 60_000;
      events.push({ kind: "breaksCompleted", title: "休息提醒", body: `已经专注一段时间，休息 ${Math.max(1, settings.reminders.breakMinutes)} 分钟吧。` });
    }
    return events;
  }
}
