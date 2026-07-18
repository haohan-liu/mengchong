import { describe, expect, it } from "vitest";
import { categorize } from "../src/shared/categorize";

describe("activity classification", () => {
  it.each([
    ["Photoshop.exe", "", "designing"],
    ["WINWORD.EXE", "", "editing"],
    ["Codex.exe", "", "developing"],
    ["WeChat.exe", "", "communicating"],
    ["msedge.exe", "正在播放 - bilibili", "watching"],
    ["msedge.exe", "项目原型 - Figma", "designing"],
    ["msedge.exe", "ChatGPT", "ai-chat"],
    ["unknown.exe", "", "other"]
  ])("classifies %s with context", (processName, title, category) => {
    expect(categorize(processName, title)).toBe(category);
  });
});
