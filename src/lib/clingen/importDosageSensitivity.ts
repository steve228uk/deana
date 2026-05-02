import {
  CLINGEN_DOSAGE_GENES_ONLY_CSV,
  CLINGEN_DOSAGE_GENE_LIST_GRCH38_TSV,
} from "./endpoints";
import { fetchText } from "./fetch";
import {
  parseCsvWithDetectedHeader,
  parseTsvWithDetectedHeader,
  warnMissingFields,
} from "./parseDelimited";
import {
  type ClinGenImportedRecord,
  type DosageSensitivityRow,
  extractPmidsFromRow,
  makeClinGenRecordId,
  normaliseHgncId,
  nullIfEmpty,
} from "./normalise";

const EXPECTED_CSV_FIELDS = [
  "GENE SYMBOL",
  "GENE ID",
  "CYTOBAND",
  "GENOMIC LOCATION",
  "HAPLOINSUFFICIENCY SCORE",
  "TRIPLOSENSITIVITY SCORE",
  "DATE LAST EVALUATED",
];

const EXPECTED_TSV_FIELDS = [
  // FTP TSV uses #Gene Symbol with leading hash; accept either form
  "Gene Symbol",
  "Gene ID",
  "cytoBand",
  "Genomic Location",
  "Haploinsufficiency Score",
  "Triplosensitivity Score",
  "Date Last Evaluated",
];

function normaliseGeneRow(
  raw: Record<string, string>,
  type: "gene" | "region",
): DosageSensitivityRow {
  const symbolKey =
    raw["GENE SYMBOL"] !== undefined
      ? "GENE SYMBOL"
      : raw["Gene Symbol"] !== undefined
        ? "Gene Symbol"
        : "#Gene Symbol";

  const idKey =
    raw["GENE ID"] !== undefined
      ? "GENE ID"
      : raw["Gene ID"] !== undefined
        ? "Gene ID"
        : "#ISCA ID";

  return {
    type,
    symbolOrRegion: raw[symbolKey]?.trim() ?? raw["#ISCA ID"]?.trim() ?? "",
    geneIdOrIscaId: normaliseHgncId(raw[idKey]),
    cytoband:
      nullIfEmpty(raw["CYTOBAND"]) ??
      nullIfEmpty(raw["cytoBand"]) ??
      nullIfEmpty(raw["CytoBand"]),
    genomicLocation:
      nullIfEmpty(raw["GENOMIC LOCATION"]) ??
      nullIfEmpty(raw["Genomic Location"]),
    haploinsufficiencyScore:
      nullIfEmpty(raw["HAPLOINSUFFICIENCY SCORE"]) ??
      nullIfEmpty(raw["Haploinsufficiency Score"]),
    haploinsufficiencyDescription:
      nullIfEmpty(raw["HAPLOINSUFFICIENCY DESCRIPTION"]) ??
      nullIfEmpty(raw["Haploinsufficiency Description"]),
    haploinsufficiencyPmids: extractPmidsFromRow(raw, "Haploinsufficiency"),
    triplosensitivityScore:
      nullIfEmpty(raw["TRIPLOSENSITIVITY SCORE"]) ??
      nullIfEmpty(raw["Triplosensitivity Score"]),
    triplosensitivityDescription:
      nullIfEmpty(raw["TRIPLOSENSITIVITY DESCRIPTION"]) ??
      nullIfEmpty(raw["Triplosensitivity Description"]),
    triplosensitivityPmids: extractPmidsFromRow(raw, "Triplosensitivity"),
    dateLastEvaluated:
      nullIfEmpty(raw["DATE LAST EVALUATED"]) ??
      nullIfEmpty(raw["Date Last Evaluated"]),
    lossPhenotypeOmimId:
      nullIfEmpty(raw["LOSS PHENOTYPE OMIM ID"]) ??
      nullIfEmpty(raw["Loss phenotype OMIM ID"]),
    triplosensitivePhenotypeOmimId:
      nullIfEmpty(raw["TRIPLOSENSITIVE PHENOTYPE OMIM ID"]) ??
      nullIfEmpty(raw["Triplosensitive phenotype OMIM ID"]),
  };
}

function toImportedRecord(
  row: DosageSensitivityRow,
  raw: Record<string, string>,
  fetchedAt: string,
  assembly?: string,
): ClinGenImportedRecord {
  const id = makeClinGenRecordId([
    "dosage_sensitivity",
    row.geneIdOrIscaId ?? row.symbolOrRegion,
    assembly,
  ]);

  return {
    id,
    source: "dosage_sensitivity",
    geneSymbol: row.type === "gene" ? row.symbolOrRegion || null : null,
    hgncId: row.geneIdOrIscaId,
    lastEvaluatedDate: row.dateLastEvaluated,
    raw,
    fetchedAt,
  };
}

export async function importDosageSensitivityCsv(): Promise<ClinGenImportedRecord[]> {
  const text = await fetchText(CLINGEN_DOSAGE_GENES_ONLY_CSV, "text/csv,text/plain,*/*");
  return parseDosageSensitivityCsvText(text, "gene");
}

export function parseDosageSensitivityCsvText(
  text: string,
  type: "gene" | "region",
): ClinGenImportedRecord[] {
  const result = parseCsvWithDetectedHeader(text);

  if (result.data.length === 0) {
    console.warn("ClinGen [dosage_sensitivity]: no rows parsed from CSV");
    return [];
  }

  const headers = Object.keys(result.data[0] ?? {});
  warnMissingFields("dosage_sensitivity (CSV)", headers, EXPECTED_CSV_FIELDS);
  console.log(`ClinGen [dosage_sensitivity CSV]: detected headers: ${headers.join(", ")}`);

  const fetchedAt = new Date().toISOString();
  const records: ClinGenImportedRecord[] = [];

  for (const raw of result.data) {
    const row = normaliseGeneRow(raw, type);
    if (!row.symbolOrRegion) continue;
    records.push(toImportedRecord(row, raw, fetchedAt));
  }

  console.log(`ClinGen [dosage_sensitivity CSV]: ${records.length} records normalised`);
  return records;
}

export async function importDosageSensitivityFtpTsv(
  assembly: "GRCh37" | "GRCh38" = "GRCh38",
): Promise<ClinGenImportedRecord[]> {
  const url =
    assembly === "GRCh38"
      ? CLINGEN_DOSAGE_GENE_LIST_GRCH38_TSV
      : CLINGEN_DOSAGE_GENE_LIST_GRCH38_TSV; // kept symmetric; swap to GRCh37 if needed
  const text = await fetchText(url, "text/tab-separated-values,text/plain,*/*");
  return parseDosageSensitivityTsvText(text, "gene", assembly);
}

export function parseDosageSensitivityTsvText(
  text: string,
  type: "gene" | "region",
  assembly?: string,
): ClinGenImportedRecord[] {
  const result = parseTsvWithDetectedHeader(text);

  if (result.data.length === 0) {
    console.warn("ClinGen [dosage_sensitivity]: no rows parsed from TSV");
    return [];
  }

  const headers = Object.keys(result.data[0] ?? {});
  warnMissingFields("dosage_sensitivity (TSV)", headers, EXPECTED_TSV_FIELDS);
  console.log(`ClinGen [dosage_sensitivity TSV]: detected headers: ${headers.join(", ")}`);

  const fetchedAt = new Date().toISOString();
  const records: ClinGenImportedRecord[] = [];

  for (const raw of result.data) {
    const row = normaliseGeneRow(raw, type);
    if (!row.symbolOrRegion) continue;
    records.push(toImportedRecord(row, raw, fetchedAt, assembly));
  }

  console.log(`ClinGen [dosage_sensitivity TSV]: ${records.length} records normalised`);
  return records;
}
