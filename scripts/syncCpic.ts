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
  guidelineName: string | null;
  url: string | null;
  level: string;
}

const jsonHeaders = { headers: { Accept: "application/json" } };

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const variantsFile = path.join(cacheDir, "variants.json");
  const pairsFile = path.join(cacheDir, "pairs.json");

  if (!options.force && existsSync(variantsFile) && existsSync(pairsFile)) {
    console.log("Using cached CPIC data (pass --force to refresh).");
    return;
  }

  await mkdir(cacheDir, { recursive: true });

  console.log("Fetching CPIC variants and gene-drug pairs...");
  const [rawVariants, pairs] = await Promise.all([
    fetchWithRetry<RawCpicVariant[]>(
      `${apiBase}/variant?select=rsid,genesymbol,function&rsid=not.is.null&limit=5000`,
      jsonHeaders,
    ),
    fetchWithRetry<RawCpicPair[]>(
      `${apiBase}/pair?select=genesymbol,drugname,guidelineName,url,level&level=in.(A,B)&limit=2000`,
      jsonHeaders,
    ),
  ]);

  const variants = rawVariants.filter((v) => v.rsid && v.genesymbol);
  console.log(`  ${variants.length.toLocaleString()} variants with rsid`);
  console.log(`  ${pairs.length.toLocaleString()} level A/B pairs`);

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
