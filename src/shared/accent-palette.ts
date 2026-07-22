export interface AccentPalette {
  label: string;
  colors: string[];
}

const palettes: Array<{ label: string; pattern: RegExp; colors: string[] }> = [
  { label: "绿色", pattern: /绿|green|emerald|forest/i, colors: ["#2f9e6f", "#3aa879", "#238b5f", "#4fb58a", "#197a50"] },
  { label: "青绿色", pattern: /青|teal|cyan|mint|薄荷/i, colors: ["#278f88", "#38a39a", "#187b76", "#51b5aa", "#146d69"] },
  { label: "蓝色", pattern: /蓝|blue|navy|sky/i, colors: ["#4f7fce", "#5b8bd8", "#3f6fbd", "#719be0", "#315fa9"] },
  { label: "紫色", pattern: /紫|purple|violet|lavender/i, colors: ["#8267c7", "#9278d2", "#7056b5", "#a18cdb", "#6047a3"] },
  { label: "橙色", pattern: /橙|orange|apricot/i, colors: ["#df7b45", "#e68b56", "#cb6934", "#ed9b6d", "#b95a2b"] },
  { label: "黄色", pattern: /黄|金|yellow|gold/i, colors: ["#c88a32", "#d39a43", "#b67825", "#dda957", "#a5681d"] },
  { label: "粉色", pattern: /粉|玫瑰|pink|rose/i, colors: ["#d96f91", "#e17f9e", "#c75c80", "#e993ac", "#b94b70"] },
  { label: "红色", pattern: /红|red|crimson/i, colors: ["#d95762", "#e2676f", "#c74653", "#ea7b80", "#b73948"] }
];

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function channel(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
}

function mix(hex: string, target: number, weight: number): string {
  const [red, green, blue] = hexToRgb(hex);
  return `#${channel(red + (target - red) * weight)}${channel(green + (target - green) * weight)}${channel(blue + (target - blue) * weight)}`;
}

export function accentPaletteForPreference(rawPreference: unknown): AccentPalette {
  const preference = String(rawPreference ?? "").trim();
  const custom = preference.match(/#[0-9a-f]{6}/i)?.[0]?.toLowerCase();
  if (custom) {
    return {
      label: "自定义色",
      colors: [custom, mix(custom, 255, .12), mix(custom, 0, .1), mix(custom, 255, .22), mix(custom, 0, .2)]
    };
  }
  const matched = palettes.find((palette) => palette.pattern.test(preference)) ?? palettes[6]!;
  return { label: matched.label, colors: [...matched.colors] };
}
