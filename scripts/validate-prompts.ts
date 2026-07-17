import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "animations_manifest.json"), "utf8")) as Array<{ id: string; prompt: string }>;
const generated = JSON.parse(await readFile(join(root, "src/data/animations.json"), "utf8"));
if (manifest.length !== 24) throw new Error(`manifest 必须恰好 24 条，实际 ${manifest.length}`);
if (JSON.stringify(manifest) !== JSON.stringify(generated)) throw new Error("src/data/animations.json 与根 manifest 不一致");
const files = (await readdir(join(root, "prompts/actions"))).filter((file) => file.endsWith(".txt"));
if (files.length !== 24) throw new Error(`动作 prompt 必须恰好 24 份，实际 ${files.length}`);
const expected = new Set(manifest.map((entry) => `${entry.id}.txt`));
for (const file of files) if (!expected.has(file)) throw new Error(`发现未登记 prompt：${file}`);
for (const entry of manifest) {
  if (!expected.has(`${entry.id}.txt`) || !files.includes(`${entry.id}.txt`)) throw new Error(`缺少 prompt：${entry.id}`);
  const value = await readFile(join(root, "prompts/actions", `${entry.id}.txt`), "utf8");
  if (!value.includes(`动作 ID：${entry.id}`) || value.trim().length < 120) throw new Error(`prompt 内容不完整：${entry.id}`);
}
console.log("Prompts OK: 24 manifest entries and 24 action prompts.");
