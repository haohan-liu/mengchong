import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("global application notifications", () => {
  it("uses the styled, screen-level notification surface for every non-update notification", async () => {
    const [main, tools, preload, vite] = await Promise.all([
      readFile(new URL("../electron/main.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/AgentTools.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/preload.cts", import.meta.url), "utf8"),
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
    ]);

    expect(main).toContain("showAppNotification");
    expect(main).toContain("notificationPopupPosition");
    expect(main).toContain('loadRenderer(window, "notification.html")');
    expect(main).toContain('showAppNotification({ title: `${settings.petName}在陪你`');
    expect(main).not.toContain("new Notification(");
    expect(tools).not.toContain("new Notification(");
    expect(tools).toContain("showNotification");
    expect(preload).toContain("notification-popup:current");
    expect(vite).toContain('notification: resolve(projectRoot, "notification.html")');
  });
});
