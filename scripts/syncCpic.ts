import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./fetchUtils";
import { parseForceOption, runCli } from "./scriptUtils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "cpic");
const apiBase = "https://api.cpicpgx.org/v1";

interface RawCpicVariant {
  rsid: string | null;
  genesymbol: string;
  function: string | null;
  variantAllele: string | null;
}

interface RawCpicPair {
  genesymbol: string;
  drugname: string;
  level: string;
  levelStatus?: string;
}

const jsonHeaders = { headers: { Accept: "application/json" } };

export function isReferenceAlleleDefinitionName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "reference" || /\breference\b/.test(normalized) || /^\*1(?!\d)/i.test(name.trim());
}

export function deriveCpicVariantAllele(nonReferenceAlleles: Iterable<string>): string | null {
  const alleles = new Set<string>();

  for (const allele of nonReferenceAlleles) {
    const normalized = allele.trim().toUpperCase();
    if (!/^[ACGT]$/.test(normalized)) continue;
    alleles.add(normalized);
    if (alleles.size > 1) return null;
  }

  return alleles.values().next().value ?? null;
}

async function fetchPairs(): Promise<RawCpicPair[]> {
  // pair_view joins drug/guideline data onto pair; raw /pair has drugid not drugname.
  // cpiclevel is the actual column name (not "level").
  const raw = await fetchWithRetry<Record<string, unknown>[]>(
    `${apiBase}/pair_view?cpiclevel=in.(A,B)&limit=5000`,
    jsonHeaders,
  );
  return raw
    .map((r) => ({
      genesymbol: String(r.genesymbol ?? ""),
      drugname: String(r.drugname ?? ""),
      level: String(r.cpiclevel ?? ""),
      levelStatus: String(r.cpiclevelstatus ?? r.levelstatus ?? ""),
    }))
    .filter((p) => p.genesymbol && p.drugname && p.level);
}

async function fetchVariants(): Promise<RawCpicVariant[]> {
  // CPIC has no /variant endpoint. rsid data lives in allele_definition joined to
  // allele_location_value and sequence_location via PostgREST embedded resource syntax.
  try {
    const raw = await fetchWithRetry<Record<string, unknown>[]>(
      `${apiBase}/allele_definition?select=genesymbol,name,allele_location_value(*,sequence_location(dbsnpid))&limit=5000`,
      jsonHeaders,
    );
    // Collect non-reference variant alleles per rsid+gene. CPIC also exposes reference
    // definitions (often *1 or "reference"), which should not make a single alternate
    // allele look ambiguous.
    const allelesByKey = new Map<string, { rsid: string; gene: string; nonReferenceAlleles: Set<string> }>();
    for (const allele of raw) {
      const gene = String(allele.genesymbol ?? "");
      if (!gene) continue;
      const referenceDefinition = isReferenceAlleleDefinitionName(String(allele.name ?? ""));
      const locations = Array.isArray(allele.allele_location_value) ? allele.allele_location_value : [];
      for (const loc of locations) {
        if (!loc || typeof loc !== "object") continue;
        const seqLoc = (loc as Record<string, unknown>).sequence_location;
        if (!seqLoc || typeof seqLoc !== "object") continue;
        const rsid = String((seqLoc as Record<string, unknown>).dbsnpid ?? "");
        if (!rsid.startsWith("rs")) continue;
        const rawAllele = String((loc as Record<string, unknown>).variantallele ?? "").trim().toUpperCase();
        const key = `${rsid}|${gene}`;
        const existing = allelesByKey.get(key);
        if (existing) {
          if (!referenceDefinition && /^[ACGT]$/.test(rawAllele)) existing.nonReferenceAlleles.add(rawAllele);
        } else {
          allelesByKey.set(key, {
            rsid,
            gene,
            nonReferenceAlleles: !referenceDefinition && /^[ACGT]$/.test(rawAllele) ? new Set([rawAllele]) : new Set(),
          });
        }
      }
    }

    const variants: RawCpicVariant[] = [];
    for (const { rsid, gene, nonReferenceAlleles } of allelesByKey.values()) {
      // Only set variantAllele when a single unambiguous non-reference single-base allele
      // defines this position. Multi-allelic positions stay null and are skipped by the pack.
      const variantAllele = deriveCpicVariantAllele(nonReferenceAlleles);
      variants.push({ rsid, genesymbol: gene, function: null, variantAllele });
    }
    return variants;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const options = parseForceOption(process.argv.slice(2));

  const variantsFile = path.join(cacheDir, "variants.json");
  const pairsFile = path.join(cacheDir, "pairs.json");

  if (!options.force && existsSync(variantsFile) && existsSync(pairsFile)) {
    console.log("Using cached CPIC data (pass --force to refresh).");
    return;
  }

  await mkdir(cacheDir, { recursive: true });

  console.log("Fetching CPIC gene-drug pairs and variants...");
  const [pairsResult, variantsResult] = await Promise.allSettled([fetchPairs(), fetchVariants()]);

  const pairs = pairsResult.status === "fulfilled" ? pairsResult.value : [];
  const variants = variantsResult.status === "fulfilled" ? variantsResult.value : [];

  if (pairsResult.status === "rejected") {
    const msg = pairsResult.reason instanceof Error ? pairsResult.reason.message : String(pairsResult.reason);
    console.warn(`Warning: CPIC pair data unavailable — ${msg}`);
  }
  if (variantsResult.status === "rejected") {
    const msg = variantsResult.reason instanceof Error ? variantsResult.reason.message : String(variantsResult.reason);
    console.warn(`Warning: CPIC variant data unavailable — ${msg}`);
  }

  if (pairs.length === 0 && variants.length === 0) {
    console.warn("Warning: No CPIC data fetched. The evidence pack will have no CPIC records.");
  } else {
    console.log(`  ${variants.length.toLocaleString()} variants with rsid`);
    console.log(`  ${pairs.length.toLocaleString()} level A/B pairs`);
  }

  await Promise.all([
    writeFile(variantsFile, `${JSON.stringify(variants, null, 2)}\n`),
    writeFile(pairsFile, `${JSON.stringify(pairs, null, 2)}\n`),
  ]);

  console.log(`Wrote CPIC cache to ${path.relative(repoRoot, cacheDir)}/`);
}

runCli(import.meta.url, main);
