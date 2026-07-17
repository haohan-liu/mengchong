import { spawn } from "node:child_process";

const UIA_SCRIPT = String.raw`
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
$focused=[System.Windows.Automation.AutomationElement]::FocusedElement
if($null -eq $focused -or $focused.Current.IsPassword){exit 0}
$pattern=$null
if($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){
  $ranges=$pattern.GetSelection()
  if($null -ne $ranges -and $ranges.Count -gt 0){
    [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
    [Console]::Write($ranges[0].GetText(2000))
  }
}`;

/** Read the focused selection without sending Ctrl+C or changing the clipboard. */
export async function readSelectedText(): Promise<string> {
  if (process.platform !== "win32") return "";
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const finish = (value = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value.trim().slice(0, 2000));
    };
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", UIA_SCRIPT], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const timer = setTimeout(() => { child.kill(); finish(); }, 1_500);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 8 * 1024) stdout += chunk.slice(0, 8 * 1024 - stdout.length);
    });
    child.once("error", () => finish());
    child.once("close", (code) => finish(code === 0 ? stdout : ""));
  });
}
