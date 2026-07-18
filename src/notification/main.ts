import "./styles.css";
import type { AppNotification } from "../types";

const root = document.querySelector<HTMLElement>("#notification-app")!;
let notification: AppNotification = { title: "提醒", body: "", kind: "reminder" };

function setAccent(value: string): void {
  document.documentElement.style.setProperty("--accent", value || "#bf718e");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function icon(kind: AppNotification["kind"]): string {
  if (kind === "assistant") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8.5v5M24 34.5v5M8.5 24h5M34.5 24h5M13.1 13.1l3.5 3.5M31.4 31.4l3.5 3.5M34.9 13.1l-3.5 3.5M16.6 31.4l-3.5 3.5"/><path class="soft" d="M24 16a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"/></svg>';
  return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 39.5h14M19.5 39.5v-3h9v3M14 34.5h20c-2.6-3-3.5-6.3-3.5-12.2 0-4.4-2.5-8.3-6.5-9.8V10a1.6 1.6 0 0 0-3.2 0v2.5c-4 1.5-6.5 5.4-6.5 9.8 0 5.9-.9 9.2-3.5 12.2Z"/><path class="soft" d="M24 5.5a18.5 18.5 0 1 1-18.5 18.5"/></svg>';
}

function render(): void {
  root.innerHTML = `<section class="notice-card kind-${notification.kind}" aria-live="assertive">
    <div class="glow glow-one"></div><div class="glow glow-two"></div>
    <button class="close" type="button" data-action="close" aria-label="关闭提醒"><i></i><i></i></button>
    <div class="notice-main"><div class="notice-icon">${icon(notification.kind)}</div>
      <div class="notice-copy"><span class="eyebrow">${notification.kind === "assistant" ? "桌宠助手" : "温柔提醒"}</span><h1>${escapeHtml(notification.title)}</h1><p>${escapeHtml(notification.body)}</p></div>
    </div>
    <div class="notice-actions"><button type="button" data-action="chat">聊天台</button><button type="button" class="accent" data-action="details">${notification.kind === "assistant" ? "打开控制台" : "调整提醒"}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5 12.5 10 7 15.5"/></svg></button></div>
  </section>`;
}

root.addEventListener("click", (event) => {
  const action = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]")?.dataset.action : undefined;
  if (action === "close") void window.petAPI.notificationPopup.close();
  if (action === "chat") void window.petAPI.notificationPopup.openChat();
  if (action === "details") void window.petAPI.notificationPopup.openReminders();
});

window.petAPI.notificationPopup.onChanged((next) => { notification = next; render(); });
void Promise.all([window.petAPI.notificationPopup.current(), window.petAPI.settings.get()]).then(([next, settings]) => { notification = next; setAccent(settings.appearance.accentColor); render(); });
window.petAPI.settings.onChanged((settings) => setAccent(settings.appearance.accentColor));
render();
