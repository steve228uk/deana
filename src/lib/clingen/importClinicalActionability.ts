import {
  CLINGEN_ACTIONABILITY_ADULT_FLAT_JSON,
  CLINGEN_ACTIONABILITY_PEDIATRIC_FLAT_JSON,
} from "./endpoints";
import { fetchJson } from "./fetch";
import {
  type ClinGenImportedRecord,
  type ClinicalActionabilityRow,
  makeClinGenRecordId,
  normaliseHgncId,
  normaliseMondoId,
  splitListField,
} from "./normalise";

function extractActionabilityRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (Array.isArray(obj.results)) return obj.results as Record<string, unknown>[];
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const columns = obj.columns.map((column) => String(column));
      const rows: Record<string, unknown>[] = [];
      for (const row of obj.rows) {
        if (!Array.isArray(row)) continue;

        const entry: Record<string, unknown> = {};
        for (let index = 0; index < columns.length; index += 1) {
          entry[columns[index]] = row[index];
        }
        rows.push(entry);
      }
      return rows;
    }
  }
  return [];
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function normaliseRow(
  raw: Record<string, unknown>,
  context: "Adult" | "Pediatric",
): ClinicalActionabilityRow {
  return {
    context,
    geneSymbol:
      str(raw["gene"]) ??
      str(raw["geneSymbol"]) ??
      str(raw["gene_symbol"]) ??
      str(raw["hgnc_symbol"]) ??
      str(raw["geneOrVariant"]),
    hgncId: normaliseHgncId(str(raw["hgncId"] ?? raw["hgnc_id"] ?? raw["gene_id"])),
    diseaseLabel:
      str(raw["disease"]) ??
      str(raw["diseaseLabel"]) ??
      str(raw["disease_label"]) ??
      str(raw["condition"]),
    mondoId: normaliseMondoId(
      str(raw["mondoId"] ?? raw["mondo_id"] ?? raw["disease_id"]),
    ),
    reportUrl:
      str(raw["reportUrl"]) ??
      str(raw["report_url"]) ??
      str(raw["url"]) ??
      str(raw["report"]) ??
      str(raw["contextIri"]),
    actionabilityAssertions: splitListField(
      str(
        raw["assertions"] ??
          raw["actionability_assertions"] ??
          raw["assertion"] ??
          raw["outcome"] ??
          raw["intervention"],
      ),
    ),
    overallScore: str(raw["overallScore"] ?? raw["overall_score"] ?? raw["score"] ?? raw["overall"]),
    sourceRaw: raw,
  };
}

function toImportedRecord(
  row: ClinicalActionabilityRow,
  fetchedAt: string,
): ClinGenImportedRecord {
  const id = makeClinGenRecordId([
    "clinical_actionability",
    row.context.toLowerCase(),
    row.hgncId ?? row.geneSymbol,
    row.mondoId ?? row.diseaseLabel,
  ]);

  return {
    id,
    source: "clinical_actionability",
    geneSymbol: row.geneSymbol,
    hgncId: row.hgncId,
    diseaseLabel: row.diseaseLabel,
    mondoId: row.mondoId,
    reportUrl: row.reportUrl,
    raw: row.sourceRaw,
    fetchedAt,
  };
}

async function importFromUrl(
  url: string,
  context: "Adult" | "Pediatric",
): Promise<ClinGenImportedRecord[]> {
  const json = await fetchJson(url);
  return parseClinicalActionabilityJson(json, context);
}

export function parseClinicalActionabilityJson(
  json: unknown,
  context: "Adult" | "Pediatric",
): ClinGenImportedRecord[] {
  const rows = extractActionabilityRows(json);

  if (rows.length === 0) {
    console.warn(`ClinGen [clinical_actionability ${context}]: no rows in JSON response`);
    return [];
  }

  const headers = Object.keys(rows[0] ?? {});
  console.log(
    `ClinGen [clinical_actionability ${context}]: detected fields: ${headers.join(", ")}`,
  );

  const fetchedAt = new Date().toISOString();
  const records: ClinGenImportedRecord[] = [];

  for (const raw of rows) {
    const row = normaliseRow(raw, context);
    records.push(toImportedRecord(row, fetchedAt));
  }

  console.log(
    `ClinGen [clinical_actionability ${context}]: ${records.length} records normalised`,
  );
  return records;
}

export async function importClinicalActionabilityAdult(): Promise<ClinGenImportedRecord[]> {
  return importFromUrl(CLINGEN_ACTIONABILITY_ADULT_FLAT_JSON, "Adult");
}

export async function importClinicalActionabilityPediatric(): Promise<ClinGenImportedRecord[]> {
  return importFromUrl(CLINGEN_ACTIONABILITY_PEDIATRIC_FLAT_JSON, "Pediatric");
}

export async function importClinicalActionability(): Promise<ClinGenImportedRecord[]> {
  const [adult, pediatric] = await Promise.all([
    importClinicalActionabilityAdult(),
    importClinicalActionabilityPediatric(),
  ]);
  return [...adult, ...pediatric];
}
