import { spawn } from "node:child_process";
import net from "node:net";
import { join } from "node:path";

const nodeModule = (...parts) => join(process.cwd(), "node_modules", ...parts);
const vite = spawn(process.execPath, [nodeModule("vite", "bin", "vite.js"), "--configLoader", "runner"], { stdio: "inherit" });
const waitPort = (port) => new Promise((resolve) => {
  const tryConnect = () => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", () => setTimeout(tryConnect, 150));
  };
  tryConnect();
});
await waitPort(1421);

// Build the Rust sidecar, or the local Win32 compatibility sidecar when Rust is unavailable.
const sensorCompile = spawn(process.execPath, [join(process.cwd(), "scripts", "build-sensor.mjs")], { stdio: "inherit" });
const sensorCompileCode = await new Promise((resolve, reject) => {
  sensorCompile.once("error", reject);
  sensorCompile.once("exit", (code) => resolve(code ?? 1));
});
if (sensorCompileCode !== 0) {
  vite.kill();
  process.exit(sensorCompileCode);
}

// Compile once before Electron starts so it never loads stale main/preload output.
const initialCompile = spawn(process.execPath, [nodeModule("typescript", "bin", "tsc"), "-p", "electron/tsconfig.json"], { stdio: "inherit" });
const initialCompileCode = await new Promise((resolve, reject) => {
  initialCompile.once("error", reject);
  initialCompile.once("exit", (code) => resolve(code ?? 1));
});
if (initialCompileCode !== 0) {
  vite.kill();
  process.exit(initialCompileCode);
}

const tsc = spawn(process.execPath, [nodeModule("typescript", "bin", "tsc"), "-p", "electron/tsconfig.json", "--watch", "--preserveWatchOutput"], { stdio: "inherit" });
const electron = spawn(process.execPath, [nodeModule("electron", "cli.js"), "."], {
  stdio: "inherit",
  env: { ...process.env, PET_DEV_URL: "http://127.0.0.1:1421", ELECTRON_ENABLE_LOGGING: "1" }
});
electron.once("error", (error) => {
  console.error("Electron failed to start:", error);
  vite.kill();
  tsc.kill();
  process.exit(1);
});
let stopping = false;
const stopChildren = (exitCode) => {
  if (stopping) return;
  stopping = true;
  electron.kill();
  vite.kill();
  tsc.kill();
  setTimeout(() => process.exit(exitCode), 750).unref();
};
process.once("SIGINT", () => stopChildren(130));
process.once("SIGTERM", () => stopChildren(143));
electron.on("exit", (code) => {
  vite.kill();
  tsc.kill();
  if (!stopping) process.exit(code ?? 0);
});
