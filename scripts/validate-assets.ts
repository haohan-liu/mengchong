import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "animations_manifest.json"), "utf8")) as Array<{ id: string; frames: number; playMode: string; returnTo: string | null; playback?: { enter?: { from: number; to: number }; sustain?: { from: number; to: number; mode?: string }; exit?: { from: number; to: number }; interruptPolicy?: string } }>;
const spriteRoot = join(root, "public/sprites");
const directories = (await readdir(spriteRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const expected = manifest.map((entry) => entry.id).sort();
if (directories.length !== 24 || directories.join("|") !== expected.join("|")) throw new Error(`动作目录必须恰好为登记的 24 个，实际 ${directories.length}`);
let total = 0;
let loop = 0;
let once = 0;
for (const definition of manifest) {
  definition.playMode === "loop" ? loop++ : once++;
  if (definition.playMode === "once" && definition.returnTo !== "idle_breath") throw new Error(`${definition.id} 的 returnTo 必须是 idle_breath`);
  if ((definition.id === "type_fast" || definition.id === "user_typing")
    && (definition.playback?.sustain?.from !== 1 || definition.playback.sustain.mode !== "ping-pong"
      || definition.playback.enter?.to !== 0 || definition.playback.exit?.to !== 0)) {
    throw new Error(`${definition.id} 必须使用 schema v2 的进入/持续/退出段，且站立帧不得进入循环`);
  }
  const directory = join(spriteRoot, definition.id);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".png")).sort();
  if (files.length !== definition.frames) throw new Error(`${definition.id} 帧数错误：${files.length}/${definition.frames}`);
  const bottoms: number[] = [];
  for (let index = 0; index < definition.frames; index++) {
    const expectedName = `${definition.id}_${String(index).padStart(3, "0")}.png`;
    if (files[index] !== expectedName) throw new Error(`${definition.id} 编号不连续：期望 ${expectedName}，得到 ${files[index]}`);
    const image = sharp(join(directory, expectedName), { failOn: "error" });
    const metadata = await image.metadata();
    if (metadata.width !== 512 || metadata.height !== 512 || metadata.channels !== 4 || !metadata.hasAlpha) throw new Error(`${expectedName} 必须为 512×512 RGBA`);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    let transparent = 0;
    let bottom = -1;
    for (let offset = 3; offset < data.length; offset += info.channels) {
      const alpha = data[offset]!;
      if (alpha === 0) transparent++;
      if (alpha > 20) { visible++; bottom = Math.max(bottom, Math.floor((offset / info.channels) / info.width)); }
    }
    if (visible < 2000 || transparent < 2000 || bottom < 0) throw new Error(`${expectedName} 必须非空且含透明区域`);
    bottoms.push(bottom);
  }
  if (Math.max(...bottoms) - Math.min(...bottoms) > 6) throw new Error(`${definition.id} 脚底基线偏差超过 6px`);
  total += files.length;
}
if (total !== 280) throw new Error(`PNG 总数必须为 280，实际 ${total}`);
if (loop !== 15 || once !== 9) throw new Error(`播放模式应为 15 loop / 9 once，实际 ${loop}/${once}`);
console.log(`Assets OK: 24 actions, ${total} RGBA PNGs, ${loop} loop / ${once} once.`);
