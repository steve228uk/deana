import { CompactMarker, RawMarkerResult, ReportEntry } from "../types";

export interface ExplorerFilters {
  q: string;
  source: string;
  evidence: string;
  significance: string;
  repute: string;
  coverage: string;
  publications: string;
  gene: string;
  tag: string;
  sort: string;
}

export const DEFAULT_FILTERS: ExplorerFilters = {
  q: "",
  source: "",
  evidence: "",
  significance: "",
  repute: "",
  coverage: "",
  publications: "",
  gene: "",
  tag: "",
  sort: "severity",
};

export function buildEntrySearchText(entry: Pick<
  ReportEntry,
  | "title"
  | "summary"
  | "detail"
  | "whyItMatters"
  | "genotypeSummary"
  | "genes"
  | "topics"
  | "conditions"
  | "matchedMarkers"
>): string {
  return [
    entry.title,
    entry.summary,
    entry.detail,
    entry.whyItMatters,
    entry.genotypeSummary,
    ...entry.genes,
    ...entry.topics,
    ...entry.conditions,
    ...entry.matchedMarkers.map((marker) => marker.rsid),
  ]
    .join(" ")
    .toLowerCase();
}

function matchesSearch(entry: Pick<ReportEntry, "searchText"> | ReportEntry, query: string): boolean {
  if (!query) return true;
  const haystack = "searchText" in entry ? entry.searchText : buildEntrySearchText(entry);
  return haystack.includes(query.toLowerCase());
}

export function matchesEntryFilters(
  entry: Pick<
    ReportEntry,
    | "category"
    | "sources"
    | "evidenceTier"
    | "clinicalSignificance"
    | "repute"
    | "coverage"
    | "publicationBucket"
    | "genes"
    | "topics"
    | "conditions"
  > &
    (Pick<ReportEntry, "matchedMarkers" | "title" | "summary" | "detail" | "whyItMatters" | "genotypeSummary"> | {
      searchText: string;
    }),
  filters: ExplorerFilters,
  category?: ReportEntry["category"],
): boolean {
  return (category ? entry.category === category : true)
    && matchesSearch(entry, filters.q)
    && (filters.source ? entry.sources.some((source) => source.name === filters.source) : true)
    && (filters.evidence ? entry.evidenceTier === filters.evidence : true)
    && (filters.significance ? entry.clinicalSignificance === filters.significance : true)
    && (filters.repute ? entry.repute === filters.repute : true)
    && (filters.coverage ? entry.coverage === filters.coverage : true)
    && (filters.publications ? entry.publicationBucket === filters.publications : true)
    && (filters.gene ? entry.genes.includes(filters.gene) : true)
    && (filters.tag ? entry.topics.includes(filters.tag) || entry.conditions.includes(filters.tag) : true);
}

export function compareEntries(
  left: Pick<ReportEntry, "sort" | "title">,
  right: Pick<ReportEntry, "sort" | "title">,
  sort: ExplorerFilters["sort"],
): number {
  switch (sort) {
    case "alphabetical":
      return left.sort.alphabetical.localeCompare(right.sort.alphabetical);
    case "publications":
      return right.sort.publications - left.sort.publications || left.title.localeCompare(right.title);
    case "evidence":
      return right.sort.evidence - left.sort.evidence || right.sort.severity - left.sort.severity;
    case "severity":
    default:
      return right.sort.severity - left.sort.severity || right.sort.evidence - left.sort.evidence;
  }
}

export function filterEntries(
  entries: ReportEntry[],
  filters: ExplorerFilters,
  category?: ReportEntry["category"],
): ReportEntry[] {
  return [...entries].filter((entry) => matchesEntryFilters(entry, filters, category)).sort((left, right) => {
    return compareEntries(left, right, filters.sort);
  });
}

export function buildRawMarkerResults(
  markers: CompactMarker[],
  entries: ReportEntry[],
  query: string,
): RawMarkerResult[] {
  const lowerQuery = query.trim().toLowerCase();
  const linkedByRsid = new Map<string, RawMarkerResult["linkedEntries"]>();

  for (const entry of entries) {
    for (const marker of entry.matchedMarkers) {
      const linked = linkedByRsid.get(marker.rsid) ?? [];
      linked.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        genes: entry.genes,
      });
      linkedByRsid.set(marker.rsid, linked);
    }
  }

  return markers
    .filter((marker) => {
      if (!lowerQuery) return true;
      const linked = linkedByRsid.get(marker[0]) ?? [];
      const geneText = linked.flatMap((entry) => entry.genes).join(" ").toLowerCase();
      return (
        marker[0].toLowerCase().includes(lowerQuery) ||
        marker[1].toLowerCase().includes(lowerQuery) ||
        marker[3].toLowerCase().includes(lowerQuery) ||
        geneText.includes(lowerQuery)
      );
    })
    .slice(0, 200)
    .map((marker) => ({
      rsid: marker[0],
      chromosome: marker[1],
      position: marker[2],
      genotype: marker[3],
      linkedEntries: linkedByRsid.get(marker[0]) ?? [],
    }));
}
