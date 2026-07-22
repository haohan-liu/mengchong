export type IconName =
  | "home" | "palette" | "sparkles" | "shield" | "clock" | "brain" | "chart" | "database"
  | "close" | "check" | "heart" | "message" | "pause" | "play" | "activity" | "keyboard" | "coffee"
  | "refresh" | "folder" | "trash" | "rotate" | "key" | "eye" | "lock"
  | "moon" | "sun" | "monitor" | "info" | "external" | "edit" | "copy" | "chevron";

const paths: Record<IconName, string> = {
  home: '<path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.7V21h13V9.7"/><path d="M9.5 21v-6h5v6"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".7"/><circle cx="17.5" cy="10.5" r=".7"/><circle cx="8.5" cy="7.5" r=".7"/><path d="M12 3a9 9 0 1 0 0 18h1.4a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/>',
  sparkles: '<path d="m12 3-1.1 3.1A7.2 7.2 0 0 1 6.5 10L3 11l3.5 1a7.2 7.2 0 0 1 4.4 3.9L12 19l1.1-3.1a7.2 7.2 0 0 1 4.4-3.9l3.5-1-3.5-1a7.2 7.2 0 0 1-4.4-3.9L12 3Z"/>',
  shield: '<path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  brain: '<path d="M9.5 4.5A3 3 0 0 0 4 6.2a3.2 3.2 0 0 0 .7 5.8A3.2 3.2 0 0 0 8 17.5 3 3 0 0 0 12 20V5.5a3 3 0 0 0-2.5-1Z"/><path d="M14.5 4.5A3 3 0 0 1 20 6.2a3.2 3.2 0 0 1-.7 5.8 3.2 3.2 0 0 1-3.3 5.5A3 3 0 0 1 12 20M8 9a3 3 0 0 0-3.3 3M16 9a3 3 0 0 1 3.3 3M8 15a3.6 3.6 0 0 0 4-3M16 15a3.6 3.6 0 0 1-4-3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  message: '<path d="M21 14a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7h4"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h5"/>',
  coffee: '<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M17 10h1a3 3 0 0 1 0 6h-2M6 3v2M10 3v2M14 3v2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m16 6-2 2.5A7 7 0 0 1 5.5 15"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  trash: '<path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V3h6v4"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M15 8l3 3M17 6l3 3"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M20 15.3A8.5 8.5 0 0 1 8.7 4a8.5 8.5 0 1 0 11.3 11.3Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z"/><path d="m13.5 7 3.5 3.5"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>'
};

export function icon(name: IconName, className = ""): string {
  return `<svg class="ui-icon ${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function sectionHeading(title: string, description = "", actions = ""): string {
  return `<div class="card-heading"><div><h3>${escapeHtml(title)}</h3>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>${actions ? `<div class="card-actions">${actions}</div>` : ""}</div>`;
}

export function buttonLabel(name: IconName, label: string): string {
  return `${icon(name)}<span>${escapeHtml(label)}</span>`;
}

export function safeAccent(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#d77d6b";
}
