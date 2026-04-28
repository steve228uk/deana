export type ProviderName =
  | "AncestryDNA"
  | "23andMe"
  | "MyHeritage"
  | "FamilyTreeDNA"
  | "LivingDNA"
  | "tellmeGen"
  | "meuDNA"
  | "Genera"
  | "MTHFR Genetics"
  | "SelfDecode"
  | "Reich"
  | "National Geographic Geno"
  | "Nebula Genomics"
  | "VCF"
  | "Unknown";

export type GenomeBuild = "GRCh37" | "GRCh38";
export type InsightCategory = "medical" | "traits" | "drug";
export type ExplorerTab = "overview" | "medical" | "traits" | "drug" | "ai";
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

export interface DnaAnnotationStats {
  build: GenomeBuild;
  annotatedMarkers: number;
  eligibleRows: number;
  unannotatedRows: number;
  skippedNonSnvRows: number;
}

export interface DnaParseProgress {
  phase: "reading" | "parsing" | "annotating" | "complete";
  percent: number;
  message: string;
}

export interface ParsedDnaFile {
  provider: ProviderName;
  build: string;
  markerCount: number;
  fileName: string;
  importedFrom: "zip" | "gzip" | "text";
  markers: CompactMarker[];
  annotation?: DnaAnnotationStats;
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
  annotationIndexes?: Array<{
    build: GenomeBuild;
    recordsPath: string;
    recordsSha256: string;
    recordCount: number;
    matchedRsidCount: number;
    missingRsidCount: number;
    sourcePath: string;
    sourceSha256?: string;
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
  riskSummary?: string;
  qualityTier?: "tier-1";
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
  packStage?: "manifest" | "records" | "checksum" | "matching" | "saving" | "indexing";
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

export interface AiConsentAcceptance {
  accepted: true;
  version: number;
  acceptedAt: string;
}

export interface StoredAiConsent extends AiConsentAcceptance {
  profileId: string;
  chatNoticeDismissedAt?: string;
}

export interface ChatTraceFinding {
  id: string;
  title: string;
  category: InsightCategory;
  matchedFields: string[];
  markerRsids: string[];
  sourceNames: string[];
}

export interface ChatSearchPlan {
  query: string;
  categories: InsightCategory[];
  genes: string[];
  rsids: string[];
  topics: string[];
  conditions: string[];
  relatedTerms: string[];
  evidence: EvidenceTier[];
  rationale: string;
}

export type ChatTraceSearchPlan = ChatSearchPlan;

export interface ChatRetrievalCursor {
  hasMore: boolean;
  nextOffset: number;
  sentFindingIds: string[];
}

export interface ChatRetrievalTrace {
  searchedAt: string;
  scannedCategories: InsightCategory[];
  searchedTerms: string[];
  relatedTerms: string[];
  resultCount: number;
  sentCount?: number;
  candidateWindowCount?: number;
  remainingCandidateCount?: number;
  returnedFindings: ChatTraceFinding[];
  rationale: string;
  searchPlan?: ChatSearchPlan;
  retrievalCursor?: ChatRetrievalCursor;
  indexCandidateCount?: number;
  usedFallback?: boolean;
  timingMs?: {
    total: number;
    indexWait: number;
    indexSearch: number;
    idbRead: number;
    fallbackScan: number;
    scoring: number;
  };
}

export interface ChatFollowUpSuggestion {
  title: string;
  body: string;
}

export interface StoredChatContextFinding {
  id: string;
  link: string;
  category: InsightCategory;
  title: string;
  summary: string;
  detail: string;
  whyItMatters: string;
  genotypeSummary: string;
  genes: string[];
  topics: string[];
  conditions: string[];
  warnings: string[];
  sourceNotes: string[];
  markers: Array<{
    rsid: string;
    genotype: string | null;
    gene?: string;
    matchedAllele?: string;
    matchedAlleleCount?: number | null;
  }>;
  evidenceTier: EvidenceTier;
  clinicalSignificance: string | null;
  normalizedClinicalSignificance: string | null;
  repute: ReputeStatus;
  coverage: CoverageStatus;
  confidenceNote: string;
  disclaimer: string;
  frequencyNote: string;
  sourceGenotype: string;
  publicationCount: number;
  sourceNames: string[];
  sourceUrls: string[];
}

export interface StoredChatThread {
  id: string;
  profileId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatMessage {
  id: string;
  threadId: string;
  profileId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  trace?: ChatRetrievalTrace;
  contextFindings?: StoredChatContextFinding[];
  reasoningSummary?: string | null;
  followUps?: ChatFollowUpSuggestion[];
}

export interface ExplorerPage {
  entries: StoredReportEntry[];
  nextCursor: string | null;
  totalLoaded: number;
  hasMore: boolean;
}
