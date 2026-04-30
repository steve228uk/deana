export type ClinGenSource =
  | "gene_disease_validity"
  | "dosage_sensitivity"
  | "clinical_actionability"
  | "variant_pathogenicity"
  | "summary_report";

export type ClinGenImportedRecord = {
  id: string;
  source: ClinGenSource;
  geneSymbol?: string | null;
  hgncId?: string | null;
  diseaseLabel?: string | null;
  mondoId?: string | null;
  classification?: string | null;
  assertion?: string | null;
  reportUrl?: string | null;
  lastEvaluatedDate?: string | null;
  publishedDate?: string | null;
  raw: Record<string, unknown>;
  fetchedAt: string;
};

export type GeneDiseaseValidityRow = {
  geneSymbol: string;
  hgncId: string | null;
  diseaseLabel: string;
  mondoId: string | null;
  modeOfInheritance: string | null;
  sop: string | null;
  classification: string;
  onlineReportUrl: string | null;
  classificationDate: string | null;
  gcep: string | null;
};

export type DosageSensitivityRow = {
  type: "gene" | "region";
  symbolOrRegion: string;
  geneIdOrIscaId: string | null;
  cytoband: string | null;
  genomicLocation: string | null;
  haploinsufficiencyScore: string | null;
  haploinsufficiencyDescription: string | null;
  haploinsufficiencyPmids: string[];
  triplosensitivityScore: string | null;
  triplosensitivityDescription: string | null;
  triplosensitivityPmids: string[];
  dateLastEvaluated: string | null;
  lossPhenotypeOmimId: string | null;
  triplosensitivePhenotypeOmimId: string | null;
};

export type VariantPathogenicityRow = {
  variation: string;
  clinvarVariationId: string | null;
  alleleRegistryId: string | null;
  hgvsExpressions: string[];
  geneSymbol: string | null;
  diseaseLabel: string | null;
  mondoId: string | null;
  modeOfInheritance: string | null;
  assertion: string | null;
  evidenceCodesMet: string[];
  evidenceCodesNotMet: string[];
  summaryOfInterpretation: string | null;
  pubmedIds: string[];
  expertPanel: string | null;
  guideline: string | null;
  approvalDate: string | null;
  publishedDate: string | null;
  retracted: boolean;
  evidenceRepoLink: string | null;
  uuid: string | null;
};

export type ClinicalActionabilityRow = {
  context: "Adult" | "Pediatric";
  geneSymbol: string | null;
  hgncId: string | null;
  diseaseLabel: string | null;
  mondoId: string | null;
  reportUrl: string | null;
  actionabilityAssertions: string[];
  overallScore: string | null;
  sourceRaw: Record<string, unknown>;
};

export function normaliseHgncId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("HGNC:") ? trimmed : `HGNC:${trimmed.replace(/^HGNC:/i, "")}`;
}

export function normaliseMondoId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("MONDO:") ? trimmed : `MONDO:${trimmed.replace(/^MONDO:/i, "")}`;
}

export function splitListField(value: string | null | undefined): string[] {
  if (!value) return [];

  return value
    .split(/[;,|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function extractPmidsFromRow(
  row: Record<string, string>,
  prefix: "Haploinsufficiency" | "Triplosensitivity",
): string[] {
  return Object.entries(row)
    .filter(([key]) => key.toLowerCase().includes(prefix.toLowerCase()))
    .filter(([key]) => key.toLowerCase().includes("pmid"))
    .flatMap(([, value]) => splitListField(value))
    .filter(Boolean);
}

export function makeClinGenRecordId(parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .map((part) =>
      String(part)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:._-]+/g, "-"),
    )
    .join("__");
}

export function nullIfEmpty(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
