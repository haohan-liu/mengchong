import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "animations_manifest.json"), "utf8")) as Array<{ id: string; prompt: string }>;
if (manifest.length !== 24) throw new Error(`manifest 必须恰好 24 条，实际 ${manifest.length}`);
const files = (await readdir(join(root, "prompts/actions"))).filter((file) => file.endsWith(".txt"));
if (files.length !== 24) throw new Error(`动作 prompt 必须恰好 24 份，实际 ${files.length}`);
const expected = new Set(manifest.map((entry) => `${entry.id}.txt`));
for (const file of files) if (!expected.has(file)) throw new Error(`发现未登记 prompt：${file}`);
for (const entry of manifest) {
  if (!expected.has(`${entry.id}.txt`) || !files.includes(`${entry.id}.txt`)) throw new Error(`缺少 prompt：${entry.id}`);
  const value = await readFile(join(root, "prompts/actions", `${entry.id}.txt`), "utf8");
  if (!value.includes(`动作 ID：${entry.id}`) || value.trim().length < 120) throw new Error(`prompt 内容不完整：${entry.id}`);
}
console.log("Prompts OK: one canonical manifest with 24 entries and 24 action prompts.");
