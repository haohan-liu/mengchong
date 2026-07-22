import { describe, expect, it } from "vitest";
import { onboardingDisplayReason, shouldAutoShowOnboarding } from "../src/shared/onboarding";

describe("onboarding prompt policy", () => {
  it("always opens for a fresh installation", () => {
    expect(shouldAutoShowOnboarding({ firstRunConsent: false, onboardingLastShownVersion: "", suppressOnboardingAfterUpdates: true }, "1.0.5")).toBe(true);
    expect(onboardingDisplayReason({ firstRunConsent: false, onboardingLastShownVersion: "", suppressOnboardingAfterUpdates: true }, "1.0.5")).toBe("first-install");
  });

  it("opens once for each unseen update", () => {
    expect(shouldAutoShowOnboarding({ firstRunConsent: true, onboardingLastShownVersion: "1.0.4", suppressOnboardingAfterUpdates: false }, "1.0.5")).toBe(true);
    expect(shouldAutoShowOnboarding({ firstRunConsent: true, onboardingLastShownVersion: "1.0.5", suppressOnboardingAfterUpdates: false }, "1.0.5")).toBe(false);
    expect(onboardingDisplayReason({ firstRunConsent: true, onboardingLastShownVersion: "1.0.4", suppressOnboardingAfterUpdates: false }, "1.0.5")).toBe("version-update");
    expect(onboardingDisplayReason({ firstRunConsent: true, onboardingLastShownVersion: "1.0.5", suppressOnboardingAfterUpdates: false }, "1.0.5")).toBeNull();
  });

  it("respects the future-update suppression preference", () => {
    expect(shouldAutoShowOnboarding({ firstRunConsent: true, onboardingLastShownVersion: "1.0.4", suppressOnboardingAfterUpdates: true }, "1.0.5")).toBe(false);
  });
});
