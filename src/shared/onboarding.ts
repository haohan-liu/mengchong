import type { Settings } from "../types.js";

export type OnboardingDisplayReason = "first-install" | "version-update" | null;

export function onboardingDisplayReason(
  settings: Pick<Settings, "firstRunConsent" | "onboardingLastShownVersion" | "suppressOnboardingAfterUpdates">,
  currentVersion: string
): OnboardingDisplayReason {
  if (!settings.firstRunConsent) return "first-install";
  if (settings.suppressOnboardingAfterUpdates) return null;
  return settings.onboardingLastShownVersion !== currentVersion ? "version-update" : null;
}

export function shouldAutoShowOnboarding(
  settings: Pick<Settings, "firstRunConsent" | "onboardingLastShownVersion" | "suppressOnboardingAfterUpdates">,
  currentVersion: string
): boolean {
  return onboardingDisplayReason(settings, currentVersion) !== null;
}
