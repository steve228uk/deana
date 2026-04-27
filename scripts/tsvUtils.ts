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
