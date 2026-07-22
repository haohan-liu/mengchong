import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("one-click publish assistant contract", () => {
  it("keeps repository configuration centralized and separates source backup from release assets", async () => {
    const [script, launcher, setupScript, setupLauncher, starter, npmrc, ignore, guide] = await Promise.all([
      readFile(new URL("../scripts/publish-assistant.ps1", import.meta.url), "utf8"),
      readFile(new URL("../一键备份与发布.bat", import.meta.url), "utf8"),
      readFile(new URL("../scripts/setup-dev-environment.ps1", import.meta.url), "utf8"),
      readFile(new URL("../一键安装开发环境.bat", import.meta.url), "utf8"),
      readFile(new URL("../启动桌宠.bat", import.meta.url), "utf8"),
      readFile(new URL("../.npmrc", import.meta.url), "utf8"),
      readFile(new URL("../.gitignore", import.meta.url), "utf8"),
      readFile(new URL("../docs/发布与迭代指南.md", import.meta.url), "utf8")
    ]);

    expect(script).toContain('$SourceRepoSlug = "haohan-liu/mengchong"');
    expect(script).toContain('$ReleaseRepoSlug = "haohan-liu/mengchong-exe"');
    expect(script).toContain("集中配置区");
    expect(script).toContain('gh.exe');
    expect(script).toContain('auth", "login"');
    expect(script).toContain('Test-NetConnection $GitHubHost -Port 443');
    expect(script).toContain('Invoke-Native "npm" @("ci")');
    expect(script).toContain('Invoke-Native "npm" @("run", "dist")');
    expect(script).toContain('"release", "create", $tag');
    expect(script).toContain('$ArtifactPrefix-$Version.exe.blockmap');
    expect(script).toContain('Join-Path $releaseDirectory "latest.yml"');
    expect(script).toContain("^(?i:YES|PUBLISH)$");
    expect(script).toContain("无需重新打包");
    expect(script).toContain('if ($confirm -cne "REPLACE")');
    expect(script).toContain('return "clean-and-synced"');
    expect(script).toContain("没有源码改动，本地提交也已同步到远程");
    expect(script).toContain("完整测试 + 打包 + 备份源码（不发布 Release）");
    expect(script).toContain("源码提交说明");
    expect(script).toContain("GitHub Release 更新说明");
    expect(script).toContain("© 2026 浩涵");
    expect(script).toContain("$RequiredSourceFiles = @(");
    expect(script).toContain('"一键备份与发布.bat"');
    expect(script).toContain('"一键安装开发环境.bat"');
    expect(script).toContain("function Stage-SourceFiles");
    expect(script).toContain('Invoke-Native "git" @("add", "--all")');
    expect(script).toContain('Invoke-Native "git" @("add", "--", $requiredFile)');
    expect(launcher).toContain("scripts\\publish-assistant.ps1");
    expect(setupLauncher).toContain("scripts\\setup-dev-environment.ps1");
    expect(launcher).toContain("\r\n");
    expect(setupLauncher).toContain("\r\n");
    expect(launcher).not.toContain("chcp 65001");
    expect(setupLauncher).not.toContain("chcp 65001");
    expect(launcher).toContain("pause >nul");
    expect(setupLauncher).toContain("pause >nul");
    expect(starter).toContain("npm.cmd ci --include=dev");
    expect(starter).toContain(":wait-for-electron");
    expect(script).toContain("LauncherCheck");
    expect(setupScript).toContain("LauncherCheck");
    expect(setupScript).toContain('$MinimumNodeMajor = 22');
    expect(setupScript).toContain('$NodeMirror = "https://npmmirror.com/mirrors/node"');
    expect(setupScript).toContain("Get-AuthenticodeSignature");
    expect(setupScript).toContain("npm ls --depth=0");
    expect(npmrc).toContain("registry=https://registry.npmmirror.com");
    expect(npmrc).not.toContain("electron_builder_binaries_mirror");
    expect(script).toContain('$env:ELECTRON_BUILDER_BINARIES_MIRROR = $ElectronBuilderMirror');
    for (const entry of ["node_modules/", "release/", ".publish/", ".env", "*.pfx"]) expect(ignore).toContain(entry);
    expect(guide).toContain("从第一次上传到日常一键发布");
    expect(guide).toContain("换 GitHub 账号或仓库");
    expect(guide).toContain("源码提交说明");
    expect(guide).toContain("Release 更新说明");
  });
});
