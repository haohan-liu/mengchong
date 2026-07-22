import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("global application notifications", () => {
  it("uses the styled, screen-level notification surface for every non-update notification", async () => {
    const [main, tools, preload, vite, notificationStyles, notificationRenderer] = await Promise.all([
      readFile(new URL("../electron/main.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/AgentTools.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/preload.cts", import.meta.url), "utf8"),
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/notification/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../src/notification/main.ts", import.meta.url), "utf8")
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
    expect(main).toContain("const NOTIFICATION_MIN_WIDTH = 316");
    expect(main).toContain("const NOTIFICATION_MAX_WIDTH = 480");
    expect(main).toContain('ipcMain.handle("notification-popup:resize"');
    expect(preload).toContain('ipcRenderer.invoke("notification-popup:resize", width)');
    expect(notificationRenderer).toContain("fitPopupToContent");
    expect(notificationRenderer).toContain("MAX_WIDTH - fixedWidth");
    expect(notificationStyles).toContain("width:60px;min-width:60px;max-width:60px;height:60px;min-height:60px;max-height:60px");
    expect(notificationStyles).toContain("aspect-ratio:1/1");
    expect(notificationStyles).toContain("font-size:15px");
    expect(notificationStyles).toContain("font-size:10.5px");
    expect(notificationStyles).not.toContain("align-self:stretch");
  });
});
