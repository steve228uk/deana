import MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";
import {
  deleteSearchIndexCache,
  loadSearchIndexCache,
  loadSearchIndexSource,
  saveSearchIndexCache,
} from "../storage";
import { rankingQualityMultiplier } from "./ranking";
import type { EvidenceTier, FindingOutcome, ReputeStatus, StoredReportEntry } from "../../types";
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
  sortEvidence: number;
  sortPublications: number;
  sortAlphabetical: string;
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
}

export type WorkerRequest =
  | { type: "prewarm"; requestId: string; profileId: string }
  | { type: "waitForIndex"; requestId: string; profileId: string }
  | { type: "searchExplorer"; requestId: string; payload: SearchExplorerEntryIdsRequest }
  | { type: "searchWithFields"; requestId: string; profileId: string; terms: string[]; limit: number }
  | { type: "queryCandidates"; requestId: string; profileId: string; terms: string[]; limit: number }
  | { type: "clearIndex"; requestId: string; profileId?: string; options?: { preservePersistentCache?: boolean } };

export type WorkerResponse =
  | { type: "prewarm"; requestId: string }
  | { type: "waitForIndex"; requestId: string }
  | { type: "searchExplorer"; requestId: string; result: SearchExplorerEntryIdsResult }
  | { type: "searchWithFields"; requestId: string; result: SearchCandidate[] }
  | { type: "queryCandidates"; requestId: string; result: string[] }
  | { type: "clearIndex"; requestId: string }
  | { type: "error"; requestId: string; error: string };

const indexes = new Map<string, MiniSearch<LightEntry>>();
const inFlight = new Map<string, Promise<void>>();

// Version 7: includes supplementary SNPedia context in the local search index.
const SEARCH_INDEX_CACHE_VERSION = 7;
const SEARCH_INDEX_INSERT_BATCH_SIZE = 500;

// Search should still find contextual SNPedia and preview records. Ranking
// penalties keep them below stronger evidence when relevance is comparable.
const INDEXED_EVIDENCE_TIERS = new Set<EvidenceTier>(["high", "moderate", "emerging", "preview", "supplementary"]);

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
      "title", "sortSeverity", "sortEvidence", "sortPublications", "sortAlphabetical",
      "outcome", "significance", "repute", "coverage", "publicationBucket",
      "geneValues", "tagValues", "sourceNames",
    ],
  });
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
    sortSeverity: entry.sort.severity,
    sortEvidence: entry.sort.evidence,
    sortPublications: entry.sort.publications,
    sortAlphabetical: entry.sort.alphabetical,
  };
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

function insertBatched(index: MiniSearch<LightEntry>, documents: LightEntry[]): void {
  for (let i = 0; i < documents.length; i += SEARCH_INDEX_INSERT_BATCH_SIZE) {
    index.addAll(documents.slice(i, i + SEARCH_INDEX_INSERT_BATCH_SIZE));
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

export async function prewarmSearchIndex(profileId: string): Promise<void> {
  if (indexes.has(profileId)) return;
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const job = (async () => {
    const index = createSearchIndex();

    const cached = await loadSearchIndexCache(profileId, SEARCH_INDEX_CACHE_VERSION);
    if (cached) {
      try {
        const documents = cached.rawData as LightEntry[];
        if (Array.isArray(documents) && documents.length > 0) {
          insertBatched(index, documents);
          indexes.set(profileId, index);
          return;
        }
      } catch {
        // Invalid cache; fall through to rebuild.
      }
    }

    const source = await loadSearchIndexSource(profileId);
    if (!source) {
      indexes.set(profileId, index);
      return;
    }

    const allDocuments: LightEntry[] = [];
    const seenIds = new Set<string>();
    let batch: LightEntry[] = [];

    for (const entry of source.entries) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      if (!INDEXED_EVIDENCE_TIERS.has(entry.evidenceTier)) continue;
      const doc = toLightEntry(entry);
      allDocuments.push(doc);
      batch.push(doc);
      if (batch.length >= SEARCH_INDEX_INSERT_BATCH_SIZE) {
        index.addAll(batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      index.addAll(batch);
    }

    await saveSearchIndexCache({
      profileId,
      cacheVersion: SEARCH_INDEX_CACHE_VERSION,
      documentCount: allDocuments.length,
      rawData: allDocuments,
    });

    indexes.set(profileId, index);
  })().finally(() => inFlight.delete(profileId));

  inFlight.set(profileId, job);
  return job;
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
  if (!index || !query) return { ids: [], count: 0 };

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
    .sort((left, right) =>
      explorerRelevanceScore(right) - explorerRelevanceScore(left)
        || compareExplorerDocuments(left, right, filters.sort)
        || (left.title as string).localeCompare(right.title as string),
    );

  if (hits.length === 0) return { ids: [], count: 0 };

  return {
    ids: hits.slice(offset, offset + limit).map((hit) => hit.id as string),
    count: hits.length,
  };
}

export async function waitForIndex(profileId: string): Promise<void> {
  if (indexes.has(profileId)) return;
  return inFlight.get(profileId) ?? prewarmSearchIndex(profileId);
}

export function clearSearchIndex(
  profileId?: string,
  options: { preservePersistentCache?: boolean } = {},
): void {
  if (profileId) {
    indexes.delete(profileId);
    inFlight.delete(profileId);
    if (!options.preservePersistentCache) void deleteSearchIndexCache(profileId);
    return;
  }
  indexes.clear();
  inFlight.clear();
  if (!options.preservePersistentCache) void deleteSearchIndexCache();
}
