import "./styles.css";
import type { UpdateStatus } from "../types";

const root = document.querySelector<HTMLElement>("#update-app")!;
let status: UpdateStatus = {
  phase: "checking", currentVersion: "", availableVersion: null, latestVerifiedVersion: null, downloadedVersion: null, checkedAt: null, downloadVerified: false, releaseNotes: null, downloadPercent: 0, message: "正在读取更新信息…"
};
let petName = "桌宠";

function setAccent(value: string): void {
  document.documentElement.style.setProperty("--accent", value || "#bf718e");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]!);
}

function progress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function content(current: UpdateStatus): { eyebrow: string; title: string; body: string; icon: "available" | "downloading" | "downloaded" | "error"; primary?: [string, string]; secondary: [string, string] } {
  const version = current.availableVersion ? `v${current.availableVersion}` : "新版本";
  if (current.phase === "downloaded") return {
    eyebrow: "更新已准备完成", title: "重启一下，焕然一新", body: `${version} 已安全下载。重启后会自动完成安装，设置、聊天和统计都会保留。`, icon: "downloaded",
    primary: ["立即重启安装", "install"], secondary: ["稍后再说", "close"]
  };
  if (current.phase === "downloading") return {
    eyebrow: "正在后台下载", title: "新版本正在赶来", body: "你可以继续使用桌宠；下载完成后会再次提醒你安装。", icon: "downloading",
    secondary: ["后台继续下载", "close"]
  };
  if (current.phase === "error") return {
    eyebrow: "下载暂时未完成", title: "再试一次吧", body: current.message || "网络连接暂时不可用，请稍后重试。", icon: "error",
    primary: ["重新下载", "download"], secondary: ["打开更新页", "details"]
  };
  return {
    eyebrow: `${petName} · 发现新版本`, title: "有一份新鲜更新", body: `${version} 已发布。下载后可在方便时重启安装，全程不会打断当前工作。`, icon: "available",
    primary: ["下载新版本", "download"], secondary: ["查看详情", "details"]
  };
}

function illustration(kind: "available" | "downloading" | "downloaded" | "error"): string {
  if (kind === "downloaded") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 25.5 21.3 32 34 17"/><path class="soft" d="M24 5.5c10.2 0 18.5 8.3 18.5 18.5S34.2 42.5 24 42.5 5.5 34.2 5.5 24 13.8 5.5 24 5.5Z"/></svg>';
  if (kind === "error") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 14v12"/><path d="M24 33.5v.2"/><path class="soft" d="M20.7 7.9 5.9 33.4A5 5 0 0 0 10.2 41h27.6a5 5 0 0 0 4.3-7.6L27.3 7.9a3.8 3.8 0 0 0-6.6 0Z"/></svg>';
  if (kind === "downloading") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 10v19"/><path d="m16.5 22.5 7.5 7.5 7.5-7.5"/><path class="soft" d="M10 36.5h28"/><path class="orbit" d="M8.5 22a15.5 15.5 0 0 1 28.8-8"/></svg>';
  return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 9v20"/><path d="m16.5 22.5 7.5 7.5 7.5-7.5"/><path class="soft" d="M10 36.5h28"/><path class="spark" d="M36 8v6M33 11h6"/></svg>';
}

function render(): void {
  const view = content(status);
  const percent = progress(status.downloadPercent);
  const isDownloading = status.phase === "downloading";
  const notes = status.releaseNotes?.replace(/\s+/g, " ").trim();
  root.innerHTML = `<section class="update-card phase-${view.icon}" aria-live="polite">
    <button type="button" class="close" data-action="close" aria-label="稍后处理更新"><span></span><span></span></button>
    <div class="ambient ambient-one"></div><div class="ambient ambient-two"></div><div class="pet-art" aria-hidden="true"><i></i><img src="./sprites/idle_breath/idle_breath_000.png"></div>
    <div class="topline"><div class="app-mark">${illustration(view.icon)}</div><div><span class="eyebrow">${escapeHtml(view.eyebrow)}</span><h1>${escapeHtml(view.title)}</h1></div></div>
    <p class="message">${escapeHtml(view.body)}</p>
    ${notes ? `<p class="release-notes" title="${escapeHtml(status.releaseNotes ?? "")}"><b>本次更新：</b>${escapeHtml(notes)}</p>` : ""}
    <div class="version-row"><span>当前 <b>v${escapeHtml(status.currentVersion || "—")}</b></span><i></i><span>最新 <b>${escapeHtml(status.availableVersion ? `v${status.availableVersion}` : "等待确认")}</b></span></div>
    <div class="progress ${isDownloading ? "visible" : ""}" aria-label="更新下载进度"><div><i style="width:${percent}%"></i></div><span>${percent}%</span></div>
    <div class="actions">${view.primary ? `<button type="button" class="primary" data-action="${view.primary[1]}">${view.primary[0]}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5 12.5 10 7 15.5"/></svg></button>` : ""}<button type="button" class="secondary" data-action="${view.secondary[1]}">${view.secondary[0]}</button></div>
  </section>`;
}

async function act(action: string): Promise<void> {
  if (action === "close") { await window.petAPI.updatePopup.close(); return; }
  if (action === "details") {
    await window.petAPI.console.open("updates");
    await window.petAPI.updatePopup.close();
    return;
  }
  if (action === "download") status = await window.petAPI.updates.download();
  if (action === "install") {
    const started = await window.petAPI.updates.install();
    if (started) await window.petAPI.updatePopup.close();
    else status = await window.petAPI.updates.status();
  }
  render();
}

root.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
  if (target) void act(target.dataset.action ?? "");
});

window.petAPI.updates.onChanged((next) => { status = next; render(); });
void Promise.all([window.petAPI.updates.status(), window.petAPI.settings.get()]).then(([next, settings]) => {
  status = next;
  petName = settings.petName || petName;
  setAccent(settings.appearance.accentColor);
  render();
});
window.petAPI.settings.onChanged((settings) => setAccent(settings.appearance.accentColor));
render();
