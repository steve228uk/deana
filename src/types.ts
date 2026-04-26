export type ProviderName =
  | "AncestryDNA"
  | "23andMe"
  | "MyHeritage"
  | "FamilyTreeDNA"
  | "Nebula Genomics"
  | "VCF"
  | "Unknown";

export type InsightCategory = "medical" | "traits" | "drug";
export type ExplorerTab = "overview" | "medical" | "traits" | "drug";
export type InsightTone = "neutral" | "good" | "caution";
export type FindingOutcome = "negative" | "positive" | "informational" | "missing";
export type CoverageStatus = "full" | "partial" | "missing";
export type EvidenceTier = "high" | "moderate" | "emerging" | "preview" | "supplementary";
export type ReputeStatus = "good" | "bad" | "mixed" | "not-set";
export type PublicationBucket = "0" | "1-5" | "6-20" | "21+";
export type ReportEntryKind = "curated" | "local-evidence";
export type EvidenceEnrichmentStatus = "idle" | "running" | "partial" | "complete" | "failed";
export type EvidenceSourceRole = "primary" | "frequency-context" | "citation" | "supplementary";

export type CompactMarker = [rsid: string, chromosome: string, position: number, genotype: string];

export interface ParsedDnaFile {
  provider: ProviderName;
  build: string;
  markerCount: number;
  fileName: string;
  importedFrom: "zip" | "gzip" | "text";
  markers: CompactMarker[];
}

export interface EvidenceSource {
  id: string;
  name: string;
  url: string;
  citation: string;
  evidenceNote: string;
  populationNote: string;
  chipCaveat: string;
  disclaimer: string;
}

export interface EvidencePackManifest {
  version: string;
  schemaVersion: number;
  generatedAt: string;
  recordsPath?: string;
  recordsSha256?: string;
  shardStrategy?: "rsid-modulo";
  shardModulo?: number;
  shards?: Array<{
    id: string;
    recordsPath: string;
    recordsSha256: string;
    recordCount: number;
    bucket: number;
  }>;
  recordCount?: number;
  attribution: string;
  sources: Array<{
    id: string;
    name: string;
    release: string;
    url: string;
    role: EvidenceSourceRole;
  }>;
}

export interface EvidencePackRecord {
  id: string;
  entryId: string;
  sourceId: string;
  role: EvidenceSourceRole;
  category?: InsightCategory;
  subcategory?: string;
  markerIds: string[];
  genes: string[];
  title: string;
  technicalName?: string;
  summary?: string;
  detail?: string;
  whyItMatters?: string;
  topics?: string[];
  conditions?: string[];
  url: string;
  release: string;
  evidenceLevel: EvidenceTier;
  clinicalSignificance: string | null;
  repute?: ReputeStatus;
  tone?: InsightTone;
  riskAllele?: string;
  genotype?: string;
  magnitude?: number | null;
  pmids: string[];
  frequencyNote?: string;
  notes: string[];
}

export interface MatchedMarker {
  rsid: string;
  genotype: string | null;
  chromosome: string | null;
  position: number | null;
  gene?: string;
  matchedAllele?: string;
  matchedAlleleCount?: number | null;
}

export interface ReportEntrySource {
  id: string;
  name: string;
  url: string;
}

export interface ReportEntry {
  id: string;
  entryKind: ReportEntryKind;
  category: InsightCategory;
  subcategory: string;
  title: string;
  summary: string;
  detail: string;
  whyItMatters: string;
  genotypeSummary: string;
  matchedMarkers: MatchedMarker[];
  genes: string[];
  topics: string[];
  conditions: string[];
  warnings: string[];
  sources: ReportEntrySource[];
  sourceNotes: string[];
  evidenceTier: EvidenceTier;
  clinicalSignificance: string | null;
  normalizedClinicalSignificance: string | null;
  repute: ReputeStatus;
  publicationCount: number;
  publicationBucket: PublicationBucket;
  frequencyNote?: string;
  magnitude?: number | null;
  sourceGenotype?: string;
  sourcePageKey?: string;
  sourcePageUrl?: string;
  coverage: CoverageStatus;
  tone: InsightTone;
  outcome: FindingOutcome;
  sort: {
    severity: number;
    evidence: number;
    alphabetical: string;
    publications: number;
  };
  confidenceNote: string;
  disclaimer: string;
}

export interface TabSummary {
  tab: ExplorerTab;
  label: string;
  description: string;
  count: number;
}

export interface ReportOverview {
  provider: ProviderName;
  build: string;
  markerCount: number;
  parsedAt: string;
  coverageScore: number;
  curatedMarkerMatches: number;
  sourceMix: Array<{ source: string; count: number }>;
  warnings: string[];
  evidenceStatus: EvidenceEnrichmentStatus;
  evidencePackVersion: string;
  evidenceProcessedRsids: number;
  evidenceMatchedFindings: number;
  localEvidenceRecordMatches: number;
  localEvidenceEntryMatches: number;
  localEvidenceMatchedRsids: number;
  evidenceUnmatchedRsids: number;
  evidenceFailedItems: number;
}

export interface ReportFacets {
  sources: string[];
  evidenceTiers: EvidenceTier[];
  coverages: CoverageStatus[];
  reputes: ReputeStatus[];
  clinicalSignificances: string[];
  clinicalSignificanceLabels: Record<string, string>;
  genes: string[];
  tags: string[];
  conditions: string[];
  publicationBuckets: PublicationBucket[];
}

export interface ReportData {
  reportVersion: number;
  evidencePackVersion: string;
  overview: ReportOverview;
  tabs: TabSummary[];
  entries: ReportEntry[];
  facets: ReportFacets;
}

export interface ReportDataMeta {
  reportVersion: number;
  evidencePackVersion: string;
  overview: ReportOverview;
  tabs: TabSummary[];
  facets: ReportFacets;
}

export interface ProfileSupplements {
  evidence?: EvidenceSupplement;
}

export interface EvidenceFailedItem {
  stage: "manifest" | "records" | "checksum" | "matching";
  attempts: number;
  message: string;
}

export interface EvidencePackMatch {
  record: EvidencePackRecord;
  matchedMarkers: MatchedMarker[];
}

export interface EvidenceProgressSnapshot {
  status: EvidenceEnrichmentStatus;
  totalRsids: number;
  processedRsids: number;
  matchedFindings: number;
  unmatchedRsids: number;
  failedRsids: number;
  retries: number;
  currentRsid: string | null;
  packStage?: "manifest" | "records" | "checksum" | "matching" | "saving";
  packVersion?: string;
}

export interface EvidenceSupplement {
  status: EvidenceEnrichmentStatus;
  fetchedAt: string | null;
  attribution: string;
  packVersion: string;
  manifest: EvidencePackManifest | null;
  totalRsids: number;
  processedRsids: number;
  matchedRecords: EvidencePackMatch[];
  unmatchedRsids: number;
  failedItems: EvidenceFailedItem[];
  retries: number;
}

export interface SavedProfile {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
  dna: ParsedDnaFile;
  supplements?: ProfileSupplements;
  reportVersion: number;
  evidencePackVersion: string;
  report: ReportData;
}

export interface DnaSummary {
  provider: ProviderName;
  build: string;
  markerCount: number;
}

export interface SavedProfileSummary {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
  dna: DnaSummary;
  reportVersion: number;
  evidencePackVersion: string;
  report: Pick<ReportDataMeta, "overview">;
}

export interface ProfileMeta {
  id: string;
  name: string;
  fileName: string;
  createdAt: string;
  dna: ParsedDnaFile;
  supplements?: ProfileSupplements;
  reportVersion: number;
  evidencePackVersion: string;
  report: ReportDataMeta;
}

export interface StoredReportEntry extends ReportEntry {
  profileId: string;
  searchText: string;
}

export interface ExplorerPage {
  entries: StoredReportEntry[];
  nextCursor: string | null;
  totalLoaded: number;
  hasMore: boolean;
}
