import { CLINGEN_VARIANT_PATHOGENICITY_TSV } from "./endpoints";
import { fetchText } from "./fetch";
import { parseTsvWithDetectedHeader, warnMissingFields } from "./parseDelimited";
import {
  type ClinGenImportedRecord,
  type VariantPathogenicityRow,
  makeClinGenRecordId,
  normaliseMondoId,
  nullIfEmpty,
  splitListField,
} from "./normalise";

const EXPECTED_FIELDS = [
  "Variation",
  "ClinVar Variation Id",
  "Allele Registry Id",
  "HGNC Gene Symbol",
  "Disease",
  "Mondo Id",
  "Mode of Inheritance",
  "Assertion",
  "Expert Panel",
  "Approval Date",
  "Published Date",
  "Retracted",
  "Uuid",
];

function normaliseRow(raw: Record<string, string>): VariantPathogenicityRow {
  return {
    variation: raw["Variation"]?.trim() ?? "",
    clinvarVariationId: nullIfEmpty(raw["ClinVar Variation Id"]),
    alleleRegistryId: nullIfEmpty(raw["Allele Registry Id"]),
    hgvsExpressions: splitListField(raw["HGVS Expressions"]),
    geneSymbol: nullIfEmpty(raw["HGNC Gene Symbol"]),
    diseaseLabel: nullIfEmpty(raw["Disease"]),
    mondoId: normaliseMondoId(raw["Mondo Id"]),
    modeOfInheritance: nullIfEmpty(raw["Mode of Inheritance"]),
    assertion: nullIfEmpty(raw["Assertion"]),
    evidenceCodesMet: splitListField(raw["Applied Evidence Codes (Met)"]),
    evidenceCodesNotMet: splitListField(raw["Applied Evidence Codes (Not Met)"]),
    summaryOfInterpretation: nullIfEmpty(raw["Summary of interpretation"]),
    pubmedIds: splitListField(raw["PubMed Articles"]),
    expertPanel: nullIfEmpty(raw["Expert Panel"]),
    guideline: nullIfEmpty(raw["Guideline"]),
    approvalDate: nullIfEmpty(raw["Approval Date"]),
    publishedDate: nullIfEmpty(raw["Published Date"]),
    retracted: raw["Retracted"]?.trim().toLowerCase() === "true",
    evidenceRepoLink: nullIfEmpty(raw["Evidence Repo Link"]),
    uuid: nullIfEmpty(raw["Uuid"]),
  };
}

function toImportedRecord(
  row: VariantPathogenicityRow,
  raw: Record<string, string>,
  fetchedAt: string,
): ClinGenImportedRecord {
  const id = row.uuid
    ? makeClinGenRecordId(["variant_pathogenicity", row.uuid])
    : makeClinGenRecordId([
        "variant_pathogenicity",
        row.clinvarVariationId,
        row.assertion,
      ]);

  return {
    id,
    source: "variant_pathogenicity",
    geneSymbol: row.geneSymbol,
    diseaseLabel: row.diseaseLabel,
    mondoId: row.mondoId,
    assertion: row.assertion,
    reportUrl: row.evidenceRepoLink,
    publishedDate: row.publishedDate,
    raw,
    fetchedAt,
  };
}

export async function importVariantPathogenicity(): Promise<ClinGenImportedRecord[]> {
  const text = await fetchText(
    CLINGEN_VARIANT_PATHOGENICITY_TSV,
    "text/tab-separated-values,text/plain,*/*",
  );
  return parseVariantPathogenicityText(text);
}

export function parseVariantPathogenicityText(text: string): ClinGenImportedRecord[] {
  const result = parseTsvWithDetectedHeader(text);

  if (result.data.length === 0) {
    console.warn("ClinGen [variant_pathogenicity]: no rows parsed");
    return [];
  }

  const headers = Object.keys(result.data[0] ?? {});
  warnMissingFields("variant_pathogenicity", headers, EXPECTED_FIELDS);
  console.log(`ClinGen [variant_pathogenicity]: detected headers: ${headers.join(", ")}`);

  const fetchedAt = new Date().toISOString();
  const records: ClinGenImportedRecord[] = [];

  for (const raw of result.data) {
    const row = normaliseRow(raw);
    if (!row.variation) continue;
    records.push(toImportedRecord(row, raw, fetchedAt));
  }

  console.log(`ClinGen [variant_pathogenicity]: ${records.length} records normalised`);
  return records;
}
