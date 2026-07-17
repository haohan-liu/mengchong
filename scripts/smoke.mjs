import { spawn } from "node:child_process";
import { join } from "node:path";

const electronCli = join(process.cwd(), "node_modules", "electron", "cli.js");
// Codex/CI 这类受限 Windows 容器无法启动 Chromium 沙箱子进程；该开关只用于本地烟雾测试，正式安装包仍保持 sandbox: true。
const child = spawn(process.execPath, [electronCli, "--no-sandbox", ".", "--smoke-test"], { stdio: "inherit", env: { ...process.env, PET_SMOKE: "1" } });
const timeout = setTimeout(() => { child.kill(); console.error("Electron smoke test 超时"); process.exit(1); }, 40_000);
child.on("exit", (code) => { clearTimeout(timeout); process.exit(code ?? 1); });
