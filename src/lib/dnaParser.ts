import { Gunzip, unzipSync } from "fflate";
import { annotateVariantRsids, type DbsnpAnnotationLookup } from "./dbsnpAnnotation";
import type { CompactMarker, DnaAnnotationStats, DnaParseProgress, GenomeBuild, ParsedDnaFile, ProviderName } from "../types";

type ImportedFrom = ParsedDnaFile["importedFrom"];
type ParserMode = "unknown" | "vcf" | "delimited";
interface ParserOptions {
  annotationLookup?: DbsnpAnnotationLookup;
  onProgress?: (progress: DnaParseProgress) => void;
}
type DelimitedSchema =
  | { delimiter: string; kind: "allele"; idIndex: number; chromosomeIndex: number | null; positionIndex: number | null; allele1Index: number; allele2Index: number }
  | { delimiter: string; kind: "genotype"; idIndex: number; chromosomeIndex: number | null; positionIndex: number | null; genotypeIndex: number };

const TEXT_CHUNK_SIZE = 1024 * 1024;
const METADATA_SAMPLE_LIMIT = 12000;
const ZERO_GENOTYPE_RE = /^0+$/;
const DASH_GENOTYPE_RE = /^-+$/;
const MISSING_RSID_VCF_MESSAGE = "That VCF is valid, but its variant rows do not contain rsID identifiers. Deana needs rsIDs to match local evidence.";
const UNSUPPORTED_ANNOTATION_BUILD_MESSAGE = "That VCF is valid, but its variant rows do not contain rsID identifiers and Deana could not detect a supported GRCh37 or GRCh38 build for local annotation.";
const GRCH37_REFSEQ_CONTIGS = new Set([
  "NC_000001.10",
  "NC_000002.11",
  "NC_000003.11",
  "NC_000004.11",
  "NC_000005.9",
  "NC_000006.11",
  "NC_000007.13",
  "NC_000008.10",
  "NC_000009.11",
  "NC_000010.10",
  "NC_000011.9",
  "NC_000012.11",
  "NC_000013.10",
  "NC_000014.8",
  "NC_000015.9",
  "NC_000016.9",
  "NC_000017.10",
  "NC_000018.9",
  "NC_000019.9",
  "NC_000020.10",
  "NC_000021.8",
  "NC_000022.10",
  "NC_000023.10",
  "NC_000024.9",
]);
const GRCH38_REFSEQ_CONTIGS = new Set([
  "NC_000001.11",
  "NC_000002.12",
  "NC_000003.12",
  "NC_000004.12",
  "NC_000005.10",
  "NC_000006.12",
  "NC_000007.14",
  "NC_000008.11",
  "NC_000009.12",
  "NC_000010.11",
  "NC_000011.10",
  "NC_000012.12",
  "NC_000013.11",
  "NC_000014.9",
  "NC_000015.10",
  "NC_000016.10",
  "NC_000017.11",
  "NC_000018.10",
  "NC_000019.10",
  "NC_000020.11",
  "NC_000021.9",
  "NC_000022.11",
  "NC_000023.11",
  "NC_000024.10",
]);

export class DnaAnnotationRetryError extends Error {
  readonly build: GenomeBuild;

  constructor(build: GenomeBuild) {
    super(MISSING_RSID_VCF_MESSAGE);
    this.name = "DnaAnnotationRetryError";
    this.build = build;
  }
}

export function annotationRetryBuild(error: unknown): GenomeBuild | null {
  return error instanceof DnaAnnotationRetryError ? error.build : null;
}

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
  if (lower.includes("ancestrydna raw data") || lower.includes("ancestry.com dna") || lower.includes("ancestrydna")) return "AncestryDNA";
  if (lower.includes("23andme")) return "23andMe";
  if (lower.includes("myheritage")) return "MyHeritage";
  if (lower.includes("family tree dna") || lower.includes("familytreedna") || lower.includes("family finder")) return "FamilyTreeDNA";
  if (lower.includes("living dna") || lower.includes("livingdna")) return "LivingDNA";
  if (lower.includes("tellmegen")) return "tellmeGen";
  if (lower.includes("meudna") || lower.includes("meu dna")) return "meuDNA";
  if (/\bgenera\b/.test(lower)) return "Genera";
  if (lower.includes("mthfr")) return "MTHFR Genetics";
  if (lower.includes("selfdecode") || lower.includes("self decode")) return "SelfDecode";
  if (lower.includes("reich") || lower.includes("1240k") || lower.includes("humanorig") || lower.includes("human origins")) return "Reich";
  if (lower.includes("geno2") || lower.includes("geno 2.0") || lower.includes("nggeno") || lower.includes("national geographic")) return "National Geographic Geno";
  if (isVcf && (lower.includes("nebula") || lower.includes("g42") || lower.includes("megabolt"))) {
    return "Nebula Genomics";
  }
  return isVcf ? "VCF" : "Unknown";
}

function detectBuild(meta: string): string {
  const lower = meta.toLowerCase();
  const refseqContigs = Array.from(meta.matchAll(/\bNC_\d{6}\.\d+\b/gi), ([match]) => match.toUpperCase());
  if (
    lower.includes("build 38") ||
    lower.includes("build38") ||
    lower.includes("grch38") ||
    lower.includes("hg38") ||
    lower.includes("length=248956422") ||
    /\bassembly=["']?b38["']?\b/.test(lower) ||
    /\bb38\b/.test(lower) ||
    /\bhs38(?:d1)?\b/.test(lower) ||
    refseqContigs.some((contig) => GRCH38_REFSEQ_CONTIGS.has(contig))
  ) {
    return "GRCh38";
  }
  if (
    lower.includes("build 37") ||
    lower.includes("build37") ||
    lower.includes("37.1") ||
    lower.includes("grch37") ||
    lower.includes("hg37") ||
    lower.includes("hg19") ||
    lower.includes("length=249250621") ||
    /\bassembly=["']?b37["']?\b/.test(lower) ||
    /\bb37\b/.test(lower) ||
    /\bhs37d5\b/.test(lower) ||
    refseqContigs.some((contig) => GRCH37_REFSEQ_CONTIGS.has(contig))
  ) {
    return "GRCh37";
  }
  if (
    lower.includes("build 36") ||
    lower.includes("build36") ||
    lower.includes("ncbi36") ||
    lower.includes("grch36") ||
    lower.includes("hg18")
  ) {
    return "GRCh36";
  }
  return "Unknown";
}

function supportedBuild(build: string): GenomeBuild | null {
  return build === "GRCh37" || build === "GRCh38" ? build : null;
}

function normalizeGenotype(raw: string): string {
  if (!raw || ZERO_GENOTYPE_RE.test(raw) || DASH_GENOTYPE_RE.test(raw)) return "--";
  return raw.toUpperCase();
}

function normalizeChromosome(raw: string): string {
  const normalized = raw.trim().replace(/^chr/i, "");
  if (normalized === "23") return "X";
  if (normalized === "24") return "Y";
  if (normalized === "25") return "XY";
  if (normalized === "26" || /^m(?:t)?$/i.test(normalized)) return "MT";
  return normalized;
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

function zipEntryScore(name: string): number {
  const lower = name.toLowerCase();
  if (/(^|\/)(readme|metadata|manifest|license)(\.|$)/.test(lower)) return 20;
  if (/\.vcf\.gz$/.test(lower)) return 0;
  if (/\.vcf$/.test(lower)) return 1;
  if (/\.(txt|csv)$/.test(lower)) return 2;
  if (/\.gz$/.test(lower)) return 3;
  return 10;
}

function zipEntryLooksParseable(name: string): boolean {
  return zipEntryScore(name) <= 3;
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

function cleanDelimitedValue(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^\ufeff/, "")
    .replace(/^#+\s*/, "")
    .replace(/^"+|"+$/g, "")
    .replaceAll("\"", "")
    .trim();
}

function normalizeHeaderName(value: string): string {
  return cleanDelimitedValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const trimmedLine = line.trimStart();
  if (
    delimiter !== "," ||
    (line.match(/"/g)?.length ?? 0) % 2 !== 0 ||
    (!trimmedLine.startsWith("\"") && line.includes("\",\""))
  ) {
    return line.split(delimiter).map(cleanDelimitedValue);
  }

  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(cleanDelimitedValue(current));
      current = "";
    } else {
      current += char;
    }
  }

  values.push(cleanDelimitedValue(current));
  return values;
}

function candidateDelimiters(line: string): string[] {
  return line.includes("\t") ? ["\t", ","] : [","];
}

function parseDelimitedFields(line: string, delimiter: string): string[] {
  const fields = splitDelimitedLine(line, delimiter);
  if (delimiter === "\t" && fields.length === 1 && /\s{2,}/.test(line)) {
    return line.trim().split(/\s+/).map(cleanDelimitedValue);
  }
  return fields;
}

function columnIndex(columns: string[], names: string[]): number | null {
  const found = columns.findIndex((column) => names.includes(column));
  return found >= 0 ? found : null;
}

function detectDelimitedSchema(rawLine: string): DelimitedSchema | null {
  const headerLine = rawLine.replace(/^\s*#\s*/, "");

  for (const delimiter of candidateDelimiters(headerLine)) {
    const columns = parseDelimitedFields(headerLine, delimiter).map(normalizeHeaderName);
    const idIndex = columnIndex(columns, ["rsid", "snp", "snpid", "snpname", "marker", "markerid"]);
    const chromosomeIndex = columnIndex(columns, ["chromosome", "chrom", "chr"]);
    const positionIndex = columnIndex(columns, ["position", "pos", "basepairposition", "basepair", "bp", "location"]);
    const genotypeIndex = columnIndex(columns, ["genotype", "result", "call"]);
    const allele1Index = columnIndex(columns, ["allele1", "allelea", "alleleone"]);
    const allele2Index = columnIndex(columns, ["allele2", "alleleb", "alleletwo"]);

    if (idIndex === null) continue;
    if (allele1Index !== null && allele2Index !== null) {
      return {
        delimiter,
        kind: "allele",
        idIndex,
        chromosomeIndex,
        positionIndex,
        allele1Index,
        allele2Index,
      };
    }
    if (genotypeIndex !== null) {
      return {
        delimiter,
        kind: "genotype",
        idIndex,
        chromosomeIndex,
        positionIndex,
        genotypeIndex,
      };
    }
  }

  return null;
}

function normalizePosition(raw: string | undefined): number {
  return Number(cleanDelimitedValue(raw).replaceAll(",", "")) || 0;
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
  private annotatedMarkers = 0;
  private eligibleUnannotatedRows = 0;
  private unresolvedUnannotatedRows = 0;
  private skippedNonSnvRows = 0;

  private delimitedSchema: DelimitedSchema | null = null;
  private delimitedDataRows = 0;
  private delimitedNonRsidRows = 0;

  constructor(
    private readonly fileName: string,
    private readonly importedFrom: ImportedFrom,
    private readonly options: ParserOptions = {},
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
        const detectedBuild = detectBuild(this.metadata);
        const annotationBuild = supportedBuild(detectedBuild);
        if (!annotationBuild) {
          throw new Error(UNSUPPORTED_ANNOTATION_BUILD_MESSAGE);
        }
        if (this.options.annotationLookup) {
          if (this.eligibleUnannotatedRows > 0) {
            throw new Error(`That VCF is valid and appears to be ${detectedBuild}, but Deana could not annotate any eligible variants from the local dbSNP evidence-pack index.`);
          }
          throw new Error(MISSING_RSID_VCF_MESSAGE);
        }
        throw new DnaAnnotationRetryError(annotationBuild);
      }
      if (isVcf && this.rsidRows > 0 && this.skippedNonSnvRows > 0) {
        throw new Error("That VCF contains rsIDs, but no called single-nucleotide genotypes Deana can match.");
      }
      if (this.delimitedSchema && this.delimitedDataRows > 0 && this.delimitedNonRsidRows > 0) {
        throw new Error("That file has a recognized raw-DNA layout, but its rows do not contain rsID identifiers. Deana needs rsIDs to match local evidence.");
      }
      throw new Error("No rsID-backed DNA markers could be parsed from that file.");
    }

    const provider = detectProvider(this.fileName, this.metadata, isVcf);
    const build = detectBuild(this.metadata);
    const annotation = this.annotationStats(build);
    return {
      provider,
      build,
      markerCount: this.markers.length,
      fileName: this.fileName,
      importedFrom: this.importedFrom,
      markers: this.markers,
      ...(annotation ? { annotation } : {}),
    };
  }

  private annotationStats(build: string): DnaAnnotationStats | null {
    const supported = supportedBuild(build);
    if (!supported || this.eligibleUnannotatedRows === 0) return null;
    return {
      build: supported,
      annotatedMarkers: this.annotatedMarkers,
      eligibleRows: this.eligibleUnannotatedRows,
      unannotatedRows: this.unresolvedUnannotatedRows,
      skippedNonSnvRows: this.skippedNonSnvRows,
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
        this.acceptDelimitedLine(line);
        return;
      } else {
        this.mode = "delimited";
      }
    }

    if (this.mode === "vcf") {
      this.acceptVcfLine(line);
      return;
    }

    this.acceptDelimitedLine(line);
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

    let rsids = ids
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

    if (rsids.length === 0) {
      this.eligibleUnannotatedRows += 1;
      const selectedAltAlleles = selectedVcfAltAlleles(sampleValues[gtIndex] ?? "", alt);
      const annotatedRsids = selectedAltAlleles.flatMap((selectedAlt) =>
        annotateVariantRsids(
          this.options.annotationLookup,
          detectBuild(this.metadata),
          chromosome,
          Number(position) || 0,
          ref,
          selectedAlt,
        ),
      );
      rsids = Array.from(new Set(annotatedRsids));
      if (rsids.length === 0) {
        this.unresolvedUnannotatedRows += 1;
        return;
      }
      this.annotatedMarkers += rsids.length;
    }

    for (const rsid of rsids) {
      this.markers.push([rsid, normalizeChromosome(chromosome), Number(position) || 0, genotype]);
    }
  }

  private acceptDelimitedLine(line: string): void {
    if (this.delimitedSchema === null || line.startsWith("#")) {
      const possibleSchema = detectDelimitedSchema(line);
      if (possibleSchema) {
        this.delimitedSchema = possibleSchema;
      }
      return;
    }

    const parts = parseDelimitedFields(line, this.delimitedSchema.delimiter);
    if (parts.length <= this.delimitedSchema.idIndex) return;
    this.delimitedDataRows += 1;

    const rsid = normalizeRsid(parts[this.delimitedSchema.idIndex]);
    if (!rsid) {
      this.delimitedNonRsidRows += 1;
      return;
    }

    const chromosome = this.delimitedSchema.chromosomeIndex === null
      ? ""
      : normalizeChromosome(parts[this.delimitedSchema.chromosomeIndex]);
    const position = this.delimitedSchema.positionIndex === null
      ? 0
      : normalizePosition(parts[this.delimitedSchema.positionIndex]);

    if (this.delimitedSchema.kind === "allele") {
      const allele1 = parts[this.delimitedSchema.allele1Index] ?? "";
      const allele2 = parts[this.delimitedSchema.allele2Index] ?? "";
      this.markers.push([rsid, chromosome, position, normalizeGenotype(`${allele1}${allele2}`)]);
      return;
    }

    const genotype = parts[this.delimitedSchema.genotypeIndex] ?? "--";
    this.markers.push([rsid, chromosome, position, normalizeGenotype(genotype)]);
  }
}

function selectedVcfAltAlleles(gt: string, alt: string): string[] {
  if (!gt || gt.includes(".")) return [];
  const alternateAlleles = alt.split(",");
  const parsedIndexes = gt
    .split(/[\/|]/)
    .map((value) => Number.parseInt(value, 10));
  const selectedIndexes = parsedIndexes.filter((value) => Number.isInteger(value) && value > 0);
  if (selectedIndexes.length === 0 && parsedIndexes.every((value) => value === 0) && alternateAlleles.length === 1) {
    return alternateAlleles;
  }
  return Array.from(new Set(selectedIndexes.map((index) => alternateAlleles[index - 1]).filter(Boolean)));
}

function parseTextChunks(
  fileName: string,
  importedFrom: ImportedFrom,
  feed: (parser: DnaTextParser) => void,
  options: ParserOptions = {},
): ParsedDnaFile {
  const parser = new DnaTextParser(fileName, importedFrom, options);
  feed(parser);
  return parser.finish();
}

export function parseDnaText(
  fileName: string,
  text: string,
  importedFrom: ImportedFrom,
  options: ParserOptions = {},
): ParsedDnaFile {
  return parseTextChunks(fileName, importedFrom, (parser) => parser.pushText(text), options);
}

function parseTextBytes(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom, options: ParserOptions): ParsedDnaFile {
  return parseTextChunks(fileName, importedFrom, (parser) => {
    const decoder = new TextDecoder();
    const totalBytes = Math.max(bytes.byteLength, 1);
    for (let offset = 0; offset < bytes.byteLength; offset += TEXT_CHUNK_SIZE) {
      const end = Math.min(offset + TEXT_CHUNK_SIZE, bytes.byteLength);
      parser.pushText(decoder.decode(bytes.subarray(offset, end), { stream: end < bytes.byteLength }));
      options.onProgress?.({
        phase: "parsing",
        percent: Math.round((end / totalBytes) * 100),
        message: "Parsing markers locally...",
      });
    }
    const flushed = decoder.decode();
    if (flushed) parser.pushText(flushed);
  }, options);
}

function normalizeGzipError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseGzipBytes(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom, options: ParserOptions): ParsedDnaFile {
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
      const totalBytes = Math.max(bytes.byteLength, 1);
      for (let offset = 0; offset < bytes.byteLength; offset += TEXT_CHUNK_SIZE) {
        const end = Math.min(offset + TEXT_CHUNK_SIZE, bytes.byteLength);
        gunzip.push(bytes.subarray(offset, end), end >= bytes.byteLength);
        options.onProgress?.({
          phase: "parsing",
          percent: Math.round((end / totalBytes) * 100),
          message: "Decompressing and parsing locally...",
        });
      }
    } catch (error) {
      throw normalizeGzipError(error);
    }

    if (!sawFinalChunk) {
      throw new Error("The gzip file ended before a complete DNA export could be decompressed.");
    }

    const flushed = decoder.decode();
    if (flushed) parser.pushText(flushed);
  }, options);
}

function parseDnaEntry(fileName: string, bytes: Uint8Array, importedFrom: ImportedFrom, options: ParserOptions): ParsedDnaFile {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return isGzip
    ? parseGzipBytes(fileName, bytes, importedFrom, options)
    : parseTextBytes(fileName, bytes, importedFrom, options);
}

function mergeParsedZipEntries(zipFileName: string, parsedEntries: ParsedDnaFile[]): ParsedDnaFile {
  if (parsedEntries.length === 1) {
    const entry = parsedEntries[0];
    const provider = entry.provider === "Unknown" ? detectProvider(zipFileName, "", false) : entry.provider;
    return provider === entry.provider ? entry : { ...entry, provider };
  }

  const provider = parsedEntries.find((entry) => entry.provider !== "Unknown")?.provider
    ?? detectProvider(zipFileName, "", false);
  const build = parsedEntries.find((entry) => entry.build !== "Unknown")?.build ?? "Unknown";
  const markers = parsedEntries.flatMap((entry) => entry.markers);
  const annotations = parsedEntries.map((entry) => entry.annotation).filter((annotation): annotation is DnaAnnotationStats => Boolean(annotation));
  const annotation = annotations.length > 0
    ? {
        build: annotations[0].build,
        annotatedMarkers: annotations.reduce((total, item) => total + item.annotatedMarkers, 0),
        eligibleRows: annotations.reduce((total, item) => total + item.eligibleRows, 0),
        unannotatedRows: annotations.reduce((total, item) => total + item.unannotatedRows, 0),
        skippedNonSnvRows: annotations.reduce((total, item) => total + item.skippedNonSnvRows, 0),
      }
    : null;

  return {
    provider,
    build,
    markerCount: markers.length,
    fileName: zipFileName,
    importedFrom: "zip",
    markers,
    ...(annotation ? { annotation } : {}),
  };
}

function parseZipBytes(fileName: string, bytes: Uint8Array, options: ParserOptions): ParsedDnaFile {
  const entries = unzipSync(bytes);
  const preferred = Object.entries(entries)
    .filter(([name]) => !name.endsWith("/") && zipEntryLooksParseable(name))
    .sort(([leftName, leftBytes], [rightName, rightBytes]) => {
      const scoreDelta = zipEntryScore(leftName) - zipEntryScore(rightName);
      if (scoreDelta !== 0) return scoreDelta;
      return rightBytes.byteLength - leftBytes.byteLength;
    });

  if (preferred.length === 0) {
    throw new Error("The zip file did not contain a readable DNA export.");
  }

  const parsedEntries: ParsedDnaFile[] = [];
  let firstError: Error | null = null;

  for (const [entryName, entryBytes] of preferred) {
    try {
      parsedEntries.push(parseDnaEntry(entryName, entryBytes, "zip", options));
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  }

  if (parsedEntries.length > 0) {
    return mergeParsedZipEntries(fileName, parsedEntries);
  }

  throw firstError ?? new Error("The zip file did not contain a readable DNA export.");
}

export function parseDnaBytes(fileName: string, bytes: Uint8Array, options: ParserOptions = {}): ParsedDnaFile {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (isZip) {
    return parseZipBytes(fileName, bytes, options);
  }

  if (isGzip) {
    return parseDnaEntry(fileName, bytes, "gzip", options);
  }

  return parseDnaEntry(fileName, bytes, "text", options);
}
