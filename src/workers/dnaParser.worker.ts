import { gunzipSync, strFromU8, unzipSync } from "fflate";
import { CompactMarker, ParsedDnaFile, ProviderName } from "../types";

interface ParseRequest {
  file: File;
}

interface ParseResponse {
  ok: true;
  data: ParsedDnaFile;
}

interface ParseError {
  ok: false;
  error: string;
}

type WorkerResponse = ParseResponse | ParseError;

function detectProvider(text: string): ProviderName {
  const sample = text.slice(0, 1200).toLowerCase();
  if (sample.includes("ancestrydna raw data")) return "AncestryDNA";
  if (sample.includes("23andme")) return "23andMe";
  if (sample.includes("myheritage")) return "MyHeritage";
  if (sample.includes("family tree dna") || sample.includes("familytreedna")) return "FamilyTreeDNA";
  return "Unknown";
}

function detectBuild(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("build 38") || lower.includes("grch38")) return "GRCh38";
  if (lower.includes("build 37") || lower.includes("37.1") || lower.includes("grch37")) return "GRCh37";
  return "Unknown";
}

function pickZipEntry(entries: Record<string, Uint8Array>): { name: string; bytes: Uint8Array } {
  const preferred = Object.entries(entries)
    .filter(([name]) => !name.endsWith("/"))
    .sort(([a], [b]) => {
      const aScore = /\.(txt|csv)$/i.test(a) ? 0 : 1;
      const bScore = /\.(txt|csv)$/i.test(b) ? 0 : 1;
      return aScore - bScore;
    });

  if (preferred.length === 0) {
    throw new Error("The zip file did not contain a readable DNA export.");
  }

  const [name, bytes] = preferred[0];
  return { name, bytes };
}

function normalizeGenotype(raw: string): string {
  const trimmed = raw.trim().replaceAll('"', "");
  if (!trimmed || trimmed === "0" || trimmed === "--") return "--";
  if (/^[ACGTDI]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed.toUpperCase();
}

function parseText(fileName: string, text: string, importedFrom: ParsedDnaFile["importedFrom"]): ParsedDnaFile {
  const lines = text.split(/\r?\n/);
  const provider = detectProvider(text);
  const build = detectBuild(text);
  const markers: CompactMarker[] = [];

  let delimiter = "\t";
  let headerCols: string[] = [];
  let headerFound = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) continue;

    if (!headerFound) {
      delimiter = line.includes("\t") ? "\t" : ",";
      headerCols = line.split(delimiter).map((part) => part.trim().toLowerCase());
      headerFound = true;
      continue;
    }

    const parts = line.split(delimiter).map((part) => part.trim().replaceAll('"', ""));
    if (parts.length < 4) continue;

    if (headerCols.includes("allele1") && headerCols.includes("allele2")) {
      const [rsid, chromosome, position, allele1, allele2] = parts;
      if (!rsid) continue;
      markers.push([rsid, chromosome, Number(position) || 0, normalizeGenotype(`${allele1}${allele2}`)]);
      continue;
    }

    if (headerCols.includes("genotype")) {
      const rsid = parts[0];
      const chromosome = parts[1] ?? "";
      const position = Number(parts[2] ?? 0);
      const genotype = parts[3] ?? "--";
      if (!rsid) continue;
      markers.push([rsid, chromosome, position, normalizeGenotype(genotype)]);
      continue;
    }

    if (headerCols.includes("result")) {
      const rsid = parts[0];
      const chromosome = parts[1] ?? "";
      const position = Number(parts[2] ?? 0);
      const genotype = parts[3] ?? "--";
      if (!rsid) continue;
      markers.push([rsid, chromosome, position, normalizeGenotype(genotype)]);
    }
  }

  if (markers.length === 0) {
    throw new Error("No DNA markers could be parsed from that file.");
  }

  return {
    provider,
    build,
    markerCount: markers.length,
    fileName,
    importedFrom,
    markers,
  };
}

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const respond = (message: WorkerResponse) => postMessage(message);

  try {
    const { file } = event.data;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;

    if (isZip) {
      const entries = unzipSync(bytes);
      const entry = pickZipEntry(entries);
      const text = strFromU8(entry.bytes);
      respond({
        ok: true,
        data: parseText(entry.name, text, "zip"),
      });
      return;
    }

    if (isGzip) {
      const text = strFromU8(gunzipSync(bytes));
      respond({
        ok: true,
        data: parseText(file.name.replace(/\.gz$/i, ""), text, "gzip"),
      });
      return;
    }

    const text = new TextDecoder().decode(bytes);
    respond({
      ok: true,
      data: parseText(file.name, text, "text"),
    });
  } catch (error) {
    respond({
      ok: false,
      error: error instanceof Error ? error.message : "Parsing failed.",
    });
  }
};
