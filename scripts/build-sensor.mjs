import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const manifest = join(root, "native", "sensor", "Cargo.toml");
if (process.platform === "win32") {
  const runningSensor = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$sensor = Get-Process -Name pet-sensor -ErrorAction SilentlyContinue; if ($sensor) { exit 20 }"
  ], { encoding: "utf8" });
  if (runningSensor.status === 20) {
    console.error("检测到正在运行的珊珊桌宠占用了 pet-sensor.exe。请先退出桌宠，再重新构建或发布。");
    process.exit(1);
  }
}
const probe = spawnSync("cargo", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
if (probe.status !== 0) {
  if (process.platform !== "win32") {
    console.warn("Rust 工具链未安装：当前平台使用 Electron 降级传感器。");
    process.exit(0);
  }
  const windows = process.env.WINDIR ?? "C:\\Windows";
  const compilers = [
    join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
  ];
  const compiler = compilers.find(existsSync);
  if (!compiler) {
    console.warn("Rust 与 Windows C# 编译器均不可用：运行时将使用 Electron 基础降级传感器。");
    process.exit(0);
  }
  const source = join(root, "native", "sensor", "compat", "PetSensorCompat.cs");
  const output = join(root, "native", "sensor", "target", "release", "pet-sensor.exe");
  mkdirSync(dirname(output), { recursive: true });
  const compat = spawnSync(compiler, ["/nologo", "/optimize+", "/platform:x64", "/target:exe", `/out:${output}`, source], { stdio: "inherit" });
  if (compat.status === 0) console.log("Rust 未安装：已构建轻量 Win32 兼容传感器（不读取按键内容）。");
  process.exit(compat.status ?? 1);
}
const result = spawnSync("cargo", ["build", "--release", "--manifest-path", manifest], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
