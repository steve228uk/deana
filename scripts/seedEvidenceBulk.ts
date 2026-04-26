import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { parseDnaBytes } from "../src/lib/dnaParser";
import type { ParsedDnaFile } from "../src/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache");
const candidateDir = path.join(repoRoot, "docs", "evidence-candidates");

interface Options {
  filePath: string;
  outPath: string;
}

interface Candidate {
  sourceId: "clinvar" | "gwas";
  candidateId: string;
  rsid: string;
  gene?: string;
  title: string;
  url: string;
  summary: string;
  clinicalSignificance?: string | null;
  traits?: string[];
  pmids: string[];
  needsReview: true;
  raw: Record<string, string>;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseOptions(argv: string[]): Options {
  const options: Partial<Options> = {};
  for (const arg of argv) {
    if (arg.startsWith("--file=")) {
      options.filePath = path.resolve(arg.slice("--file=".length));
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.outPath = path.resolve(repoRoot, arg.slice("--out=".length));
      continue;
    }
    if (!arg.startsWith("--") && !options.filePath) {
      options.filePath = path.resolve(arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.filePath) {
    throw new Error("Usage: bun run evidence:seed:bulk --file=/path/to/dna.zip");
  }
  if (!existsSync(options.filePath)) {
    throw new Error(`DNA file not found: ${options.filePath}`);
  }

  return {
    filePath: options.filePath,
    outPath: options.outPath ?? path.join(candidateDir, `dna-bulk-${todayStamp()}.json`),
  };
}

async function parseDnaFile(filePath: string): Promise<ParsedDnaFile> {
  const bytes = new Uint8Array(await readFile(filePath));
  return parseDnaBytes(path.basename(filePath), bytes);
}

function splitTsv(line: string): string[] {
  return line.split("\t").map((value) => value.trim());
}

function column(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const hit = row[name];
    if (hit) return hit;
  }
  return "";
}

function extractRsids(value: string): string[] {
  return Array.from(new Set(Array.from(value.matchAll(/rs\d+/gi), (match) => match[0].toLowerCase())));
}

async function* tsvRows(filePath: string): AsyncGenerator<Record<string, string>> {
  const stream = filePath.endsWith(".gz")
    ? createReadStream(filePath).pipe(createGunzip())
    : createReadStream(filePath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] | null = null;

  for await (const line of lines) {
    if (!line.trim()) continue;
    if (!headers) {
      headers = splitTsv(line);
      continue;
    }
    const values = splitTsv(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    yield row;
  }
}

async function collectClinVar(rsids: Set<string>): Promise<Candidate[]> {
  const filePath = path.join(cacheRoot, "clinvar", "variant_summary.txt.gz");
  if (!existsSync(filePath)) return [];

  const candidates: Candidate[] = [];
  for await (const row of tsvRows(filePath)) {
    const rawRsid = column(row, ["RS# (dbSNP)", "RS#"]);
    if (!rawRsid || rawRsid === "-1") continue;
    const rsid = `rs${rawRsid.replace(/^rs/i, "")}`.toLowerCase();
    if (!rsids.has(rsid)) continue;

    const variationId = column(row, ["VariationID", "AlleleID"]) || rawRsid;
    const gene = column(row, ["GeneSymbol"]);
    const clinicalSignificance = column(row, ["ClinicalSignificance"]);
    const traits = column(row, ["PhenotypeList"]).split("|").map((trait) => trait.trim()).filter(Boolean);
    const title = column(row, ["Name"]) || `${rsid} ClinVar variant`;
    candidates.push({
      sourceId: "clinvar",
      candidateId: `clinvar-${variationId}`,
      rsid,
      gene,
      title,
      url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variationId}/`,
      summary: clinicalSignificance ? `${title}: ${clinicalSignificance}.` : title,
      clinicalSignificance: clinicalSignificance || null,
      traits,
      pmids: [],
      needsReview: true,
      raw: {
        variationId,
        reviewStatus: column(row, ["ReviewStatus"]),
        origin: column(row, ["Origin"]),
        assembly: column(row, ["Assembly"]),
        chromosome: column(row, ["Chromosome"]),
        start: column(row, ["Start"]),
        stop: column(row, ["Stop"]),
      },
    });
  }
  return candidates;
}

async function collectGwas(rsids: Set<string>): Promise<Candidate[]> {
  const filePath = path.join(cacheRoot, "gwas", "associations.tsv");
  if (!existsSync(filePath)) return [];

  const candidates: Candidate[] = [];
  let index = 0;
  for await (const row of tsvRows(filePath)) {
    const rowRsids = extractRsids([
      column(row, ["SNPS", "SNP_ID_CURRENT", "SNP_ID"]),
      column(row, ["STRONGEST SNP-RISK ALLELE"]),
    ].join(" "));
    const matched = rowRsids.find((rsid) => rsids.has(rsid));
    if (!matched) continue;

    index += 1;
    const trait = column(row, ["MAPPED_TRAIT", "DISEASE/TRAIT"]) || "GWAS association";
    const pmid = column(row, ["PUBMEDID", "PUBMED ID"]);
    candidates.push({
      sourceId: "gwas",
      candidateId: `gwas-${matched}-${index}`,
      rsid: matched,
      gene: column(row, ["MAPPED_GENE", "REPORTED GENE(S)"]),
      title: `${matched} ${trait}`,
      url: column(row, ["LINK"]) || `https://www.ebi.ac.uk/gwas/search?query=${encodeURIComponent(matched)}`,
      summary: `${matched} is associated with ${trait} in GWAS Catalog data.`,
      traits: trait.split(",").map((value) => value.trim()).filter(Boolean),
      pmids: pmid ? [pmid] : [],
      needsReview: true,
      raw: {
        pValue: column(row, ["P-VALUE"]),
        riskAllele: column(row, ["STRONGEST SNP-RISK ALLELE"]),
        reportedGenes: column(row, ["REPORTED GENE(S)"]),
        mappedGenes: column(row, ["MAPPED_GENE"]),
      },
    });
  }
  return candidates;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const parsed = await parseDnaFile(options.filePath);
  const rsids = new Set(parsed.markers.map((marker) => marker[0].toLowerCase()).filter((rsid) => /^rs\d+$/.test(rsid)));
  console.log(`Parsed ${parsed.markerCount.toLocaleString()} ${parsed.provider} markers from ${parsed.fileName}.`);
  console.log(`Joining ${rsids.size.toLocaleString()} unique rsIDs against local source files.`);

  const clinvar = await collectClinVar(rsids);
  console.log(`Matched ${clinvar.length.toLocaleString()} ClinVar rows.`);
  const gwas = await collectGwas(rsids);
  console.log(`Matched ${gwas.length.toLocaleString()} GWAS rows.`);

  const candidates = [...clinvar, ...gwas];
  const output = {
    generatedAt: new Date().toISOString(),
    dnaSeed: {
      sourceFile: path.basename(options.filePath),
      parsedFile: parsed.fileName,
      provider: parsed.provider,
      build: parsed.build,
      markerCount: parsed.markerCount,
      uniqueRsidCount: rsids.size,
    },
    sourceFiles: {
      clinvar: existsSync(path.join(cacheRoot, "clinvar", "variant_summary.txt.gz"))
        ? ".evidence-cache/clinvar/variant_summary.txt.gz"
        : null,
      gwas: existsSync(path.join(cacheRoot, "gwas", "associations.tsv"))
        ? ".evidence-cache/gwas/associations.tsv"
        : null,
    },
    candidates,
  };

  await mkdir(path.dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, options.outPath)} with ${candidates.length.toLocaleString()} candidates.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
