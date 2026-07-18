import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityRuleStore } from "../electron/services/ActivityRuleStore";

const paths: string[] = [];
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("local activity rule store", () => {
  it("stores only normalized reusable fields and supports independent clearing", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-rules-")); paths.push(root);
    const store = new ActivityRuleStore(() => root);
    await store.load();
    const learned = await store.addLearned({
      processName: "C:\\Apps\\ExampleTool.EXE",
      titleKeywords: ["Render", "https://private.example/?project=secret", "Render"],
      applicationLabel: "Example Tool",
      activityKind: "rendering",
      confidence: .92
    });
    expect(learned.processName).toBe("exampletool.exe");
    expect(learned.titleKeywords).toEqual(["render"]);
    expect(store.match("D:\\Other\\ExampleTool.exe", "Render queue", "learned")?.activityKind).toBe("rendering");
    const fixed = await store.update(learned.id, { activityKind: "modeling", pinned: true });
    expect(fixed).toEqual(expect.objectContaining({ activityKind: "modeling", source: "manual", pinned: true }));
    await store.clear();
    expect(store.list()).toEqual([]);
  });
});
