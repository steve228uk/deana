import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { EvidencePackManifest } from "../src/types";

interface EvidencePackLock {
  version: string;
  schemaVersion: number;
  url?: string;
  localArchivePath?: string;
  archiveName?: string;
  archiveSha256: string;
  manifestSha256?: string;
}

interface Options {
  check: boolean;
}

interface ArchiveInstallSource {
  path: string;
  verified: boolean;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repoRoot, "evidence-pack.lock.json");
const targetRoot = path.join(repoRoot, "public", "evidence-packs");
const cacheRoot = path.join(repoRoot, ".evidence-cache", "release-archives");
const configPath = path.join(repoRoot, "src", "lib", "evidencePackConfig.ts");

function parseOptions(argv: string[]): Options {
  const options: Options = { check: false };
  for (const arg of argv) {
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  const file = Bun.file(filePath);
  const reader = file.stream().getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    digest.update(value);
  }
  return digest.digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readLock(): Promise<EvidencePackLock> {
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as EvidencePackLock;
  if (!lock.version || !lock.archiveSha256 || !lock.schemaVersion) {
    throw new Error("evidence-pack.lock.json is missing required fields.");
  }
  return lock;
}

function resolveLocalArchive(lock: EvidencePackLock): string | null {
  const envArchive = process.env.EVIDENCE_PACK_ARCHIVE;
  if (envArchive) return path.resolve(repoRoot, envArchive);
  if (lock.localArchivePath) {
    const localPath = path.resolve(repoRoot, lock.localArchivePath);
    if (existsSync(localPath)) return localPath;
  }
  return null;
}

async function downloadArchive(lock: EvidencePackLock): Promise<ArchiveInstallSource> {
  if (!lock.url) {
    throw new Error("No local evidence archive was found and the lockfile does not include a url.");
  }

  await mkdir(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, lock.archiveName ?? `deana-evidence-pack-${lock.version}.tgz`);
  if (existsSync(archivePath) && await sha256File(archivePath) === lock.archiveSha256) {
    return { path: archivePath, verified: true };
  }

  const response = await fetch(lock.url);
  if (!response.ok) {
    throw new Error(`Evidence archive download failed with ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(archivePath, bytes);
  await verifyArchive(archivePath, lock);
  return { path: archivePath, verified: true };
}

async function archivePathForInstall(lock: EvidencePackLock): Promise<ArchiveInstallSource> {
  const localArchive = resolveLocalArchive(lock);
  return localArchive ? { path: localArchive, verified: false } : await downloadArchive(lock);
}

async function verifyArchive(filePath: string, lock: EvidencePackLock): Promise<void> {
  const digest = await sha256File(filePath);
  if (digest !== lock.archiveSha256) {
    throw new Error(`Evidence archive checksum mismatch. Expected ${lock.archiveSha256}; got ${digest}.`);
  }
}

async function extractArchive(archivePath: string, lock: EvidencePackLock): Promise<void> {
  const tmpRoot = path.join(targetRoot, `.${lock.version}.tmp-${process.pid}`);
  const extractedDir = path.join(tmpRoot, lock.version);
  const targetDir = path.join(targetRoot, lock.version);

  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });

  const tar = spawnSync("tar", ["-xzf", archivePath, "-C", tmpRoot], { stdio: "inherit" });
  if (tar.status !== 0) {
    throw new Error(`tar failed with status ${tar.status ?? "unknown"}.`);
  }
  if (!existsSync(extractedDir)) {
    throw new Error(`Evidence archive did not contain ${lock.version}/.`);
  }

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  await rename(extractedDir, targetDir);
  await rm(tmpRoot, { recursive: true, force: true });
}

async function verifyPackFileChecksum(filePath: string, expectedSha256: string): Promise<void> {
  const digest = await sha256File(filePath);
  if (digest !== expectedSha256) {
    throw new Error(`Evidence pack file checksum mismatch for ${path.relative(repoRoot, filePath)}.`);
  }
}

async function validateInstalledPack(lock: EvidencePackLock): Promise<EvidencePackManifest> {
  const packDir = path.join(targetRoot, lock.version);
  const manifestPath = path.join(packDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Evidence pack ${lock.version} is not installed.`);
  }

  const manifestText = await readFile(manifestPath, "utf8");
  if (lock.manifestSha256) {
    const manifestDigest = sha256Text(manifestText);
    if (manifestDigest !== lock.manifestSha256) {
      throw new Error("Evidence manifest checksum mismatch.");
    }
  }

  const manifest = JSON.parse(manifestText) as EvidencePackManifest;
  if (manifest.version !== lock.version || manifest.schemaVersion !== lock.schemaVersion) {
    throw new Error("Installed evidence pack manifest is not compatible with the lockfile.");
  }

  for (const shard of manifest.shards ?? []) {
    await verifyPackFileChecksum(path.join(packDir, shard.recordsPath), shard.recordsSha256);
  }
  for (const index of manifest.annotationIndexes ?? []) {
    await verifyPackFileChecksum(path.join(packDir, index.recordsPath), index.recordsSha256);
  }

  return manifest;
}

function configSource(lock: EvidencePackLock): string {
  return `// AUTO-GENERATED by scripts/installEvidencePack.ts; do not edit manually.\n\nexport const LOCAL_EVIDENCE_PACK_VERSION = ${JSON.stringify(lock.version)};\nexport const LOCAL_EVIDENCE_PACK_BASE = \`/evidence-packs/\${LOCAL_EVIDENCE_PACK_VERSION}\`;\n`;
}

async function syncConfig(lock: EvidencePackLock, check: boolean): Promise<void> {
  const expected = configSource(lock);
  const current = existsSync(configPath) ? await readFile(configPath, "utf8") : null;
  if (current === expected) return;
  if (check) {
    throw new Error("Evidence pack config is not current. Run bun run evidence:install.");
  }
  await writeFile(configPath, expected);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const lock = await readLock();

  if (!options.check) {
    const archive = await archivePathForInstall(lock);
    if (!archive.verified) await verifyArchive(archive.path, lock);
    await extractArchive(archive.path, lock);
  }

  const manifest = await validateInstalledPack(lock);
  await syncConfig(lock, options.check);
  console.log(`Evidence pack ${manifest.version} is installed and verified.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
