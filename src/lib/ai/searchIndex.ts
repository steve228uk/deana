import { create, insertMultiple, load as loadOrama, save as saveOrama, search, type AnyOrama, type RawData } from "@orama/orama";
import {
  deleteSearchIndexCache,
  loadSearchIndexCache,
  loadSearchIndexSource,
  saveSearchIndexCache,
} from "../storage";
import type { EvidenceTier, StoredReportEntry } from "../../types";

interface LightEntry {
  id: string;
  category: string;
  title: string;
  genes: string;
  topics: string;
  conditions: string;
  rsids: string;
  evidenceTier: string;
  markers: string;
  body: string;
  sortSeverity: number;
  sortEvidence: number;
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

const indexes = new Map<string, AnyOrama>();
const inFlight = new Map<string, Promise<void>>();
const SEARCH_INDEX_CACHE_VERSION = 2;
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
  markers: "string",
  body: "string",
  sortSeverity: "number",
  sortEvidence: "number",
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

function createSearchIndex(): AnyOrama {
  return create({
    schema: SEARCH_INDEX_SCHEMA,
  });
}

function toLightEntry(entry: StoredReportEntry): LightEntry {
  const markers = entry.matchedMarkers
    .flatMap((marker) => [marker.rsid, marker.gene ?? "", marker.genotype ?? "", marker.matchedAllele ?? ""])
    .filter(Boolean)
    .join(" ");
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
    rsids: entry.matchedMarkers.map((marker) => marker.rsid).join(" "),
    evidenceTier: entry.evidenceTier,
    markers,
    body,
    sortSeverity: entry.sort.severity,
    sortEvidence: entry.sort.evidence,
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
    term: query,
    mode: "fulltext",
    tolerance: 1,
    exact: false,
    limit,
    boost: SEARCH_INDEX_FIELD_BOOSTS,
  });

  return result.hits as unknown as Array<{ document: LightEntry }>;
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
