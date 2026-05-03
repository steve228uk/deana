import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { findOptionalZipTextEntry, findZipTextEntry, parseForceOption, runCli } from "./scriptUtils";
import { rowFromValues, splitTsv } from "./tsvUtils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "pharmgkb");
const downloadUrl = "https://api.pharmgkb.org/v1/download/file/data/clinicalAnnotations.zip";

// Include levels with robust clinical evidence; exclude 3/4 (case reports, weak associations)
const INCLUDED_LEVELS = new Set(["1A", "1B", "2A", "2B"]);

// Patterns that indicate the allele/genotype is associated with altered (risk) function
const RISK_FUNCTION_RE =
  /poor\s+metabolizer|no\s+function|decreased\s+function|increased\s+toxicity|decreased\s+efficacy|ultra.?rapid\s+metabolizer/i;
const NORMAL_FUNCTION_RE = /normal\s+metabolizer|normal\s+function|increased\s+function/i;

export interface PharmGkbAnnotation {
  variantId: string;
  rsid: string;
  gene: string;
  drugs: string[];
  phenotypeCategory: string;
  evidenceLevel: string;
  significance: string;
  pmids: string[];
  url: string;
  riskAllele: string | null;
}

export function determineRiskAllele(
  entries: Array<{ genotype: string; function_: string }>,
): string | null {
  // Case 1: Single-base allele entries (allele-level annotations, e.g. Genotype/Allele = "A")
  const singleBase = entries.filter((e) => /^[ACGT]$/i.test(e.genotype));
  if (singleBase.length > 0) {
    const riskEntry = singleBase.find((e) => RISK_FUNCTION_RE.test(e.function_));
    if (riskEntry) return riskEntry.genotype.toUpperCase();
    // No function info: return the allele only when there's a single unambiguous one
    const unique = new Set(singleBase.map((e) => e.genotype.toUpperCase()));
    if (unique.size === 1) return [...unique][0];
    return null;
  }

  // Case 2: Two-character genotype entries (e.g. Genotype/Allele = "CT")
  const twoChar = entries.filter((e) => /^[ACGT]{2}$/i.test(e.genotype));
  if (twoChar.length === 0) return null;

  // Find the homozygous risk genotype directly ("TT" → Poor Metabolizer → risk allele = "T")
  const homoRisk = twoChar
    .filter((e) => e.genotype[0] === e.genotype[1])
    .find((e) => RISK_FUNCTION_RE.test(e.function_));
  if (homoRisk) {
    const allele = homoRisk.genotype[0].toUpperCase();
    if (/^[ACGT]$/.test(allele)) return allele;
  }

  // Derive risk allele from normal-homozygous + heterozygous pair
  // ("CC" → Normal, "CT" → het → risk allele is "T")
  const homoNormal = twoChar
    .filter((e) => e.genotype[0] === e.genotype[1])
    .find((e) => NORMAL_FUNCTION_RE.test(e.function_));
  const hetEntry = twoChar.find((e) => e.genotype[0] !== e.genotype[1]);
  if (homoNormal && hetEntry) {
    const normalAllele = homoNormal.genotype[0].toUpperCase();
    const [a, b] = [hetEntry.genotype[0].toUpperCase(), hetEntry.genotype[1].toUpperCase()];
    // The het must contain the normal allele for this derivation to be valid
    if (a === normalAllele || b === normalAllele) {
      const risk = a === normalAllele ? b : a;
      if (/^[ACGT]$/.test(risk)) return risk;
    }
  }

  return null;
}

// Build annotationId → riskAllele map from clinical_ann_alleles.tsv
export function buildRiskAlleleMap(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();

  const headers = splitTsv(lines[0]);
  const findCol = (patterns: RegExp[]) =>
    headers.findIndex((h) => patterns.some((p) => p.test(h)));

  const idIdx = findCol([/clinical\s*annotation\s*id/i]);
  const genoIdx = findCol([/genotype\s*[/\\]\s*allele/i, /genotype/i]);
  const funcIdx = findCol([/^allele\s*function$/i, /^function$/i]);

  if (idIdx === -1 || genoIdx === -1) return new Map();

  const grouped = new Map<string, Array<{ genotype: string; function_: string }>>();
  for (let i = 1; i < lines.length; i++) {
    const values = splitTsv(lines[i]);
    const id = (values[idIdx] ?? "").trim();
    if (!id) continue;
    const genotype = (values[genoIdx] ?? "").trim();
    if (!genotype) continue;
    const func = funcIdx >= 0 ? (values[funcIdx] ?? "").trim() : "";
    const existing = grouped.get(id);
    if (existing) existing.push({ genotype, function_: func });
    else grouped.set(id, [{ genotype, function_: func }]);
  }

  const result = new Map<string, string>();
  for (const [id, entries] of grouped) {
    const allele = determineRiskAllele(entries);
    if (allele) result.set(id, allele);
  }
  return result;
}

function parseClinicalAnnotationsTsv(text: string, riskAlleleMap: Map<string, string>): PharmGkbAnnotation[] {
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
    const riskAllele = riskAlleleMap.get(variantId) ?? null;

    results.push({ variantId, rsid, gene, drugs, phenotypeCategory, evidenceLevel: level, significance, pmids, url, riskAllele });
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
    /clinical.?annotations?(?!.*allele)/i,
    "PharmGKB ZIP did not contain a clinical annotations TSV file.",
  );

  const allelesBytes = findOptionalZipTextEntry(entries, /clinical.?ann.?alleles?/i);
  const riskAlleleMap = allelesBytes
    ? buildRiskAlleleMap(new TextDecoder().decode(allelesBytes))
    : new Map<string, string>();

  if (allelesBytes) {
    console.log(`PharmGKB: parsed allele function data (${riskAlleleMap.size} risk alleles identified).`);
  } else {
    console.log("PharmGKB: no allele function file found in ZIP; risk alleles will not be set.");
  }

  const text = new TextDecoder().decode(tsvBytes);
  const annotations = parseClinicalAnnotationsTsv(text, riskAlleleMap);

  await writeFile(annotationsFile, `${JSON.stringify(annotations, null, 2)}\n`);
  console.log(`PharmGKB: ${annotations.length.toLocaleString()} level 1A–2B annotations written to ${path.relative(repoRoot, annotationsFile)}`);
}

runCli(import.meta.url, main);
