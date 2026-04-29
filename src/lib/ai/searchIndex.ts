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
}

const indexes = new Map<string, MiniSearch<LightEntry>>();
const inFlight = new Map<string, Promise<void>>();

function toLightEntry(entry: Awaited<ReturnType<typeof streamReportEntries>> extends AsyncGenerator<infer T> ? T : never): LightEntry {
  return {
    id: entry.id,
    category: entry.category,
    title: entry.title.slice(0, 120),
    genes: entry.genes.join(" "),
    topics: entry.topics.join(" "),
    conditions: entry.conditions.join(" "),
    rsids: entry.matchedMarkers.map((marker) => marker.rsid).join(" "),
    evidenceTier: entry.evidenceTier,
  };
}

export async function prewarmSearchIndex(profileId: string): Promise<void> {
  if (indexes.has(profileId)) return;
  if (inFlight.has(profileId)) return inFlight.get(profileId);

  const job = (async () => {
    const miniSearch = new MiniSearch<LightEntry>({
      idField: "id",
      fields: ["genes", "conditions", "topics", "title", "rsids", "category", "evidenceTier"],
      storeFields: ["id"],
      searchOptions: { fuzzy: 0.2, prefix: true, boost: { genes: 4, conditions: 3, topics: 3, title: 2, rsids: 4 } },
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
  if (terms.length === 0) return [];
  await prewarmSearchIndex(profileId);
  const index = indexes.get(profileId);
  if (!index) return [];
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
