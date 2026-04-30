import { create, insertMultiple, search, type AnyOrama } from "@orama/orama";
import { streamReportEntries } from "../storage";
import type { EvidenceTier } from "../../types";

interface LightEntry {
  id: string;
  category: string;
  title: string;
  genes: string;
  topics: string;
  conditions: string;
  rsids: string;
  evidenceTier: string;
  summary: string;
  detail: string;
  sourceNotes: string;
  markers: string;
  searchText: string;
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

function toLightEntry(entry: Awaited<ReturnType<typeof streamReportEntries>> extends AsyncGenerator<infer T> ? T : never): LightEntry {
  const markers = entry.matchedMarkers
    .flatMap((marker) => [marker.rsid, marker.gene ?? "", marker.genotype ?? "", marker.matchedAllele ?? ""])
    .filter(Boolean)
    .join(" ");

  return {
    id: entry.id,
    category: entry.category,
    title: entry.title.slice(0, 120),
    genes: entry.genes.join(" "),
    topics: entry.topics.join(" "),
    conditions: entry.conditions.join(" "),
    rsids: entry.matchedMarkers.map((marker) => marker.rsid).join(" "),
    evidenceTier: entry.evidenceTier,
    summary: entry.summary.slice(0, 320),
    detail: entry.detail.slice(0, 640),
    sourceNotes: entry.sourceNotes.join(" ").slice(0, 320),
    markers,
    searchText: (entry.searchText || "").slice(0, 960),
    sortSeverity: entry.sort.severity,
    sortEvidence: entry.sort.evidence,
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
  });

  return result.hits as unknown as Array<{ document: LightEntry }>;
}

export async function prewarmSearchIndex(profileId: string): Promise<void> {
  if (indexes.has(profileId)) return;
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const job = (async () => {
    const index = await create({
      schema: {
        id: "string",
        category: "string",
        title: "string",
        genes: "string",
        topics: "string",
        conditions: "string",
        rsids: "string",
        evidenceTier: "string",
        summary: "string",
        detail: "string",
        sourceNotes: "string",
        markers: "string",
        searchText: "string",
        sortSeverity: "number",
        sortEvidence: "number",
      },
    });

    const documents: LightEntry[] = [];
    for await (const entry of streamReportEntries(profileId)) {
      documents.push(toLightEntry(entry));
    }

    if (documents.length > 0) {
      await insertMultiple(index, documents, documents.length);
    }

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

  return hits.map((result) => {
    const doc = result.document;
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
  });
}

export async function waitForIndex(profileId: string): Promise<void> {
  return inFlight.get(profileId) ?? Promise.resolve();
}

export function clearSearchIndex(profileId?: string): void {
  if (profileId) {
    indexes.delete(profileId);
    inFlight.delete(profileId);
    return;
  }
  indexes.clear();
  inFlight.clear();
}
