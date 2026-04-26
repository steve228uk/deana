import { ReportEntry } from "../types";

export interface ExplorerFilters {
  q: string;
  source: string;
  evidence: string[];
  significance: string[];
  repute: string[];
  coverage: string[];
  publications: string[];
  gene: string[];
  tag: string[];
  sort: string;
}

export const DEFAULT_FILTERS: ExplorerFilters = {
  q: "",
  source: "",
  evidence: [],
  significance: [],
  repute: [],
  coverage: [],
  publications: [],
  gene: [],
  tag: [],
  sort: "severity",
};

type SearchableEntry = {
  searchText?: string;
  id?: string;
  entryKind?: string;
  category?: string;
  subcategory?: string;
  title: string;
  summary: string;
  detail: string;
  whyItMatters: string;
  genotypeSummary: string;
  genes: string[];
  topics: string[];
  conditions: string[];
  warnings?: string[];
  sources?: ReportEntry["sources"];
  sourceNotes?: string[];
  evidenceTier?: string;
  clinicalSignificance?: string | null;
  normalizedClinicalSignificance?: string | null;
  repute?: string;
  publicationBucket?: string;
  frequencyNote?: string;
  magnitude?: number | null;
  sourceGenotype?: string;
  sourcePageKey?: string;
  sourcePageUrl?: string;
  coverage?: string;
  tone?: string;
  outcome?: string;
  confidenceNote?: string;
  disclaimer?: string;
  matchedMarkers: ReportEntry["matchedMarkers"];
};

function compactSearchValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(compactSearchValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(compactSearchValue).join(" ");
  return String(value);
}

export function buildEntrySearchText(entry: SearchableEntry): string {
  return [
    entry.id,
    entry.entryKind,
    entry.category,
    entry.subcategory,
    entry.title,
    entry.summary,
    entry.detail,
    entry.whyItMatters,
    entry.genotypeSummary,
    entry.evidenceTier,
    entry.clinicalSignificance,
    entry.normalizedClinicalSignificance,
    entry.repute,
    entry.publicationBucket,
    entry.frequencyNote,
    entry.magnitude,
    entry.sourceGenotype,
    entry.sourcePageKey,
    entry.sourcePageUrl,
    entry.coverage,
    entry.tone,
    entry.outcome,
    entry.confidenceNote,
    entry.disclaimer,
    ...entry.genes,
    ...entry.topics,
    ...entry.conditions,
    ...(entry.warnings ?? []),
    ...(entry.sourceNotes ?? []),
    ...(entry.sources ?? []).flatMap((source) => [source.id, source.name, source.url]),
    ...entry.matchedMarkers.flatMap((marker) => [
      marker.rsid,
      marker.genotype,
      marker.chromosome,
      marker.position,
      marker.gene,
      marker.matchedAllele,
      marker.matchedAlleleCount,
    ]),
  ]
    .map(compactSearchValue)
    .join(" ")
    .toLowerCase();
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function isLooseTokenMatch(query: string, token: string): boolean {
  if (token.includes(query)) return true;
  if (query.length < 4 || token.length < 4) return false;
  const distance = levenshtein(query, token);
  return distance <= (query.length <= 6 ? 1 : 2);
}

function matchesSearch(entry: SearchableEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = typeof entry.searchText === "string" ? entry.searchText : buildEntrySearchText(entry);
  if (haystack.includes(normalizedQuery)) return true;

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const tokens = Array.from(new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean)));
  return queryTokens.every((queryToken) => tokens.some((token) => isLooseTokenMatch(queryToken, token)));
}

function matchesAny<T extends string | null>(value: T, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return Boolean(value && filters.includes(value));
}

function overlaps(values: string[], filters: string[]): boolean {
  if (filters.length === 0) return true;
  return values.some((value) => filters.includes(value));
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
    | "normalizedClinicalSignificance"
  > &
    SearchableEntry,
  filters: ExplorerFilters,
  category?: ReportEntry["category"],
): boolean {
  return (category ? entry.category === category : true)
    && matchesSearch(entry, filters.q)
    && (filters.source ? entry.sources.some((source) => source.name === filters.source) : true)
    && matchesAny(entry.evidenceTier, filters.evidence)
    && matchesAny(entry.normalizedClinicalSignificance, filters.significance)
    && matchesAny(entry.repute, filters.repute)
    && matchesAny(entry.coverage, filters.coverage)
    && matchesAny(entry.publicationBucket, filters.publications)
    && overlaps(entry.genes, filters.gene)
    && overlaps([...entry.topics, ...entry.conditions], filters.tag);
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
