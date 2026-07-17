import { describe, expect, it, vi } from "vitest";
import { ReminderScheduler } from "../electron/services/ReminderScheduler";
import { defaultSettings } from "../electron/services/SettingsStore";
import type { ActivitySnapshot } from "../src/types";

vi.mock("electron", () => ({ app: {}, safeStorage: {} }));

describe("reminder scheduler", () => {
  it("emits one focus break and respects silent mode", () => {
    const scheduler = new ReminderScheduler();
    const settings = defaultSettings();
    settings.reminders.focusMinutes = 1;
    settings.reminders.breakMinutes = 5;
    const base = { timestamp: 1_000, appCategory: "development", activeAppSeconds: 120, idleSeconds: 0, locked: false } as ActivitySnapshot;
    scheduler.tick(base, settings, true);
    let events = [] as ReturnType<ReminderScheduler["tick"]>;
    for (let second = 1; second <= 60; second += 1) events.push(...scheduler.tick({ ...base, timestamp: 1_000 + second * 1_000 }, settings, true));
    expect(events.filter((event) => event.kind === "breaksCompleted")).toHaveLength(1);
    expect(scheduler.tick({ ...base, timestamp: 70_000 }, settings, false)).toEqual([]);
  });
});
