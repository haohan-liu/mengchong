import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("custom pet name linkage", () => {
  it("defaults to 珊珊 and links every user-facing runtime", async () => {
    const [settings, consoleSource, petSource, mainSource, agentSource, toolsSource] = await Promise.all([
      read("../electron/services/SettingsStore.ts"),
      read("../src/console/main.ts"),
      read("../src/renderer/App.ts"),
      read("../electron/main.ts"),
      read("../electron/services/DeepSeekAgent.ts"),
      read("../electron/services/AgentTools.ts")
    ]);

    expect(settings).toContain('petName: "珊珊"');
    expect(consoleSource).toContain("data-pet-name");
    expect(petSource).toContain("updatePetName");
    expect(mainSource).toContain("applyBranding(saved)");
    expect(agentSource).toContain("systemPrompt(settings.petName)");
    expect(toolsSource).toContain("getPetName");
    const legacyName = ["知", "知"].join("");
    expect([settings, consoleSource, petSource, mainSource, agentSource, toolsSource].join("\n")).not.toContain(legacyName);
  });
});
