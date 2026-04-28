import { createReadStream } from "node:fs";
import readline from "node:readline";
import { createGunzip } from "node:zlib";

export function splitTsv(line: string): string[] {
  return line.split("\t").map((v) => v.trim());
}

export async function* tsvRows(filePath: string): AsyncGenerator<Record<string, string>> {
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

export function column(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const v = row[name];
    if (v) return v;
  }
  return "";
}

export function normalizeRsid(value: string): string | null {
  const match = value.match(/rs(\d+)/i);
  return match ? `rs${match[1]}` : null;
}

export function singleBaseAllele(value: string): string | undefined {
  const a = value.trim().toUpperCase();
  return /^[ACGT]$/.test(a) ? a : undefined;
}

export function extractRsids(value: string): string[] {
  return Array.from(new Set(Array.from(value.matchAll(/rs\d+/gi), (m) => m[0].toLowerCase())));
}

export function extractPmids(otherIds: string): string[] {
  return Array.from(otherIds.matchAll(/(?:PubMed|PMID):(\d+)/gi), (m) => m[1]);
}

export function riskSummaryForClinvar(gene: string, significance: string, condition: string): string {
  if (/drug response|pharmacogen/i.test(significance)) {
    return `${gene} variant with clinical drug-response annotation for ${condition}`;
  }
  if (/protective/i.test(significance)) {
    return `${gene} variant reported as protective for ${condition}`;
  }
  if (/risk factor/i.test(significance)) {
    return `${gene} variant reported as a risk factor for ${condition}`;
  }
  return `${gene} variant classified as ${significance.toLowerCase()} for ${condition} by an expert panel`;
}

export function riskSummaryForGwas(gene: string, trait: string, orBeta: number, ci: string): string {
  const effect = orBeta > 0 ? `OR/Beta ${orBeta}${ci ? ` ${ci}` : ""}` : "";
  return `${gene || "this locus"} risk allele is associated with ${trait}${effect ? ` (${effect})` : ""} in a large, replicated genome-wide study`;
}
