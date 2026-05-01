import { CLINGEN_GENE_DISEASE_VALIDITY_CSV } from "./endpoints";
import { fetchText } from "./fetch";
import { parseCsvWithDetectedHeader, warnMissingFields } from "./parseDelimited";
import {
  type ClinGenImportedRecord,
  type GeneDiseaseValidityRow,
  makeClinGenRecordId,
  normaliseHgncId,
  normaliseMondoId,
  nullIfEmpty,
} from "./normalise";

const EXPECTED_FIELDS = [
  "GENE SYMBOL",
  "GENE ID (HGNC)",
  "DISEASE LABEL",
  "DISEASE ID (MONDO)",
  "MOI",
  "SOP",
  "CLASSIFICATION",
  "ONLINE REPORT",
  "CLASSIFICATION DATE",
  "GCEP",
];

function hasAlphanumeric(value: string): boolean {
  return /[a-z0-9]/i.test(value);
}

function normaliseRow(raw: Record<string, string>): GeneDiseaseValidityRow {
  return {
    geneSymbol: raw["GENE SYMBOL"]?.trim() ?? "",
    hgncId: normaliseHgncId(raw["GENE ID (HGNC)"]),
    diseaseLabel: raw["DISEASE LABEL"]?.trim() ?? "",
    mondoId: normaliseMondoId(raw["DISEASE ID (MONDO)"]),
    modeOfInheritance: nullIfEmpty(raw["MOI"]),
    sop: nullIfEmpty(raw["SOP"]),
    classification: raw["CLASSIFICATION"]?.trim() ?? "",
    onlineReportUrl: nullIfEmpty(raw["ONLINE REPORT"]),
    classificationDate: nullIfEmpty(raw["CLASSIFICATION DATE"]),
    gcep: nullIfEmpty(raw["GCEP"]),
  };
}

function toImportedRecord(
  row: GeneDiseaseValidityRow,
  raw: Record<string, string>,
  fetchedAt: string,
): ClinGenImportedRecord {
  const id = makeClinGenRecordId([
    "gene_disease_validity",
    row.hgncId,
    row.mondoId,
    row.classification,
  ]);

  return {
    id,
    source: "gene_disease_validity",
    geneSymbol: row.geneSymbol || null,
    hgncId: row.hgncId,
    diseaseLabel: row.diseaseLabel || null,
    mondoId: row.mondoId,
    classification: row.classification || null,
    reportUrl: row.onlineReportUrl,
    lastEvaluatedDate: row.classificationDate,
    raw,
    fetchedAt,
  };
}

export async function importGeneDiseaseValidity(): Promise<ClinGenImportedRecord[]> {
  const text = await fetchText(CLINGEN_GENE_DISEASE_VALIDITY_CSV, "text/csv,text/plain,*/*");
  return parseGeneDiseaseValidityText(text);
}

export function parseGeneDiseaseValidityText(text: string): ClinGenImportedRecord[] {
  const result = parseCsvWithDetectedHeader(text);

  if (result.data.length === 0) {
    console.warn("ClinGen [gene_disease_validity]: no rows parsed");
    return [];
  }

  const headers = Object.keys(result.data[0] ?? {});
  warnMissingFields("gene_disease_validity", headers, EXPECTED_FIELDS);
  console.log(`ClinGen [gene_disease_validity]: detected headers: ${headers.join(", ")}`);

  const fetchedAt = new Date().toISOString();
  const records: ClinGenImportedRecord[] = [];

  for (const raw of result.data) {
    const row = normaliseRow(raw);
    if (
      !row.geneSymbol ||
      !row.diseaseLabel ||
      !hasAlphanumeric(row.geneSymbol) ||
      !hasAlphanumeric(row.diseaseLabel)
    ) {
      continue;
    }
    records.push(toImportedRecord(row, raw, fetchedAt));
  }

  console.log(`ClinGen [gene_disease_validity]: ${records.length} records normalised`);
  return records;
}
