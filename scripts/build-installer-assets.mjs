import sharp from "sharp";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const root = process.cwd();
const mascot = join(root, "public", "sprites", "idle_breath", "idle_breath_000.png");
const build = join(root, "build");

const svg = (width, height, body) => Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="warm" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf8"/><stop offset="1" stop-color="#fff0e5"/></linearGradient><radialGradient id="glow" cx="1" cy="0" r="1"><stop stop-color="#f5a178" stop-opacity=".32"/><stop offset="1" stop-color="#f5a178" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#warm)"/><circle cx="${width}" cy="0" r="${Math.round(width*.68)}" fill="url(#glow)"/>${body}</svg>`);

async function mascotLayer(width) {
  return sharp(mascot).resize({ width, height: width, fit: "contain" }).png().toBuffer();
}

async function writeBmp(image, path) {
  const { data, info } = await image.flatten({ background: "#fff8f1" }).raw().toBuffer({ resolveWithObject: true });
  const rowSize = Math.floor((info.width * 3 + 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const source = (y * info.width + x) * info.channels;
      const target = (info.height - 1 - y) * rowSize + x * 3;
      pixels[target] = data[source + 2] ?? data[source] ?? 0;
      pixels[target + 1] = data[source + 1] ?? data[source] ?? 0;
      pixels[target + 2] = data[source] ?? 0;
    }
  }
  const header = Buffer.alloc(54);
  header.write("BM", 0, 2, "ascii"); header.writeUInt32LE(54 + pixels.length, 2); header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14); header.writeInt32LE(info.width, 18); header.writeInt32LE(info.height, 22);
  header.writeUInt16LE(1, 26); header.writeUInt16LE(24, 28); header.writeUInt32LE(pixels.length, 34);
  await writeFile(path, Buffer.concat([header, pixels]));
}

await writeBmp(sharp(svg(150, 57, `<path d="M13 44h64" stroke="#efc2aa" stroke-width="1"/><text x="12" y="22" fill="#5a4136" font-size="13" font-weight="700" font-family="Microsoft YaHei, Segoe UI">珊珊桌宠</text><text x="12" y="36" fill="#a37b6a" font-size="7" font-family="Segoe UI, Microsoft YaHei">轻盈陪伴 · 专注每一刻</text>`))
  .composite([{ input: await mascotLayer(45), left: 99, top: 6 }]), join(build, "installerHeader.bmp"));

const sidebar = await sharp(svg(164, 314, `<path d="M18 53h44" stroke="#edb9a2" stroke-width="2" stroke-linecap="round"/><text x="18" y="31" fill="#4d382f" font-size="18" font-weight="700" font-family="Microsoft YaHei, Segoe UI">珊珊桌宠</text><text x="18" y="46" fill="#9b7465" font-size="8" font-family="Segoe UI, Microsoft YaHei">陪你把每一小步走稳</text><circle cx="28" cy="232" r="36" fill="#f8d9c9" opacity=".55"/><circle cx="133" cy="260" r="48" fill="#f4c6a9" opacity=".34"/><path d="M18 283c26 12 65 14 119-1" stroke="#ebc0aa" fill="none" stroke-width="1"/>`))
  .composite([{ input: await mascotLayer(118), left: 23, top: 112 }]);
await writeBmp(sidebar, join(build, "installerSidebar.bmp"));
await writeBmp(sidebar, join(build, "uninstallerSidebar.bmp"));
