import { describe, expect, it } from "vitest";
import { categorize } from "../src/shared/categorize";

describe("application categorization", () => {
  it.each([
    ["Photoshop.exe", "", "design"],
    ["WINWORD.EXE", "", "office"],
    ["Codex.exe", "", "development"],
    ["WeChat.exe", "", "communication"],
    ["msedge.exe", "正在播放 - bilibili", "entertainment"],
    ["msedge.exe", "项目原型 - Figma", "design"]
  ])("classifies %s with context", (processName, title, category) => {
    expect(categorize(processName, title)).toBe(category);
  });
});
