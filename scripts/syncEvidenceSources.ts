import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");

interface SourceConfig {
  id: "clinvar" | "gwas";
  url: string | null;
  path: string;
  required: boolean;
}

interface Options {
  force: boolean;
  gwasUrl: string | null;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    force: false,
    gwasUrl: process.env.GWAS_ASSOCIATIONS_URL ?? null,
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("--gwas-url=")) {
      options.gwasUrl = arg.slice("--gwas-url=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function sources(options: Options): SourceConfig[] {
  return [
    {
      id: "clinvar",
      url: "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz",
      path: path.join(cacheRoot, "clinvar", "variant_summary.txt.gz"),
      required: true,
    },
    {
      id: "gwas",
      url: options.gwasUrl,
      path: path.join(cacheRoot, "gwas", "associations.tsv"),
      required: false,
    },
  ];
}

async function sha256(filePath: string): Promise<string> {
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

async function download(source: SourceConfig, force: boolean): Promise<object> {
  if (!source.url) {
    return {
      id: source.id,
      status: "skipped",
      reason: source.id === "gwas"
        ? "Set GWAS_ASSOCIATIONS_URL or pass --gwas-url=... for a current GWAS Catalog association TSV."
        : "No URL configured.",
    };
  }

  if (!force && existsSync(source.path)) {
    return {
      id: source.id,
      status: "cached",
      path: path.relative(repoRoot, source.path),
      bytes: Bun.file(source.path).size,
      sha256: await sha256(source.path),
    };
  }

  const response = await fetch(source.url);
  if (!response.ok || !response.body) {
    if (source.required) {
      throw new Error(`${source.id} download failed: ${response.status} ${response.statusText}`);
    }
    return {
      id: source.id,
      status: "failed",
      url: source.url,
      error: `${response.status} ${response.statusText}`,
    };
  }

  await mkdir(path.dirname(source.path), { recursive: true });
  await writeFile(source.path, response.body);
  return {
    id: source.id,
    status: "downloaded",
    url: source.url,
    path: path.relative(repoRoot, source.path),
    bytes: Bun.file(source.path).size,
    sha256: await sha256(source.path),
    fetchedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(cacheRoot, { recursive: true });
  const results = [];
  for (const source of sources(options)) {
    console.log(`Syncing ${source.id}...`);
    results.push(await download(source, options.force));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: results,
  };
  await writeFile(path.join(cacheRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, path.join(cacheRoot, "manifest.json"))}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
