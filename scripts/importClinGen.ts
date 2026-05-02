import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importClinicalActionability } from "../src/lib/clingen/importClinicalActionability";
import {
  importDosageSensitivityCsv,
  importDosageSensitivityFtpTsv,
} from "../src/lib/clingen/importDosageSensitivity";
import {
  INCLUDED_GENE_DISEASE_VALIDITY_CLASSIFICATIONS,
  importGeneDiseaseValidity,
} from "../src/lib/clingen/importGeneDiseaseValidity";
import { importVariantPathogenicity } from "../src/lib/clingen/importVariantPathogenicity";
import type { ClinGenImportedRecord } from "../src/lib/clingen/normalise";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "clingen");

type ClinGenImportSource =
  | "gene-disease-validity"
  | "dosage-sensitivity"
  | "clinical-actionability"
  | "variant-pathogenicity";

interface ImportOptions {
  force: boolean;
  sources: ClinGenImportSource[];
}

interface CacheTarget {
  source: ClinGenImportSource;
  label: string;
  outputFile: string;
  requiredCachedFiles?: string[];
  importRecords: () => Promise<ClinGenImportedRecord[]>;
  afterWrite?: (records: ClinGenImportedRecord[]) => Promise<void>;
}

interface LegacyClinGenClassification {
  gene: string;
  disease: string;
  diseaseId: string;
  classification: string;
  url: string;
  pmids: string[];
}

const allSources: ClinGenImportSource[] = [
  "gene-disease-validity",
  "dosage-sensitivity",
  "clinical-actionability",
  "variant-pathogenicity",
];

function parseOptions(argv: string[]): ImportOptions {
  const options: ImportOptions = {
    force: false,
    sources: [...allSources],
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg.startsWith("--source=")) {
      const source = normaliseSource(arg.slice("--source=".length));
      options.sources = [source];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normaliseSource(value: string): ClinGenImportSource {
  const source = value.trim().toLowerCase().replace(/_/g, "-");
  if (allSources.includes(source as ClinGenImportSource)) {
    return source as ClinGenImportSource;
  }

  throw new Error(
    `Unknown ClinGen source: ${value}. Expected one of: ${allSources.join(", ")}`,
  );
}

function cachePath(fileName: string): string {
  return path.join(cacheDir, fileName);
}

function toLegacyGeneValidity(
  records: ClinGenImportedRecord[],
): LegacyClinGenClassification[] {
  const classifications: LegacyClinGenClassification[] = [];

  for (const record of records) {
    if (
      !record.geneSymbol ||
      !record.diseaseLabel ||
      !record.classification ||
      !INCLUDED_GENE_DISEASE_VALIDITY_CLASSIFICATIONS.has(record.classification)
    ) {
      continue;
    }

    classifications.push({
      gene: record.geneSymbol,
      disease: record.diseaseLabel,
      diseaseId: record.mondoId ?? "",
      classification: record.classification,
      url: record.reportUrl ?? "https://search.clinicalgenome.org/kb/gene-validity",
      pmids: record.pmids ?? [],
    });
  }

  return classifications;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeLegacyGeneValidity(records: ClinGenImportedRecord[]): Promise<void> {
  const outputFile = cachePath("gene_validity.json");
  const classifications = toLegacyGeneValidity(records);

  await writeJson(outputFile, classifications);
  console.log(
    `ClinGen: ${classifications.length.toLocaleString()} Definitive/Strong/Moderate gene-disease classifications written to ${path.relative(repoRoot, outputFile)}`,
  );
}

function getTargets(): CacheTarget[] {
  return [
    {
      source: "gene-disease-validity",
      label: "gene-disease validity",
      outputFile: cachePath("gene_disease_validity.json"),
      requiredCachedFiles: [cachePath("gene_validity.json")],
      importRecords: importGeneDiseaseValidity,
      afterWrite: writeLegacyGeneValidity,
    },
    {
      source: "dosage-sensitivity",
      label: "dosage sensitivity",
      outputFile: cachePath("dosage_sensitivity.json"),
      importRecords: async () => {
        const [csvRecords, tsvRecords] = await Promise.all([
          importDosageSensitivityCsv(),
          importDosageSensitivityFtpTsv("GRCh38"),
        ]);
        return [...csvRecords, ...tsvRecords];
      },
    },
    {
      source: "clinical-actionability",
      label: "clinical actionability",
      outputFile: cachePath("clinical_actionability.json"),
      importRecords: importClinicalActionability,
    },
    {
      source: "variant-pathogenicity",
      label: "variant pathogenicity",
      outputFile: cachePath("variant_pathogenicity.json"),
      importRecords: importVariantPathogenicity,
    },
  ];
}

async function importTarget(target: CacheTarget, options: ImportOptions): Promise<void> {
  const cachedFiles = [target.outputFile, ...(target.requiredCachedFiles ?? [])];
  if (!options.force && cachedFiles.every((file) => existsSync(file))) {
    console.log(
      `Using cached ClinGen ${target.label} data (pass --force to refresh).`,
    );
    return;
  }

  console.log(`Downloading ClinGen ${target.label} data...`);
  const records = await target.importRecords();

  await writeJson(target.outputFile, records);
  console.log(
    `ClinGen: ${records.length.toLocaleString()} ${target.label} records written to ${path.relative(repoRoot, target.outputFile)}`,
  );

  await target.afterWrite?.(records);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(cacheDir, { recursive: true });

  const targets = getTargets().filter((target) => options.sources.includes(target.source));

  for (const target of targets) {
    await importTarget(target, options);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
