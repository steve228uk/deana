import MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";
import {
  deleteSearchIndexCache,
  loadSearchIndexCache,
  loadSearchIndexSource,
  saveSearchIndexCache,
} from "../storage";
import { rankingQualityMultiplier } from "../ranking";
import type {
  CompactMarker,
  EvidenceTier,
  FindingOutcome,
  MarkerExplorerPage,
  MarkerSort,
  ReputeStatus,
  StoredMarkerSummary,
  StoredReportEntry,
} from "../../types";
import type { ExplorerFilters } from "../explorer";

interface LightEntry {
  id: string;
  category: StoredReportEntry["category"];
  title: string;
  genes: string;
  topics: string;
  conditions: string;
  rsids: string;
  evidenceTier: EvidenceTier;
  outcome: FindingOutcome;
  sourceNames: string[];
  significance: string;
  repute: ReputeStatus;
  coverage: string;
  publicationBucket: string;
  geneValues: string[];
  tagValues: string[];
  markers: string;
  body: string;
  // Sort fields stored with the document but outside the search fields,
  // so MiniSearch does not build index entries for them.
  sortSeverity: number;
  sortRank: number;
  sortEvidence: number;
  sortPublications: number;
  sortAlphabetical: string;
}

interface MarkerDocument extends StoredMarkerSummary {
  id: string;
  genesText: string;
  body: string;
  sortOrder: number;
}

export interface SearchCandidate {
  id: string;
  score: number;
  category: string;
  evidenceTier: EvidenceTier;
  genes: string;
  topics: string;
  conditions: string;
  rsids: string;
  title: string;
  sortSeverity: number;
  sortEvidence: number;
  outcome: FindingOutcome;
  repute: ReputeStatus;
}

export interface SearchExplorerEntryIdsRequest {
  profileId: string;
  category: StoredReportEntry["category"];
  filters: ExplorerFilters;
  offset: number;
  limit: number;
}

export interface SearchExplorerEntryIdsResult {
  ids: string[];
  count: number;
  indexStatus: SearchIndexStatus;
}

export interface SearchMarkerPageRequest {
  profileId: string;
  query: string;
  sort: MarkerSort;
  offset: number;
  limit: number;
}

export interface SearchMarkerPageResult extends MarkerExplorerPage {
  indexStatus: SearchIndexStatus;
}

export type SearchIndexFallbackReason = "memory-budget" | "unavailable" | "index-error";

export type SearchIndexStatus =
  | { state: "ready"; documentCount: number }
  | { state: "skipped"; reason: SearchIndexFallbackReason; documentCount: number; message: string }
  | { state: "failed"; reason: SearchIndexFallbackReason; documentCount?: number; message: string };

export type WorkerRequest =
  | { type: "prewarm"; requestId: string; profileId: string }
  | { type: "waitForIndex"; requestId: string; profileId: string }
  | { type: "searchExplorer"; requestId: string; payload: SearchExplorerEntryIdsRequest }
  | { type: "prewarmMarkers"; requestId: string; profileId: string }
  | { type: "searchMarkers"; requestId: string; payload: SearchMarkerPageRequest }
  | { type: "loadMarker"; requestId: string; profileId: string; rsid: string }
  | { type: "searchWithFields"; requestId: string; profileId: string; terms: string[]; limit: number }
  | { type: "queryCandidates"; requestId: string; profileId: string; terms: string[]; limit: number }
  | { type: "clearIndex"; requestId: string; profileId?: string; options?: { preservePersistentCache?: boolean } };

export type WorkerResponse =
  | { type: "prewarm"; requestId: string; status: SearchIndexStatus }
  | { type: "waitForIndex"; requestId: string; status: SearchIndexStatus }
  | { type: "searchExplorer"; requestId: string; result: SearchExplorerEntryIdsResult }
  | { type: "prewarmMarkers"; requestId: string; status: SearchIndexStatus }
  | { type: "searchMarkers"; requestId: string; result: SearchMarkerPageResult }
  | { type: "loadMarker"; requestId: string; result: StoredMarkerSummary | null }
  | { type: "searchWithFields"; requestId: string; result: SearchCandidate[] }
  | { type: "queryCandidates"; requestId: string; result: string[] }
  | { type: "clearIndex"; requestId: string }
  | { type: "error"; requestId: string; error: string };

const indexes = new Map<string, MiniSearch<LightEntry>>();
const indexStatuses = new Map<string, SearchIndexStatus>();
const inFlight = new Map<string, Promise<SearchIndexStatus>>();
const markerIndexes = new Map<string, MiniSearch<MarkerDocument>>();
const markerDocuments = new Map<string, MarkerDocument[]>();
const markerDocumentById = new Map<string, Map<string, MarkerDocument>>();
const markerIndexStatuses = new Map<string, SearchIndexStatus>();
const markerInFlight = new Map<string, Promise<SearchIndexStatus>>();

// Version 10: invalidates cached ranks after source-aware validity scoring changes.
const SEARCH_INDEX_CACHE_VERSION = 10;
const SEARCH_INDEX_INSERT_BATCH_SIZE = 500;
const LOW_MEMORY_MAX_DOCUMENTS = 125_000;
const LOW_MEMORY_MAX_TEXT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENTS = 250_000;
const DEFAULT_MAX_TEXT_BYTES = 512 * 1024 * 1024;

const INDEXED_PRIMARY_EVIDENCE_TIERS = new Set<EvidenceTier>(["high", "moderate"]);
const EMPTY_READY_STATUS: SearchIndexStatus = { state: "ready", documentCount: 0 };

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
};

interface SearchIndexMemoryBudget {
  maxDocuments: number;
  maxTextBytes: number;
}

const SEARCH_INDEX_FIELD_BOOSTS = {
  rsids: 12,
  markers: 10,
  genes: 8,
  conditions: 6,
  title: 6,
  topics: 3,
  body: 1,
} as const;

const EXPLORER_ARRAY_FILTER_FIELDS: Array<[
  "evidence" | "significance" | "repute" | "coverage" | "publications" | "gene" | "tag",
  keyof LightEntry,
]> = [
  ["evidence", "evidenceTier"],
  ["significance", "significance"],
  ["repute", "repute"],
  ["coverage", "coverage"],
  ["publications", "publicationBucket"],
  ["gene", "geneValues"],
  ["tag", "tagValues"],
];

function createSearchIndex(): MiniSearch<LightEntry> {
  return new MiniSearch<LightEntry>({
    idField: "id",
    fields: ["title", "genes", "topics", "conditions", "rsids", "markers", "body"],
    storeFields: [
      "id", "category", "evidenceTier", "genes", "topics", "conditions", "rsids",
      "title", "sortSeverity", "sortRank", "sortEvidence", "sortPublications", "sortAlphabetical",
      "outcome", "significance", "repute", "coverage", "publicationBucket",
      "geneValues", "tagValues", "sourceNames",
    ],
  });
}

function createMarkerIndex(): MiniSearch<MarkerDocument> {
  return new MiniSearch<MarkerDocument>({
    idField: "id",
    fields: ["rsid", "genotype", "chromosome", "genesText", "body"],
  });
}

function navigatorLike(): NavigatorLike | null {
  return typeof navigator === "undefined" ? null : navigator;
}

function isLowMemoryDevice(): boolean {
  const nav = navigatorLike();
  if (!nav) return false;

  const userAgent = nav.userAgent ?? "";
  const platform = nav.platform ?? "";
  const isIphoneOrIpad =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);

  return isIphoneOrIpad || (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4);
}

function activeMemoryBudget(): SearchIndexMemoryBudget {
  return isLowMemoryDevice()
    ? { maxDocuments: LOW_MEMORY_MAX_DOCUMENTS, maxTextBytes: LOW_MEMORY_MAX_TEXT_BYTES }
    : { maxDocuments: DEFAULT_MAX_DOCUMENTS, maxTextBytes: DEFAULT_MAX_TEXT_BYTES };
}

function isHighSignalSupplementaryEntry(entry: StoredReportEntry): boolean {
  return (entry.magnitude ?? 0) >= 2 ||
    entry.publicationCount > 0 ||
    entry.repute === "bad" ||
    entry.repute === "mixed";
}

export function shouldIndexEntry(entry: StoredReportEntry): boolean {
  if (entry.entryKind === "curated") return true;

  const isSupplementary = entry.evidenceTier === "supplementary" || entry.subcategory === "snpedia";
  if (isSupplementary) return isHighSignalSupplementaryEntry(entry);

  return INDEXED_PRIMARY_EVIDENCE_TIERS.has(entry.evidenceTier);
}

function joinedLength(values: string[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value.length, values.length - 1);
}

function documentTextBytes(document: LightEntry): number {
  const fieldLengths = [
    document.id.length,
    document.category.length,
    document.title.length,
    document.genes.length,
    document.topics.length,
    document.conditions.length,
    document.rsids.length,
    document.evidenceTier.length,
    joinedLength(document.sourceNames),
    document.significance.length,
    document.repute.length,
    document.coverage.length,
    document.publicationBucket.length,
    joinedLength(document.geneValues),
    joinedLength(document.tagValues),
    document.markers.length,
    document.body.length,
  ];

  return (fieldLengths.reduce((total, length) => total + length, 0) + fieldLengths.length - 1) * 2;
}

function memoryBudgetSkipStatus(
  budget: SearchIndexMemoryBudget,
  documentCount: number,
  textBytes: number,
): SearchIndexStatus | null {
  if (documentCount <= budget.maxDocuments && textBytes <= budget.maxTextBytes) return null;

  return {
    state: "skipped",
    reason: "memory-budget",
    documentCount,
    message: `Local search index skipped because ${documentCount.toLocaleString()} documents exceed the device memory budget.`,
  };
}

function readyIndexStatus(documentCount: number): SearchIndexStatus {
  return { state: "ready", documentCount };
}

function setIndexStatus(profileId: string, status: SearchIndexStatus): SearchIndexStatus {
  indexStatuses.set(profileId, status);
  return status;
}

function toLightEntry(entry: StoredReportEntry): LightEntry {
  const markerParts: string[] = [];
  const rsids: string[] = [];
  for (const marker of entry.matchedMarkers) {
    rsids.push(marker.rsid);
    markerParts.push(marker.rsid);
    if (marker.gene) markerParts.push(marker.gene);
    if (marker.genotype) markerParts.push(marker.genotype);
    if (marker.matchedAllele) markerParts.push(marker.matchedAllele);
  }
  const body = [
    entry.summary.slice(0, 240),
    entry.detail.slice(0, 360),
    entry.sourceNotes.join(" ").slice(0, 240),
    (entry.searchText || "").slice(0, 480),
  ].filter(Boolean).join(" ");

  return {
    id: entry.id,
    category: entry.category,
    title: entry.title.slice(0, 120),
    genes: entry.genes.join(" "),
    topics: entry.topics.join(" "),
    conditions: entry.conditions.join(" "),
    rsids: rsids.join(" "),
    evidenceTier: entry.evidenceTier,
    outcome: entry.outcome,
    sourceNames: entry.sources.map((source) => source.name),
    significance: entry.normalizedClinicalSignificance ?? "",
    repute: entry.repute,
    coverage: entry.coverage,
    publicationBucket: entry.publicationBucket,
    geneValues: entry.genes,
    tagValues: [...entry.topics, ...entry.conditions],
    markers: markerParts.join(" "),
    body,
    sortRank: entry.sort.rank,
    sortSeverity: entry.sort.severity,
    sortEvidence: entry.sort.evidence,
    sortPublications: entry.sort.publications,
    sortAlphabetical: entry.sort.alphabetical,
  };
}

function markerId(rsid: string): string {
  return rsid.trim().toLowerCase();
}

function compactUnique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });
  return result;
}

function markerDocumentToSummary(document: Pick<
  MarkerDocument,
  "rsid" | "chromosome" | "position" | "genotype" | "genes" | "findingIds" | "findingTitles" | "findingCount"
>): StoredMarkerSummary {
  return {
    rsid: document.rsid,
    chromosome: document.chromosome,
    position: document.position,
    genotype: document.genotype,
    genes: document.genes,
    findingIds: document.findingIds,
    findingTitles: document.findingTitles,
    findingCount: document.findingCount,
  };
}

function setMarkerDocumentCache(
  profileId: string,
  documents: MarkerDocument[],
  status: SearchIndexStatus,
): SearchIndexStatus {
  markerDocuments.set(profileId, documents);
  markerDocumentById.set(profileId, new Map(documents.map((document) => [document.id, document])));
  markerIndexStatuses.set(profileId, status);
  return status;
}

function buildMarkerDocuments(markers: CompactMarker[], entries: StoredReportEntry[]): MarkerDocument[] {
  const aggregates = new Map<string, {
    genes: string[];
    findingIds: string[];
    findingTitles: string[];
    bodyParts: string[];
  }>();

  for (const entry of entries) {
    for (const marker of entry.matchedMarkers) {
      const id = markerId(marker.rsid);
      if (!id) continue;
      const aggregate = aggregates.get(id) ?? {
        genes: [],
        findingIds: [],
        findingTitles: [],
        bodyParts: [],
      };
      if (marker.gene) aggregate.genes.push(marker.gene);
      aggregate.genes.push(...entry.genes);
      aggregate.findingIds.push(entry.id);
      aggregate.findingTitles.push(entry.title);
      aggregate.bodyParts.push(
        entry.title,
        entry.summary,
        entry.genotypeSummary,
        ...entry.genes,
        ...entry.topics,
        ...entry.conditions,
        ...entry.sources.map((source) => source.name),
      );
      aggregates.set(id, aggregate);
    }
  }

  return markers.map((marker, index) => {
    const [rsid, chromosome, position, genotype] = marker;
    const aggregate = aggregates.get(markerId(rsid));
    const genes = compactUnique(aggregate?.genes ?? []);
    const findingIds = compactUnique(aggregate?.findingIds ?? []);
    const findingTitles = compactUnique(aggregate?.findingTitles ?? []);

    return {
      id: markerId(rsid),
      rsid,
      chromosome,
      position,
      genotype,
      genes,
      genesText: genes.join(" "),
      findingIds,
      findingTitles,
      findingCount: findingIds.length,
      body: compactUnique(aggregate?.bodyParts ?? []).join(" "),
      sortOrder: index,
    };
  });
}

function toSearchCandidate(result: SearchResult): SearchCandidate {
  return {
    id: result.id as string,
    score: result.score,
    category: result.category as string,
    evidenceTier: (result.evidenceTier as EvidenceTier) ?? "supplementary",
    genes: result.genes as string,
    topics: result.topics as string,
    conditions: result.conditions as string,
    rsids: result.rsids as string,
    title: result.title as string,
    sortSeverity: result.sortSeverity as number,
    sortEvidence: result.sortEvidence as number,
    outcome: (result.outcome as FindingOutcome) ?? "informational",
    repute: (result.repute as ReputeStatus) ?? "not-set",
  };
}

function insertBatched<T>(index: MiniSearch<T>, documents: T[]): void {
  let batch: T[] = [];
  for (const document of documents) {
    batch.push(document);
    if (batch.length >= SEARCH_INDEX_INSERT_BATCH_SIZE) {
      index.addAll(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    index.addAll(batch);
  }
}

function searchDocs(index: MiniSearch<LightEntry>, terms: string[], limit: number): SearchResult[] {
  if (terms.length === 0) return [];
  const query = terms.join(" ").trim();
  if (!query) return [];
  return index.search(query, {
    boost: SEARCH_INDEX_FIELD_BOOSTS,
    fuzzy: (term) => term.length >= 5 ? 0.2 : false,
    maxFuzzy: 2,
    prefix: true,
    combineWith: "OR",
  }).slice(0, limit);
}

function explorerFilter(category: StoredReportEntry["category"], filters: ExplorerFilters) {
  return (result: SearchResult): boolean => {
    if ((result.category as string) !== category) return false;
    if (filters.source && !(result.sourceNames as string[]).includes(filters.source)) return false;
    for (const [filterKey, documentField] of EXPLORER_ARRAY_FILTER_FIELDS) {
      const values = filters[filterKey];
      if (values.length === 0) continue;
      const docValue = result[documentField as string];
      if (Array.isArray(docValue)) {
        if (!values.some((v) => (docValue as string[]).includes(v))) return false;
      } else if (!values.includes(docValue as string)) return false;
    }
    return true;
  };
}

function compareExplorerDocuments(left: SearchResult, right: SearchResult, sort: ExplorerFilters["sort"]): number {
  switch (sort) {
    case "rank":
      return compareByRankThenTitle(left, right);
    case "alphabetical":
      return (left.sortAlphabetical as string).localeCompare(right.sortAlphabetical as string);
    case "publications":
      return (right.sortPublications as number) - (left.sortPublications as number)
        || (left.title as string).localeCompare(right.title as string);
    case "evidence":
      return (right.sortEvidence as number) - (left.sortEvidence as number)
        || (right.sortSeverity as number) - (left.sortSeverity as number)
        || (left.title as string).localeCompare(right.title as string);
    case "severity":
    default:
      return (right.sortSeverity as number) - (left.sortSeverity as number)
        || (right.sortEvidence as number) - (left.sortEvidence as number)
        || (left.title as string).localeCompare(right.title as string);
  }
}

function compareByRankThenTitle(left: SearchResult, right: SearchResult): number {
  return (right.sortRank as number) - (left.sortRank as number)
    || (right.sortSeverity as number) - (left.sortSeverity as number)
    || (right.sortEvidence as number) - (left.sortEvidence as number)
    || (left.title as string).localeCompare(right.title as string);
}

function compareRankSearchFallback(left: SearchResult, right: SearchResult): number {
  return (right.sortRank as number) - (left.sortRank as number)
    || (left.title as string).localeCompare(right.title as string);
}

function qualityMultiplier(result: SearchResult): number {
  return rankingQualityMultiplier({
    evidenceTier: result.evidenceTier,
    outcome: result.outcome,
    repute: result.repute,
  });
}

function explorerRelevanceScore(result: SearchResult): number {
  return result.score * qualityMultiplier(result);
}

export async function prewarmSearchIndex(profileId: string): Promise<SearchIndexStatus> {
  if (indexes.has(profileId)) return indexStatuses.get(profileId) ?? EMPTY_READY_STATUS;
  const existingStatus = indexStatuses.get(profileId);
  if (existingStatus && existingStatus.state !== "ready") return existingStatus;
  const pendingJob = inFlight.get(profileId);
  if (pendingJob) return pendingJob;

  const job = (async () => {
    const budget = activeMemoryBudget();

    const cached = await loadSearchIndexCache(profileId, SEARCH_INDEX_CACHE_VERSION);
    if (cached) {
      try {
        const documents = cached.rawData as LightEntry[];
        if (Array.isArray(documents) && documents.length > 0) {
          if (documents.length > budget.maxDocuments) {
            return setIndexStatus(profileId, memoryBudgetSkipStatus(budget, documents.length, 0)!);
          }
          const textBytes = documents.reduce((total, document) => total + documentTextBytes(document), 0);
          const budgetStatus = memoryBudgetSkipStatus(budget, documents.length, textBytes);
          if (budgetStatus) {
            return setIndexStatus(profileId, budgetStatus);
          }
          const index = createSearchIndex();
          insertBatched(index, documents);
          indexes.set(profileId, index);
          return setIndexStatus(profileId, readyIndexStatus(documents.length));
        }
      } catch {
        // Invalid cache; fall through to rebuild.
      }
    }

    const source = await loadSearchIndexSource(profileId);
    if (!source) {
      const index = createSearchIndex();
      indexes.set(profileId, index);
      return setIndexStatus(profileId, EMPTY_READY_STATUS);
    }

    const allDocuments: LightEntry[] = [];
    const seenIds = new Set<string>();
    let textBytes = 0;

    for (const entry of source.entries) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      if (!shouldIndexEntry(entry)) continue;
      const doc = toLightEntry(entry);
      textBytes += documentTextBytes(doc);
      allDocuments.push(doc);

      const budgetStatus = memoryBudgetSkipStatus(budget, allDocuments.length, textBytes);
      if (budgetStatus) {
        return setIndexStatus(profileId, budgetStatus);
      }
    }

    const index = createSearchIndex();
    if (allDocuments.length > 0) {
      insertBatched(index, allDocuments);
    }

    await saveSearchIndexCache({
      profileId,
      cacheVersion: SEARCH_INDEX_CACHE_VERSION,
      documentCount: allDocuments.length,
      rawData: allDocuments,
    });

    indexes.set(profileId, index);
    return setIndexStatus(profileId, readyIndexStatus(allDocuments.length));
  })().finally(() => inFlight.delete(profileId));

  inFlight.set(profileId, job);
  return job;
}

export async function prewarmMarkerIndex(profileId: string): Promise<SearchIndexStatus> {
  if (markerIndexes.has(profileId)) return markerIndexStatuses.get(profileId) ?? EMPTY_READY_STATUS;
  const existingStatus = markerIndexStatuses.get(profileId);
  if (existingStatus && existingStatus.state !== "ready") return existingStatus;
  const pendingJob = markerInFlight.get(profileId);
  if (pendingJob) return pendingJob;

  const job = (async () => {
    const source = await loadSearchIndexSource(profileId);
    if (!source) {
      const index = createMarkerIndex();
      markerIndexes.set(profileId, index);
      return setMarkerDocumentCache(profileId, [], readyIndexStatus(0));
    }

    const documents = buildMarkerDocuments(source.markers, source.entries);
    const budget = activeMemoryBudget();
    const textBytes = documents.reduce((total, document) => total + (
      document.rsid.length +
      document.chromosome.length +
      document.genotype.length +
      document.genesText.length +
      document.body.length
    ) * 2, 0);
    const budgetStatus = memoryBudgetSkipStatus(budget, documents.length, textBytes);
    if (budgetStatus) {
      return setMarkerDocumentCache(profileId, documents, budgetStatus);
    }

    const index = createMarkerIndex();
    if (documents.length > 0) insertBatched(index, documents);
    markerIndexes.set(profileId, index);
    return setMarkerDocumentCache(profileId, documents, readyIndexStatus(documents.length));
  })().finally(() => markerInFlight.delete(profileId));

  markerInFlight.set(profileId, job);
  return job;
}

function markerPageFromDocuments(
  documents: MarkerDocument[],
  offset: number,
  limit: number,
  indexStatus: SearchIndexStatus,
): SearchMarkerPageResult {
  const markers = documents.slice(offset, offset + limit).map(markerDocumentToSummary);
  const nextOffset = offset + markers.length;

  return {
    markers,
    nextCursor: nextOffset < documents.length ? JSON.stringify({ offset: nextOffset }) : null,
    totalLoaded: offset + markers.length,
    hasMore: nextOffset < documents.length,
    indexStatus,
  };
}

function rsidNumber(value: string): number {
  const match = /^rs(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function chromosomeRank(value: string): number {
  const normalized = value.trim().toUpperCase().replace(/^CHR/, "");
  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (normalized === "X") return 23;
  if (normalized === "Y") return 24;
  if (normalized === "M" || normalized === "MT") return 25;
  return 99;
}

function compareMarkerDocuments(left: MarkerDocument, right: MarkerDocument, sort: MarkerSort): number {
  switch (sort) {
    case "rsid":
      return rsidNumber(left.rsid) - rsidNumber(right.rsid)
        || left.rsid.localeCompare(right.rsid)
        || left.sortOrder - right.sortOrder;
    case "location":
      return chromosomeRank(left.chromosome) - chromosomeRank(right.chromosome)
        || left.position - right.position
        || rsidNumber(left.rsid) - rsidNumber(right.rsid)
        || left.sortOrder - right.sortOrder;
    case "raw":
      return left.sortOrder - right.sortOrder;
    case "findings":
    default:
      return right.findingCount - left.findingCount
        || rsidNumber(left.rsid) - rsidNumber(right.rsid)
        || left.sortOrder - right.sortOrder;
  }
}

function sortMarkerDocuments(documents: MarkerDocument[], sort: MarkerSort): MarkerDocument[] {
  if (sort === "raw") return documents;
  return [...documents].sort((left, right) => compareMarkerDocuments(left, right, sort));
}

function decodeMarkerOffset(cursorOffset: number): number {
  return Number.isFinite(cursorOffset) && cursorOffset > 0 ? cursorOffset : 0;
}

export async function searchMarkerPage({
  profileId,
  query,
  sort,
  offset,
  limit,
}: SearchMarkerPageRequest): Promise<SearchMarkerPageResult> {
  const status = await prewarmMarkerIndex(profileId);
  const documents = markerDocuments.get(profileId) ?? [];
  const normalizedOffset = decodeMarkerOffset(offset);
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  if (!trimmedQuery || status.state !== "ready") {
    const filteredDocuments = trimmedQuery
      ? documents.filter((document) => {
        const haystack = [
          document.rsid,
          document.genotype,
          document.chromosome,
          document.position,
          document.genesText,
          document.body,
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      : documents;
    return markerPageFromDocuments(sortMarkerDocuments(filteredDocuments, sort), normalizedOffset, limit, status);
  }

  const index = markerIndexes.get(profileId);
  if (!index) return markerPageFromDocuments(sortMarkerDocuments(documents, sort), normalizedOffset, limit, status);
  const documentsById = markerDocumentById.get(profileId) ?? new Map();

  const hits = index.search(trimmedQuery, {
    boost: {
      rsid: 12,
      genesText: 8,
      genotype: 4,
      chromosome: 2,
      body: 1,
    },
    fuzzy: (term) => term.length >= 5 ? 0.2 : false,
    maxFuzzy: 2,
    prefix: (term) => term.length >= 2,
    combineWith: "AND",
  })
    .map((result) => documentsById.get(result.id as string))
    .filter((document): document is MarkerDocument => Boolean(document));

  return markerPageFromDocuments(sortMarkerDocuments(hits, sort), normalizedOffset, limit, status);
}

export async function loadMarkerSummary(profileId: string, rsid: string): Promise<StoredMarkerSummary | null> {
  await prewarmMarkerIndex(profileId);
  const document = markerDocumentById.get(profileId)?.get(markerId(rsid));
  return document ? markerDocumentToSummary(document) : null;
}

export async function queryCandidateIds(profileId: string, terms: string[], limit = 50): Promise<string[]> {
  const index = indexes.get(profileId);
  if (!index) return [];
  return searchDocs(index, terms, limit).map((result) => result.id as string);
}

export async function searchWithFields(profileId: string, terms: string[], limit: number): Promise<SearchCandidate[]> {
  const index = indexes.get(profileId);
  if (!index) return [];
  return searchDocs(index, terms, limit).map(toSearchCandidate);
}

export async function searchExplorerEntryIds({
  profileId,
  category,
  filters,
  offset,
  limit,
}: SearchExplorerEntryIdsRequest): Promise<SearchExplorerEntryIdsResult> {
  const index = indexes.get(profileId);
  const query = filters.q.trim();
  const indexStatus = indexStatuses.get(profileId) ?? (index ? { state: "ready", documentCount: 0 } : EMPTY_READY_STATUS);
  if (!index || !query) return { ids: [], count: 0, indexStatus };

  const hits = index
    .search(query, {
      boost: SEARCH_INDEX_FIELD_BOOSTS,
      fuzzy: (term) => term.length >= 5 ? 0.2 : false,
      maxFuzzy: 2,
      prefix: (term) => term.length >= 3,
      combineWith: "AND",
      filter: explorerFilter(category, filters),
    })
    .filter((hit) => hit.score > 0)
    .map((hit) => ({
      hit,
      relevanceScore: explorerRelevanceScore(hit),
    }))
    .sort((left, right) =>
      right.relevanceScore - left.relevanceScore
        || compareExplorerDocuments(left.hit, right.hit, filters.sort)
        || compareRankSearchFallback(left.hit, right.hit),
    );

  if (hits.length === 0) return { ids: [], count: 0, indexStatus };

  return {
    ids: hits.slice(offset, offset + limit).map(({ hit }) => hit.id as string),
    count: hits.length,
    indexStatus,
  };
}

export async function waitForIndex(profileId: string): Promise<SearchIndexStatus> {
  if (indexes.has(profileId)) return indexStatuses.get(profileId) ?? EMPTY_READY_STATUS;
  const existingStatus = indexStatuses.get(profileId);
  if (existingStatus && existingStatus.state !== "ready") return existingStatus;
  return inFlight.get(profileId) ?? prewarmSearchIndex(profileId);
}

export function clearSearchIndex(
  profileId?: string,
  options: { preservePersistentCache?: boolean } = {},
): void {
  if (profileId) {
    indexes.delete(profileId);
    indexStatuses.delete(profileId);
    inFlight.delete(profileId);
    markerIndexes.delete(profileId);
    markerDocuments.delete(profileId);
    markerDocumentById.delete(profileId);
    markerIndexStatuses.delete(profileId);
    markerInFlight.delete(profileId);
    if (!options.preservePersistentCache) void deleteSearchIndexCache(profileId);
    return;
  }
  indexes.clear();
  indexStatuses.clear();
  inFlight.clear();
  markerIndexes.clear();
  markerDocuments.clear();
  markerDocumentById.clear();
  markerIndexStatuses.clear();
  markerInFlight.clear();
  if (!options.preservePersistentCache) void deleteSearchIndexCache();
}
