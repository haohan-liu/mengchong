import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("desktop update contract", () => {
  it("publishes NSIS updates to the public GitHub Releases repository", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.dependencies["electron-updater"]).toBeTruthy();
    expect(packageJson.build.appId).toBe("com.qpet.ai");
    expect(packageJson.build.win.target).toBe("nsis");
    expect(packageJson.build.win.signExts).toContain("pet-sensor.exe");
    expect(packageJson.build.publish).toEqual([{ provider: "github", owner: "haohan-liu", repo: "mengchong-exe" }]);
    expect(packageJson.build.nsis.deleteAppDataOnUninstall).toBe(true);
    expect(packageJson.build.nsis.include).toBe("build/installer.nsh");
    expect(packageJson.build.nsis.language).toBe("2052");
    expect(packageJson.build.nsis.installerHeader).toBe("build/installerHeader.bmp");
    expect(packageJson.build.nsis.installerSidebar).toBe("build/installerSidebar.bmp");
    expect(packageJson.build.nsis.uninstallerSidebar).toBe("build/uninstallerSidebar.bmp");
  });

  it("keeps update checks manual in development and exposes the full IPC flow", async () => {
    const service = await readFile(new URL("../electron/services/UpdateService.ts", import.meta.url), "utf8");
    const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
    const preload = await readFile(new URL("../electron/preload.cts", import.meta.url), "utf8");
    const popup = await readFile(new URL("../src/update/main.ts", import.meta.url), "utf8");
    const vite = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(service).toContain("autoDownload = false");
    expect(service).toContain("autoInstallOnAppQuit = false");
    expect(service).toContain("latestVerifiedVersion");
    expect(service).toContain("downloadedVersion");
    expect(service).toContain("downloadVerified");
    expect(service).toContain("function releaseNotes");
    expect(service).toContain("quitAndInstall(true, true)");
    for (const channel of ["updates:status", "updates:check", "updates:download", "updates:install", "updates:open-releases"]) {
      expect(main).toContain(channel);
      expect(preload).toContain(channel);
    }
    expect(main).toContain("showUpdatePopup");
    expect(main).toContain('loadRenderer(window, "update.html")');
    expect(main).toContain("update-popup:close");
    expect(preload).toContain("update-popup:close");
    expect(popup).toContain('window.petAPI.console.open("updates")');
    expect(popup).toContain('class="release-notes"');
    expect(vite).toContain('update: resolve(projectRoot, "update.html")');
    expect(service).toContain("发布页暂时还没有正式版本");
  });

  it("shows release-note update dialogs in both console and chat renderers", async () => {
    const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
    const preload = await readFile(new URL("../electron/preload.cts", import.meta.url), "utf8");
    const consoleRenderer = await readFile(new URL("../src/console/main.ts", import.meta.url), "utf8");
    const chatRenderer = await readFile(new URL("../src/chat/main.ts", import.meta.url), "utf8");
    const modal = await readFile(new URL("../src/shared/update-modal.ts", import.meta.url), "utf8");

    expect(main).toContain('chatWindow?.webContents.send("updates:changed", status)');
    expect(consoleRenderer).toContain("installUpdateModal()");
    expect(chatRenderer).toContain("installUpdateModal()");
    expect(modal).toContain("update-modal-window-scrim");
    expect(modal).toContain('status.phase === "available"');
    expect(modal).toContain('status.phase === "downloaded"')
    expect(modal).toContain('window.petAPI.updates.status().then')
    expect(modal).toContain("稍后更新");
    expect(modal).toContain("稍后安装");
    expect(modal).toContain("renderReleaseNotes(status.releaseNotes)");
    expect(modal).toContain("data-update-release-link");
    expect(main).toContain("updates:open-link");
    expect(preload).toContain("updates:open-link");
  });

  it("only removes a recorded data directory carrying the app marker", async () => {
    const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
    expect(installer).toContain("!macro customWelcomePage");
    expect(installer).toContain("skipPageIfUpdated");
    expect(installer).toContain("!macro customUnWelcomePage");
    expect(installer).toContain("${IfNot} ${isUpdated}");
    expect(installer).toContain(".qpet-data-root");
    expect(installer).toContain('DeleteRegKey HKCU "Software\\com.qpet.ai"');
  });

  it("ships correctly sized 24-bit BMP artwork for the branded installer", async () => {
    const expectedAssets = [
      ["installerHeader.bmp", 150, 57],
      ["installerSidebar.bmp", 164, 314],
      ["uninstallerSidebar.bmp", 164, 314],
    ];

    for (const [fileName, width, height] of expectedAssets) {
      const asset = await readFile(new URL(`../build/${fileName}`, import.meta.url));
      expect(asset.subarray(0, 2).toString("ascii")).toBe("BM");
      expect(asset.readUInt32LE(10)).toBe(54);
      expect(asset.readInt32LE(18)).toBe(width);
      expect(asset.readInt32LE(22)).toBe(height);
      expect(asset.readUInt16LE(28)).toBe(24);
    }
  });
});
