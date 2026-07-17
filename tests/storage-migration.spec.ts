import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateDataDirectory } from "../electron/services/StorageMigration";

const paths: string[] = [];
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("storage migration", () => {
  it("copies and verifies data before deleting the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "qpet-test-")); paths.push(root);
    const source = join(root, "source"); const target = join(root, "target");
    await mkdir(source); await mkdir(target);
    await writeFile(join(source, "statistics.json"), "{\"ok\":true}");
    const migrated = await migrateDataDirectory(source, target);
    expect(await readFile(join(migrated, "statistics.json"), "utf8")).toContain("true");
    await expect(access(source)).rejects.toThrow();
  });
});
