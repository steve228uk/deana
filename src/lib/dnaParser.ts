import { Gunzip, unzipSync } from "fflate";
import type { CompactMarker, ParsedDnaFile, ProviderName } from "../types";

type ImportedFrom = ParsedDnaFile["importedFrom"];
type ParserMode = "unknown" | "vcf" | "delimited";

const TEXT_CHUNK_SIZE = 1024 * 1024;
const METADATA_SAMPLE_LIMIT = 12000;

function normalizeRsid(raw: string): string | null {
  const match = raw.trim().match(/^rs\d+$/i);
  return match ? match[0].toLowerCase() : null;
}

function appendMetadataSample(sample: string, line: string): string {
  if (sample.length >= METADATA_SAMPLE_LIMIT) return sample;
  return (sample + line + "\n").slice(0, METADATA_SAMPLE_LIMIT);
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

function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripGzipExtension(fileName: string): string {
  return fileName.replace(/\.gz$/i, "");
}

function isVcfFileName(fileName: string): boolean {
  return /\.vcf(?:\.gz)?$/i.test(fileName);
}

function lineLooksLikeVcf(line: string): boolean {
  return line.startsWith("##fileformat=VCF") || /^#CHROM\tPOS\tID\tREF\tALT(?:\t|$)/i.test(line);
}

function stripCommentPrefix(line: string): string {
  return line.replace(/^#\s*/, "");
}

function parseDelimitedHeader(line: string): { delimiter: string; columns: string[] } {
  const delimiter = line.includes("\t") ? "\t" : ",";
  return {
    delimiter,
    columns: line.split(delimiter).map((part) => part.trim().replaceAll("\"", "").toLowerCase()),
  };
}

function detectDelimitedHeaderType(columns: string[]): "allele" | "genotype" | null {
  if (columns.includes("allele1") && columns.includes("allele2")) return "allele";
  if (columns.includes("genotype") || columns.includes("result")) return "genotype";
  return null;
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

class DnaTextParser {
  private mode: ParserMode;
  private metadata = "";
  private lineCarry = "";
  private sawContentLine = false;

  private readonly markers: CompactMarker[] = [];

  private vcfHeaderFound = false;
  private variantRows = 0;
  private genotypeRows = 0;
  private rsidRows = 0;
  private skippedNonSnvRows = 0;

  private delimiter = "\t";
  private headerType: "allele" | "genotype" | null = null;

  constructor(
    private readonly fileName: string,
    private readonly importedFrom: ImportedFrom,
  ) {
    this.mode = isVcfFileName(fileName) ? "vcf" : "unknown";
  }

  pushText(text: string): void {
    if (!text) return;
    const combined = this.lineCarry + text;
    const lines = combined.split("\n");
    this.lineCarry = lines.pop() ?? "";

    for (const line of lines) {
      this.acceptLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  }

  finish(): ParsedDnaFile {
    if (this.lineCarry) {
      this.acceptLine(this.lineCarry.endsWith("\r") ? this.lineCarry.slice(0, -1) : this.lineCarry);
      this.lineCarry = "";
    }

    const isVcf = this.mode === "vcf" || this.variantRows > 0;
    if (this.markers.length === 0) {
      if (isVcf && this.variantRows > 0 && this.genotypeRows > 0 && this.rsidRows === 0) {
        throw new Error("That VCF is valid, but its variant rows do not contain rsID identifiers. Deana needs rsIDs to match local evidence.");
      }
      if (isVcf && this.rsidRows > 0 && this.skippedNonSnvRows > 0) {
        throw new Error("That VCF contains rsIDs, but no called single-nucleotide genotypes Deana can match.");
      }
      throw new Error("No DNA markers could be parsed from that file.");
    }

    return {
      provider: detectProvider(this.fileName, this.metadata, isVcf),
      build: detectBuild(this.metadata),
      markerCount: this.markers.length,
      fileName: this.fileName,
      importedFrom: this.importedFrom,
      markers: this.markers,
    };
  }

  private acceptLine(rawLine: string): void {
    const line = this.sawContentLine ? rawLine : stripByteOrderMark(rawLine).trimStart();
    if (!line.trim()) return;
    this.sawContentLine = true;

    this.metadata = appendMetadataSample(this.metadata, line);

    if (this.mode === "unknown") {
      if (lineLooksLikeVcf(line)) {
        this.mode = "vcf";
      } else if (line.startsWith("#")) {
        const { delimiter, columns } = parseDelimitedHeader(stripCommentPrefix(line));
        const detected = detectDelimitedHeaderType(columns);
        if (detected !== null) {
          this.mode = "delimited";
          this.delimiter = delimiter;
          this.headerType = detected;
        }
      } else {
        this.mode = "delimited";
      }
    }

    if (this.mode === "vcf") {
      this.acceptVcfLine(line);
      return;
    }

    if (this.mode === "delimited") {
      this.acceptDelimitedLine(line);
    }
  }

  private acceptVcfLine(line: string): void {
    if (line.startsWith("##")) return;
    if (line.startsWith("#CHROM")) {
      this.vcfHeaderFound = true;
      return;
    }
    if (!this.vcfHeaderFound) return;

    const parts = line.split("\t");
    if (parts.length < 10) return;
    this.variantRows += 1;

    const [chromosome, position, ids, ref, alt] = parts;
    const formatKeys = parts[8].split(":");
    const sampleValues = parts[9].split(":");
    const gtIndex = formatKeys.indexOf("GT");
    if (gtIndex < 0) return;
    this.genotypeRows += 1;

    const rsids = ids
      .split(/[;,]/)
      .map(normalizeRsid)
      .filter((rsid): rsid is string => Boolean(rsid));

    if (rsids.length > 0) {
      this.rsidRows += 1;
    }

    const genotype = genotypeFromVcf(sampleValues[gtIndex] ?? "", ref, alt);
    if (!genotype) {
      this.skippedNonSnvRows += 1;
      return;
    }

    for (const rsid of rsids) {
      this.markers.push([rsid, normalizeChromosome(chromosome), Number(position) || 0, genotype]);
    }
  }

  private acceptDelimitedLine(line: string): void {
    if (line.startsWith("#")) {
      if (this.headerType === null) {
        const { delimiter, columns } = parseDelimitedHeader(stripCommentPrefix(line));
        const detected = detectDelimitedHeaderType(columns);
        if (detected !== null) {
          this.delimiter = delimiter;
          this.headerType = detected;
        }
      }
      return;
    }

    if (this.headerType === null) {
      const { delimiter, columns } = parseDelimitedHeader(line);
      this.delimiter = delimiter;
      this.headerType = detectDelimitedHeaderType(columns) ?? "genotype";
      return;
    }

    const parts = line.split(this.delimiter).map((part) => part.trim().replaceAll("\"", ""));
    if (parts.length < 4) return;

    if (this.headerType === "allele") {
      const [rawRsid, chromosome, position, allele1, allele2] = parts;
      const rsid = normalizeRsid(rawRsid);
      if (!rsid) return;
      this.markers.push([rsid, chromosome, Number(position) || 0, normalizeGenotype(`${allele1}${allele2}`)]);
      return;
    }

    const rsid = normalizeRsid(parts[0]);
    const chromosome = parts[1] ?? "";
    const position = Number(parts[2] ?? 0);
    const genotype = parts[3] ?? "--";
    if (!rsid) return;
    this.markers.push([rsid, chromosome, position, normalizeGenotype(genotype)]);
  }
}

function parseTextChunks(fileName: string, importedFrom: ImportedFrom, feed: (parser: DnaTextParser) => void): ParsedDnaFile {
  const parser = new DnaTextParser(fileName, importedFrom);
  feed(parser);
  return parser.finish();
}

export function parseDnaText(fileName: string, text: string, importedFrom: ImportedFrom): ParsedDnaFile {
  return parseTextChunks(fileName, importedFrom, (parser) => parser.pushText(text));
}

function parseTextBytes(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom): ParsedDnaFile {
  return parseTextChunks(fileName, importedFrom, (parser) => {
    const decoder = new TextDecoder();
    for (let offset = 0; offset < bytes.byteLength; offset += TEXT_CHUNK_SIZE) {
      const end = Math.min(offset + TEXT_CHUNK_SIZE, bytes.byteLength);
      parser.pushText(decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.byteLength }));
    }
    const flushed = decoder.decode();
    if (flushed) parser.pushText(flushed);
  });
}

function normalizeGzipError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseGzipBytes(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom): ParsedDnaFile {
  const parsedFileName = stripGzipExtension(fileName);
  return parseTextChunks(parsedFileName, importedFrom, (parser) => {
    const decoder = new TextDecoder();
    let sawFinalChunk = false;

    const gunzip = new Gunzip((chunk, final) => {
      if (chunk.byteLength) {
        parser.pushText(decoder.decode(chunk, { stream: true }));
      }
      sawFinalChunk = sawFinalChunk || final;
    });

    try {
      for (let offset = 0; offset < bytes.byteLength; offset += TEXT_CHUNK_SIZE) {
        const end = Math.min(offset + TEXT_CHUNK_SIZE, bytes.byteLength);
        gunzip.push(bytes.subarray(offset, end), end >= bytes.byteLength);
      }
    } catch (error) {
      throw normalizeGzipError(error);
    }

    if (!sawFinalChunk) {
      throw new Error("The gzip file ended before a complete DNA export could be decompressed.");
    }

    const flushed = decoder.decode();
    if (flushed) parser.pushText(flushed);
  });
}

function parseDnaEntry(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom): ParsedDnaFile {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return isGzip
    ? parseGzipBytes(fileName, bytes, importedFrom)
    : parseTextBytes(fileName, bytes, importedFrom);
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
