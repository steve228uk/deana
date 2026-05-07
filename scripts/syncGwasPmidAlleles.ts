import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { column, extractRsids, splitCsv, splitTsv, tsvRows } from "./tsvUtils";
import { runCli } from "./scriptUtils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");
const gwasFile = path.join(cacheRoot, "gwas", "associations.tsv");
const cacheDir = path.join(cacheRoot, "gwas", "pmid-alleles");
const resolvedFile = path.join(cacheDir, "resolved.json");
const manifestFile = path.join(cacheDir, "manifest.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; deana-gwas-pmid-allele-sync/1.0; +https://github.com/DeanaDNA/deana)";

interface Options {
  force: boolean;
  maxPmids: number;
  pmids: Set<string>;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    force: false,
    maxPmids: Number.parseInt(process.env.GWAS_PMID_ALLELE_MAX_PMIDS ?? "100", 10),
    pmids: new Set(),
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("--max-pmids=")) {
      options.maxPmids = Number.parseInt(arg.slice("--max-pmids=".length), 10);
      continue;
    }
    if (arg.startsWith("--pmid=")) {
      options.pmids.add(arg.slice("--pmid=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.maxPmids) || options.maxPmids < 0) {
    throw new Error("--max-pmids must be a non-negative integer.");
  }

  return options;
}

export interface GwasPmidAlleleCandidate {
  pmid: string;
  rsid: string;
  trait: string;
  studyAccession?: string;
  strongestAllele: string;
}

export interface ResolvedGwasPmidAllele {
  pmid: string;
  rsid: string;
  riskAllele: string;
  sourceType: "pmc-table" | "supplement-table" | "summary-statistics";
  sourceUrl: string;
  sourceLabel: string;
  studyAccession?: string;
  trait?: string;
  confidence: "structured-table";
}

export interface StructuredSource {
  sourceType: ResolvedGwasPmidAllele["sourceType"];
  sourceUrl: string;
  sourceLabel: string;
  text: string;
}

export interface ParsedAlleleEvidence {
  rsid: string;
  riskAllele: string;
  sourceType: ResolvedGwasPmidAllele["sourceType"];
  sourceUrl: string;
  sourceLabel: string;
}

function includeGwas(row: Record<string, string>): boolean {
  const pValue = Number(column(row, ["P-VALUE"]));
  return Number.isFinite(pValue) && pValue > 0 && pValue <= 5e-8;
}

function singleBaseAllele(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[ACGT]$/.test(normalized) ? normalized : null;
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function gwasRiskAllelesByRsid(strongestAllele: string): Map<string, string> {
  const alleles = new Map<string, string>();
  for (const match of strongestAllele.matchAll(/\b(rs\d+)-([ACGT])\b/gi)) {
    alleles.set(match[1].toLowerCase(), match[2].toUpperCase());
  }
  return alleles;
}

export function candidateRowsFromGwasRow(row: Record<string, string>): GwasPmidAlleleCandidate[] {
  if (!includeGwas(row)) return [];

  const pmid = column(row, ["PUBMEDID", "PUBMED ID"]);
  if (!pmid) return [];

  const strongestAllele = column(row, ["STRONGEST SNP-RISK ALLELE"]);
  const rsids = extractRsids([
    column(row, ["SNPS", "SNP_ID_CURRENT", "SNP_ID"]),
    strongestAllele,
  ].join(" "));
  if (rsids.length === 0) return [];

  const knownRiskAlleles = gwasRiskAllelesByRsid(strongestAllele);
  const trait = column(row, ["MAPPED_TRAIT", "DISEASE/TRAIT"]) || "GWAS association";
  const studyAccession = column(row, ["STUDY ACCESSION"]);

  return rsids
    .filter((rsid) => !knownRiskAlleles.has(rsid))
    .map((rsid) => ({
      pmid,
      rsid,
      trait,
      studyAccession: studyAccession || undefined,
      strongestAllele,
    }));
}

export async function collectGwasPmidAlleleCandidates(filePath = gwasFile): Promise<GwasPmidAlleleCandidate[]> {
  if (!existsSync(filePath)) return [];

  const seen = new Map<string, GwasPmidAlleleCandidate>();
  for await (const row of tsvRows(filePath)) {
    for (const candidate of candidateRowsFromGwasRow(row)) {
      const key = [
        candidate.pmid,
        candidate.rsid,
        candidate.trait,
        candidate.studyAccession ?? "",
      ].join("\0");
      if (!seen.has(key)) seen.set(key, candidate);
    }
  }
  return Array.from(seen.values());
}

function decodeEntities(value: string): string {
  return value
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number.parseInt(dec, 10)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ").trim());
}

function tableRowsFromMarkup(text: string): string[][] {
  const rows: string[][] = [];
  for (const tableMatch of text.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const table = tableMatch[0];
    for (const rowMatch of table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const row = rowMatch[0];
      const cells = Array.from(row.matchAll(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi), (cell) => stripTags(cell[0]))
        .filter(Boolean);
      if (cells.length > 0) rows.push(cells);
    }
  }
  return rows;
}

function delimitedRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  if (lines[0].includes("\t")) {
    return lines.map((line) => splitTsv(line));
  }
  if (lines[0].includes(",")) {
    return lines.map((line) => splitCsv(line));
  }
  return [];
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}

function rsidColumnIndexes(headers: string[]): number[] {
  return headers
    .map((header, index) => ({ header: normalizeHeader(header), index }))
    .filter(({ header }) =>
      header === "rsid" ||
      /\brs\b/.test(header) ||
      /\bsnp\b/.test(header) ||
      /\bvariant\b/.test(header) ||
      /\bmarker\b/.test(header)
    )
    .map(({ index }) => index);
}

function alleleColumnIndexes(headers: string[]): number[] {
  return headers
    .map((header, index) => ({ header: normalizeHeader(header), index }))
    .filter(({ header }) =>
      header === "a1" ||
      header === "effect allele" ||
      header === "risk allele" ||
      header === "tested allele" ||
      header === "coded allele" ||
      header === "alt" ||
      header === "alt allele" ||
      header === "alternate allele"
    )
    .map(({ index }) => index);
}

function rowsFromStructuredText(text: string): string[][] {
  const jsonRows = rowsFromJson(text);
  if (jsonRows.length > 0) return jsonRows;
  const markupRows = tableRowsFromMarkup(text);
  if (markupRows.length > 0) return markupRows;
  return delimitedRows(text);
}

function objectRowsFromUnknown(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.every((item) => item && typeof item === "object" && !Array.isArray(item))
      ? value as Array<Record<string, unknown>>
      : [];
  }
  if (!value || typeof value !== "object") return [];
  for (const child of Object.values(value)) {
    const rows = objectRowsFromUnknown(child);
    if (rows.length > 0) return rows;
  }
  return [];
}

function rowsFromJson(text: string): string[][] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];

  try {
    const objectRows = objectRowsFromUnknown(JSON.parse(trimmed));
    if (objectRows.length === 0) return [];
    const headers = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));
    if (headers.length === 0) return [];
    return [
      headers,
      ...objectRows.map((row) => headers.map((header) => {
        const value = row[header];
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
      })),
    ];
  } catch {
    return [];
  }
}

function resolveEvidenceFromRows(rows: string[][], source: Omit<StructuredSource, "text">): ParsedAlleleEvidence[] {
  if (rows.length < 2) return [];

  const [headers, ...bodyRows] = rows;
  const rsidColumns = rsidColumnIndexes(headers);
  const alleleColumns = alleleColumnIndexes(headers);
  if (rsidColumns.length === 0 || alleleColumns.length === 0) return [];

  const resolved: ParsedAlleleEvidence[] = [];
  for (const row of bodyRows) {
    const rsidColumnText = rsidColumns.map((index) => row[index] ?? "").join(" ");
    const candidateRsids = extractRsids(rsidColumnText);
    const rsids = candidateRsids.length > 0 ? candidateRsids : extractRsids(row.join(" "));
    if (rsids.length === 0) continue;

    for (const alleleIndex of alleleColumns) {
      const riskAllele = singleBaseAllele(row[alleleIndex]);
      if (!riskAllele) continue;
      for (const rsid of rsids) {
        resolved.push({
          rsid,
          riskAllele,
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
          sourceLabel: source.sourceLabel,
        });
      }
    }
  }

  return resolved;
}

export function parseStructuredAlleleEvidence(source: StructuredSource): ParsedAlleleEvidence[] {
  return resolveEvidenceFromRows(rowsFromStructuredText(source.text), source);
}

export function resolveCandidatesFromStructuredSources(
  candidates: GwasPmidAlleleCandidate[],
  sources: StructuredSource[],
): { resolved: ResolvedGwasPmidAllele[]; conflicts: Array<{ pmid: string; rsid: string; alleles: string[] }> } {
  const candidatesByRsid = new Map<string, GwasPmidAlleleCandidate[]>();
  for (const candidate of candidates) {
    pushMapValue(candidatesByRsid, candidate.rsid, candidate);
  }

  const evidenceByRsid = new Map<string, ParsedAlleleEvidence[]>();
  for (const source of sources) {
    for (const evidence of parseStructuredAlleleEvidence(source)) {
      if (!candidatesByRsid.has(evidence.rsid)) continue;
      pushMapValue(evidenceByRsid, evidence.rsid, evidence);
    }
  }

  const resolved: ResolvedGwasPmidAllele[] = [];
  const conflicts: Array<{ pmid: string; rsid: string; alleles: string[] }> = [];
  for (const [rsid, candidatesForRsid] of candidatesByRsid) {
    const evidence = evidenceByRsid.get(rsid) ?? [];
    const alleles = Array.from(new Set(evidence.map((item) => item.riskAllele)));
    if (alleles.length === 0) continue;

    const pmid = candidatesForRsid[0].pmid;
    if (alleles.length > 1) {
      conflicts.push({ pmid, rsid, alleles });
      continue;
    }

    const selected = evidence.find((item) => item.riskAllele === alleles[0]);
    if (!selected) continue;
    for (const candidate of candidatesForRsid) {
      resolved.push({
        pmid: candidate.pmid,
        rsid,
        riskAllele: alleles[0],
        sourceType: selected.sourceType,
        sourceUrl: selected.sourceUrl,
        sourceLabel: selected.sourceLabel,
        studyAccession: candidate.studyAccession,
        trait: candidate.trait,
        confidence: "structured-table",
      });
    }
  }

  return { resolved, conflicts };
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) return null;
  return await response.text();
}

function addStructuredSource(
  sources: StructuredSource[],
  text: string | null,
  source: Omit<StructuredSource, "text">,
): void {
  if (!text) return;
  sources.push({ ...source, text });
}

async function pmcIdsForPmid(pmid: string): Promise<string[]> {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=pubmed&db=pmc&id=${encodeURIComponent(pmid)}&retmode=json`;
  const text = await fetchText(url, "application/json");
  if (!text) return [];

  const json = JSON.parse(text) as {
    linksets?: Array<{ linksetdbs?: Array<{ links?: string[] }> }>;
  };
  return Array.from(new Set(
    json.linksets
      ?.flatMap((linkSet) => linkSet.linksetdbs ?? [])
      .flatMap((db) => db.links ?? [])
      .map((id) => `PMC${id}`) ?? [],
  ));
}

async function structuredSourcesForCandidateGroup(
  pmid: string,
  studyAccessions: string[],
): Promise<StructuredSource[]> {
  const sources: StructuredSource[] = [];

  for (const pmcId of await pmcIdsForPmid(pmid)) {
    const numericId = pmcId.replace(/^PMC/i, "");
    const xmlUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${numericId}&retmode=xml`;
    const xml = await fetchText(xmlUrl, "application/xml,text/xml,*/*");
    addStructuredSource(sources, xml, {
      sourceType: "pmc-table",
      sourceUrl: xmlUrl,
      sourceLabel: `${pmcId} full-text XML`,
    });

    const europePmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcId}/fullTextXML`;
    const europePmcXml = await fetchText(europePmcUrl, "application/xml,text/xml,*/*");
    addStructuredSource(sources, europePmcXml, {
      sourceType: "pmc-table",
      sourceUrl: europePmcUrl,
      sourceLabel: `${pmcId} Europe PMC full-text XML`,
    });
  }

  const supplementUrls = await supplementaryFileUrlsForPmid(pmid);
  for (const url of supplementUrls) {
    if (!/\.(?:txt|tsv|csv|xml|html?)($|\?)/i.test(url)) continue;
    const text = await fetchText(url, "text/tab-separated-values,text/csv,text/plain,application/xml,text/xml,text/html,*/*");
    addStructuredSource(sources, text, {
      sourceType: "supplement-table",
      sourceUrl: url,
      sourceLabel: `PMID ${pmid} supplementary file`,
    });
  }

  for (const accession of studyAccessions) {
    const summaryUrl = `https://www.ebi.ac.uk/gwas/summary-statistics/api/studies/${encodeURIComponent(accession)}/associations`;
    const text = await fetchText(summaryUrl, "application/json,text/tab-separated-values,text/plain,*/*");
    addStructuredSource(sources, text, {
      sourceType: "summary-statistics",
      sourceUrl: summaryUrl,
      sourceLabel: `${accession} GWAS Catalog summary statistics`,
    });
  }

  return sources;
}

async function supplementaryFileUrlsForPmid(pmid: string): Promise<string[]> {
  const urls = [
    `https://www.ebi.ac.uk/europepmc/webservices/rest/MED/${encodeURIComponent(pmid)}/supplementaryFiles`,
  ];
  const found: string[] = [];
  for (const url of urls) {
    const text = await fetchText(url, "application/json,application/xml,text/xml,*/*");
    if (!text) continue;
    found.push(...Array.from(text.matchAll(/https?:\/\/[^"'<>\s]+/g), (match) => decodeEntities(match[0])));
  }
  return Array.from(new Set(found));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options.force && existsSync(resolvedFile)) {
    console.log("Using cached GWAS PMID allele resolutions (pass --force to refresh).");
    return;
  }

  await mkdir(cacheDir, { recursive: true });

  const allCandidates = await collectGwasPmidAlleleCandidates();
  const candidates = options.pmids.size > 0
    ? allCandidates.filter((candidate) => options.pmids.has(candidate.pmid))
    : allCandidates;
  const candidatesByPmid = new Map<string, GwasPmidAlleleCandidate[]>();
  for (const candidate of candidates) {
    pushMapValue(candidatesByPmid, candidate.pmid, candidate);
  }

  const pmidEntries = Array.from(candidatesByPmid.entries())
    .slice(0, options.maxPmids === 0 ? undefined : options.maxPmids);

  const allResolved: ResolvedGwasPmidAllele[] = [];
  const allConflicts: Array<{ pmid: string; rsid: string; alleles: string[] }> = [];
  for (const [pmid, pmidCandidates] of pmidEntries) {
    const studyAccessions = Array.from(new Set(
      pmidCandidates.map((candidate) => candidate.studyAccession).filter((value): value is string => Boolean(value)),
    ));
    const sources = await structuredSourcesForCandidateGroup(pmid, studyAccessions);
    const { resolved, conflicts } = resolveCandidatesFromStructuredSources(pmidCandidates, sources);
    allResolved.push(...resolved);
    allConflicts.push(...conflicts);
  }

  allResolved.sort((left, right) =>
    `${left.pmid}|${left.rsid}|${left.trait ?? ""}`.localeCompare(`${right.pmid}|${right.rsid}|${right.trait ?? ""}`),
  );

  await writeFile(resolvedFile, `${JSON.stringify(allResolved, null, 2)}\n`);
  await writeFile(manifestFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    pmidCount: candidatesByPmid.size,
    processedPmidCount: pmidEntries.length,
    maxPmids: options.maxPmids,
    resolvedCount: allResolved.length,
    conflictCount: allConflicts.length,
    conflicts: allConflicts.slice(0, 100),
  }, null, 2)}\n`);

  console.log(`GWAS PMID allele candidates: ${candidates.length.toLocaleString()} across ${candidatesByPmid.size.toLocaleString()} PMIDs.`);
  console.log(`GWAS PMID allele PMIDs processed: ${pmidEntries.length.toLocaleString()}${options.maxPmids === 0 ? "" : ` (max ${options.maxPmids.toLocaleString()})`}.`);
  console.log(`GWAS PMID allele resolutions: ${allResolved.length.toLocaleString()}.`);
  if (allConflicts.length > 0) {
    console.log(`GWAS PMID allele conflicts skipped: ${allConflicts.length.toLocaleString()}.`);
  }
}

runCli(import.meta.url, main);
