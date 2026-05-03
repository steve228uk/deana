import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { fileSha256, findZipTextEntry, runCli, sha256 } from "./scriptUtils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");

interface SourceConfig {
  id: "clinvar" | "clinvar-citations" | "gwas" | "gwas-studies";
  url: string | null;
  path: string;
  required: boolean;
}

interface Options {
  force: boolean;
  gwasUrl: string | null;
  gwasStudiesUrl: string | null;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    force: false,
    gwasUrl: process.env.GWAS_ASSOCIATIONS_URL ?? null,
    gwasStudiesUrl: process.env.GWAS_STUDIES_URL ?? null,
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
    if (arg.startsWith("--gwas-studies-url=")) {
      options.gwasStudiesUrl = arg.slice("--gwas-studies-url=".length);
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
      id: "clinvar-citations",
      url: "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/var_citations.txt",
      path: path.join(cacheRoot, "clinvar", "var_citations.txt"),
      required: false,
    },
    {
      id: "gwas",
      url: options.gwasUrl,
      path: path.join(cacheRoot, "gwas", "associations.tsv"),
      required: false,
    },
    {
      id: "gwas-studies",
      url: options.gwasStudiesUrl,
      path: path.join(cacheRoot, "gwas", "studies.tsv"),
      required: false,
    },
  ];
}

function isZipSource(source: SourceConfig, response: Response): boolean {
  return (
    (source.id === "gwas" || source.id === "gwas-studies") &&
    (source.url?.toLowerCase().endsWith(".zip") ||
      response.headers.get("content-type")?.toLowerCase().includes("zip") === true)
  );
}

function extractGwasZip(source: SourceConfig, bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes);
  const pattern = source.id === "gwas-studies" ? /studies/i : /associations/i;
  return findZipTextEntry(
    entries,
    pattern,
    `${source.id} ZIP did not contain the expected TSV/TXT file.`,
  );
}

function skipReasonForSource(sourceId: SourceConfig["id"]): string {
  switch (sourceId) {
    case "gwas":
      return "Set GWAS_ASSOCIATIONS_URL or pass --gwas-url=... for a current GWAS Catalog association TSV.";
    case "gwas-studies":
      return "Set GWAS_STUDIES_URL or pass --gwas-studies-url=... for optional GWAS Catalog studies metadata.";
    case "clinvar":
    case "clinvar-citations":
      return "No URL configured.";
  }
}

async function download(source: SourceConfig, force: boolean): Promise<object> {
  if (!source.url) {
    return {
      id: source.id,
      status: "skipped",
      reason: skipReasonForSource(source.id),
    };
  }

  if (!force && existsSync(source.path)) {
    return {
      id: source.id,
      status: "cached",
      path: path.relative(repoRoot, source.path),
      bytes: Bun.file(source.path).size,
      sha256: await fileSha256(source.path),
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

  const responseBytes = new Uint8Array(await response.arrayBuffer());
  const bytes = isZipSource(source, response)
    ? extractGwasZip(source, responseBytes)
    : responseBytes;

  await mkdir(path.dirname(source.path), { recursive: true });
  await writeFile(source.path, bytes);
  return {
    id: source.id,
    status: "downloaded",
    url: source.url,
    path: path.relative(repoRoot, source.path),
    bytes: Bun.file(source.path).size,
    sha256: sha256(bytes),
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

runCli(import.meta.url, main);
