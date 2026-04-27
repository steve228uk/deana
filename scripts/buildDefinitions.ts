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

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GenericDefinitionParams } from "../src/lib/evidencePack";
import { column, extractPmids, normalizeRsid, singleBaseAllele, tsvRows } from "./tsvUtils";
import { MANUAL_RSIDS } from "./definitionMarkers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");
const outFile = path.join(repoRoot, "src", "lib", "autoDefinitions.ts");

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
  if (/practice guideline|reviewed by expert panel/i.test(reviewStatus)) return "high";
  return "moderate";
}

function reputeForOrBeta(orBeta: number): GenericDefinitionParams["repute"] {
  if (orBeta > 1.05) return "bad";
  if (orBeta < 0.95 && orBeta > 0) return "good";
  return "not-set";
}

function evidenceTierForGwas(pValue: number): GenericDefinitionParams["evidenceTier"] {
  return pValue <= 1e-10 ? "high" : "moderate";
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

// ── ClinVar ───────────────────────────────────────────────────────────────────

async function mineClinvar(): Promise<GenericDefinitionParams[]> {
  const filePath = path.join(cacheRoot, "clinvar", "variant_summary.txt.gz");
  if (!existsSync(filePath)) {
    console.log("ClinVar source not found — skipping (run evidence:sources:sync first).");
    return [];
  }

  const seen = new Set<string>();
  const params: GenericDefinitionParams[] = [];

  for await (const row of tsvRows(filePath)) {
    const reviewStatus = column(row, ["ReviewStatus"]);
    if (!/reviewed by expert panel|practice guideline/i.test(reviewStatus)) continue;

    const significance = column(row, ["ClinicalSignificance"]);
    if (!/pathogenic|likely pathogenic|risk factor|drug response/i.test(significance)) continue;
    if (/benign|uncertain/i.test(significance)) continue;

    const rawRsid = column(row, ["RS# (dbSNP)", "RS#"]);
    if (!rawRsid || rawRsid === "-1") continue;
    const rsid = normalizeRsid(rawRsid.startsWith("rs") ? rawRsid : `rs${rawRsid}`);
    if (!rsid || MANUAL_RSIDS.has(rsid) || seen.has(rsid)) continue;

    seen.add(rsid);

    const gene = column(row, ["GeneSymbol"]) || "Unknown";
    const traits = column(row, ["PhenotypeList"])
      .split(/[|;]/)
      .map((t) => t.trim())
      .filter((t) => t && !/not provided|see cases/i.test(t))
      .slice(0, 4);
    const condition = traits[0] || "the reported condition";
    const pmids = extractPmids(column(row, ["OtherIDs"]));
    const riskAllele = singleBaseAllele(column(row, ["AlternateAlleleVCF", "AlternateAllele"])) ?? null;
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

// ── GWAS ──────────────────────────────────────────────────────────────────────

interface BestGwasRow {
  pValue: number;
  trait: string;
  mappedGene: string;
  orBeta: number;
  ci: string;
  pmid: string;
  strongestAllele: string;
}

async function mineGwas(): Promise<GenericDefinitionParams[]> {
  const filePath = path.join(cacheRoot, "gwas", "associations.tsv");
  if (!existsSync(filePath)) {
    console.log("GWAS source not found — skipping (run evidence:sources:sync first).");
    return [];
  }

  const bestByRsid = new Map<string, BestGwasRow>();

  for await (const row of tsvRows(filePath)) {
    const pValue = Number(column(row, ["P-VALUE"]));
    if (!Number.isFinite(pValue) || pValue <= 0 || pValue > 1e-10) continue;

    const orBeta = Number(column(row, ["OR or BETA"]));
    if (!Number.isFinite(orBeta)) continue;

    if (!column(row, ["REPLICATION SAMPLE SIZE"])) continue;

    const rsidsRaw = column(row, ["SNPS", "SNP_ID_CURRENT"]);
    const rsid = normalizeRsid(rsidsRaw.split(/[\s,;]+/)[0] ?? "");
    if (!rsid || MANUAL_RSIDS.has(rsid)) continue;

    const current = bestByRsid.get(rsid);
    if (!current || pValue < current.pValue) {
      bestByRsid.set(rsid, {
        pValue,
        trait: column(row, ["MAPPED_TRAIT", "DISEASE/TRAIT"]) || "GWAS association",
        mappedGene: column(row, ["MAPPED_GENE", "REPORTED GENE(S)"]).split(/[;,]/)[0]?.trim() || "",
        orBeta,
        ci: column(row, ["95% CI (TEXT)"]),
        pmid: column(row, ["PUBMEDID", "PUBMED ID"]),
        strongestAllele: column(row, ["STRONGEST SNP-RISK ALLELE"]),
      });
    }
  }

  const params: GenericDefinitionParams[] = [];

  for (const [rsid, best] of bestByRsid) {
    const riskAllele = singleBaseAllele(best.strongestAllele.split("-").pop() ?? "") ?? null;
    const repute = reputeForOrBeta(best.orBeta);
    const traits = best.trait.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4);

    params.push({
      id: `auto-gwas-${slugify(best.mappedGene || rsid)}-${slugify(traits[0] || rsid)}`,
      rsid,
      gene: best.mappedGene,
      riskAllele,
      category: "traits",
      subcategory: "association",
      title: `${best.mappedGene || rsid} / ${traits[0] || best.trait}`,
      riskSummary: riskSummaryForGwas(best.mappedGene, traits[0] || best.trait, best.orBeta, best.ci),
      topics: ["GWAS", "Association"],
      conditions: traits,
      evidenceTier: evidenceTierForGwas(best.pValue),
      clinicalSignificance: "trait-association",
      repute,
      publicationCount: best.pmid ? 1 : 0,
      sourceIds: ["gwas", ...(best.pmid ? ["pubmed"] : [])],
    });
  }

  console.log(`GWAS: ${params.length} tier-1 definitions extracted (p ≤ 1e-10, replicated).`);
  return params;
}

// ── Write ──────────────────────────────────────────────────────────────────────

function renderParams(p: GenericDefinitionParams): string {
  return `  ${JSON.stringify(p, null, 4).split("\n").join("\n  ")},`;
}

async function main(): Promise<void> {
  const [clinvarParams, gwasParams] = await Promise.all([mineClinvar(), mineGwas()]);
  const all = [...clinvarParams, ...gwasParams];

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
