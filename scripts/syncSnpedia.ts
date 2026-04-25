import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".evidence-cache", "snpedia");
const pagesPath = path.join(cacheDir, "pages.json");
const manifestPath = path.join(cacheDir, "manifest.json");
const apiUrl = "https://bots.snpedia.com/api.php";

interface Options {
  force: boolean;
  limit: number | null;
  batchSize: number;
}

interface CachedSnpediaPage {
  title: string;
  content: string;
  timestamp?: string;
}

interface CategoryResponse {
  continue?: {
    cmcontinue?: string;
  };
  query?: {
    categorymembers?: Array<{ title: string }>;
  };
}

interface PageResponse {
  query?: {
    pages?: Array<{
      title: string;
      missing?: boolean;
      revisions?: Array<{
        timestamp?: string;
        slots?: {
          main?: {
            content?: string;
          };
        };
      }>;
    }>;
  };
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    force: false,
    limit: null,
    batchSize: 40,
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Number.parseInt(arg.slice("--limit=".length), 10);
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      options.batchSize = Number.parseInt(arg.slice("--batch-size=".length), 10);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.limit !== null && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive integer.");
  }
  if (!Number.isFinite(options.batchSize) || options.batchSize <= 0 || options.batchSize > 50) {
    throw new Error("--batch-size must be between 1 and 50.");
  }

  return options;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchJson<T>(params: URLSearchParams): Promise<T> {
  const response = await fetch(`${apiUrl}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SNPedia request failed with ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function categoryTitles(category: string, limit: number | null): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | null = null;

  do {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: category,
      cmlimit: "500",
      formatversion: "2",
      format: "json",
      origin: "*",
    });
    if (cmcontinue) params.set("cmcontinue", cmcontinue);

    const data = await fetchJson<CategoryResponse>(params);
    for (const member of data.query?.categorymembers ?? []) {
      titles.push(member.title);
      if (limit && titles.length >= limit) return titles;
    }
    cmcontinue = data.continue?.cmcontinue ?? null;
    console.log(`${category}: ${titles.length.toLocaleString()} titles`);
  } while (cmcontinue);

  return titles;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchPages(titles: string[], batchSize: number): Promise<CachedSnpediaPage[]> {
  const pages: CachedSnpediaPage[] = [];
  const batches = chunks(titles, batchSize);

  for (const [index, batch] of batches.entries()) {
    const params = new URLSearchParams({
      action: "query",
      prop: "revisions",
      titles: batch.join("|"),
      rvprop: "content|timestamp",
      rvslots: "main",
      redirects: "1",
      formatversion: "2",
      format: "json",
      origin: "*",
    });

    const data = await fetchJson<PageResponse>(params);
    for (const page of data.query?.pages ?? []) {
      const revision = page.revisions?.[0];
      const content = revision?.slots?.main?.content;
      if (!page.missing && content) {
        pages.push({ title: page.title, content, timestamp: revision.timestamp });
      }
    }
    console.log(`Fetched SNPedia page batch ${index + 1} of ${batches.length}`);
  }

  return pages;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options.force && existsSync(pagesPath)) {
    const text = await readFile(pagesPath, "utf8");
    console.log(`Using cached ${path.relative(repoRoot, pagesPath)} (${sha256(text).slice(0, 12)}).`);
    return;
  }

  await mkdir(cacheDir, { recursive: true });
  const rsTitles = await categoryTitles("Category:Is_a_snp", options.limit);
  const genotypeTitles = await categoryTitles("Category:Is_a_genotype", options.limit);
  const titles = Array.from(new Set([...rsTitles, ...genotypeTitles])).sort();
  const pages = await fetchPages(titles, options.batchSize);
  const text = `${JSON.stringify(pages, null, 2)}\n`;
  await writeFile(pagesPath, text);
  await writeFile(manifestPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: apiUrl,
    categories: ["Category:Is_a_snp", "Category:Is_a_genotype"],
    titleCount: titles.length,
    pageCount: pages.length,
    sha256: sha256(text),
  }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, pagesPath)} with ${pages.length.toLocaleString()} pages.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
