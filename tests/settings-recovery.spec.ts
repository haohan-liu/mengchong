import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "C:/temp/qpet-test", setLoginItemSettings: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}));

describe("settings recovery", () => {
  it("normalizes corrupted and out-of-range persisted values", async () => {
    const { mergeSettings } = await import("../electron/services/SettingsStore");
    const settings = mergeSettings({
      appearance: { scale: 99, theme: "broken", bubbleFontSize: "huge" },
      sensing: { blockedApps: "not-an-array", enabled: "yes" },
      reminders: { quietStart: "29:90", proactiveDailyLimit: -10 },
      ai: { baseUrl: "javascript:alert(1)", model: "unknown", monthlyLimit: Number.NaN }
    } as never);

    expect(settings.appearance.scale).toBe(1.5);
    expect(settings.appearance.theme).toBe("system");
    expect(settings.appearance.bubbleFontSize).toBe(15);
    expect(settings.sensing.blockedApps).toContain("password");
    expect(settings.sensing.enabled).toBe(true);
    expect(settings.reminders.quietStart).toBe("22:30");
    expect(settings.reminders.proactiveDailyLimit).toBe(0);
    expect(settings.ai.baseUrl).toBe("https://api.deepseek.com");
    expect(settings.ai.model).toBe("deepseek-v4-flash");
    expect(settings.ai.monthlyLimit).toBe(500);
    expect(settings.onboardingLastShownVersion).toBe("");
    expect(settings.suppressOnboardingAfterUpdates).toBe(false);
  });
});
