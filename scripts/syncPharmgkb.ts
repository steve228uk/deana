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
  annotationText: string | null;
  genotype: string | null;
  riskAllele: string | null;
}

export interface PharmGkbAlleleAnnotation {
  annotationText: string | null;
  genotype: string | null;
  riskAllele: string | null;
}

export function normalizePharmgkbAllele(value: string): { genotype: string | null; riskAllele: string | null } | null {
  const normalized = value.trim().toUpperCase();
  if (/^[ACGT]{2}$/.test(normalized)) {
    return { genotype: normalized.split("").sort().join(""), riskAllele: null };
  }
  if (/^[ACGT]$/.test(normalized)) {
    return { genotype: null, riskAllele: normalized };
  }
  return null;
}

// Build annotationId → genotype-specific rows from clinical_ann_alleles.tsv.
export function buildAlleleAnnotationMap(text: string): Map<string, PharmGkbAlleleAnnotation[]> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();

  const headers = splitTsv(lines[0]);
  const findCol = (patterns: RegExp[]) =>
    headers.findIndex((h) => patterns.some((p) => p.test(h)));

  const idIdx = findCol([/clinical\s*annotation\s*id/i]);
  const genoIdx = findCol([/genotype\s*[/\\]\s*allele/i, /genotype/i]);
  const textIdx = findCol([/^annotation\s*text$/i]);

  if (idIdx === -1 || genoIdx === -1) return new Map();

  const grouped = new Map<string, PharmGkbAlleleAnnotation[]>();
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const values = splitTsv(lines[i]);
    const id = (values[idIdx] ?? "").trim();
    if (!id) continue;
    const normalized = normalizePharmgkbAllele(values[genoIdx] ?? "");
    if (!normalized) continue;
    const annotationText = textIdx >= 0 ? (values[textIdx] ?? "").trim() : "";
    const dedupeKey = [id, normalized.genotype ?? "", normalized.riskAllele ?? "", annotationText].join("\0");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const existing = grouped.get(id);
    const entry = { ...normalized, annotationText: annotationText || null };
    if (existing) existing.push(entry);
    else grouped.set(id, [entry]);
  }
  return grouped;
}

function parseClinicalAnnotationsTsv(text: string, alleleAnnotationMap: Map<string, PharmGkbAlleleAnnotation[]>): PharmGkbAnnotation[] {
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
    const alleleAnnotations = alleleAnnotationMap.get(variantId) ?? [];

    for (const alleleAnnotation of alleleAnnotations) {
      results.push({
        variantId,
        rsid,
        gene,
        drugs,
        phenotypeCategory,
        evidenceLevel: level,
        significance,
        pmids,
        url,
        ...alleleAnnotation,
      });
    }
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
  const alleleAnnotationMap = allelesBytes
    ? buildAlleleAnnotationMap(new TextDecoder().decode(allelesBytes))
    : new Map<string, PharmGkbAlleleAnnotation[]>();

  if (allelesBytes) {
    const alleleAnnotationCount = Array.from(alleleAnnotationMap.values()).reduce((sum, entries) => sum + entries.length, 0);
    console.log(`PharmGKB: parsed allele annotation data (${alleleAnnotationCount.toLocaleString()} genotype/allele rows identified).`);
  } else {
    console.log("PharmGKB: no allele annotation file found in ZIP; genotype-specific records will not be set.");
  }

  const text = new TextDecoder().decode(tsvBytes);
  const annotations = parseClinicalAnnotationsTsv(text, alleleAnnotationMap);

  await writeFile(annotationsFile, `${JSON.stringify(annotations, null, 2)}\n`);
  console.log(`PharmGKB: ${annotations.length.toLocaleString()} level 1A–2B annotations written to ${path.relative(repoRoot, annotationsFile)}`);
}

runCli(import.meta.url, main);
