import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSearchIndex } from "./ai/searchIndex";
import { DEFAULT_FILTERS, buildEntrySearchText } from "./explorer";
import { loadExplorerPage } from "./explorerSearch";
import {
  deleteSearchIndexCache,
  loadCategoryPage,
  loadReportEntriesByIds,
  loadSearchIndexCache,
  loadSearchIndexSource,
  saveSearchIndexCache,
} from "./storage";
import { makeSavedProfile } from "../test/fixtures";
import type { StoredReportEntry } from "../types";

vi.mock("./storage", () => ({
  loadCategoryPage: vi.fn(),
  loadReportEntriesByIds: vi.fn(),
  loadSearchIndexSource: vi.fn(),
  loadSearchIndexCache: vi.fn(),
  saveSearchIndexCache: vi.fn(),
  deleteSearchIndexCache: vi.fn(),
}));

let entries: StoredReportEntry[] = [];
let cachedSearchIndex: unknown = null;

function storedEntries(): StoredReportEntry[] {
  const profile = makeSavedProfile({ id: "profile-explorer-search" });
  return profile.report.entries.map((entry) => ({
    ...entry,
    profileId: profile.id,
    searchText: buildEntrySearchText(entry),
  }));
}

function withSearchText(entry: StoredReportEntry): StoredReportEntry {
  return {
    ...entry,
    searchText: buildEntrySearchText(entry),
  };
}

function entriesByIds(ids: string[]): StoredReportEntry[] {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  return ids.map((id) => entryById.get(id)).filter((entry): entry is StoredReportEntry => Boolean(entry));
}

function installEntries(nextEntries: StoredReportEntry[]) {
  entries = nextEntries;

  vi.mocked(loadSearchIndexSource).mockImplementation(async (profileId: string) => ({
    metadata: {
      reportVersion: 1,
      evidencePackVersion: "test",
      reportParsedAt: "2026-04-25T00:00:00.000Z",
    },
    entries: entries.filter((entry) => entry.profileId === profileId),
  }));
  vi.mocked(loadSearchIndexCache).mockImplementation(async () => cachedSearchIndex as Awaited<ReturnType<typeof loadSearchIndexCache>>);
  vi.mocked(saveSearchIndexCache).mockImplementation(async (cache) => {
    cachedSearchIndex = {
      profileId: cache.profileId,
      cacheVersion: cache.cacheVersion,
      reportVersion: 1,
      evidencePackVersion: "test",
      reportParsedAt: "2026-04-25T00:00:00.000Z",
      documentCount: cache.documentCount,
      rawData: cache.rawData,
      cachedAt: "2026-04-25T00:00:00.000Z",
    };
  });
  vi.mocked(deleteSearchIndexCache).mockImplementation(async () => {
    cachedSearchIndex = null;
  });
  vi.mocked(loadReportEntriesByIds).mockImplementation(async (_profileId: string, ids: string[]) => entriesByIds(ids));
}

describe("loadExplorerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    entries = [];
    cachedSearchIndex = null;
    clearSearchIndex();
  });

  it("delegates to IndexedDB cursor paging when there is no search query", async () => {
    const page = {
      entries: [],
      nextCursor: null,
      totalLoaded: 0,
      hasMore: false,
    };
    vi.mocked(loadCategoryPage).mockResolvedValue(page);

    await expect(loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: DEFAULT_FILTERS,
    })).resolves.toBe(page);

    expect(loadCategoryPage).toHaveBeenCalledWith({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: DEFAULT_FILTERS,
      cursor: undefined,
      pageSize: 50,
    });
    expect(loadSearchIndexSource).not.toHaveBeenCalled();
  });

  it("uses Orama tolerance for explorer typo search", async () => {
    const template = storedEntries()[0];
    const alzheimer = withSearchText({
      ...template,
      id: "medical-alzheimer-search",
      category: "medical",
      title: "Alzheimer disease risk context",
      summary: "APOE context for Alzheimer disease.",
      genes: ["APOE"],
      conditions: ["Alzheimer disease"],
      matchedMarkers: [{ rsid: "rs429358", genotype: "CT", chromosome: "19", position: 44908684, gene: "APOE" }],
    });
    installEntries([alzheimer]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "alzhemers" },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual(["medical-alzheimer-search"]);
    expect(page.hasMore).toBe(false);
  });

  it("loads non-visible Orama matches from IndexedDB by returned finding IDs", async () => {
    const template = storedEntries()[0];
    const target = withSearchText({
      ...template,
      id: "medical-rare-result",
      category: "medical",
      title: "Rare searchable result",
      summary: "A xylophonic marker term that should be found outside the current visible page.",
      sort: {
        ...template.sort,
        severity: 1,
      },
    });
    const unrelated = Array.from({ length: 75 }, (_, index) => withSearchText({
      ...template,
      id: `medical-unrelated-${index}`,
      category: "medical",
      title: `Common unrelated result ${index}`,
      summary: "Common finding text.",
      sort: {
        ...template.sort,
        severity: 100 - index,
      },
    }));
    installEntries([...unrelated, target]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "xylophonic" },
    });

    expect(loadCategoryPage).not.toHaveBeenCalled();
    expect(loadReportEntriesByIds).toHaveBeenCalledWith("profile-explorer-search", ["medical-rare-result"]);
    expect(page.entries.map((entry) => entry.id)).toEqual(["medical-rare-result"]);
  });

  it("requires all search terms and applies exact filters", async () => {
    const template = storedEntries()[0];
    const factor = withSearchText({
      ...template,
      id: "medical-factor-v-search",
      category: "medical",
      title: "Factor V Leiden clotting risk",
      summary: "Factor V Leiden thrombophilia context.",
      evidenceTier: "high",
      genes: ["F5"],
      topics: ["Clotting"],
      conditions: ["Thrombophilia"],
      sources: [{ id: "clinvar", name: "ClinVar", url: "https://example.com/clinvar" }],
      matchedMarkers: [{ rsid: "rs6025", genotype: "CT", chromosome: "1", position: 169519049, gene: "F5" }],
    });
    const partial = withSearchText({
      ...template,
      id: "medical-factor-only-search",
      category: "medical",
      title: "Factor unrelated note",
      summary: "Mentions factor but not the requested condition.",
      evidenceTier: "moderate",
      genes: ["GENE2"],
      topics: ["Other"],
      conditions: ["Other condition"],
      sources: [{ id: "snpedia", name: "SNPedia", url: "https://example.com/snpedia" }],
      matchedMarkers: [{ rsid: "rs111", genotype: "AA", chromosome: "1", position: 1, gene: "GENE2" }],
    });
    installEntries([partial, factor]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: {
        ...DEFAULT_FILTERS,
        q: "factor leiden",
        source: "ClinVar",
        evidence: ["high"],
        gene: ["F5"],
        tag: ["Thrombophilia"],
      },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual(["medical-factor-v-search"]);
  });

  it("returns stable Orama pages with load more cursors", async () => {
    const template = storedEntries()[0];
    installEntries(Array.from({ length: 3 }, (_, index) => withSearchText({
      ...template,
      id: `medical-factor-${index}`,
      category: "medical",
      title: `Factor V Leiden result ${index}`,
      summary: "Factor V Leiden result.",
      sort: {
        ...template.sort,
        severity: 100 - index,
      },
    })));

    const firstPage = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "factor leiden" },
      pageSize: 2,
    });
    const secondPage = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "factor leiden" },
      cursor: firstPage.nextCursor,
      pageSize: 2,
    });

    expect(firstPage.entries.map((entry) => entry.id)).toEqual(["medical-factor-0", "medical-factor-1"]);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.entries.map((entry) => entry.id)).toEqual(["medical-factor-2"]);
    expect(secondPage.hasMore).toBe(false);
  });

  it("preserves Orama result order after IndexedDB hydration", async () => {
    const template = storedEntries()[0];
    const first = withSearchText({
      ...template,
      id: "medical-shared-first",
      category: "medical",
      title: "Shared search result first",
      summary: "Shared search phrase.",
      sort: {
        ...template.sort,
        severity: 100,
      },
    });
    const second = withSearchText({
      ...template,
      id: "medical-shared-second",
      category: "medical",
      title: "Shared search result second",
      summary: "Shared search phrase.",
      sort: {
        ...template.sort,
        severity: 50,
      },
    });
    installEntries([first, second]);
    vi.mocked(loadReportEntriesByIds).mockResolvedValueOnce([second, first]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "shared search phrase" },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual(["medical-shared-first", "medical-shared-second"]);
  });
});
