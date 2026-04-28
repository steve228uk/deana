import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type {
  EvidencePackManifest,
  EvidencePackRecord,
  EvidenceSourceRole,
  EvidenceTier,
  GenomeBuild,
  InsightCategory,
  ReputeStatus,
} from "../src/types";
import { normalizeConditions } from "../src/lib/normalization";
import { normalizeChromosome } from "../src/lib/dbsnpAnnotation";
import { column, extractPmids, extractRsids, normalizeRsid, riskSummaryForClinvar, riskSummaryForGwas, singleBaseAllele, splitTsv, tsvRows } from "./tsvUtils";
import { DEFINITION_MARKERS, DEFINITION_TITLES } from "./definitionMarkers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");
const packRoot = path.join(repoRoot, "public", "evidence-packs");
const schemaVersion = 1;
const shardModulo = 256;
const dbsnpSources: Record<GenomeBuild, { path: string; url: string }> = {
  GRCh37: {
    path: path.join(cacheRoot, "dbsnp", "GRCh37", "dbsnp.vcf.gz"),
    url: "https://ftp.ncbi.nlm.nih.gov/refseq/H_sapiens/annotation/GRCh37_latest/refseq_identifiers/GRCh37_latest_dbSNP_all.vcf.gz",
  },
  GRCh38: {
    path: path.join(cacheRoot, "dbsnp", "GRCh38", "dbsnp.vcf.gz"),
    url: "https://ftp.ncbi.nlm.nih.gov/refseq/H_sapiens/annotation/GRCh38_latest/refseq_identifiers/GRCh38_latest_dbSNP_all.vcf.gz",
  },
};

function dbsnpSourceReady(build: GenomeBuild): boolean {
  const source = dbsnpSources[build];
  return existsSync(source.path) && existsSync(`${source.path}.complete`);
}
const defaultVersion = (() => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-core`;
})();

const attribution =
  "Local Deana evidence pack built from public ClinVar, CPIC, GWAS Catalog, PharmGKB, PubMed citation metadata, and gnomAD context. User marker IDs and genotypes are matched locally in the browser.";

const sourceMetadata: EvidencePackManifest["sources"] = [
  {
    id: "clinvar",
    name: "ClinVar",
    release: "ClinVar variant_summary bulk TSV",
    url: "https://www.ncbi.nlm.nih.gov/clinvar/docs/downloads/",
    role: "primary",
  },
  {
    id: "gwas",
    name: "GWAS Catalog",
    release: "GWAS Catalog association export",
    url: "https://www.ebi.ac.uk/gwas/downloads",
    role: "primary",
  },
  {
    id: "cpic",
    name: "CPIC",
    release: "CPIC API variant and pair data",
    url: "https://cpicpgx.org/api-and-database/",
    role: "primary",
  },
  {
    id: "pharmgkb",
    name: "PharmGKB",
    release: "PharmGKB clinical annotations bulk download",
    url: "https://www.pharmgkb.org/downloads",
    role: "primary",
  },
  {
    id: "pubmed",
    name: "PubMed",
    release: "PubMed citation metadata carried by source rows",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK25497/",
    role: "citation",
  },
  {
    id: "gnomad",
    name: "gnomAD",
    release: "Curated gnomAD context from Deana seed pack",
    url: "https://gnomad.broadinstitute.org/",
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

interface Options {
  version: string;
  check: boolean;
  maxClinvarRecords: number;
  maxGwasRecords: number;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    version: defaultVersion,
    check: false,
    maxClinvarRecords: 100000,
    maxGwasRecords: 100000,
  };

  for (const arg of argv) {
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
      continue;
    }
    if (arg.startsWith("--max-clinvar-records=")) {
      options.maxClinvarRecords = Number.parseInt(arg.slice("--max-clinvar-records=".length), 10);
      continue;
    }
    if (arg.startsWith("--max-gwas-records=")) {
      options.maxGwasRecords = Number.parseInt(arg.slice("--max-gwas-records=".length), 10);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}-core$/.test(options.version)) {
    throw new Error(`Evidence-pack version must match YYYY-MM-core: ${options.version}`);
  }

  return options;
}


function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileSha256(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const digest = createHash("sha256");
  const reader = file.stream().getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    digest.update(value);
  }
  return digest.digest("hex");
}

function recordText(records: EvidencePackRecord[]): string {
  return `${JSON.stringify(records.sort((left, right) => left.id.localeCompare(right.id)))}\n`;
}

function annotationText(rows: DbsnpAnnotationRow[]): string {
  return `${JSON.stringify(rows.sort((left, right) =>
    left[0].localeCompare(right[0]) ||
    left[1] - right[1] ||
    left[2].localeCompare(right[2]) ||
    left[3].localeCompare(right[3]),
  ))}\n`;
}

function rsidBucket(rsid: string): number {
  const numeric = Number.parseInt(rsid.replace(/^rs/i, ""), 10);
  if (Number.isFinite(numeric)) return numeric % shardModulo;
  let hash = 0;
  for (const char of rsid.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % shardModulo;
}

function sourceRole(sourceId: string): EvidenceSourceRole {
  if (sourceId === "gnomad") return "frequency-context";
  if (sourceId === "pubmed") return "citation";
  if (sourceId === "snpedia") return "supplementary";
  return "primary";
}

type DbsnpAnnotationRow = [chromosome: string, position: number, ref: string, alt: string, rsids: string[]];


function evidenceRsids(records: EvidencePackRecord[]): string[] {
  return Array.from(new Set(records.flatMap((record) => record.markerIds).map(normalizeRsid).filter(Boolean) as string[]))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function queryDbsnpRows(build: GenomeBuild, rsidFile: string, wantedRsids: Set<string>): Promise<DbsnpAnnotationRow[]> {
  const source = dbsnpSources[build];
  const child = spawn("bcftools", [
    "query",
    "-i",
    `ID=@${rsidFile}`,
    "-f",
    "%CHROM\\t%POS\\t%ID\\t%REF\\t%ALT\\n",
    source.path,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const rows = new Map<string, DbsnpAnnotationRow>();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    const [chromosomeRaw, positionRaw, idsRaw, refRaw, altRaw] = line.split("\t");
    const chromosome = normalizeChromosome(chromosomeRaw ?? "");
    const position = Number(positionRaw);
    const ref = singleBaseAllele(refRaw ?? "");
    if (!chromosome || !Number.isFinite(position) || !ref) continue;

    const rsids = (idsRaw ?? "")
      .split(/[;,]/)
      .map(normalizeRsid)
      .filter((rsid): rsid is string => Boolean(rsid && wantedRsids.has(rsid)));
    if (rsids.length === 0) continue;

    for (const altValue of (altRaw ?? "").split(",")) {
      const alt = singleBaseAllele(altValue);
      if (!alt) continue;
      const key = [chromosome, position, ref, alt].join(":");
      const existing = rows.get(key);
      if (existing) {
        existing[4] = Array.from(new Set([...existing[4], ...rsids])).sort();
      } else {
        rows.set(key, [chromosome, position, ref, alt, Array.from(new Set(rsids)).sort()]);
      }
    }
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`bcftools dbSNP query failed for ${build}: ${stderr.trim() || `exit ${exitCode}`}`);
  }

  return Array.from(rows.values());
}

async function buildAnnotationIndexes(
  records: EvidencePackRecord[],
  targetDir: string,
  check: boolean,
  existingManifest: Partial<EvidencePackManifest> | null,
): Promise<{ indexes: NonNullable<EvidencePackManifest["annotationIndexes"]>; changed: boolean }> {
  const rsids = evidenceRsids(records);
  const wantedRsids = new Set(rsids);
  const rsidFile = path.join(cacheRoot, "dbsnp", "current-evidence-rsids.txt");
  await mkdir(path.dirname(rsidFile), { recursive: true });
  await writeFile(rsidFile, `${rsids.join("\n")}\n`);

  const indexes: NonNullable<EvidencePackManifest["annotationIndexes"]> = [];
  let changed = false;
  let usedCachedManifest = false;

  for (const build of ["GRCh37", "GRCh38"] as const) {
    const source = dbsnpSources[build];
    if (!dbsnpSourceReady(build)) {
      const existing = existingManifest?.annotationIndexes?.find((index) => index.build === build);
      if (existing) {
        indexes.push(existing);
        usedCachedManifest = true;
      }
      continue;
    }

    const rows = await queryDbsnpRows(build, rsidFile, wantedRsids);
    const matchedRsids = new Set(rows.flatMap((row) => row[4]));
    const recordsPath = `annotation/dbsnp-${build.toLowerCase()}.json`;
    const text = annotationText(rows);
    changed = (await writeIfChanged(path.join(targetDir, recordsPath), text, check)) || changed;
    indexes.push({
      build,
      recordsPath,
      recordsSha256: sha256(text),
      recordCount: rows.length,
      matchedRsidCount: matchedRsids.size,
      missingRsidCount: Math.max(0, rsids.length - matchedRsids.size),
      sourcePath: path.relative(repoRoot, source.path),
    });
  }

  if (usedCachedManifest) {
    console.log("dbSNP source cache missing for one or more builds; preserving existing annotation manifest entries.");
  }

  return { indexes, changed };
}

function categoryForClinvar(significance: string): InsightCategory {
  return /drug response|pharmacogen/i.test(significance) ? "drug" : "medical";
}

function evidenceForClinvar(reviewStatus: string, significance: string): EvidenceTier {
  if (/practice guideline|reviewed by expert panel|criteria provided, multiple submitters, no conflicts/i.test(reviewStatus)) {
    return "high";
  }
  if (/pathogenic|risk factor|drug response|affects/i.test(significance)) return "moderate";
  return "emerging";
}

function reputeForSignificance(significance: string): ReputeStatus {
  if (/pathogenic|risk factor|drug response|affects/i.test(significance)) return "bad";
  if (/protective/i.test(significance)) return "good";
  if (/conflicting/i.test(significance)) return "mixed";
  return "not-set";
}

function includeClinvar(significance: string, reviewStatus: string): boolean {
  const lower = `${significance} ${reviewStatus}`.toLowerCase();
  if (!significance || /not provided|not specified|no assertion|uncertain significance|benign|likely benign/i.test(lower)) {
    return false;
  }
  return /pathogenic|risk factor|drug response|affects|association|protective|conflicting/i.test(lower);
}

function cleanCondition(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned || /^not (provided|specified)$/i.test(cleaned) || /^see cases$/i.test(cleaned)) return null;
  return cleaned.replace(/\s+/g, " ");
}

function conditionList(value: string): string[] {
  return normalizeConditions(Array.from(
    new Set(
      value
        .split(/[|;]/)
        .map(cleanCondition)
        .filter((condition): condition is string => Boolean(condition)),
    ),
  )).slice(0, 8);
}

function primaryCondition(conditions: string[], fallback: string): string {
  return conditions.find((condition) => !/related disorder|inborn genetic diseases|neoplasm/i.test(condition)) ?? conditions[0] ?? fallback;
}

function plainClinvarTitle(gene: string, significance: string, conditions: string[], category: InsightCategory): string {
  const condition = primaryCondition(conditions, "a ClinVar condition");
  if (category === "drug") {
    return `${gene} drug-response variant`;
  }
  if (/conflicting/i.test(significance)) {
    return `${gene} variant with conflicting ClinVar classifications for ${condition}`;
  }
  if (/protective/i.test(significance)) {
    return `${gene} variant reported as protective for ${condition}`;
  }
  if (/risk factor|association/i.test(significance)) {
    return `${gene} variant associated with ${condition}`;
  }
  return `${gene} variant reported for ${condition}`;
}


function clinvarRecord(row: Record<string, string>): EvidencePackRecord | null {
  const rawRsid = column(row, ["RS# (dbSNP)", "RS#"]);
  if (!rawRsid || rawRsid === "-1") return null;
  const rsid = normalizeRsid(rawRsid.startsWith("rs") ? rawRsid : `rs${rawRsid}`);
  if (!rsid) return null;

  const significance = column(row, ["ClinicalSignificance"]);
  const reviewStatus = column(row, ["ReviewStatus"]);
  if (!includeClinvar(significance, reviewStatus)) return null;

  const variationId = column(row, ["VariationID", "AlleleID"]) || rawRsid;
  const gene = column(row, ["GeneSymbol"]) || "Unknown";
  const technicalName = column(row, ["Name"]) || `${rsid} ClinVar variant`;
  const traits = conditionList(column(row, ["PhenotypeList"]));
  const category = categoryForClinvar(significance);
  const condition = primaryCondition(traits, "the reported condition");
  const riskAllele = singleBaseAllele(column(row, ["AlternateAlleleVCF", "AlternateAllele"]));
  const title = plainClinvarTitle(gene, significance, traits, category);
  const pmids = extractPmids(column(row, ["OtherIDs"]));
  const numSubmitters = column(row, ["NumberSubmitters"]);
  const lastEvaluated = column(row, ["LastEvaluated"]);

  const submitterNote = numSubmitters && numSubmitters !== "0"
    ? `${numSubmitters} submitter${numSubmitters === "1" ? "" : "s"}.`
    : null;

  return {
    id: `clinvar-${variationId}-${rsid}`,
    entryId: `local-${category}-clinvar-${variationId}`,
    sourceId: "clinvar",
    role: "primary",
    category,
    subcategory: category === "drug" ? "pharmacogenomics" : "clinical-variant",
    markerIds: [rsid],
    genes: [gene],
    title,
    technicalName,
    summary: `ClinVar classifies this ${gene} variant as ${significance.toLowerCase()} for ${condition}.`,
    detail: `ClinVar reports ${significance} for ${technicalName}.`,
    whyItMatters: `This is source-reviewed clinical context for ${condition}; Deana only surfaces it when the uploaded genotype matches the reported allele where ClinVar provides one.`,
    topics: ["ClinVar", "Clinical variant"],
    conditions: traits,
    url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`,
    release: "ClinVar variant_summary bulk TSV",
    evidenceLevel: evidenceForClinvar(reviewStatus, significance),
    clinicalSignificance: significance,
    repute: reputeForSignificance(significance),
    tone: category === "drug" ? "caution" : "neutral",
    riskAllele,
    riskSummary: /reviewed by expert panel|practice guideline/i.test(reviewStatus)
      ? riskSummaryForClinvar(gene, significance, condition)
      : undefined,
    qualityTier: /reviewed by expert panel|practice guideline/i.test(reviewStatus) ? "tier-1" : undefined,
    pmids,
    notes: [
      `Review status: ${reviewStatus || "not supplied"}.`,
      ...(submitterNote ? [submitterNote] : []),
      ...(lastEvaluated && lastEvaluated !== "-" ? [`Last evaluated: ${lastEvaluated}.`] : []),
      ...(riskAllele ? [`Reported alternate allele: ${riskAllele}.`] : []),
      "Generated from bulk ClinVar data; clinical interpretation requires human review and confirmatory testing.",
    ],
  };
}

function includeGwas(row: Record<string, string>): boolean {
  const pValueRaw = column(row, ["P-VALUE"]);
  const pValue = Number(pValueRaw);
  return Number.isFinite(pValue) && pValue > 0 && pValue <= 5e-8;
}

function gwasEvidenceTier(pValue: number): EvidenceTier {
  return pValue <= 1e-10 ? "high" : "moderate";
}

function gwasRepute(orBeta: number): ReputeStatus {
  if (orBeta > 1.05) return "bad";
  if (orBeta < 0.95 && orBeta > 0) return "good";
  return "not-set";
}

function normalizeGwasUrl(raw: string): string {
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function gwasRecords(row: Record<string, string>, index: number): EvidencePackRecord[] {
  if (!includeGwas(row)) return [];
  const rsids = extractRsids([
    column(row, ["SNPS", "SNP_ID_CURRENT", "SNP_ID"]),
    column(row, ["STRONGEST SNP-RISK ALLELE"]),
  ].join(" "));
  if (rsids.length === 0) return [];

  const trait = column(row, ["MAPPED_TRAIT", "DISEASE/TRAIT"]) || "GWAS association";
  const mappedGene = column(row, ["MAPPED_GENE", "REPORTED GENE(S)"]) || "Unknown";
  const pmid = column(row, ["PUBMEDID", "PUBMED ID"]);
  const strongestAllele = column(row, ["STRONGEST SNP-RISK ALLELE"]);
  const riskAllele = singleBaseAllele(strongestAllele.split("-").pop() ?? "");

  const pValue = Number(column(row, ["P-VALUE"]));
  const orBetaRaw = column(row, ["OR or BETA"]);
  const orBeta = Number(orBetaRaw);
  const ci = column(row, ["95% CI (TEXT)"]);
  const sampleSize = column(row, ["INITIAL SAMPLE SIZE"]);
  const firstAuthor = column(row, ["FIRST AUTHOR"]);
  const journal = column(row, ["JOURNAL"]);
  const date = column(row, ["DATE"]);
  const studyAccession = column(row, ["STUDY ACCESSION"]);
  const riskAlleleFreq = column(row, ["RISK ALLELE FREQUENCY"]);

  const genes = Array.from(new Set(
    mappedGene.split(/[;,]/).map((g) => g.trim()).filter(Boolean),
  )).slice(0, 5);

  const rawUrl = column(row, ["LINK"]);

  const detailParts: string[] = [
    `GWAS Catalog association with p=${pValue}.`,
  ];
  if (orBetaRaw && Number.isFinite(orBeta)) {
    detailParts.push(`Effect: OR/Beta=${orBetaRaw}${ci ? ` ${ci}` : ""}.`);
  }
  if (sampleSize) {
    detailParts.push(`Initial sample: ${sampleSize}.`);
  }

  const citationNote = [firstAuthor, journal, date].filter(Boolean).join(", ");
  const notes: string[] = [
    `Risk allele: ${strongestAllele || "not supplied"}.`,
    ...(citationNote ? [`Study: ${citationNote}.`] : []),
    ...(studyAccession ? [`GWAS Catalog accession: ${studyAccession}.`] : []),
    "Generated from bulk GWAS Catalog data; effect size and ancestry transferability require review.",
  ];

  const frequencyNote =
    riskAlleleFreq && riskAlleleFreq !== "NR"
      ? `Risk allele frequency in study: ${riskAlleleFreq}`
      : undefined;

  const isTier1Gwas = pValue <= 1e-10 && Boolean(column(row, ["REPLICATION SAMPLE SIZE"])) && Number.isFinite(orBeta);
  const gwasRiskSummary = isTier1Gwas ? riskSummaryForGwas(genes[0] ?? mappedGene, trait, orBeta, ci) : undefined;

  return rsids.map((rsid) => ({
    id: `gwas-${rsid}-${index}`,
    entryId: `local-trait-gwas-${rsid}-${index}`,
    sourceId: "gwas",
    role: "primary",
    category: "traits" as const,
    subcategory: "association",
    markerIds: [rsid],
    genes,
    title: `${trait} association near ${genes[0] || rsid}`,
    technicalName: `${rsid} ${trait}`,
    summary: `GWAS Catalog links ${riskAllele ? `${rsid}-${riskAllele}` : rsid} with ${trait}.`,
    detail: detailParts.join(" "),
    whyItMatters: "This common-variant association is matched locally against the uploaded genotype and should be treated as a tendency signal, not a prediction.",
    topics: ["GWAS", "Association"],
    conditions: trait.split(",").map((v) => v.trim()).filter(Boolean),
    url: normalizeGwasUrl(rawUrl) || `https://www.ebi.ac.uk/gwas/search?query=${encodeURIComponent(rsid)}`,
    release: "GWAS Catalog association export",
    evidenceLevel: gwasEvidenceTier(pValue),
    clinicalSignificance: "trait-association",
    repute: Number.isFinite(orBeta) ? gwasRepute(orBeta) : "not-set",
    riskAllele,
    riskSummary: gwasRiskSummary,
    qualityTier: isTier1Gwas ? "tier-1" : undefined,
    pmids: pmid ? [pmid] : [],
    frequencyNote,
    notes,
  }));
}

interface CachedSnpediaPage {
  title: string;
  content: string;
  timestamp?: string;
}

function snpediaPageKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function templateValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`\\|${key}=([^\\n]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function cleanWikiText(value: string): string {
  return value
    .replace(/\{\{[^{}]+\}\}/g, " ")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraphs(content: string, count: number): string {
  const body = content.replace(/\{\{[\s\S]*?\}\}\s*/u, "").trim();
  if (!body) return "";
  return body
    .split(/\n{2,}/)
    .map((chunk) => cleanWikiText(chunk))
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function snpediaGenotypeFromTitle(title: string): { rsid: string; genotype: string } | null {
  const match = title.match(/^(rs\d+)\(([ACGT]);([ACGT])\)$/i);
  if (!match) return null;
  return {
    rsid: match[1].toLowerCase(),
    genotype: [match[2], match[3]].sort().join("").toUpperCase(),
  };
}

function parseSnpediaGenes(content: string): string[] {
  const genes = new Set<string>();
  for (const match of content.matchAll(/\[\[([A-Z0-9-]{2,})\]\]\s+gene/gu)) {
    genes.add(match[1]);
  }
  return [...genes];
}

function parseSnpediaPmids(content: string): string[] {
  return Array.from(new Set(Array.from(content.matchAll(/\{\{PMID\|?(\d+)\}\}/gi), (match) => match[1])));
}

function parseSnpediaRepute(raw: string | null): ReputeStatus {
  if (!raw) return "not-set";
  if (/good/i.test(raw)) return "good";
  if (/bad/i.test(raw)) return "bad";
  if (/mixed/i.test(raw)) return "mixed";
  return "not-set";
}

function parseSnpediaMagnitude(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function snpediaCategory(summary: string, detail: string): InsightCategory {
  const text = `${summary} ${detail}`.toLowerCase();
  if (/drug|warfarin|statin|clopidogrel|metabolizer|dose|medication|pharmacogen/.test(text)) return "drug";
  if (/bald|hair|eye color|caffeine|taste|earwax|lactose|chronotype|sleep|height|weight|skin|muscle/.test(text)) {
    return "traits";
  }
  return "medical";
}

function snpediaTitle(summary: string, rsid: string): string {
  const cleaned = summary.replace(/\.$/, "");
  if (cleaned.length > 8 && !/^rs\d+/i.test(cleaned)) {
    return cleaned.length > 96 ? `${cleaned.slice(0, 93).trim()}...` : cleaned;
  }
  return `${rsid} genotype context from SNPedia`;
}

async function buildSnpediaRecords(): Promise<EvidencePackRecord[]> {
  const sourceFile = path.join(cacheRoot, "snpedia", "pages.json");
  if (!existsSync(sourceFile)) return [];

  const pages = JSON.parse(await readFile(sourceFile, "utf8")) as CachedSnpediaPage[];
  const rsPages = new Map<string, CachedSnpediaPage>();
  for (const page of pages) {
    const rsid = normalizeRsid(page.title);
    if (rsid && /^rs\d+$/i.test(page.title)) {
      rsPages.set(rsid, page);
    }
  }

  return pages.flatMap((page): EvidencePackRecord[] => {
    const genotype = snpediaGenotypeFromTitle(page.title);
    if (!genotype) return [];

    const summary = cleanWikiText(templateValue(page.content, "summary") ?? firstParagraphs(page.content, 1));
    if (!summary || /no summary|stub/i.test(summary)) return [];

    const rsPage = rsPages.get(genotype.rsid);
    const rsContent = rsPage?.content ?? "";
    const detail = cleanWikiText(firstParagraphs(page.content, 2) || summary);
    const genes = parseSnpediaGenes(rsContent);
    const conditions = conditionList(`${summary};${detail}`).slice(0, 6);
    const category = snpediaCategory(summary, detail);
    const pmids = Array.from(new Set([...parseSnpediaPmids(page.content), ...parseSnpediaPmids(rsContent)]));
    const magnitude = parseSnpediaMagnitude(templateValue(page.content, "magnitude"));
    const repute = parseSnpediaRepute(templateValue(page.content, "repute"));

    return [{
      id: `snpedia-${snpediaPageKey(page.title)}`,
      entryId: `local-${category}-snpedia-${snpediaPageKey(page.title)}`,
      sourceId: "snpedia",
      role: "supplementary",
      category,
      subcategory: "snpedia",
      markerIds: [genotype.rsid],
      genes,
      title: snpediaTitle(summary, genotype.rsid),
      technicalName: page.title,
      summary,
      detail,
      whyItMatters: "SNPedia has a genotype-specific page for this result, which can add consumer-facing context alongside primary evidence sources.",
      topics: ["SNPedia", "Genotype page"],
      conditions,
      url: `https://bots.snpedia.com/index.php/${encodeURIComponent(page.title)
        .replaceAll("%28", "(")
        .replaceAll("%29", ")")
        .replaceAll("%3B", ";")}`,
      release: `SNPedia cached page export${page.timestamp ? `; page timestamp ${page.timestamp}` : ""}`,
      evidenceLevel: "supplementary",
      clinicalSignificance: null,
      repute,
      tone: repute === "bad" ? "caution" : repute === "good" ? "good" : "neutral",
      genotype: genotype.genotype,
      magnitude,
      pmids,
      notes: [
        `SNPedia genotype page: ${page.title}.`,
        ...(magnitude !== null ? [`SNPedia magnitude: ${magnitude}.`] : []),
        `SNPedia repute: ${repute}.`,
        "SNPedia is supplementary and should not be treated as a primary clinical source.",
      ],
    }];
  });
}


async function buildDefinitionRecords(): Promise<EvidencePackRecord[]> {
  const clinvarFile = path.join(cacheRoot, "clinvar", "variant_summary.txt.gz");
  const gwasFile = path.join(cacheRoot, "gwas", "associations.tsv");

  // rsid → definition id (for quick lookup)
  const rsidToDefId = new Map<string, string>();
  for (const [defId, rsids] of Object.entries(DEFINITION_MARKERS)) {
    for (const rsid of rsids) rsidToDefId.set(rsid, defId);
  }

  // Collect per-definition data from sources
  const defData = new Map<string, { pmids: Set<string>; notes: Set<string>; sourceIds: Set<string>; riskAllele?: string }>();
  for (const defId of Object.keys(DEFINITION_MARKERS)) {
    defData.set(defId, { pmids: new Set(), notes: new Set(), sourceIds: new Set() });
  }

  if (existsSync(clinvarFile)) {
    for await (const row of tsvRows(clinvarFile)) {
      const rawRsid = column(row, ["RS# (dbSNP)", "RS#"]);
      if (!rawRsid || rawRsid === "-1") continue;
      const rsid = normalizeRsid(rawRsid.startsWith("rs") ? rawRsid : `rs${rawRsid}`);
      if (!rsid) continue;
      const defId = rsidToDefId.get(rsid);
      if (!defId) continue;
      const data = defData.get(defId)!;
      data.sourceIds.add("clinvar");
      for (const pmid of extractPmids(column(row, ["OtherIDs"]))) data.pmids.add(pmid);
      const reviewStatus = column(row, ["ReviewStatus"]);
      if (reviewStatus) data.notes.add(`ClinVar review status: ${reviewStatus}.`);
    }
  }

  if (existsSync(gwasFile)) {
    for await (const row of tsvRows(gwasFile)) {
      const rsidsRaw = extractRsids([
        column(row, ["SNPS", "SNP_ID_CURRENT"]),
        column(row, ["STRONGEST SNP-RISK ALLELE"]),
      ].join(" "));
      for (const rsid of rsidsRaw) {
        const defId = rsidToDefId.get(rsid);
        if (!defId) continue;
        const data = defData.get(defId)!;
        data.sourceIds.add("gwas");
        const pmid = column(row, ["PUBMEDID", "PUBMED ID"]);
        if (pmid) data.pmids.add(pmid);
        const riskAlleleFreq = column(row, ["RISK ALLELE FREQUENCY"]);
        if (riskAlleleFreq && riskAlleleFreq !== "NR") {
          data.notes.add(`Risk allele frequency in study: ${riskAlleleFreq}.`);
        }
      }
    }
  }

  // Build one record per definition
  const records: EvidencePackRecord[] = [];
  for (const [defId, rsids] of Object.entries(DEFINITION_MARKERS)) {
    const data = defData.get(defId)!;
    const pmidsArr = Array.from(data.pmids);
    const sourceIds = Array.from(data.sourceIds);
    if (sourceIds.length === 0) sourceIds.push("clinvar"); // fallback

    records.push({
      id: `curated-${defId}`,
      entryId: defId,
      sourceId: sourceIds[0],
      role: "primary",
      markerIds: rsids,
      genes: [],
      title: DEFINITION_TITLES[defId] ?? defId,
      url: "",
      release: "Auto-generated from ClinVar/GWAS source data",
      evidenceLevel: "high",
      clinicalSignificance: null,
      pmids: pmidsArr,
      notes: Array.from(data.notes),
    });
  }

  console.log(`Definition seed records: ${records.length} generated from source data.`);
  return records;
}

async function buildClinvarRecords(maxRecords: number): Promise<EvidencePackRecord[]> {
  const sourceFile = path.join(cacheRoot, "clinvar", "variant_summary.txt.gz");
  if (!existsSync(sourceFile)) return [];

  const records: EvidencePackRecord[] = [];
  for await (const row of tsvRows(sourceFile)) {
    const record = clinvarRecord(row);
    if (!record) continue;
    records.push(record);
    if (records.length >= maxRecords) break;
  }
  return records;
}

async function buildGwasRecords(maxRecords: number): Promise<EvidencePackRecord[]> {
  const sourceFile = path.join(cacheRoot, "gwas", "associations.tsv");
  if (!existsSync(sourceFile)) return [];

  const raw: EvidencePackRecord[] = [];
  let rowIndex = 0;
  for await (const row of tsvRows(sourceFile)) {
    rowIndex += 1;
    raw.push(...gwasRecords(row, rowIndex));
  }

  // Deduplicate: keep first-seen record per (rsid, primary trait) pair.
  // The source file groups rows by study so first-seen tends to be the
  // most-cited association for that rsid+trait combination.
  const seen = new Map<string, EvidencePackRecord>();
  for (const record of raw) {
    const key = `${record.markerIds[0]}|${record.conditions[0] ?? ""}`;
    if (!seen.has(key)) seen.set(key, record);
  }
  return Array.from(seen.values()).slice(0, maxRecords);
}

interface CpicVariant {
  rsid: string;
  genesymbol: string;
  function: string | null;
}

interface CpicPair {
  genesymbol: string;
  drugname: string;
  guidelineName: string | null;
  url: string | null;
  level: string;
}

async function buildCpicRecords(): Promise<EvidencePackRecord[]> {
  const variantsFile = path.join(cacheRoot, "cpic", "variants.json");
  const pairsFile = path.join(cacheRoot, "cpic", "pairs.json");
  if (!existsSync(variantsFile) || !existsSync(pairsFile)) return [];

  const variants = JSON.parse(await readFile(variantsFile, "utf8")) as CpicVariant[];
  const pairs = JSON.parse(await readFile(pairsFile, "utf8")) as CpicPair[];

  const pairsByGene = new Map<string, CpicPair[]>();
  for (const pair of pairs) {
    const gene = pair.genesymbol.toUpperCase();
    const arr = pairsByGene.get(gene);
    if (arr) arr.push(pair);
    else pairsByGene.set(gene, [pair]);
  }

  const records: EvidencePackRecord[] = [];
  for (const variant of variants) {
    const rsid = normalizeRsid(variant.rsid);
    if (!rsid) continue;
    const gene = variant.genesymbol.toUpperCase();
    const genePairs = pairsByGene.get(gene);
    if (!genePairs || genePairs.length === 0) continue;

    const drugs = Array.from(new Set(genePairs.map((p) => p.drugname))).slice(0, 4);
    const topPair = genePairs[0];
    const level = topPair.level;
    const evidenceLevel: EvidenceTier = level === "A" ? "high" : "moderate";
    const functionNote = variant.function ? `Variant function: ${variant.function}.` : null;

    records.push({
      id: `cpic-${rsid}-${gene.toLowerCase()}`,
      entryId: `local-drug-cpic-${rsid}`,
      sourceId: "cpic",
      role: "primary",
      category: "drug",
      subcategory: "pharmacogenomics",
      markerIds: [rsid],
      genes: [gene],
      title: `${gene} pharmacogenomic variant — ${drugs[0]} context (CPIC)`,
      summary: `${rsid} affects ${gene} function and is relevant to ${drugs.slice(0, 2).join(" and ")} dosing per CPIC level ${level} guidelines.`,
      riskSummary: `${gene} variant with altered function (${variant.function ?? "see guideline"}) — ${drugs[0]} dosing may require adjustment`,
      qualityTier: level === "A" ? "tier-1" : undefined,
      detail: `CPIC level ${level} guideline covers ${gene} and ${drugs.join(", ")}.`,
      whyItMatters: "CPIC guidelines provide evidence-based recommendations for adjusting drug therapy based on pharmacogenomic results.",
      topics: ["CPIC", "Drug response", "Pharmacogenomics"],
      conditions: drugs.map((d) => `${d} response`),
      url: topPair.url ?? `https://cpicpgx.org/guidelines/`,
      release: "CPIC API variant and pair data",
      evidenceLevel,
      clinicalSignificance: "drug-response",
      repute: "mixed",
      tone: "caution",
      pmids: [],
      notes: [
        `CPIC level ${level} guideline.`,
        ...(functionNote ? [functionNote] : []),
        "Consumer arrays may not cover all alleles needed for a complete CPIC phenotype call.",
        "Medication changes require clinical review and confirmatory testing.",
      ],
    });
  }

  return records;
}

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

async function buildPharmgkbRecords(): Promise<EvidencePackRecord[]> {
  const annotationsFile = path.join(cacheRoot, "pharmgkb", "annotations.json");
  if (!existsSync(annotationsFile)) return [];

  const annotations = JSON.parse(await readFile(annotationsFile, "utf8")) as PharmGkbAnnotation[];
  const records: EvidencePackRecord[] = [];

  for (const ann of annotations) {
    const rsid = normalizeRsid(ann.rsid);
    if (!rsid) continue;

    const evidenceLevel: EvidenceTier =
      ann.evidenceLevel === "1A" || ann.evidenceLevel === "1B" ? "high" :
      ann.evidenceLevel === "2A" || ann.evidenceLevel === "2B" ? "moderate" :
      "emerging";

    const drugs = ann.drugs.slice(0, 4);
    const category = ann.phenotypeCategory.toLowerCase();
    const isEfficacy = /efficacy/i.test(category);
    const isToxicity = /toxicity|adverse/i.test(category);
    const tone: InsightTone = isToxicity ? "caution" : isEfficacy ? "good" : "neutral";
    const repute: ReputeStatus = isToxicity ? "bad" : isEfficacy ? "good" : "not-set";

    records.push({
      id: `pharmgkb-${ann.variantId}-${rsid}`,
      entryId: `local-drug-pharmgkb-${ann.variantId}`,
      sourceId: "pharmgkb",
      role: "primary",
      category: "drug",
      subcategory: "pharmacogenomics",
      markerIds: [rsid],
      genes: ann.gene ? [ann.gene] : [],
      title: `${ann.gene || rsid} / ${drugs[0] ?? "drug response"} (PharmGKB level ${ann.evidenceLevel})`,
      summary: `PharmGKB level ${ann.evidenceLevel} annotation links ${rsid} to ${ann.phenotypeCategory.toLowerCase()} with ${drugs.slice(0, 2).join(" and ")}.`,
      riskSummary: evidenceLevel === "high" || evidenceLevel === "moderate"
        ? `${ann.gene || rsid} variant associated with ${ann.phenotypeCategory.toLowerCase()} for ${drugs[0] ?? "the reported drug"}`
        : undefined,
      qualityTier: ann.evidenceLevel === "1A" || ann.evidenceLevel === "1B" ? "tier-1" : undefined,
      detail: `PharmGKB clinical annotation level ${ann.evidenceLevel}: ${ann.phenotypeCategory} for ${drugs.join(", ")}.`,
      whyItMatters: "PharmGKB curates pharmacogenomic evidence from the literature, with level 1A–2B annotations backed by expert review and published clinical studies.",
      topics: ["PharmGKB", "Drug response", "Pharmacogenomics"],
      conditions: drugs.map((d) => `${d} ${ann.phenotypeCategory.toLowerCase()}`),
      url: ann.url,
      release: "PharmGKB clinical annotations bulk download",
      evidenceLevel,
      clinicalSignificance: "drug-response",
      repute,
      tone,
      pmids: ann.pmids,
      notes: [
        `PharmGKB evidence level: ${ann.evidenceLevel}.`,
        `Phenotype category: ${ann.phenotypeCategory}.`,
        ...(ann.significance ? [`Significance: ${ann.significance}.`] : []),
        "PharmGKB annotations reflect published literature and should not replace clinical pharmacogenomic testing.",
      ],
    });
  }

  return records;
}

function dedupeRecords(records: EvidencePackRecord[]): EvidencePackRecord[] {
  return Array.from(new Map(records.map((record) => [record.id, record])).values());
}

function withKnownSourceRoles(records: EvidencePackRecord[]): EvidencePackRecord[] {
  return records.map((record) => ({
    ...record,
    role: record.role ?? sourceRole(record.sourceId),
  }));
}

async function writeIfChanged(filePath: string, text: string, check: boolean): Promise<boolean> {
  const current = existsSync(filePath) ? await readFile(filePath, "utf8") : null;
  if (current === text) return false;
  if (check) return true;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
  return true;
}

async function sourceChecksums(): Promise<Record<string, string | null>> {
  const clinvar = path.join(cacheRoot, "clinvar", "variant_summary.txt.gz");
  const gwas = path.join(cacheRoot, "gwas", "associations.tsv");
  const snpedia = path.join(cacheRoot, "snpedia", "pages.json");
  const cpic = path.join(cacheRoot, "cpic", "variants.json");
  const pharmgkb = path.join(cacheRoot, "pharmgkb", "annotations.json");
  return {
    clinvar: existsSync(clinvar) ? await fileSha256(clinvar) : null,
    gwas: existsSync(gwas) ? await fileSha256(gwas) : null,
    snpedia: existsSync(snpedia) ? await fileSha256(snpedia) : null,
    cpic: existsSync(cpic) ? await fileSha256(cpic) : null,
    pharmgkb: existsSync(pharmgkb) ? await fileSha256(pharmgkb) : null,
  };
}

function replaceVersionConstant(source: string, exportName: string, version: string): string {
  const pattern = new RegExp(`export const ${exportName} = "[^"]+";`);
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${exportName} export.`);
  }
  return source.replace(pattern, `export const ${exportName} = "${version}";`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const targetDir = path.join(packRoot, options.version);
  const definitionRecords = await buildDefinitionRecords();
  const clinvarRecords = await buildClinvarRecords(options.maxClinvarRecords);
  const gwasRecords = await buildGwasRecords(options.maxGwasRecords);
  const snpediaRecords = await buildSnpediaRecords();
  const cpicRecords = await buildCpicRecords();
  const pharmgkbRecords = await buildPharmgkbRecords();
  const records = dedupeRecords(withKnownSourceRoles([...definitionRecords, ...clinvarRecords, ...gwasRecords, ...snpediaRecords, ...cpicRecords, ...pharmgkbRecords]));
  const buckets = new Map<number, EvidencePackRecord[]>();

  for (const record of records) {
    const bucket = rsidBucket(record.markerIds[0] ?? record.id);
    const arr = buckets.get(bucket);
    if (arr) arr.push(record);
    else buckets.set(bucket, [record]);
  }

  if (!options.check) {
    await rm(path.join(targetDir, "shards"), { recursive: true, force: true });
    if (Object.values(dbsnpSources).some((source) => existsSync(source.path))) {
      await rm(path.join(targetDir, "annotation"), { recursive: true, force: true });
    }
  }

  const shards: NonNullable<EvidencePackManifest["shards"]> = [];
  let changed = false;
  for (const [bucket, bucketRecords] of Array.from(buckets.entries()).sort(([left], [right]) => left - right)) {
    const id = `m${String(bucket).padStart(3, "0")}`;
    const recordsPath = `shards/${id}.json`;
    const text = recordText(bucketRecords);
    changed = (await writeIfChanged(path.join(targetDir, recordsPath), text, options.check)) || changed;
    shards.push({
      id,
      recordsPath,
      recordsSha256: sha256(text),
      recordCount: bucketRecords.length,
      bucket,
    });
  }

  const checksums = await sourceChecksums();
  const existingManifestPath = path.join(targetDir, "manifest.json");
  const existingManifest = existsSync(existingManifestPath)
    ? JSON.parse(await readFile(existingManifestPath, "utf8")) as Partial<EvidencePackManifest>
    : null;
  const annotationResult = await buildAnnotationIndexes(records, targetDir, options.check, existingManifest);
  changed = annotationResult.changed || changed;
  const generatedAt = existingManifest?.version === options.version ? existingManifest.generatedAt ?? new Date().toISOString() : new Date().toISOString();
  const manifest = {
    version: options.version,
    schemaVersion,
    generatedAt,
    shardStrategy: "rsid-modulo",
    shardModulo,
    shards,
    ...(annotationResult.indexes.length > 0 ? { annotationIndexes: annotationResult.indexes } : {}),
    recordCount: records.length,
    attribution,
    sources: sourceMetadata.map((source) => {
      const checksum = checksums[source.id as keyof typeof checksums];
      return {
        ...source,
        release: checksum ? `${source.release}; sha256 ${checksum.slice(0, 12)}` : source.release,
      };
    }),
  } satisfies EvidencePackManifest;
  changed = (await writeIfChanged(existingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, options.check)) || changed;

  const evidencePackFile = path.join(repoRoot, "src", "lib", "evidencePack.ts");
  const evidencePackDataFile = path.join(repoRoot, "src", "lib", "evidencePackData.ts");
  changed = (await writeIfChanged(
    evidencePackFile,
    replaceVersionConstant(await readFile(evidencePackFile, "utf8"), "EVIDENCE_PACK_VERSION", options.version),
    options.check,
  )) || changed;
  changed = (await writeIfChanged(
    evidencePackDataFile,
    replaceVersionConstant(await readFile(evidencePackDataFile, "utf8"), "LOCAL_EVIDENCE_PACK_VERSION", options.version),
    options.check,
  )) || changed;

  // Write records.json (auto-generated definition seeds — replaces hand-maintained file)
  const recordsJsonPath = path.join(targetDir, "records.json");
  const recordsJsonText = `${JSON.stringify(definitionRecords, null, 2)}\n`;
  changed = (await writeIfChanged(recordsJsonPath, recordsJsonText, options.check)) || changed;

  console.log(`Definition seed records: ${definitionRecords.length.toLocaleString()}`);
  console.log(`ClinVar records: ${clinvarRecords.length.toLocaleString()}`);
  console.log(`GWAS records: ${gwasRecords.length.toLocaleString()}`);
  console.log(`SNPedia records: ${snpediaRecords.length.toLocaleString()}`);
  console.log(`CPIC records: ${cpicRecords.length.toLocaleString()}`);
  console.log(`PharmGKB records: ${pharmgkbRecords.length.toLocaleString()}`);
  console.log(`Packed records: ${records.length.toLocaleString()} across ${shards.length.toLocaleString()} shards.`);
  if (options.check && changed) {
    process.exitCode = 1;
    console.log("Evidence pack is not current.");
  } else if (!changed) {
    console.log("Evidence pack is current.");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
