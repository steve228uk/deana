/**
 * Mines ClinVar and GWAS Catalog source files for high-quality, science-backed
 * variant associations and writes src/lib/autoDefinitions.ts.
 *
 * Quality gates:
 *   ClinVar  — ReviewStatus "reviewed by expert panel" or "practice guideline"
 *              ClinicalSignificance pathogenic / likely pathogenic / risk factor / drug response
 *   GWAS     — P-VALUE ≤ 1e-10, numeric OR/Beta, non-empty REPLICATION SAMPLE SIZE
 *              One record per rsid (lowest p-value wins)
 *
 * Run: bun run evidence:definitions:build
 */

import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import type { GenericDefinitionParams } from "../src/lib/evidencePack";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");
const outFile = path.join(repoRoot, "src", "lib", "autoDefinitions.ts");

// rsids already covered by the 12 hand-crafted EVIDENCE_DEFINITIONS — skip these
const MANUAL_RSIDS = new Set([
  "rs429358", "rs7412",           // APOE
  "rs6025",                       // Factor V Leiden
  "rs1799963",                    // Prothrombin G20210A
  "rs1800562", "rs1799945",       // HFE
  "rs1801133",                    // MTHFR C677T
  "rs12913832",                   // HERC2 eye colour
  "rs4988235",                    // Lactase persistence
  "rs762551",                     // CYP1A2 caffeine
  "rs1815739",                    // ACTN3
  "rs4244285",                    // CYP2C19 *2
  "rs1057910", "rs9923231",       // CYP2C9 / VKORC1 warfarin
  "rs4149056",                    // SLCO1B1
]);

function splitTsv(line: string): string[] {
  return line.split("\t").map((v) => v.trim());
}

async function* tsvRows(filePath: string): AsyncGenerator<Record<string, string>> {
  const stream = filePath.endsWith(".gz")
    ? createReadStream(filePath).pipe(createGunzip())
    : createReadStream(filePath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] | null = null;
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (!headers) { headers = splitTsv(line); continue; }
    const values = splitTsv(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    yield row;
  }
}

function col(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const v = row[name];
    if (v) return v;
  }
  return "";
}

function normalizeRsid(raw: string): string | null {
  const m = raw.match(/rs(\d+)/i);
  return m ? `rs${m[1]}` : null;
}

function singleBaseAllele(value: string): string | null {
  const a = value.trim().toUpperCase();
  return /^[ACGT]$/.test(a) ? a : null;
}

function extractPmids(otherIds: string): string[] {
  return Array.from(otherIds.matchAll(/(?:PubMed|PMID):(\d+)/gi), (m) => m[1]);
}

function categoryForSignificance(sig: string): GenericDefinitionParams["category"] {
  if (/drug response|pharmacogen/i.test(sig)) return "drug";
  return "medical";
}

function reputeForSignificance(sig: string): GenericDefinitionParams["repute"] {
  if (/protective/i.test(sig)) return "good";
  if (/conflicting/i.test(sig)) return "mixed";
  return "bad";
}

function evidenceTierForClinvar(reviewStatus: string): GenericDefinitionParams["evidenceTier"] {
  if (/practice guideline/i.test(reviewStatus)) return "high";
  if (/reviewed by expert panel/i.test(reviewStatus)) return "high";
  return "moderate";
}

function reputeForOrBeta(orBeta: number): GenericDefinitionParams["repute"] {
  if (orBeta > 1.05) return "bad";
  if (orBeta < 0.95 && orBeta > 0) return "good";
  return "not-set";
}

function evidenceTierForGwas(pValue: number): GenericDefinitionParams["evidenceTier"] {
  return pValue <= 1e-20 ? "high" : "moderate";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function riskSummaryForClinvar(gene: string, sig: string, condition: string): string {
  if (/drug response|pharmacogen/i.test(sig)) {
    return `${gene} variant with clinical drug-response annotation for ${condition}`;
  }
  if (/protective/i.test(sig)) {
    return `${gene} variant reported as protective for ${condition}`;
  }
  if (/risk factor/i.test(sig)) {
    return `${gene} variant reported as a risk factor for ${condition}`;
  }
  return `${gene} variant classified as ${sig.toLowerCase()} for ${condition} by an expert panel`;
}

function riskSummaryForGwas(gene: string, trait: string, orBeta: number, ci: string): string {
  const effect = orBeta > 0 ? `OR/Beta ${orBeta}${ci ? ` ${ci}` : ""}` : "";
  return `${gene || "this locus"} risk allele is associated with ${trait}${effect ? ` (${effect})` : ""} in a large, replicated genome-wide study`;
}

// ── ClinVar ──────────────────────────────────────────────────────────────────

async function mineClinvar(): Promise<GenericDefinitionParams[]> {
  const filePath = path.join(cacheRoot, "clinvar", "variant_summary.txt.gz");
  if (!existsSync(filePath)) {
    console.log("ClinVar source not found — skipping (run evidence:sources:sync first).");
    return [];
  }

  const seen = new Set<string>();
  const params: GenericDefinitionParams[] = [];

  for await (const row of tsvRows(filePath)) {
    const reviewStatus = col(row, ["ReviewStatus"]);
    if (!/reviewed by expert panel|practice guideline/i.test(reviewStatus)) continue;

    const significance = col(row, ["ClinicalSignificance"]);
    if (!/pathogenic|likely pathogenic|risk factor|drug response/i.test(significance)) continue;
    if (/benign|uncertain/i.test(significance)) continue;

    const rawRsid = col(row, ["RS# (dbSNP)", "RS#"]);
    if (!rawRsid || rawRsid === "-1") continue;
    const rsid = normalizeRsid(rawRsid.startsWith("rs") ? rawRsid : `rs${rawRsid}`);
    if (!rsid || MANUAL_RSIDS.has(rsid) || seen.has(rsid)) continue;

    // Prefer GRCh38 when multiple assemblies appear; just skip duplicates gracefully
    seen.add(rsid);

    const gene = col(row, ["GeneSymbol"]) || "Unknown";
    const traits = col(row, ["PhenotypeList"])
      .split(/[|;]/)
      .map((t) => t.trim())
      .filter((t) => t && !/not provided|see cases/i.test(t))
      .slice(0, 4);
    const condition = traits[0] || "the reported condition";
    const pmids = extractPmids(col(row, ["OtherIDs"]));
    const riskAllele = singleBaseAllele(col(row, ["AlternateAlleleVCF", "AlternateAllele"]));
    const category = categoryForSignificance(significance);
    const tier = evidenceTierForClinvar(reviewStatus);

    params.push({
      id: `auto-clinvar-${slugify(gene)}-${rsid}`,
      rsid,
      gene,
      riskAllele,
      category,
      subcategory: category === "drug" ? "pharmacogenomics" : "clinical-variant",
      title: `${gene} / ${condition}`,
      riskSummary: riskSummaryForClinvar(gene, significance, condition),
      topics: ["ClinVar", category === "drug" ? "Drug response" : "Clinical variant"],
      conditions: traits,
      evidenceTier: tier,
      clinicalSignificance: significance,
      repute: reputeForSignificance(significance),
      publicationCount: pmids.length,
      sourceIds: ["clinvar", ...(pmids.length > 0 ? ["pubmed"] : [])],
    });
  }

  console.log(`ClinVar: ${params.length} expert-panel definitions extracted.`);
  return params;
}

// ── GWAS ─────────────────────────────────────────────────────────────────────

async function mineGwas(): Promise<GenericDefinitionParams[]> {
  const filePath = path.join(cacheRoot, "gwas", "associations.tsv");
  if (!existsSync(filePath)) {
    console.log("GWAS source not found — skipping (run evidence:sources:sync first).");
    return [];
  }

  // Collect best row per rsid (lowest p-value)
  const bestByRsid = new Map<string, { pValue: number; row: Record<string, string> }>();

  for await (const row of tsvRows(filePath)) {
    const pValue = Number(col(row, ["P-VALUE"]));
    if (!Number.isFinite(pValue) || pValue <= 0 || pValue > 1e-10) continue;

    const orBetaRaw = col(row, ["OR or BETA"]);
    const orBeta = Number(orBetaRaw);
    if (!Number.isFinite(orBeta)) continue;

    if (!col(row, ["REPLICATION SAMPLE SIZE"])) continue;

    const rsidsRaw = col(row, ["SNPS", "SNP_ID_CURRENT"]);
    const rsid = normalizeRsid(rsidsRaw.split(/[\s,;]+/)[0] ?? "");
    if (!rsid || MANUAL_RSIDS.has(rsid)) continue;

    const current = bestByRsid.get(rsid);
    if (!current || pValue < current.pValue) {
      bestByRsid.set(rsid, { pValue, row });
    }
  }

  const params: GenericDefinitionParams[] = [];

  for (const [rsid, { pValue, row }] of bestByRsid) {
    const trait = col(row, ["MAPPED_TRAIT", "DISEASE/TRAIT"]) || "GWAS association";
    const mappedGene = col(row, ["MAPPED_GENE", "REPORTED GENE(S)"]).split(/[;,]/)[0]?.trim() || "";
    const orBeta = Number(col(row, ["OR or BETA"]));
    const ci = col(row, ["95% CI (TEXT)"]);
    const pmid = col(row, ["PUBMEDID", "PUBMED ID"]);
    const strongestAllele = col(row, ["STRONGEST SNP-RISK ALLELE"]);
    const riskAllele = singleBaseAllele(strongestAllele.split("-").pop() ?? "");
    const repute = reputeForOrBeta(orBeta);
    const traits = trait.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4);

    params.push({
      id: `auto-gwas-${slugify(mappedGene || rsid)}-${slugify(traits[0] || rsid)}`,
      rsid,
      gene: mappedGene,
      riskAllele,
      category: "traits",
      subcategory: "association",
      title: `${mappedGene || rsid} / ${traits[0] || trait}`,
      riskSummary: riskSummaryForGwas(mappedGene, traits[0] || trait, orBeta, ci),
      topics: ["GWAS", "Association"],
      conditions: traits,
      evidenceTier: evidenceTierForGwas(pValue),
      clinicalSignificance: "trait-association",
      repute,
      publicationCount: pmid ? 1 : 0,
      sourceIds: ["gwas", ...(pmid ? ["pubmed"] : [])],
    });
  }

  console.log(`GWAS: ${params.length} tier-1 definitions extracted (p ≤ 1e-10, replicated).`);
  return params;
}

// ── Deduplicate & write ───────────────────────────────────────────────────────

function deduplicateById(params: GenericDefinitionParams[]): GenericDefinitionParams[] {
  const seen = new Set<string>();
  return params.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function renderParams(p: GenericDefinitionParams): string {
  return `  makeGenericDefinition(${JSON.stringify(p, null, 4).split("\n").join("\n  ")}),`;
}

async function main(): Promise<void> {
  const [clinvarParams, gwasParams] = await Promise.all([mineClinvar(), mineGwas()]);
  const all = deduplicateById([...clinvarParams, ...gwasParams]);

  const header = `// AUTO-GENERATED by scripts/buildDefinitions.ts — do not edit manually\n// Run: bun run evidence:definitions:build\n// ClinVar entries: ${clinvarParams.length}  GWAS entries: ${gwasParams.length}  Total: ${all.length}\n\nimport type { GenericDefinitionParams } from "./evidencePack";\n\nexport const AUTO_DEFINITION_PARAMS: GenericDefinitionParams[] = [\n`;
  const footer = `];\n`;
  const body = all.map(renderParams).join("\n");
  const source = `${header}${body}\n${footer}`;

  await writeFile(outFile, source);
  console.log(`Wrote ${path.relative(repoRoot, outFile)} with ${all.length} auto-definitions.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
