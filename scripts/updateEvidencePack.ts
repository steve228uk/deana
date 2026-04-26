import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVIDENCE_DEFINITIONS, SOURCE_LIBRARY } from "../src/lib/evidencePack";
import type { EvidencePackManifest, EvidencePackRecord, EvidenceSourceRole, EvidenceTier } from "../src/types";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recordsPath = "records.json";
const schemaVersion = 1;
const versionPattern = /^\d{4}-\d{2}-core$/;

const sourceMetadata: EvidencePackManifest["sources"] = [
  {
    id: "clinvar",
    name: "ClinVar",
    release: "ClinVar public release, weekly-maintained",
    url: "https://www.ncbi.nlm.nih.gov/clinvar/docs/downloads/",
    role: "primary",
  },
  {
    id: "cpic",
    name: "CPIC",
    release: "CPIC guideline and database tables",
    url: "https://cpicpgx.org/api-and-database/",
    role: "primary",
  },
  {
    id: "gwas",
    name: "GWAS Catalog",
    release: "GWAS Catalog association export",
    url: "https://www.ebi.ac.uk/gwas/rest/api/v2/docs",
    role: "primary",
  },
  {
    id: "pubmed",
    name: "PubMed",
    release: "PubMed citation metadata, queried during pack build",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK25497/",
    role: "citation",
  },
  {
    id: "gnomad",
    name: "gnomAD",
    release: "gnomAD v4.1.1 context",
    url: "https://gnomad.broadinstitute.org/news/2026-03-gnomad-v4-1-1/",
    role: "frequency-context",
  },
  {
    id: "snpedia",
    name: "SNPedia",
    release: "SNPedia cached page export from bots.snpedia.com",
    url: "https://bots.snpedia.com/index.php/Bulk",
    role: "supplementary",
  },
];

const attribution =
  "Local Deana evidence pack built from public ClinVar, CPIC, GWAS Catalog, PubMed citation metadata, and gnomAD context. User marker IDs and genotypes are matched locally in the browser.";

const evidenceTierValues = new Set<EvidenceTier>(["high", "moderate", "emerging", "preview", "supplementary"]);
const sourceRoleValues = new Set<EvidenceSourceRole>(["primary", "frequency-context", "citation", "supplementary"]);
const insightCategories = new Set(["medical", "traits", "drug"]);
const reputeValues = new Set(["good", "bad", "mixed", "not-set"]);
const toneValues = new Set(["neutral", "good", "caution"]);
const knownEntryIds = new Set(EVIDENCE_DEFINITIONS.map((definition) => definition.id));
const knownSourceIds = new Set(Object.keys(SOURCE_LIBRARY));

interface Options {
  check: boolean;
  targetVersion: string;
  repoRoot?: string;
}

export interface EvidencePackUpdateResult {
  targetVersion: string;
  targetDir: string;
  changed: boolean;
  messages: string[];
}

function parseOptions(argv: string[]): Options {
  const now = new Date();
  const defaultVersion = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-core`;
  const options: Options = {
    check: false,
    targetVersion: defaultVersion,
  };

  for (const arg of argv) {
    if (arg === "--check") {
      options.check = true;
      continue;
    }

    if (arg.startsWith("--version=")) {
      options.targetVersion = arg.slice("--version=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!versionPattern.test(options.targetVersion)) {
    throw new Error(`Evidence-pack version must match YYYY-MM-core: ${options.targetVersion}`);
  }

  return options;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function evidencePackRoot(repoRoot: string): string {
  return path.join(repoRoot, "public", "evidence-packs");
}

function assertString(value: unknown, label: string, errors: string[]): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string.`);
  }
}

function assertStringArray(value: unknown, label: string, errors: string[]): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push(`${label} must be a non-empty string array.`);
  }
}

function validateRecords(value: unknown): EvidencePackRecord[] {
  const errors: string[] = [];
  if (!Array.isArray(value)) {
    throw new Error("records.json must contain an array.");
  }

  const ids = new Set<string>();
  for (const [index, record] of value.entries()) {
    const label = `records[${index}]`;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(`${label} must be an object.`);
      continue;
    }

    const item = record as Partial<EvidencePackRecord>;
    assertString(item.id, `${label}.id`, errors);
    assertString(item.entryId, `${label}.entryId`, errors);
    assertString(item.sourceId, `${label}.sourceId`, errors);
    assertString(item.title, `${label}.title`, errors);
    assertString(item.url, `${label}.url`, errors);
    assertString(item.release, `${label}.release`, errors);
    assertStringArray(item.markerIds, `${label}.markerIds`, errors);
    assertStringArray(item.genes, `${label}.genes`, errors);
    if (!Array.isArray(item.pmids) || item.pmids.some((item) => typeof item !== "string")) {
      errors.push(`${label}.pmids must be a string array.`);
    }
    assertStringArray(item.notes, `${label}.notes`, errors);

    if (item.id && ids.has(item.id)) errors.push(`${label}.id is duplicated: ${item.id}.`);
    if (item.id) ids.add(item.id);
    if (item.entryId && !knownEntryIds.has(item.entryId) && !/^local-(medical|trait|drug)-/.test(item.entryId)) {
      errors.push(`${label}.entryId is not known: ${item.entryId}.`);
    }
    if (/^local-(medical|trait|drug)-/.test(item.entryId ?? "") && !item.category) {
      errors.push(`${label}.category is required for local evidence entries.`);
    }
    if (item.sourceId && !knownSourceIds.has(item.sourceId)) errors.push(`${label}.sourceId is not known: ${item.sourceId}.`);
    if (item.role && !sourceRoleValues.has(item.role)) errors.push(`${label}.role is not valid: ${item.role}.`);
    if (item.category && !insightCategories.has(item.category)) errors.push(`${label}.category is not valid: ${item.category}.`);
    if (item.evidenceLevel && !evidenceTierValues.has(item.evidenceLevel)) errors.push(`${label}.evidenceLevel is not valid: ${item.evidenceLevel}.`);
    if (item.repute && !reputeValues.has(item.repute)) errors.push(`${label}.repute is not valid: ${item.repute}.`);
    if (item.tone && !toneValues.has(item.tone)) errors.push(`${label}.tone is not valid: ${item.tone}.`);
    if (item.clinicalSignificance !== null && typeof item.clinicalSignificance !== "string") {
      errors.push(`${label}.clinicalSignificance must be a string or null.`);
    }
    if (item.riskAllele !== undefined && typeof item.riskAllele !== "string") errors.push(`${label}.riskAllele must be a string.`);
    if (item.genotype !== undefined && typeof item.genotype !== "string") errors.push(`${label}.genotype must be a string.`);
    if (item.technicalName !== undefined && typeof item.technicalName !== "string") errors.push(`${label}.technicalName must be a string.`);
    if (item.magnitude !== undefined && item.magnitude !== null && typeof item.magnitude !== "number") {
      errors.push(`${label}.magnitude must be a number or null.`);
    }
    if (item.frequencyNote !== undefined && typeof item.frequencyNote !== "string") errors.push(`${label}.frequencyNote must be a string.`);
    if (item.summary !== undefined && typeof item.summary !== "string") errors.push(`${label}.summary must be a string.`);
    if (item.detail !== undefined && typeof item.detail !== "string") errors.push(`${label}.detail must be a string.`);
    if (item.whyItMatters !== undefined && typeof item.whyItMatters !== "string") errors.push(`${label}.whyItMatters must be a string.`);
    if (item.subcategory !== undefined && typeof item.subcategory !== "string") errors.push(`${label}.subcategory must be a string.`);
    if (Array.isArray(item.pmids) && item.pmids.some((pmid) => !/^\d+$/.test(pmid))) {
      errors.push(`${label}.pmids must contain numeric PMID strings.`);
    }
    if (item.topics !== undefined && (!Array.isArray(item.topics) || item.topics.some((item) => typeof item !== "string"))) {
      errors.push(`${label}.topics must be a string array.`);
    }
    if (item.conditions !== undefined && (!Array.isArray(item.conditions) || item.conditions.some((item) => typeof item !== "string"))) {
      errors.push(`${label}.conditions must be a string array.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Evidence pack record validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  return value as EvidencePackRecord[];
}

function sortedRecordText(records: EvidencePackRecord[]): string {
  const sortedRecords = [...records].sort((left, right) => left.id.localeCompare(right.id));
  return `${JSON.stringify(sortedRecords, null, 2)}\n`;
}

function buildManifest(version: string, generatedAt: string, recordsText: string): EvidencePackManifest {
  return {
    version,
    schemaVersion,
    generatedAt,
    recordsPath,
    recordsSha256: sha256(recordsText),
    attribution,
    sources: sourceMetadata,
  };
}

function manifestText(manifest: EvidencePackManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function replaceVersionConstant(source: string, exportName: string, version: string): string {
  const pattern = new RegExp(`export const ${exportName} = "[^"]+";`);
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${exportName} export.`);
  }
  return source.replace(pattern, `export const ${exportName} = "${version}";`);
}

function validateManifest(manifest: EvidencePackManifest, version: string, recordsText: string): string[] {
  const errors: string[] = [];
  if (manifest.version !== version) errors.push(`manifest.version must be ${version}.`);
  if (manifest.schemaVersion !== schemaVersion) errors.push(`manifest.schemaVersion must be ${schemaVersion}.`);
  if (manifest.recordsPath !== recordsPath) errors.push(`manifest.recordsPath must be ${recordsPath}.`);
  if (manifest.recordsSha256 !== sha256(recordsText)) errors.push("manifest.recordsSha256 does not match records.json.");
  if (manifest.attribution !== attribution) errors.push("manifest.attribution is not current.");
  if (JSON.stringify(manifest.sources) !== JSON.stringify(sourceMetadata)) errors.push("manifest.sources are not current.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.generatedAt)) {
    errors.push("manifest.generatedAt must be an ISO timestamp.");
  }
  return errors;
}

async function listPackVersions(repoRoot: string): Promise<string[]> {
  const entries = await readdir(evidencePackRoot(repoRoot), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && versionPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function ensureTargetRecords(repoRoot: string, targetVersion: string): Promise<{ recordsText: string; targetDir: string; created: boolean }> {
  const targetDir = path.join(evidencePackRoot(repoRoot), targetVersion);
  const targetRecordsPath = path.join(targetDir, recordsPath);
  if (existsSync(targetRecordsPath)) {
    return {
      recordsText: await readFile(targetRecordsPath, "utf8"),
      targetDir,
      created: false,
    };
  }

  const versions = (await listPackVersions(repoRoot)).filter((version) => version !== targetVersion);
  const sourceVersion = versions.at(-1);
  if (!sourceVersion) {
    throw new Error("No existing evidence pack found to seed the new monthly pack.");
  }

  const sourceRecordsPath = path.join(evidencePackRoot(repoRoot), sourceVersion, recordsPath);
  return {
    recordsText: await readFile(sourceRecordsPath, "utf8"),
    targetDir,
    created: true,
  };
}

async function writeIfChanged(repoRoot: string, filePath: string, nextText: string, check: boolean, messages: string[]): Promise<boolean> {
  const currentText = existsSync(filePath) ? await readFile(filePath, "utf8") : null;
  if (currentText === nextText) return false;

  const relativePath = path.relative(repoRoot, filePath);
  if (check) {
    messages.push(`${relativePath} is not current.`);
    return true;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, nextText);
  messages.push(`Updated ${relativePath}.`);
  return true;
}

export async function updateEvidencePack(options: Options): Promise<EvidencePackUpdateResult> {
  const messages: string[] = [];
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const { recordsText: rawRecordsText, targetDir } = await ensureTargetRecords(repoRoot, options.targetVersion);
  const records = validateRecords(JSON.parse(rawRecordsText));
  const nextRecordsText = sortedRecordText(records);
  const manifestPath = path.join(targetDir, "manifest.json");
  const existingManifest = existsSync(manifestPath)
    ? await readJsonFile<EvidencePackManifest>(manifestPath)
    : null;
  const generatedAt = existingManifest?.version === options.targetVersion
    ? existingManifest.generatedAt
    : new Date().toISOString();
  const nextManifest = buildManifest(options.targetVersion, generatedAt, nextRecordsText);
  const manifestErrors = validateManifest(nextManifest, options.targetVersion, nextRecordsText);
  if (manifestErrors.length > 0) {
    throw new Error(`Generated evidence pack manifest is invalid:\n${manifestErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  const evidencePackFile = path.join(repoRoot, "src", "lib", "evidencePack.ts");
  const evidencePackDataFile = path.join(repoRoot, "src", "lib", "evidencePackData.ts");
  const evidencePackSource = replaceVersionConstant(
    await readFile(evidencePackFile, "utf8"),
    "EVIDENCE_PACK_VERSION",
    options.targetVersion,
  );
  const evidencePackDataSource = replaceVersionConstant(
    await readFile(evidencePackDataFile, "utf8"),
    "LOCAL_EVIDENCE_PACK_VERSION",
    options.targetVersion,
  );

  let changed = false;
  changed = (await writeIfChanged(repoRoot, path.join(targetDir, recordsPath), nextRecordsText, options.check, messages)) || changed;
  changed = (await writeIfChanged(repoRoot, manifestPath, manifestText(nextManifest), options.check, messages)) || changed;
  changed = (await writeIfChanged(repoRoot, evidencePackFile, evidencePackSource, options.check, messages)) || changed;
  changed = (await writeIfChanged(repoRoot, evidencePackDataFile, evidencePackDataSource, options.check, messages)) || changed;

  if (!changed) {
    messages.push(`Evidence pack ${options.targetVersion} is current.`);
  }

  return {
    targetVersion: options.targetVersion,
    targetDir,
    changed,
    messages,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const result = await updateEvidencePack(options);
  for (const message of result.messages) {
    console.log(message);
  }
  if (options.check && result.changed) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
