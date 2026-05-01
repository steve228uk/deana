import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseForceOption, runCli } from "./scriptUtils";
import { rowFromValues, splitCsv } from "./tsvUtils";
import { CLINGEN_GENE_DISEASE_VALIDITY_CSV } from "../src/lib/clingen/endpoints";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "clingen");

const downloadUrl = CLINGEN_GENE_DISEASE_VALIDITY_CSV;

// Only include classifications with meaningful positive evidence
const INCLUDED_CLASSIFICATIONS = new Set(["Definitive", "Strong", "Moderate"]);

export interface ClinGenClassification {
  gene: string;
  disease: string;
  diseaseId: string;
  classification: string;
  url: string;
}

function parseClinGenCsv(text: string): ClinGenClassification[] {
  // Strip UTF-8 BOM if present
  const clean = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    console.warn(`ClinGen: response has ${lines.length} line(s) — first 500 chars:\n${text.slice(0, 500)}`);
    return [];
  }

  const headers = splitCsv(lines[0]);
  console.log(`ClinGen: CSV headers: ${JSON.stringify(headers)}`);

  const results: ClinGenClassification[] = [];
  const classificationValues = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsv(lines[i]);
    const row = rowFromValues(headers, values, (header) => header.toUpperCase());

    const classification = row["CLASSIFICATION"] ?? row["FINAL CLASSIFICATION"] ?? "";
    classificationValues.add(classification);
    if (!INCLUDED_CLASSIFICATIONS.has(classification)) continue;

    const gene = row["GENE SYMBOL"] ?? row["GENE"] ?? "";
    const disease = row["DISEASE LABEL"] ?? row["DISEASE"] ?? "";
    const diseaseId = row["DISEASE ID (MONDO)"] ?? row["DISEASE ID"] ?? row["DISEASE MIM NUMBER"] ?? "";
    const url = row["ONLINE REPORT"] ?? row["URL"] ?? `https://search.clinicalgenome.org/kb/gene-validity`;

    if (!gene || !disease) continue;
    results.push({ gene, disease, diseaseId, classification, url });
  }

  if (results.length === 0) {
    const sample = [...classificationValues].slice(0, 20);
    console.warn(`ClinGen: 0 rows matched included classifications. Values found: ${JSON.stringify(sample)}`);
  }

  return results;
}

async function main(): Promise<void> {
  const options = parseForceOption(process.argv.slice(2));
  const outputFile = path.join(cacheDir, "gene_validity.json");

  if (!options.force && existsSync(outputFile)) {
    console.log("Using cached ClinGen data (pass --force to refresh).");
    return;
  }

  await mkdir(cacheDir, { recursive: true });

  console.log("Downloading ClinGen gene-disease validity classifications...");
  const response = await fetch(downloadUrl, {
    headers: {
      Accept: "text/csv,application/csv,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; deana-evidence-sync/1.0; +https://github.com/steve228uk/deana)",
    },
  });
  if (!response.ok) {
    throw new Error(`ClinGen download failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(`ClinGen returned HTML instead of CSV — likely bot-blocked. First 200 chars:\n${text.slice(0, 200)}`);
  }

  const classifications = parseClinGenCsv(text);

  await writeFile(outputFile, `${JSON.stringify(classifications, null, 2)}\n`);
  console.log(`ClinGen: ${classifications.length.toLocaleString()} Definitive/Strong/Moderate classifications written to ${path.relative(repoRoot, outputFile)}`);
}

runCli(import.meta.url, main);
