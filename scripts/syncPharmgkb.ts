import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { findZipTextEntry, parseForceOption, runCli } from "./scriptUtils";
import { rowFromValues, splitTsv } from "./tsvUtils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "pharmgkb");
const downloadUrl = "https://api.pharmgkb.org/v1/download/file/data/clinicalAnnotations.zip";

// Include levels with robust clinical evidence; exclude 3/4 (case reports, weak associations)
const INCLUDED_LEVELS = new Set(["1A", "1B", "2A", "2B"]);

interface PharmGkbAnnotation {
  variantId: string;
  rsid: string;
  gene: string;
  drugs: string[];
  phenotypeCategory: string;
  evidenceLevel: string;
  significance: string;
  pmids: string[];
  url: string;
}

function parseClinicalAnnotationsTsv(text: string): PharmGkbAnnotation[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitTsv(lines[0]);
  const results: PharmGkbAnnotation[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitTsv(lines[i]);
    const row = rowFromValues(headers, values);

    const level = row["Level of Evidence"] ?? "";
    if (!INCLUDED_LEVELS.has(level)) continue;

    // Variant/Haplotypes column: may be "rs1234567" or "rs1234567, rs890" or a haplotype name
    const variantRaw = row["Variant/Haplotypes"] ?? "";
    // Extract first rsid from the field
    const rsidMatch = variantRaw.match(/rs\d+/i);
    if (!rsidMatch) continue;

    const rsid = rsidMatch[0].toLowerCase();
    const variantId = row["Clinical Annotation ID"] ?? `${rsid}-${i}`;
    const gene = row["Gene"] ?? "";
    const drugsRaw = row["Drug(s)"] ?? "";
    const drugs = drugsRaw.split(/[,;]/).map((d) => d.trim()).filter(Boolean).slice(0, 6);
    if (drugs.length === 0) continue;

    const phenotypeCategory = row["Phenotype Category"] ?? "";
    const significance = row["Stat Result Type"] ?? "";
    const pmidsRaw = row["PMID(s)"] ?? "";
    const pmids = pmidsRaw.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    const url = row["URL"] ?? `https://www.pharmgkb.org/clinicalAnnotation/${variantId}`;

    results.push({ variantId, rsid, gene, drugs, phenotypeCategory, evidenceLevel: level, significance, pmids, url });
  }

  return results;
}

async function main(): Promise<void> {
  const options = parseForceOption(process.argv.slice(2));
  const annotationsFile = path.join(cacheDir, "annotations.json");

  if (!options.force && existsSync(annotationsFile)) {
    console.log("Using cached PharmGKB data (pass --force to refresh).");
    return;
  }

  await mkdir(cacheDir, { recursive: true });

  console.log("Downloading PharmGKB clinical annotations...");
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`PharmGKB download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(bytes);
  const tsvBytes = findZipTextEntry(
    entries,
    /clinical.?annotations?/i,
    "PharmGKB ZIP did not contain a clinical annotations TSV file.",
  );

  const text = new TextDecoder().decode(tsvBytes);
  const annotations = parseClinicalAnnotationsTsv(text);

  await writeFile(annotationsFile, `${JSON.stringify(annotations, null, 2)}\n`);
  console.log(`PharmGKB: ${annotations.length.toLocaleString()} level 1A–2B annotations written to ${path.relative(repoRoot, annotationsFile)}`);
}

runCli(import.meta.url, main);
