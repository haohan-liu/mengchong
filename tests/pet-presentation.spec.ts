import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("pet presentation interactions", () => {
  it("links the smooth entrance, click action, simple speech bubble and proactive controls", async () => {
    const [petSource, styles, mainSource] = await Promise.all([
      readFile(new URL("../src/renderer/App.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../electron/main.ts", import.meta.url), "utf8")
    ]);

    expect(petSource).not.toContain('class="pet-tools"');
    expect(petSource).not.toContain('class="chat-form"');
    expect(petSource).not.toContain("showConsent");
    expect(petSource).toContain('data-action="console"');
    expect(petSource).toContain('data-action="chat"');
    expect(petSource).toContain('openChat');
    expect(petSource).toContain('data-bubble-name');
    expect(petSource).toContain("nextSpeech");
    expect(petSource).toContain("onSpeech");
    expect(petSource).toContain('addEventListener("wheel"');
    expect(styles).toContain('.pet-hit:hover:not(.dragging):not(.wheel-scaling) canvas');
    expect(styles).toContain('.pet-hit.q-bounce canvas');
    expect(styles).toContain('.pet-hit.q-bounce-soft canvas');
    expect(styles).toContain('@keyframes pet-bubble-pop');
    expect(styles).toContain('.pet-bubble-anchor');
    expect(styles).toContain('var(--bubble-width)');
    expect(styles).toContain('--bubble-gap');
    expect(styles).not.toContain('--bubble-overlap');
    expect(styles).toContain('transition: opacity 160ms ease');
    expect(petSource).toContain('onScaleFrame');
    expect(mainSource).toContain('"pet:scale-frame"');
    expect(mainSource).toContain('petScaleAnimation');
    expect(styles).not.toContain('.chat-form');
    expect(styles).not.toContain('translateX(-50%) scale(var(--pet-scale))');
    expect(mainSource).toContain('process.argv.includes("--autostart")');
    expect(mainSource).toContain('settings.reminders.startupDelaySeconds');
    expect(mainSource).toContain('sendPetAction("dragged")');
    expect(mainSource).toContain('sendPetAction("drop_landing")');
    expect(mainSource).toContain('tray.on("click"');
    expect(mainSource).toContain('const duration = 1_900');
    expect(mainSource).toContain('maybeSendProactive');
    expect(mainSource).toContain('proactiveCooldownMinutes');
    expect(mainSource).toContain('settingsStore.clearAndReset()');
    expect(mainSource).toContain('activityClassifier.setApiConfigured(false)');
    expect(mainSource).toContain('!settingsStore.get().firstRunConsent) void openConsole("home")');
    const settingsSource = await readFile(new URL("../electron/services/SettingsStore.ts", import.meta.url), "utf8");
    expect(settingsSource).toContain('firstRunConsent: false');
    expect(settingsSource).toContain('args: ["--autostart"]');
    expect(settingsSource).toContain('app.isPackaged');
  });
});
