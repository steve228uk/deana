import { searchExplorerEntryIds, waitForIndex } from "./ai/searchIndex";
import { loadCategoryPage, loadReportEntriesByIds } from "./storage";
import type { ExplorerFilters } from "./explorer";
import type { ExplorerPage, StoredReportEntry } from "../types";

interface ExplorerPageRequest {
  profileId: string;
  category: StoredReportEntry["category"];
  filters: ExplorerFilters;
  cursor?: string | null;
  pageSize?: number;
}

interface SearchCursor {
  mode: "orama";
  offset: number;
}

const DEFAULT_PAGE_SIZE = 50;

function encodeSearchCursor(cursor: SearchCursor): string {
  return JSON.stringify(cursor);
}

function decodeSearchCursor(value: string | null | undefined): SearchCursor | null {
  if (!value) return null;

  try {
    const cursor = JSON.parse(value) as Partial<SearchCursor>;
    if (cursor.mode !== "orama" || typeof cursor.offset !== "number" || cursor.offset < 0) return null;
    return {
      mode: "orama",
      offset: cursor.offset,
    };
  } catch {
    return null;
  }
}

function orderEntriesByIds(ids: string[], entries: StoredReportEntry[]): StoredReportEntry[] {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  return ids
    .map((id) => entryById.get(id))
    .filter((entry): entry is StoredReportEntry => Boolean(entry));
}

export async function loadExplorerPage({
  profileId,
  category,
  filters,
  cursor,
  pageSize = DEFAULT_PAGE_SIZE,
}: ExplorerPageRequest): Promise<ExplorerPage> {
  if (!filters.q.trim()) {
    return loadCategoryPage({
      profileId,
      category,
      filters,
      cursor,
      pageSize,
    });
  }

  const offset = decodeSearchCursor(cursor)?.offset ?? 0;
  await waitForIndex(profileId);

  const searchResult = await searchExplorerEntryIds({
    profileId,
    category,
    filters,
    offset,
    limit: pageSize,
  });
  if (searchResult.ids.length === 0) {
    return {
      entries: [],
      nextCursor: null,
      totalLoaded: offset,
      hasMore: false,
    };
  }

  const entries = await loadReportEntriesByIds(profileId, searchResult.ids);
  const orderedEntries = orderEntriesByIds(searchResult.ids, entries);
  const nextOffset = offset + searchResult.ids.length;
  const hasMore = nextOffset < searchResult.count;

  return {
    entries: orderedEntries,
    nextCursor: hasMore ? encodeSearchCursor({ mode: "orama", offset: nextOffset }) : null,
    totalLoaded: offset + orderedEntries.length,
    hasMore,
  };
}
