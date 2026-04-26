import { gunzipSync, strFromU8, unzipSync } from "fflate";
import type { CompactMarker, ParsedDnaFile, ProviderName } from "../types";

type ImportedFrom = ParsedDnaFile["importedFrom"];

function normalizeRsid(raw: string): string | null {
  const match = raw.trim().match(/^rs\d+$/i);
  return match ? match[0].toLowerCase() : null;
}

function metadataSample(text: string): string {
  const vcfHeaderEnd = text.indexOf("\n#CHROM");
  return vcfHeaderEnd > 0 ? text.slice(0, vcfHeaderEnd) : text.slice(0, 12000);
}

function detectProvider(fileName: string, meta: string, isVcf: boolean): ProviderName {
  const lower = `${fileName}\n${meta}`.toLowerCase();
  if (lower.includes("ancestrydna raw data")) return "AncestryDNA";
  if (lower.includes("23andme")) return "23andMe";
  if (lower.includes("myheritage")) return "MyHeritage";
  if (lower.includes("family tree dna") || lower.includes("familytreedna")) return "FamilyTreeDNA";
  if (isVcf && (lower.includes("nebula") || lower.includes("g42") || lower.includes("megabolt"))) {
    return "Nebula Genomics";
  }
  return isVcf ? "VCF" : "Unknown";
}

function detectBuild(meta: string): string {
  const lower = meta.toLowerCase();
  if (
    lower.includes("build 38") ||
    lower.includes("grch38") ||
    lower.includes("hg38") ||
    lower.includes("length=248956422")
  ) {
    return "GRCh38";
  }
  if (
    lower.includes("build 37") ||
    lower.includes("37.1") ||
    lower.includes("grch37") ||
    lower.includes("hg19") ||
    lower.includes("length=249250621")
  ) {
    return "GRCh37";
  }
  return "Unknown";
}

function normalizeGenotype(raw: string): string {
  const trimmed = raw.trim().replaceAll("\"", "");
  if (!trimmed || trimmed === "0" || trimmed === "--") return "--";
  return trimmed.toUpperCase();
}

function normalizeChromosome(raw: string): string {
  return raw.trim().replace(/^chr/i, "");
}

function singleBaseAllele(raw: string | undefined): string | null {
  const allele = raw?.trim().toUpperCase();
  return allele && /^[ACGT]$/.test(allele) ? allele : null;
}

function isVcfText(text: string): boolean {
  return text.startsWith("##fileformat=VCF") || /(?:^|\r?\n)#CHROM\tPOS\tID\tREF\tALT\t/i.test(text);
}

function zipEntryScore(name: string): number {
  const lower = name.toLowerCase();
  if (/(^|\/)(readme|metadata|manifest|license)(\.|$)/.test(lower)) return 20;
  if (/\.vcf\.gz$/.test(lower)) return 0;
  if (/\.vcf$/.test(lower)) return 1;
  if (/\.(txt|csv)$/.test(lower)) return 2;
  if (/\.gz$/.test(lower)) return 3;
  return 10;
}

export function pickZipEntry(entries: Record<string, Uint8Array>): { name: string; bytes: Uint8Array } {
  const preferred = Object.entries(entries)
    .filter(([name]) => !name.endsWith("/"))
    .sort(([leftName, leftBytes], [rightName, rightBytes]) => {
      const scoreDelta = zipEntryScore(leftName) - zipEntryScore(rightName);
      if (scoreDelta !== 0) return scoreDelta;
      return rightBytes.byteLength - leftBytes.byteLength;
    });

  if (preferred.length === 0) {
    throw new Error("The zip file did not contain a readable DNA export.");
  }

  const [name, bytes] = preferred[0];
  return { name, bytes };
}

function genotypeFromVcf(gt: string, ref: string, alt: string): string | null {
  if (!gt || gt.includes(".")) return null;

  const refAllele = singleBaseAllele(ref);
  if (!refAllele) return null;

  const alternateAlleles = alt.split(",");
  const selectedIndexes = gt
    .split(/[\/|]/)
    .map((value) => Number.parseInt(value, 10));

  if (selectedIndexes.some((value) => !Number.isInteger(value) || value < 0)) return null;
  if (selectedIndexes.length === 0 || selectedIndexes.length > 2) return null;

  const diploidIndexes = selectedIndexes.length === 1
    ? [selectedIndexes[0], selectedIndexes[0]]
    : selectedIndexes;

  const alleles = diploidIndexes
    .sort((left, right) => left - right)
    .map((index) => {
      if (index === 0) return refAllele;
      return singleBaseAllele(alternateAlleles[index - 1]);
    });

  if (alleles.some((allele) => !allele)) return null;
  return alleles.join("");
}

function parseVcf(fileName: string, text: string, importedFrom: ImportedFrom): ParsedDnaFile {
  const markers: CompactMarker[] = [];
  let headerFound = false;
  let variantRows = 0;
  let genotypeRows = 0;
  let rsidRows = 0;
  let skippedNonSnvRows = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    if (line.startsWith("##")) continue;
    if (line.startsWith("#CHROM")) {
      headerFound = true;
      continue;
    }
    if (!headerFound) continue;

    const parts = line.split("\t");
    if (parts.length < 10) continue;
    variantRows += 1;

    const [chromosome, position, ids, ref, alt] = parts;
    const formatKeys = parts[8].split(":");
    const sampleValues = parts[9].split(":");
    const gtIndex = formatKeys.indexOf("GT");
    if (gtIndex < 0) continue;
    genotypeRows += 1;

    const rsids = ids
      .split(";")
      .map(normalizeRsid)
      .filter((rsid): rsid is string => Boolean(rsid));

    if (rsids.length > 0) {
      rsidRows += 1;
    }

    const genotype = genotypeFromVcf(sampleValues[gtIndex] ?? "", ref, alt);
    if (!genotype) {
      skippedNonSnvRows += 1;
      continue;
    }

    for (const rsid of rsids) {
      markers.push([rsid, normalizeChromosome(chromosome), Number(position) || 0, genotype]);
    }
  }

  if (markers.length === 0) {
    if (variantRows > 0 && genotypeRows > 0 && rsidRows === 0) {
      throw new Error("That VCF is valid, but its variant rows do not contain rsID identifiers. Deana needs rsIDs to match local evidence.");
    }
    if (rsidRows > 0 && skippedNonSnvRows > 0) {
      throw new Error("That VCF contains rsIDs, but no called single-nucleotide genotypes Deana can match.");
    }
    throw new Error("No DNA markers could be parsed from that file.");
  }

  const meta = metadataSample(text);
  return {
    provider: detectProvider(fileName, meta, true),
    build: detectBuild(meta),
    markerCount: markers.length,
    fileName,
    importedFrom,
    markers,
  };
}

function parseDelimited(fileName: string, text: string, importedFrom: ImportedFrom): ParsedDnaFile {
  const markers: CompactMarker[] = [];

  let delimiter = "\t";
  let headerCols: string[] = [];
  let headerFound = false;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) continue;

    if (!headerFound) {
      delimiter = line.includes("\t") ? "\t" : ",";
      headerCols = line.split(delimiter).map((part) => part.trim().toLowerCase());
      headerFound = true;
      continue;
    }

    const parts = line.split(delimiter).map((part) => part.trim().replaceAll("\"", ""));
    if (parts.length < 4) continue;

    if (headerCols.includes("allele1") && headerCols.includes("allele2")) {
      const [rawRsid, chromosome, position, allele1, allele2] = parts;
      const rsid = normalizeRsid(rawRsid);
      if (!rsid) continue;
      markers.push([rsid, chromosome, Number(position) || 0, normalizeGenotype(`${allele1}${allele2}`)]);
      continue;
    }

    if (headerCols.includes("genotype") || headerCols.includes("result")) {
      const rsid = normalizeRsid(parts[0]);
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

  const meta = metadataSample(text);
  return {
    provider: detectProvider(fileName, meta, false),
    build: detectBuild(meta),
    markerCount: markers.length,
    fileName,
    importedFrom,
    markers,
  };
}

export function parseDnaText(fileName: string, text: string, importedFrom: ImportedFrom): ParsedDnaFile {
  return isVcfText(text) ? parseVcf(fileName, text, importedFrom) : parseDelimited(fileName, text, importedFrom);
}

function stripGzipExtension(fileName: string): string {
  return fileName.replace(/\.gz$/i, "");
}

function parseDnaEntry(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom): ParsedDnaFile {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = isGzip ? strFromU8(gunzipSync(bytes)) : new TextDecoder().decode(bytes);
  return parseDnaText(isGzip ? stripGzipExtension(fileName) : fileName, text, importedFrom);
}

export function parseDnaBytes(fileName: string, bytes: Uint8Array): ParsedDnaFile {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (isZip) {
    const entry = pickZipEntry(unzipSync(bytes));
    return parseDnaEntry(entry.name, entry.bytes, "zip");
  }

  if (isGzip) {
    return parseDnaEntry(fileName, bytes, "gzip");
  }

  return parseDnaEntry(fileName, bytes, "text");
}
