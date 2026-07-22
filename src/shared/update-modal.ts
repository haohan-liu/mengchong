import type { UpdateStatus } from "../types";
import "./update-modal.css";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]!);
}

function renderInlineMarkdown(value: string): string {
  const links: string[] = [];
  const withPlaceholders = value.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => {
    const index = links.push(`<a href="#" data-update-release-link="${escapeHtml(url)}">${escapeHtml(label)}</a>`) - 1;
    return `\u0000LINK${index}\u0000`;
  });
  return escapeHtml(withPlaceholders)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\u0000LINK(\d+)\u0000/g, (_match, index: string) => links[Number(index)] ?? "");
}

function renderReleaseNotes(markdown: string | null): string {
  const source = markdown?.replace(/\r\n/g, "\n").trim();
  if (!source) return '<p class="update-modal-notes-empty">发布页暂未提供更新说明。</p>';
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = (): void => { if (list) output.push(`</${list}>`); list = null; };
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h3>${renderInlineMarkdown(heading[2]!)}</h3>`); continue; }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) { if (list !== "ul") { closeList(); output.push("<ul>"); list = "ul"; } output.push(`<li>${renderInlineMarkdown(unordered[1]!)}</li>`); continue; }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) { if (list !== "ol") { closeList(); output.push("<ol>"); list = "ol"; } output.push(`<li>${renderInlineMarkdown(ordered[1]!)}</li>`); continue; }
    closeList();
    if (line.startsWith("> ")) output.push(`<blockquote>${renderInlineMarkdown(line.slice(2))}</blockquote>`);
    else output.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("");
}

/** Shows the same update dialog in every open application window. */
export function installUpdateModal(): void {
  const dialog = document.createElement("dialog");
  dialog.className = "update-modal";
  dialog.setAttribute("aria-labelledby", "update-modal-title");
  dialog.innerHTML = `<form method="dialog" class="update-modal-card">
    <button class="update-modal-close" value="later" aria-label="稍后更新">×</button>
    <div class="update-modal-copy">
      <span class="update-modal-kicker">发现新版本</span>
      <h2 id="update-modal-title">有一份新鲜更新</h2>
      <p data-update-modal-message></p>
      <div class="update-modal-version"><span>当前 <b data-update-modal-current></b></span><i></i><span>最新 <b data-update-modal-latest></b></span></div>
      <section class="update-modal-notes" aria-label="本次更新说明"><b>本次更新</b><div data-update-modal-notes></div></section>
      <div class="update-modal-progress" data-update-modal-progress hidden><i></i><span></span></div>
    </div>
    <footer><button type="button" data-update-modal-action="later">稍后更新</button><button type="button" class="update-modal-primary" data-update-modal-action="download">立即下载</button></footer>
  </form>`;
  const host = document.querySelector<HTMLElement>(".console-shell, .chat-shell") ?? document.body;
  host.append(dialog);

  const message = dialog.querySelector<HTMLElement>("[data-update-modal-message]")!;
  const kicker = dialog.querySelector<HTMLElement>(".update-modal-kicker")!;
  const title = dialog.querySelector<HTMLElement>("#update-modal-title")!;
  const current = dialog.querySelector<HTMLElement>("[data-update-modal-current]")!;
  const latest = dialog.querySelector<HTMLElement>("[data-update-modal-latest]")!;
  const progress = dialog.querySelector<HTMLElement>("[data-update-modal-progress]")!;
  const notes = dialog.querySelector<HTMLElement>("[data-update-modal-notes]")!;
  const progressFill = progress.querySelector<HTMLElement>("i")!;
  const progressLabel = progress.querySelector<HTMLElement>("span")!;
  const primary = dialog.querySelector<HTMLButtonElement>("[data-update-modal-action=download]")!;
  const secondary = dialog.querySelector<HTMLButtonElement>("[data-update-modal-action=later]")!;
  const setWindowScrim = (visible: boolean): void => {
    const appWindow = document.querySelector<HTMLElement>(".app-window");
    if (!appWindow) return;
    let scrim = appWindow.querySelector<HTMLElement>(".update-modal-window-scrim");
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "update-modal-window-scrim"; scrim.hidden = true; appWindow.prepend(scrim); }
    scrim.hidden = !visible;
  };

  const sync = (status: UpdateStatus): void => {
    const version = status.availableVersion ? `v${status.availableVersion}` : "待确认";
    current.textContent = `v${status.currentVersion}`;
    latest.textContent = version;
    notes.innerHTML = renderReleaseNotes(status.releaseNotes);
    if (status.phase === "downloading") {
      kicker.textContent = "后台下载中";
      title.textContent = "新版本正在下载";
      message.textContent = "正在后台下载新版本，你可以继续使用当前窗口。";
      progress.hidden = false;
      progressFill.style.setProperty("--update-scale", String(Math.max(0, Math.min(1, status.downloadPercent / 100))));
      progressLabel.textContent = `${Math.round(status.downloadPercent)}%`;
      primary.textContent = "正在下载";
      primary.disabled = true;
      secondary.textContent = "隐藏窗口";
      return;
    }
    if (status.phase === "downloaded") {
      kicker.textContent = "下载完成";
      title.textContent = "更新已经准备好";
      message.textContent = "更新已安全下载完成，重启后会自动完成安装。";
      progress.hidden = false;
      progressFill.style.setProperty("--update-scale", "1");
      progressLabel.textContent = "100%";
      primary.textContent = "立即重启安装";
      primary.disabled = false;
      secondary.textContent = "稍后安装";
      return;
    }
    kicker.textContent = "发现新版本";
    title.textContent = "有一份新鲜更新";
    message.textContent = `${version} 已发布。下载后可在方便时重启安装，当前工作不会被打断。`;
    progress.hidden = true;
    primary.textContent = "立即下载";
    primary.disabled = false;
    secondary.textContent = "稍后更新";
  };
  const show = (status: UpdateStatus): void => { sync(status); if (!dialog.open) dialog.showModal(); setWindowScrim(true); };

  dialog.addEventListener("close", () => setWindowScrim(false));
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close("later"); });
  dialog.addEventListener("click", (event) => {
    const releaseLink = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("[data-update-release-link]") : null;
    if (releaseLink) {
      event.preventDefault();
      const url = releaseLink.dataset.updateReleaseLink;
      if (url) void window.petAPI.updates.openLink(url);
      return;
    }
    const action = (event.target instanceof Element ? event.target.closest<HTMLElement>("[data-update-modal-action]") : null)?.dataset.updateModalAction;
    if (action === "later") dialog.close("later");
    if (action === "download") void (async () => {
      const status = await window.petAPI.updates.status();
      if (status.phase === "downloaded") {
        if (await window.petAPI.updates.install()) dialog.close("install");
        return;
      }
      sync(await window.petAPI.updates.download());
    })();
  });
  window.petAPI.updates.onChanged((status) => {
    if (status.phase === "available") show(status);
    else if (status.phase === "downloaded") show(status);
    else if (dialog.open && status.phase === "downloading") sync(status);
  });
  void window.petAPI.updates.status().then((status) => {
    if (status.phase === "downloaded") show(status);
  });
}
