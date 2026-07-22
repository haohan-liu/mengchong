import "./styles.css";
import type { AppNotification, NotificationKind } from "../types";

const root = document.querySelector<HTMLElement>("#notification-app")!;
let notification: AppNotification = { id: "preview", title: "提醒", body: "", kind: "reminder", priority: "normal", actions: [], createdAt: Date.now() };

function setAppearance(accent: string, opacity = .94): void { document.documentElement.style.setProperty("--accent", accent || "#d77d6b"); document.documentElement.style.setProperty("--notice-opacity", String(Math.max(.55, Math.min(1, opacity)))); }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!); }
function icon(kind: NotificationKind): string {
  if (kind === "hydration") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7c7 8.2 11.8 14.1 11.8 21A11.8 11.8 0 1 1 12.2 28C12.2 21.1 17 15.2 24 7Z"/><path class="soft" d="M18.5 30.3c1.4 3.8 5.8 5.6 9.4 3.7"/></svg>';
  if (kind === "break") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 38h18M17.5 38v-4.2h13V38M13.2 31.5h21.6c-2.8-3.2-3.6-6.4-3.6-12.1 0-4.2-2.4-7.8-6.2-9.2V8.7a1.2 1.2 0 0 0-2.4 0v1.5c-3.8 1.4-6.2 5-6.2 9.2 0 5.7-.8 8.9-3.2 12.1Z"/><path class="soft" d="M36 14.5h5M38.5 12v5"/></svg>';
  if (kind === "plan") return '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="11" y="7.5" width="26" height="33" rx="5"/><path d="M18 7.5v5M30 7.5v5M17.5 21h13M17.5 28h13M17.5 35h8"/><path class="soft" d="m16.8 27.8 2.2 2.2 3.8-4"/></svg>';
  if (kind === "assistant") return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8.5v5M24 34.5v5M8.5 24h5M34.5 24h5M13.1 13.1l3.5 3.5M31.4 31.4l3.5 3.5M34.9 13.1l-3.5 3.5M16.6 31.4l-3.5 3.5"/><path class="soft" d="M24 16a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"/></svg>';
  return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 39.5h14M19.5 39.5v-3h9v3M14 34.5h20c-2.6-3-3.5-6.3-3.5-12.2 0-4.4-2.5-8.3-6.5-9.8V10a1.6 1.6 0 0 0-3.2 0v2.5c-4 1.5-6.5 5.4-6.5 9.8 0 5.9-.9 9.2-3.5 12.2Z"/></svg>';
}
function eyebrow(kind: NotificationKind): string { return kind === "plan" ? "计划提醒" : kind === "hydration" ? "补水时间" : kind === "break" ? "劳逸结合" : kind === "assistant" ? "桌宠助手" : "温柔提醒"; }

const MIN_WIDTH = 316;
const MAX_WIDTH = 480;

function textWidth(value: string, font: string): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return value.length * 12;
  context.font = font;
  return context.measureText(value).width;
}

function fitPopupToContent(): void {
  const card = root.querySelector<HTMLElement>(".notice-card");
  const actions = root.querySelector<HTMLElement>(".notice-actions");
  if (!card || !actions) return;
  const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button"));
  const buttonWidths = buttons.map((button) => Math.ceil(button.getBoundingClientRect().width));
  const inlineActionWidth = buttonWidths.reduce((total, width) => total + width, 0) + Math.max(0, buttons.length - 1) * 6;
  const stacked = buttons.length > 1 && inlineActionWidth > 150;
  actions.classList.toggle("stacked", stacked);
  const actionWidth = stacked ? Math.max(...buttonWidths) : inlineActionWidth;
  const fixedWidth = 9 + 60 + 9 + 9 + 25 + 2 + actionWidth;
  const preferredCopyWidth = Math.ceil(Math.max(
    128,
    textWidth(notification.title, '800 15px "Segoe UI Variable", "Microsoft YaHei UI", sans-serif'),
    Math.min(230, textWidth(notification.body, '500 10.5px "Segoe UI Variable", "Microsoft YaHei UI", sans-serif'))
  ));
  const copyWidth = Math.max(108, Math.min(preferredCopyWidth, MAX_WIDTH - fixedWidth));
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, fixedWidth + copyWidth));
  card.style.setProperty("--copy-width", `${copyWidth}px`);
  void window.petAPI.notificationPopup.resize(width).finally(() => document.body.classList.add("notice-ready"));
}

function render(): void {
  const actions = notification.actions.length ? notification.actions : [{ id: "acknowledge" as const, label: "知道了", style: "primary" as const }];
  const snooze = actions.find((action) => action.id === "snooze");
  root.innerHTML = `<section class="notice-card kind-${notification.kind}" aria-live="assertive" tabindex="-1">
    <div class="glow glow-one"></div><div class="glow glow-two"></div><div class="pet-art" aria-hidden="true"><img src="./sprites/notification/companion_peek_v1.png"></div>
    <button class="close" type="button" data-action="close" aria-label="关闭提醒"><i></i><i></i></button>
    <div class="notice-main"><div class="notice-icon">${icon(notification.kind)}</div><div class="notice-copy"><span class="eyebrow">${eyebrow(notification.kind)}</span><h1>${escapeHtml(notification.title)}</h1><p>${escapeHtml(notification.body)}</p></div></div>
    <div class="notice-actions">${actions.map((action) => `<button type="button" data-action="${action.id}" class="${action.style === "primary" ? "accent" : action.style === "quiet" ? "quiet" : ""}">${escapeHtml(action.label)}</button>`).join("")}${snooze?.alternatives?.length ? `<select data-snooze-minutes aria-label="选择稍后时间"><option value="${snooze.snoozeMinutes ?? 10}">10 分钟</option>${snooze.alternatives.map((item) => `<option value="${item.minutes}">${escapeHtml(item.label)}</option>`).join("")}</select>` : ""}</div>
  </section>`;
  requestAnimationFrame(fitPopupToContent);
}

root.addEventListener("mouseenter", () => void window.petAPI.notificationPopup.hover(true));
root.addEventListener("mouseleave", () => void window.petAPI.notificationPopup.hover(false));
root.addEventListener("keydown", (event) => { if (event.key === "Escape") void window.petAPI.notificationPopup.close(); if (event.key === "Enter") root.querySelector<HTMLButtonElement>(".notice-actions .accent")?.click(); });
root.addEventListener("click", (event) => {
  const action = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]")?.dataset.action : undefined;
  if (!action) return;
  if (action === "close") { void window.petAPI.notificationPopup.close(); return; }
  const minutes = Number(root.querySelector<HTMLSelectElement>("[data-snooze-minutes]")?.value || 0) || undefined;
  void window.petAPI.notificationPopup.respond(action, minutes);
});

window.petAPI.notificationPopup.onChanged((next) => { document.body.classList.remove("notice-ready"); notification = next; render(); });
void Promise.all([window.petAPI.notificationPopup.current(), window.petAPI.settings.get()]).then(([next, settings]) => { notification = next; setAppearance(settings.appearance.accentColor, settings.appearance.bubbleOpacity); render(); });
window.petAPI.settings.onChanged((settings) => setAppearance(settings.appearance.accentColor, settings.appearance.bubbleOpacity));
