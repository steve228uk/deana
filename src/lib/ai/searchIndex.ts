import MiniSearch from "minisearch";
import { streamReportEntries } from "../storage";

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
}

const indexes = new Map<string, MiniSearch<LightEntry>>();
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
  };
}

export async function prewarmSearchIndex(profileId: string): Promise<void> {
  if (indexes.has(profileId)) return;
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const job = (async () => {
    const miniSearch = new MiniSearch<LightEntry>({
      idField: "id",
      fields: ["genes", "conditions", "topics", "title", "rsids", "markers", "summary", "detail", "sourceNotes", "searchText", "category", "evidenceTier"],
      storeFields: ["id"],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
        boost: {
          rsids: 8,
          markers: 7,
          genes: 6,
          conditions: 5,
          title: 4,
          topics: 3,
          summary: 3,
          detail: 2,
          sourceNotes: 2,
          searchText: 1,
        },
      },
    });

    for await (const entry of streamReportEntries(profileId)) {
      miniSearch.add(toLightEntry(entry));
    }
    indexes.set(profileId, miniSearch);
  })().finally(() => inFlight.delete(profileId));

  inFlight.set(profileId, job);
  return job;
}

export async function queryCandidateIds(profileId: string, terms: string[], limit = 50): Promise<string[]> {
  const index = indexes.get(profileId);
  if (!index || terms.length === 0) return [];
  const query = terms.join(" ").trim();
  if (!query) return [];
  return index.search(query, { fuzzy: 0.2, prefix: true }).slice(0, limit).map((result) => result.id as string);
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
