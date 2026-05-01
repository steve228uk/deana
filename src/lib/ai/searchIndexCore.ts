import { create, insertMultiple, search, type AnyOrama } from "@orama/orama";
import { pluginQPS } from "@orama/plugin-qps";
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
  // Sort fields are stored with the document but kept outside the schema so
  // Orama does not build inverted index entries for them, reducing memory.
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

// Version 4: switched to LightEntry[] cache format (avoids loadOrama/saveOrama
// 2× memory spike) and added QPS plugin + removed sort fields from schema.
const SEARCH_INDEX_CACHE_VERSION = 4;
const SEARCH_INDEX_INSERT_BATCH_SIZE = 100;

// Only searchable and filterable fields go in the schema. Sort-only fields
// (sortSeverity, sortEvidence, sortPublications, sortAlphabetical) are
// inserted as extra document properties — Orama stores them but does not
// build inverted index entries for them, cutting index memory significantly.
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
    plugins: [pluginQPS()],
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

async function insertBatched(index: AnyOrama, documents: LightEntry[]): Promise<void> {
  for (let i = 0; i < documents.length; i += SEARCH_INDEX_INSERT_BATCH_SIZE) {
    await insertMultiple(index, documents.slice(i, i + SEARCH_INDEX_INSERT_BATCH_SIZE));
  }
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
    const index = createSearchIndex();

    // Cache (v4+) stores LightEntry[] directly. This avoids the 2× memory
    // spike that occurred when saveOrama/loadOrama held both the serialised
    // JSON blob and the live index structure in memory simultaneously.
    const cached = await loadSearchIndexCache(profileId, SEARCH_INDEX_CACHE_VERSION);
    if (cached) {
      try {
        const documents = cached.rawData as LightEntry[];
        if (Array.isArray(documents) && documents.length > 0) {
          await insertBatched(index, documents);
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

    // Convert and insert in batches so we never hold a full parallel LightEntry[]
    // alongside source.entries — only one small batch lives at a time.
    const allDocuments: LightEntry[] = [];
    const seenIds = new Set<string>();
    let batch: LightEntry[] = [];

    for (const entry of source.entries) {
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      const doc = toLightEntry(entry);
      allDocuments.push(doc);
      batch.push(doc);
      if (batch.length >= SEARCH_INDEX_INSERT_BATCH_SIZE) {
        await insertMultiple(index, batch);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await insertMultiple(index, batch);
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
