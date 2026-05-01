import { create, insertMultiple, load as loadOrama, save as saveOrama, search, type AnyOrama, type RawData } from "@orama/orama";
import {
  deleteSearchIndexCache,
  loadSearchIndexCache,
  loadSearchIndexSource,
  saveSearchIndexCache,
} from "../storage";
import type { EvidenceTier, StoredReportEntry } from "../../types";
import type { ExplorerFilters } from "../explorer";

interface LightEntry {
  id: string;
  category: string;
  title: string;
  genes: string;
  topics: string;
  conditions: string;
  rsids: string;
  evidenceTier: string;
  sourceNames: string[];
  significance: string;
  repute: string;
  coverage: string;
  publicationBucket: string;
  geneValues: string[];
  tagValues: string[];
  markers: string;
  body: string;
  sortSeverity: number;
  sortEvidence: number;
  sortPublications: number;
  sortAlphabetical: string;
}

export interface SearchCandidate {
  id: string;
  category: string;
  evidenceTier: EvidenceTier;
  genes: string;
  topics: string;
  conditions: string;
  rsids: string;
  title: string;
  sortSeverity: number;
  sortEvidence: number;
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

const indexes = new Map<string, AnyOrama>();
const inFlight = new Map<string, Promise<void>>();
const SEARCH_INDEX_CACHE_VERSION = 3;
const SEARCH_INDEX_INSERT_BATCH_SIZE = 500;
const SEARCH_INDEX_SCHEMA = {
  id: "string",
  category: "string",
  title: "string",
  genes: "string",
  topics: "string",
  conditions: "string",
  rsids: "string",
  evidenceTier: "string",
  sourceNames: "string[]",
  significance: "string",
  repute: "string",
  coverage: "string",
  publicationBucket: "string",
  geneValues: "string[]",
  tagValues: "string[]",
  markers: "string",
  body: "string",
  sortSeverity: "number",
  sortEvidence: "number",
  sortPublications: "number",
  sortAlphabetical: "string",
} as const;
const SEARCH_INDEX_FIELD_BOOSTS = {
  rsids: 8,
  markers: 7,
  genes: 6,
  conditions: 5,
  title: 4,
  topics: 3,
  body: 2,
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

function createSearchIndex(): AnyOrama {
  return create({
    schema: SEARCH_INDEX_SCHEMA,
  });
}

function fullTextSearchParams(term: string) {
  return {
    term,
    mode: "fulltext" as const,
    exact: false,
    boost: SEARCH_INDEX_FIELD_BOOSTS,
  };
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

function toSearchCandidate(doc: LightEntry): SearchCandidate {
  return {
    id: doc.id,
    category: doc.category,
    evidenceTier: (doc.evidenceTier as EvidenceTier) ?? "supplementary",
    genes: doc.genes,
    topics: doc.topics,
    conditions: doc.conditions,
    rsids: doc.rsids,
    title: doc.title,
    sortSeverity: doc.sortSeverity,
    sortEvidence: doc.sortEvidence,
  };
}

async function searchDocs(index: AnyOrama, terms: string[], limit: number): Promise<Array<{ document: LightEntry }>> {
  if (terms.length === 0) return [];
  const query = terms.join(" ").trim();
  if (!query) return [];

  const result = await search(index, {
    ...fullTextSearchParams(query),
    tolerance: 1,
    limit,
  });

  return result.hits as unknown as Array<{ document: LightEntry }>;
}

function explorerWhere(category: StoredReportEntry["category"], filters: ExplorerFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {
    category,
  };

  if (filters.source) where.sourceNames = filters.source;
  for (const [filterKey, documentField] of EXPLORER_ARRAY_FILTER_FIELDS) {
    const values = filters[filterKey];
    if (values.length > 0) where[documentField] = values;
  }

  return where;
}

function compareExplorerDocuments(left: LightEntry, right: LightEntry, sort: ExplorerFilters["sort"]): number {
  switch (sort) {
    case "alphabetical":
      return left.sortAlphabetical.localeCompare(right.sortAlphabetical);
    case "publications":
      return right.sortPublications - left.sortPublications || left.title.localeCompare(right.title);
    case "evidence":
      return right.sortEvidence - left.sortEvidence || right.sortSeverity - left.sortSeverity || left.title.localeCompare(right.title);
    case "severity":
    default:
      return right.sortSeverity - left.sortSeverity || right.sortEvidence - left.sortEvidence || left.title.localeCompare(right.title);
  }
}

export async function prewarmSearchIndex(profileId: string): Promise<void> {
  if (indexes.has(profileId)) return;
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const job = (async () => {
    const cached = await loadSearchIndexCache(profileId, SEARCH_INDEX_CACHE_VERSION);

    if (cached) {
      try {
        const cachedIndex = createSearchIndex();
        loadOrama(cachedIndex, cached.rawData as RawData);
        indexes.set(profileId, cachedIndex);
        return;
      } catch {
        // Cached data can be invalidated by Orama internals; rebuild from stored entries.
      }
    }

    const index = createSearchIndex();

    const source = await loadSearchIndexSource(profileId);
    if (!source) {
      indexes.set(profileId, index);
      return;
    }

    const documents: LightEntry[] = [];
    const seenIds = new Set<string>();
    for (const entry of source.entries) {
      if (!seenIds.has(entry.id)) {
        seenIds.add(entry.id);
        documents.push(toLightEntry(entry));
      }
    }

    if (documents.length > 0) {
      await insertMultiple(index, documents, SEARCH_INDEX_INSERT_BATCH_SIZE);
    }

    await saveSearchIndexCache({
      profileId,
      cacheVersion: SEARCH_INDEX_CACHE_VERSION,
      documentCount: documents.length,
      rawData: saveOrama(index),
    });

    indexes.set(profileId, index);
  })().finally(() => inFlight.delete(profileId));

  inFlight.set(profileId, job);
  return job;
}

export async function queryCandidateIds(profileId: string, terms: string[], limit = 50): Promise<string[]> {
  const index = indexes.get(profileId);
  if (!index) return [];
  const hits = await searchDocs(index, terms, limit);
  return hits.map((result) => result.document.id);
}

export async function searchWithFields(profileId: string, terms: string[], limit: number): Promise<SearchCandidate[]> {
  const index = indexes.get(profileId);
  if (!index) return [];
  const hits = await searchDocs(index, terms, limit);

  return hits.map((result) => toSearchCandidate(result.document));
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

  const searchParams = {
    ...fullTextSearchParams(query),
    tolerance: 1,
    threshold: 0,
    where: explorerWhere(category, filters),
  } as const;

  // Orama narrows the text match set; Explorer's selected sort remains authoritative for visible ordering.
  const preflight = await search(index, {
    ...searchParams,
    preflight: true,
  });

  if (preflight.count === 0) return { ids: [], count: 0 };

  const result = await search(index, {
    ...searchParams,
    limit: preflight.count,
  });

  const hits = (result.hits as unknown as Array<{ document: LightEntry; score: number }>)
    .filter((hit) => hit.score > 0)
    .sort((left, right) =>
      compareExplorerDocuments(left.document, right.document, filters.sort) ||
      right.score - left.score,
    );

  return {
    ids: hits.slice(offset, offset + limit).map((hit) => hit.document.id),
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
