import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./fetchUtils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "cpic");
const apiBase = "https://api.cpicpgx.org/v1";

interface Options {
  force: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { force: false };
  for (const arg of argv) {
    if (arg === "--force") { options.force = true; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

interface RawCpicVariant {
  rsid: string | null;
  genesymbol: string;
  function: string | null;
}

interface RawCpicPair {
  genesymbol: string;
  drugname: string;
  level: string;
}

const jsonHeaders = { headers: { Accept: "application/json" } };

async function fetchPairs(): Promise<RawCpicPair[]> {
  // Fetch without select or filter to avoid column-name mismatches; filter A/B client-side.
  const raw = await fetchWithRetry<Record<string, unknown>[]>(
    `${apiBase}/pair?limit=5000`,
    jsonHeaders,
  );
  return raw
    .map((r) => ({
      genesymbol: String(r.genesymbol ?? r.gene_symbol ?? ""),
      drugname: String(r.drugname ?? r.drug_name ?? ""),
      level: String(r.level ?? r.cpic_level ?? ""),
    }))
    .filter((p) => p.genesymbol && p.drugname && (p.level === "A" || p.level === "B"));
}

async function fetchVariants(): Promise<RawCpicVariant[]> {
  // Try /variant first, then /allele as a fallback (the table name has changed across API versions).
  const endpoints = [
    `${apiBase}/variant?select=rsid,genesymbol,function&rsid=not.is.null&limit=5000`,
    `${apiBase}/allele?select=rsid,genesymbol,functionalstatus&rsid=not.is.null&limit=5000`,
  ];
  for (const url of endpoints) {
    try {
      const raw = await fetchWithRetry<Record<string, unknown>[]>(url, jsonHeaders);
      const variants = raw
        .map((r) => ({
          rsid: String(r.rsid ?? ""),
          genesymbol: String(r.genesymbol ?? r.gene_symbol ?? ""),
          function: String(r.function ?? r.functionalstatus ?? r.functional_status ?? "") || null,
        }))
        .filter((v) => v.rsid && v.genesymbol);
      if (variants.length > 0) return variants;
    } catch {
      // try next endpoint
    }
  }
  return [];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
