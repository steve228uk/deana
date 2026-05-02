import { CLINGEN_GENE_DISEASE_VALIDITY_CSV } from "./endpoints";
import { fetchHtml, fetchText } from "./fetch";
import { parseCsvWithDetectedHeader, warnMissingFields } from "./parseDelimited";
import {
  type ClinGenImportedRecord,
  type GeneDiseaseValidityRow,
  makeClinGenRecordId,
  normaliseHgncId,
  normaliseMondoId,
  nullIfEmpty,
} from "./normalise";

const SOURCE = "gene_disease_validity";
const LOG_PREFIX = `ClinGen [${SOURCE}]`;
const DETAIL_FETCH_CONCURRENCY = 4;
export const INCLUDED_GENE_DISEASE_VALIDITY_CLASSIFICATIONS = new Set([
  "Definitive",
  "Strong",
  "Moderate",
]);

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

const ALPHANUMERIC_PATTERN = /[a-z0-9]/i;
const PMID_FIELD_PATTERN = /\bPMIDs?\s*:?\s*([0-9,;\s]+)/gi;
const PUBMED_FIELD_PATTERN = /\bPubMed(?:\s+ID)?\s*:?\s*(\d{6,9})\b/gi;
const PMID_PATTERN = /\b\d{6,9}\b/g;

function hasAlphanumeric(value: string): boolean {
  return ALPHANUMERIC_PATTERN.test(value);
}

function isUsableGeneDiseaseRow(row: GeneDiseaseValidityRow): boolean {
  return (
    Boolean(row.geneSymbol) &&
    Boolean(row.diseaseLabel) &&
    hasAlphanumeric(row.geneSymbol) &&
    hasAlphanumeric(row.diseaseLabel)
  );
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
    source: SOURCE,
    geneSymbol: row.geneSymbol || null,
    hgncId: row.hgncId,
    diseaseLabel: row.diseaseLabel || null,
    mondoId: row.mondoId,
    classification: row.classification || null,
    reportUrl: row.onlineReportUrl,
    lastEvaluatedDate: row.classificationDate,
    pmids: [],
    raw,
    fetchedAt,
  };
}

export async function importGeneDiseaseValidity(): Promise<ClinGenImportedRecord[]> {
  const text = await fetchText(CLINGEN_GENE_DISEASE_VALIDITY_CSV, "text/csv,text/plain,*/*");
  return enrichGeneDiseaseValidityPmids(parseGeneDiseaseValidityText(text));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
}

function extractPubMedIdsFromText(text: string): string[] {
  const pmids = new Set<string>();

  for (const match of text.matchAll(PMID_FIELD_PATTERN)) {
    for (const pmid of match[1].match(PMID_PATTERN) ?? []) {
      pmids.add(pmid);
    }
  }

  for (const match of text.matchAll(PUBMED_FIELD_PATTERN)) {
    pmids.add(match[1]);
  }

  return Array.from(pmids);
}

export function extractPubMedIdsFromClinGenDetailHtml(html: string): string[] {
  const text = htmlToText(html);
  const referencesIndex = text.lastIndexOf("References");

  if (referencesIndex >= 0) {
    const referencePmids = extractPubMedIdsFromText(text.slice(referencesIndex));
    if (referencePmids.length > 0) return referencePmids;
  }

  return extractPubMedIdsFromText(text);
}

function hasIncludedGeneDiseaseClassification(record: ClinGenImportedRecord): boolean {
  return Boolean(
    record.classification &&
      INCLUDED_GENE_DISEASE_VALIDITY_CLASSIFICATIONS.has(record.classification),
  );
}

export async function enrichGeneDiseaseValidityPmids(
  records: ClinGenImportedRecord[],
  fetchDetailHtml: (url: string) => Promise<string> = fetchHtml,
): Promise<ClinGenImportedRecord[]> {
  const enriched: ClinGenImportedRecord[] = [];
  const publicationTargets: Array<{ index: number; url: string }> = [];

  for (const record of records) {
    const enrichedRecord = { ...record, pmids: record.pmids ?? [] };
    const index = enriched.push(enrichedRecord) - 1;
    if (enrichedRecord.reportUrl && hasIncludedGeneDiseaseClassification(enrichedRecord)) {
      publicationTargets.push({ index, url: enrichedRecord.reportUrl });
    }
  }

  let nextPublicationTarget = 0;

  async function worker(): Promise<void> {
    while (nextPublicationTarget < publicationTargets.length) {
      const target = publicationTargets[nextPublicationTarget];
      nextPublicationTarget += 1;

      try {
        const html = await fetchDetailHtml(target.url);
        const record = enriched[target.index];
        enriched[target.index] = {
          ...record,
          pmids: extractPubMedIdsFromClinGenDetailHtml(html),
        };
      } catch (error) {
        console.warn(
          `${LOG_PREFIX}: failed to fetch publication detail for ${target.url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(DETAIL_FETCH_CONCURRENCY, publicationTargets.length) },
      () => worker(),
    ),
  );

  const pmidCount = enriched.reduce((total, record) => total + (record.pmids?.length ?? 0), 0);
  console.log(
    `${LOG_PREFIX}: ${pmidCount.toLocaleString()} PubMed IDs extracted from detail pages`,
  );

  return enriched;
}

export function parseGeneDiseaseValidityText(text: string): ClinGenImportedRecord[] {
  const result = parseCsvWithDetectedHeader(text);

  if (result.data.length === 0) {
    console.warn(`${LOG_PREFIX}: no rows parsed`);
    return [];
  }

  const headers = Object.keys(result.data[0] ?? {});
  warnMissingFields(SOURCE, headers, EXPECTED_FIELDS);
  console.log(`${LOG_PREFIX}: detected headers: ${headers.join(", ")}`);

  const fetchedAt = new Date().toISOString();
  const records: ClinGenImportedRecord[] = [];

  for (const raw of result.data) {
    const row = normaliseRow(raw);
    if (!isUsableGeneDiseaseRow(row)) continue;
    records.push(toImportedRecord(row, raw, fetchedAt));
  }

  console.log(`${LOG_PREFIX}: ${records.length} records normalised`);
  return records;
}
