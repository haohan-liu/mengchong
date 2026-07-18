import { describe, expect, it } from "vitest";
import { resolvePresence } from "../src/shared/activity";
import { TypingTracker } from "../src/renderer/activity/TypingTracker";

describe("presence and typing continuity", () => {
  it("marks normal inactivity away at 60 seconds and resting at 5 minutes", () => {
    expect(resolvePresence({ locked: false, idleSeconds: 59, meeting: false, fullscreen: false, activityKind: "developing" })).toBe("active");
    expect(resolvePresence({ locked: false, idleSeconds: 60, meeting: false, fullscreen: false, activityKind: "developing" })).toBe("away");
    expect(resolvePresence({ locked: false, idleSeconds: 300, meeting: false, fullscreen: false, activityKind: "developing" })).toBe("resting");
    expect(resolvePresence({ locked: true, idleSeconds: 0, meeting: false, fullscreen: false, activityKind: "developing" })).toBe("resting");
  });

  it("keeps passive use active before the rest boundary", () => {
    expect(resolvePresence({ locked: false, idleSeconds: 120, meeting: false, fullscreen: false, activityKind: "reading" })).toBe("active");
    expect(resolvePresence({ locked: false, idleSeconds: 120, meeting: true, fullscreen: false, activityKind: "meeting" })).toBe("active");
    expect(resolvePresence({ locked: false, idleSeconds: 120, meeting: false, fullscreen: true, activityKind: "watching" })).toBe("active");
    expect(resolvePresence({ locked: false, idleSeconds: 600, meeting: true, fullscreen: false, activityKind: "meeting" })).toBe("active");
    expect(resolvePresence({ locked: false, idleSeconds: 600, meeting: false, fullscreen: true, activityKind: "watching" })).toBe("active");
  });

  it("holds typing for 2.2 seconds and uses fast-mode hysteresis", () => {
    const tracker = new TypingTracker();
    expect(tracker.update(1_000, true, 12)).toBe("fast");
    expect(tracker.update(2_000, false, 8)).toBe("fast");
    expect(tracker.update(2_500, false, 5)).toBe("typing");
    expect(tracker.update(3_199, false, 5)).toBe("typing");
    expect(tracker.update(3_201, false, 5)).toBeNull();
  });
});
