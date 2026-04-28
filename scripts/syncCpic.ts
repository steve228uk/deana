import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function fetchJson<T>(url: string): Promise<T> {
  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (response.ok) return response.json() as Promise<T>;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw new Error(`CPIC API request failed: ${response.status} ${response.statusText} — ${url}`);
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < maxAttempts) {
      const delay = 2000 * 2 ** (attempt - 1);
      console.warn(`CPIC request failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${lastError?.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const variantsFile = path.join(cacheDir, "variants.json");
  const pairsFile = path.join(cacheDir, "pairs.json");

  if (!options.force && existsSync(variantsFile) && existsSync(pairsFile)) {
    console.log("Using cached CPIC data (pass --force to refresh).");
    return;
  }

  await mkdir(cacheDir, { recursive: true });

  // Fetch all variants with rsid annotations
  console.log("Fetching CPIC variants...");
  const rawVariants = await fetchJson<RawCpicVariant[]>(
    `${apiBase}/variant?select=rsid,genesymbol,function&rsid=not.is.null&limit=5000`,
  );
  const variants = rawVariants.filter((v) => v.rsid && v.genesymbol);
  console.log(`  ${variants.length.toLocaleString()} variants with rsid`);

  // Fetch A and B level gene-drug pairs (the guideline-backed ones)
  console.log("Fetching CPIC gene-drug pairs (levels A and B)...");
  const pairs = await fetchJson<RawCpicPair[]>(
    `${apiBase}/pair?select=genesymbol,drugname,guidelineName,url,level&level=in.(A,B)&limit=2000`,
  );
  console.log(`  ${pairs.length.toLocaleString()} level A/B pairs`);

  await writeFile(variantsFile, `${JSON.stringify(variants, null, 2)}\n`);
  await writeFile(pairsFile, `${JSON.stringify(pairs, null, 2)}\n`);

  console.log(`Wrote CPIC cache to ${path.relative(repoRoot, cacheDir)}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
