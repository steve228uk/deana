export type ProviderName =
  | "AncestryDNA"
  | "23andMe"
  | "MyHeritage"
  | "FamilyTreeDNA"
  | "Unknown";

export type InsightCategory = "medical" | "traits" | "drug";
export type ExplorerTab = "overview" | "medical" | "traits" | "drug" | "raw";
export type InsightTone = "neutral" | "good" | "caution";
export type CoverageStatus = "full" | "partial" | "missing";
export type EvidenceTier = "high" | "moderate" | "emerging" | "preview" | "supplementary";
export type ReputeStatus = "good" | "bad" | "mixed" | "not-set";
export type PublicationBucket = "0" | "1-5" | "6-20" | "21+";
export type SnpediaEnrichmentStatus = "idle" | "running" | "partial" | "complete" | "failed";

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

export interface MatchedMarker {
  rsid: string;
  genotype: string | null;
  chromosome: string | null;
  position: number | null;
  gene?: string;
}

export interface ReportEntrySource {
  id: string;
  name: string;
  url: string;
}

export interface ReportEntry {
  id: string;
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
  repute: ReputeStatus;
  publicationCount: number;
  publicationBucket: PublicationBucket;
  frequencyNote?: string;
  magnitude?: number | null;
  sourcePageKey?: string;
  sourcePageUrl?: string;
  coverage: CoverageStatus;
  tone: InsightTone;
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
  snpediaStatus: SnpediaEnrichmentStatus;
  snpediaProcessedRsids: number;
  snpediaTotalRsids: number;
  snpediaMatchedFindings: number;
  snpediaUnmatchedRsids: number;
  snpediaFailedRsids: number;
}

export interface ReportFacets {
  sources: string[];
  evidenceTiers: EvidenceTier[];
  coverages: CoverageStatus[];
  reputes: ReputeStatus[];
  clinicalSignificances: string[];
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

export interface SnpediaFinding {
  id: string;
  rsid: string;
  pageKey: string;
  pageTitle: string;
  pageUrl: string;
  genotype: string | null;
  summary: string;
  detail: string;
  genes: string[];
  topics: string[];
  conditions: string[];
  clinicalSignificance: string | null;
  category: InsightCategory;
  repute: ReputeStatus;
  publicationCount: number;
  chromosome: string | null;
  position: number | null;
  magnitude: number | null;
  fetchedAt: string;
}

export interface SnpediaFailedItem {
  rsid: string;
  stage: "rs-page" | "genotype-page";
  attempts: number;
  message: string;
}

export interface SnpediaProgressSnapshot {
  status: SnpediaEnrichmentStatus;
  totalRsids: number;
  processedRsids: number;
  matchedFindings: number;
  unmatchedRsids: number;
  failedRsids: number;
  retries: number;
  currentRsid: string | null;
  snpediaSnapshotPage?: number;
  snpediaSnapshotTotalPages?: number | null;
  snpediaSnapshotRsids?: number;
}

export interface SnpediaSupplement {
  status: SnpediaEnrichmentStatus;
  fetchedAt: string | null;
  attribution: string;
  totalRsids: number;
  processedRsids: number;
  matchedFindings: SnpediaFinding[];
  unmatchedRsids: number;
  failedItems: SnpediaFailedItem[];
  retries: number;
}

export interface ProfileSupplements {
  snpedia: SnpediaSupplement;
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

export interface RawMarkerResult {
  rsid: string;
  chromosome: string;
  position: number;
  genotype: string;
  linkedEntries: Pick<ReportEntry, "id" | "title" | "category" | "genes">[];
}
