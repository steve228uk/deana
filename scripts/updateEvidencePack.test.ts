import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateEvidencePack } from "./updateEvidencePack";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePackDir = path.join(repoRoot, "public", "evidence-packs", "2026-04-core");

let fixtureRoot: string;

async function createFixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deana-evidence-pack-"));
  const packDir = path.join(root, "public", "evidence-packs", "2026-04-core");
  const libDir = path.join(root, "src", "lib");
  await mkdir(packDir, { recursive: true });
  await mkdir(libDir, { recursive: true });
  await writeFile(path.join(packDir, "records.json"), await readFile(path.join(sourcePackDir, "records.json"), "utf8"));
  await writeFile(path.join(packDir, "manifest.json"), await readFile(path.join(sourcePackDir, "manifest.json"), "utf8"));
  await writeFile(path.join(libDir, "evidencePack.ts"), 'export const EVIDENCE_PACK_VERSION = "2026-04-core";\n');
  await writeFile(path.join(libDir, "evidencePackData.ts"), 'export const LOCAL_EVIDENCE_PACK_VERSION = "2026-04-core";\n');
  return root;
}

beforeEach(async () => {
  fixtureRoot = await createFixtureRepo();
  await updateEvidencePack({ check: false, targetVersion: "2026-04-core", repoRoot: fixtureRoot });
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("updateEvidencePack", () => {
  it("passes check mode when the current pack is valid", async () => {
    const result = await updateEvidencePack({ check: true, targetVersion: "2026-04-core", repoRoot: fixtureRoot });

    expect(result.changed).toBe(false);
    expect(result.messages).toEqual(["Evidence pack 2026-04-core is current."]);
  });

  it("reports manifest checksum drift in check mode", async () => {
    const manifestPath = path.join(fixtureRoot, "public", "evidence-packs", "2026-04-core", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.recordsSha256 = "0".repeat(64);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = await updateEvidencePack({ check: true, targetVersion: "2026-04-core", repoRoot: fixtureRoot });

    expect(result.changed).toBe(true);
    expect(result.messages).toContain("public/evidence-packs/2026-04-core/manifest.json is not current.");
  });

  it("rejects duplicate record IDs", async () => {
    const recordsPath = path.join(fixtureRoot, "public", "evidence-packs", "2026-04-core", "records.json");
    const records = JSON.parse(await readFile(recordsPath, "utf8"));
    records[1].id = records[0].id;
    await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);

    await expect(updateEvidencePack({ check: true, targetVersion: "2026-04-core", repoRoot: fixtureRoot })).rejects.toThrow("duplicated");
  });

  it("rejects unknown sources", async () => {
    const recordsPath = path.join(fixtureRoot, "public", "evidence-packs", "2026-04-core", "records.json");
    const records = JSON.parse(await readFile(recordsPath, "utf8"));
    records[0].sourceId = "made-up-source";
    await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);

    await expect(updateEvidencePack({ check: true, targetVersion: "2026-04-core", repoRoot: fixtureRoot })).rejects.toThrow("sourceId is not known");
  });

  it("rejects unknown entry IDs", async () => {
    const recordsPath = path.join(fixtureRoot, "public", "evidence-packs", "2026-04-core", "records.json");
    const records = JSON.parse(await readFile(recordsPath, "utf8"));
    records[0].entryId = "made-up-entry";
    await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`);

    await expect(updateEvidencePack({ check: true, targetVersion: "2026-04-core", repoRoot: fixtureRoot })).rejects.toThrow("entryId is not known");
  });
});
