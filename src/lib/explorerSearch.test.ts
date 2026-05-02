import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSearchIndex } from "./ai/searchIndex";
import { shouldIndexEntry } from "./ai/searchIndexCore";
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

  it("uses MiniSearch tolerance for explorer typo search", async () => {
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

  it("loads non-visible MiniSearch matches from IndexedDB by returned finding IDs", async () => {
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

  it("ranks stronger textual matches above higher-severity body-only matches", async () => {
    const template = storedEntries()[0];
    const titleMatch = withSearchText({
      ...template,
      id: "medical-lactose-title-match",
      category: "medical",
      title: "Lactose intolerance response",
      summary: "Genotype context for lactose digestion.",
      sort: {
        ...template.sort,
        severity: 1,
      },
    });
    const bodyOnlyMatch = withSearchText({
      ...template,
      id: "medical-lactose-body-match",
      category: "medical",
      title: "Digestive note",
      summary: "This lower-priority body copy mentions lactose intolerance in passing.",
      sort: {
        ...template.sort,
        severity: 100,
      },
    });
    installEntries([bodyOnlyMatch, titleMatch]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "lactose intolerance" },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual([
      "medical-lactose-title-match",
      "medical-lactose-body-match",
    ]);
  });

  it("does not rank partial multi-term matches ahead of full matches", async () => {
    const template = storedEntries()[0];
    const fullMatch = withSearchText({
      ...template,
      id: "medical-factor-v-full-match",
      category: "medical",
      title: "Factor V Leiden clotting risk",
      summary: "Factor V Leiden thrombophilia context.",
      genes: ["F5"],
      matchedMarkers: [{ rsid: "rs6025", genotype: "CT", chromosome: "1", position: 169519049, gene: "F5" }],
    });
    const partialMatch = withSearchText({
      ...template,
      id: "medical-factor-partial-match",
      category: "medical",
      title: "Factor unrelated note",
      summary: "Mentions factor but not the requested condition.",
      sort: {
        ...template.sort,
        severity: 100,
      },
    });
    installEntries([partialMatch, fullMatch]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "factor leiden" },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual(["medical-factor-v-full-match"]);
  });

  it("prefers positive and negative findings over informational findings when relevance is close", async () => {
    const template = storedEntries()[0];
    const informational = withSearchText({
      ...template,
      id: "medical-shared-informational",
      category: "medical",
      title: "Shared nutrigenomics match",
      summary: "Shared nutrigenomics match.",
      evidenceTier: "high",
      outcome: "informational",
      repute: "not-set",
      sort: {
        ...template.sort,
        severity: 100,
      },
    });
    const negative = withSearchText({
      ...template,
      id: "medical-shared-negative",
      category: "medical",
      title: "Shared nutrigenomics match",
      summary: "Shared nutrigenomics match.",
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      sort: {
        ...template.sort,
        severity: 1,
      },
    });
    installEntries([informational, negative]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "shared nutrigenomics" },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual([
      "medical-shared-negative",
      "medical-shared-informational",
    ]);
  });

  it("returns high-signal supplementary SNPedia context from MiniSearch results", async () => {
    const template = storedEntries()[0];
    const snpedia = withSearchText({
      ...template,
      id: "local-traits-snpedia-baldness-context",
      category: "traits",
      subcategory: "snpedia",
      title: "Normal higher risk of Male Pattern Baldness",
      summary: "SNPedia genotype context for male pattern baldness.",
      detail: "Supplementary consumer-facing SNPedia context.",
      evidenceTier: "supplementary",
      magnitude: 2,
      sources: [{ id: "snpedia", name: "SNPedia", url: "https://example.com/snpedia" }],
      topics: ["SNPedia", "Genotype page"],
      conditions: ["Male Pattern Baldness"],
      matchedMarkers: [{ rsid: "rs2003046", genotype: "CC", chromosome: "7", position: 123, gene: undefined }],
    });
    installEntries([snpedia]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "traits",
      filters: { ...DEFAULT_FILTERS, q: "male pattern baldness" },
    });

    expect(page.entries.map((entry) => entry.id)).toEqual(["local-traits-snpedia-baldness-context"]);
  });

  it("does not include low-signal supplementary SNPedia context in MiniSearch results", async () => {
    const template = storedEntries()[0];
    const snpedia = withSearchText({
      ...template,
      id: "local-traits-snpedia-low-signal",
      entryKind: "local-evidence",
      category: "traits",
      subcategory: "snpedia",
      title: "Low signal SNPedia context",
      summary: "A low signal supplementary SNPedia phrase.",
      detail: "Supplementary consumer-facing SNPedia context.",
      evidenceTier: "supplementary",
      magnitude: null,
      publicationCount: 0,
      repute: "good",
      sources: [{ id: "snpedia", name: "SNPedia", url: "https://example.com/snpedia" }],
      topics: ["SNPedia", "Genotype page"],
      conditions: ["Low signal phrase"],
      matchedMarkers: [{ rsid: "rs2003046", genotype: "CC", chromosome: "7", position: 123, gene: undefined }],
    });
    installEntries([snpedia]);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "traits",
      filters: { ...DEFAULT_FILTERS, q: "low signal phrase" },
    });

    expect(page.entries).toEqual([]);
  });

  it("falls back to IndexedDB search when the MiniSearch index is skipped for memory budget", async () => {
    const template = storedEntries()[0];
    const oversizedEntries = Array.from({ length: 30_001 }, (_, index) => withSearchText({
      ...template,
      id: `medical-budget-${index}`,
      category: "medical",
      title: `Budget entry ${index}`,
      summary: index === 30_000 ? "Direct database fallback phrase." : "Unrelated budget entry.",
      evidenceTier: "high",
      matchedMarkers: [{ rsid: `rs${900000 + index}`, genotype: "AA", chromosome: "1", position: index, gene: "GENE" }],
    }));
    const directPage = {
      entries: [oversizedEntries[30_000]],
      nextCursor: null,
      totalLoaded: 1,
      hasMore: false,
    };
    installEntries(oversizedEntries);
    vi.mocked(loadCategoryPage).mockResolvedValueOnce(directPage);

    const page = await loadExplorerPage({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "direct database fallback phrase" },
    });

    expect(page).toBe(directPage);
    expect(loadCategoryPage).toHaveBeenCalledWith({
      profileId: "profile-explorer-search",
      category: "medical",
      filters: { ...DEFAULT_FILTERS, q: "direct database fallback phrase" },
      cursor: undefined,
      pageSize: 50,
    });
    expect(saveSearchIndexCache).not.toHaveBeenCalled();
  });

  it("returns stable MiniSearch pages with load more cursors", async () => {
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

  it("preserves MiniSearch result order after IndexedDB hydration", async () => {
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

describe("shouldIndexEntry", () => {
  it("keeps curated entries and prunes low-signal supplementary local evidence", () => {
    const template = storedEntries()[0];

    expect(shouldIndexEntry({ ...template, entryKind: "curated", evidenceTier: "supplementary" })).toBe(true);
    expect(shouldIndexEntry({
      ...template,
      entryKind: "local-evidence",
      evidenceTier: "supplementary",
      subcategory: "snpedia",
      publicationCount: 0,
      magnitude: null,
      repute: "good",
    })).toBe(false);
    expect(shouldIndexEntry({
      ...template,
      entryKind: "local-evidence",
      evidenceTier: "supplementary",
      subcategory: "snpedia",
      publicationCount: 0,
      magnitude: 2,
      repute: "good",
    })).toBe(true);
    expect(shouldIndexEntry({ ...template, entryKind: "local-evidence", evidenceTier: "moderate" })).toBe(true);
    expect(shouldIndexEntry({ ...template, entryKind: "local-evidence", evidenceTier: "emerging" })).toBe(false);
  });
});
