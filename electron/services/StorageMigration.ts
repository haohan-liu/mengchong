import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

async function inventory(root: string, current = root): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        for (const [path, hash] of await inventory(root, full)) result.set(path, hash);
      } else if (entry.isFile()) {
        const relative = full.slice(root.length + 1).replaceAll("\\", "/");
        result.set(relative, createHash("sha256").update(await readFile(full)).digest("hex"));
      }
    }
  } catch { /* an empty source is valid */ }
  return result;
}

export async function migrateDataDirectory(source: string, selectedParent: string): Promise<string> {
  const sourcePath = resolve(source);
  const target = resolve(join(selectedParent, "QPetData"));
  if (sourcePath === target) return target;
  const staging = resolve(join(dirname(target), `.qpet-migration-${Date.now()}`));
  if (!staging.startsWith(resolve(selectedParent))) throw new Error("迁移目标不在所选目录内");
  await mkdir(staging, { recursive: true });
  try {
    try { await stat(sourcePath); await cp(sourcePath, staging, { recursive: true, force: true }); } catch { /* first migration */ }
    const [before, after] = await Promise.all([inventory(sourcePath), inventory(staging)]);
    if (before.size !== after.size || [...before].some(([file, hash]) => after.get(file) !== hash)) throw new Error("迁移文件校验失败");
    try { await stat(target); throw new Error(`${basename(target)} 已存在，请选择其他目录`); } catch (error) {
      if (error instanceof Error && error.message.includes("已存在")) throw error;
    }
    await rename(staging, target);
    await rm(sourcePath, { recursive: true, force: true });
    return target;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
