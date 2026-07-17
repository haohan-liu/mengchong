import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("desktop update contract", () => {
  it("publishes NSIS updates to the public GitHub Releases repository", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.dependencies["electron-updater"]).toBeTruthy();
    expect(packageJson.build.appId).toBe("com.qpet.ai");
    expect(packageJson.build.win.target).toBe("nsis");
    expect(packageJson.build.publish).toEqual([{ provider: "github", owner: "haohan-liu", repo: "mengchong-exe" }]);
    expect(packageJson.build.nsis.deleteAppDataOnUninstall).toBe(true);
    expect(packageJson.build.nsis.include).toBe("build/installer.nsh");
  });

  it("keeps update checks manual in development and exposes the full IPC flow", async () => {
    const service = await readFile(new URL("../electron/services/UpdateService.ts", import.meta.url), "utf8");
    const main = await readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
    const preload = await readFile(new URL("../electron/preload.cts", import.meta.url), "utf8");
    expect(service).toContain("autoDownload = false");
    expect(service).toContain("autoInstallOnAppQuit = true");
    expect(service).toContain("quitAndInstall(false, true)");
    for (const channel of ["updates:status", "updates:check", "updates:download", "updates:install", "updates:open-releases"]) {
      expect(main).toContain(channel);
      expect(preload).toContain(channel);
    }
    expect(main).toContain('openConsole("updates")');
    expect(service).toContain("发布页暂时还没有正式版本");
  });

  it("only removes a recorded data directory carrying the app marker", async () => {
    const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
    expect(installer).toContain("${IfNot} ${isUpdated}");
    expect(installer).toContain(".qpet-data-root");
    expect(installer).toContain('DeleteRegKey HKCU "Software\\com.qpet.ai"');
  });
});
