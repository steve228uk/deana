import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEntrySearchText, matchesEntryFilters } from "./explorer";
import { searchReportEntriesForChat } from "./aiRetrieval";
import { clearSearchIndex } from "./ai/searchIndex";
import {
  deleteSearchIndexCache,
  loadCategoryPage,
  loadReportEntriesByIds,
  loadSearchIndexCache,
  loadSearchIndexSource,
  saveSearchIndexCache,
  streamReportEntries,
} from "./storage";
import { makeSavedProfile } from "../test/fixtures";
import type { ChatSearchPlan, InsightCategory, StoredReportEntry } from "../types";

vi.mock("./storage", () => ({
  streamReportEntries: vi.fn(),
  loadCategoryPage: vi.fn(),
  loadReportEntriesByIds: vi.fn(),
  loadSearchIndexSource: vi.fn(),
  loadSearchIndexCache: vi.fn(),
  saveSearchIndexCache: vi.fn(),
  deleteSearchIndexCache: vi.fn(),
}));

let cachedSearchIndex: unknown = null;

function storedEntries(): StoredReportEntry[] {
  const profile = makeSavedProfile({ id: "profile-ai-search" });
  return profile.report.entries.map((entry) => ({
    ...entry,
    profileId: profile.id,
    searchText: buildEntrySearchText(entry),
  }));
}

function installEntries(entries: StoredReportEntry[]) {
  vi.mocked(loadSearchIndexSource).mockImplementation(async (profileId: string) => ({
    metadata: {
      reportVersion: 1,
      evidencePackVersion: "test",
      reportParsedAt: "2026-04-25T00:00:00.000Z",
    },
    entries: entries.filter((entry) => entry.profileId === profileId || profileId === "profile-ai-search"),
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

  vi.mocked(loadReportEntriesByIds).mockImplementation(async (profileId: string, ids: string[]) => {
    const selected = [] as StoredReportEntry[];
    for await (const entry of streamReportEntries(profileId)) {
      if (ids.includes(entry.id)) selected.push(entry);
    }
    return selected;
  });

  vi.mocked(streamReportEntries).mockImplementation(async function* (_profileId: string, category?: InsightCategory) {
    for (const entry of entries) {
      if (!category || entry.category === category) {
        yield entry;
      }
    }
  });
  vi.mocked(loadCategoryPage).mockImplementation(async ({
    profileId,
    category,
    filters,
    cursor,
    pageSize = 50,
  }) => {
    const start = cursor ? Number(cursor) : 0;
    const matchedEntries = entries.filter((entry) =>
      (entry.profileId === profileId || profileId === "profile-ai-search") &&
      matchesEntryFilters(entry, filters, category),
    );
    const pageEntries = matchedEntries.slice(start, start + pageSize);
    const nextCursor = start + pageSize < matchedEntries.length ? String(start + pageSize) : null;

    return {
      entries: pageEntries,
      nextCursor,
      totalLoaded: start + pageEntries.length,
      hasMore: nextCursor !== null,
    };
  });
}

function withSearchText(entry: StoredReportEntry): StoredReportEntry {
  return {
    ...entry,
    searchText: buildEntrySearchText(entry),
  };
}

describe("searchReportEntriesForChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedSearchIndex = null;
    clearSearchIndex();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses AI-planned genes and rsIDs to retrieve local report findings", async () => {
    const entries = storedEntries();
    installEntries(entries);
    const plan: ChatSearchPlan = {
      query: "factor v leiden",
      categories: ["medical"],
      genes: ["F5"],
      rsids: ["rs6025"],
      topics: [],
      conditions: [],
      relatedTerms: [],
      evidence: [],
      rationale: "Search Factor V Leiden markers.",
    };

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "What does Factor V mean?",
      plan,
    });

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].markers.some((marker) => marker.rsid === "rs6025")).toBe(true);
    expect(result.trace.usedFallback).toBe(false);
    expect(result.trace.indexCandidateCount).toBeGreaterThan(0);
    expect(result.trace.timingMs?.total).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("Stephen");
  });

  it("caps retrieved findings before they leave the browser", async () => {
    const template = storedEntries().find((entry) => entry.category === "medical")!;
    const entries = Array.from({ length: 20 }, (_, index) => ({
      ...template,
      id: `medical-copy-${index}`,
      title: `Factor V copy ${index}`,
      sort: {
        ...template.sort,
        severity: 100 - index,
      },
    }));
    installEntries(entries);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Factor V Leiden",
      limit: 6,
    });

    expect(result.findings).toHaveLength(6);
    expect(result.trace.usedFallback).toBe(false);
  });

  it("uses MiniSearch candidate strength instead of rsID plans to choose the result count", async () => {
    const template = storedEntries().find((entry) => entry.category === "medical")!;
    const entries = Array.from({ length: 8 }, (_, index) => withSearchText({
      ...template,
      id: `medical-factor-rsid-${index}`,
      title: `Factor V Leiden context ${index}`,
      summary: "Factor V Leiden clotting context.",
      genes: ["F5"],
      matchedMarkers: [{ rsid: "rs6025", genotype: "CT", chromosome: "1", position: 169519049, gene: "F5" }],
      sort: {
        ...template.sort,
        severity: 100 - index,
      },
    }));
    installEntries(entries);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Factor V Leiden rs6025",
      plan: {
        query: "Factor V Leiden",
        categories: ["medical"],
        genes: ["F5"],
        rsids: ["rs6025"],
        topics: [],
        conditions: ["Factor V Leiden"],
        relatedTerms: [],
        evidence: [],
        rationale: "Search a specific marker.",
      },
    });

    expect(result.findings.length).toBeGreaterThan(5);
    expect(result.findings).toHaveLength(8);
    expect(result.trace.candidateWindowCount).toBe(8);
    expect(result.trace.sentCount).toBe(8);
    expect(result.trace.remainingCandidateCount).toBe(0);
    expect(result.trace.retrievalCursor?.hasMore).toBe(false);
  });

  it("uses AI-planned related terms to search full finding fields", async () => {
    const template = storedEntries()[0];
    const entry: StoredReportEntry = {
      ...template,
      id: "source-note-match",
      title: "Unrelated title",
      summary: "No direct prompt term here.",
      detail: "No direct prompt term here either.",
      sourceNotes: ["This note mentions a rare phenotype alias that only appears in source notes."],
      searchText: "",
    };
    entry.searchText = buildEntrySearchText(entry);
    installEntries([entry]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Anything about the uncommon condition?",
      plan: {
        query: "uncommon condition",
        categories: [],
        genes: [],
        rsids: [],
        topics: [],
        conditions: [],
        relatedTerms: ["rare phenotype alias"],
        evidence: [],
        rationale: "Search related phenotype aliases.",
      },
    });

    expect(result.findings[0].id).toBe("source-note-match");
    expect(result.trace.returnedFindings[0].matchedFields).toContain("sourceNotes");
    expect(result.trace.usedFallback).toBe(false);
  });

  it("deduplicates repeated streamed report entries before building the MiniSearch index", async () => {
    const template = storedEntries()[0];
    const entry = withSearchText({
      ...template,
      id: "duplicate-entry",
      title: "Duplicate searchable Factor V entry",
      genes: ["F5"],
      matchedMarkers: [{ rsid: "rs6025", genotype: "CT", chromosome: "1", position: 169519049, gene: "F5" }],
    });
    installEntries([entry, entry]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Factor V",
      plan: {
        query: "Factor V",
        categories: ["medical"],
        genes: ["F5"],
        rsids: ["rs6025"],
        topics: [],
        conditions: [],
        relatedTerms: [],
        evidence: [],
        rationale: "Search duplicate report entries.",
      },
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe("duplicate-entry");
    expect(result.trace.usedFallback).toBe(false);
  });

  it("restores a cached MiniSearch index without reloading all report entries", async () => {
    const entries = storedEntries();
    installEntries(entries);

    await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Factor V",
      plan: {
        query: "Factor V",
        categories: ["medical"],
        genes: ["F5"],
        rsids: ["rs6025"],
        topics: [],
        conditions: [],
        relatedTerms: [],
        evidence: [],
        rationale: "Prime the cached search index.",
      },
    });

    expect(saveSearchIndexCache).toHaveBeenCalledTimes(1);
    vi.mocked(loadSearchIndexSource).mockClear();
    clearSearchIndex(undefined, { preservePersistentCache: true });

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Factor V",
      plan: {
        query: "Factor V",
        categories: ["medical"],
        genes: ["F5"],
        rsids: ["rs6025"],
        topics: [],
        conditions: [],
        relatedTerms: [],
        evidence: [],
        rationale: "Use the cached search index.",
      },
    });

    expect(loadSearchIndexSource).not.toHaveBeenCalled();
    expect(result.trace.usedFallback).toBe(false);
    expect(result.trace.indexCandidateCount).toBeGreaterThan(0);
  });

  it("retrieves the rs9939609 diabetes and ghrelin finding through planner terms", async () => {
    const template = storedEntries()[0];
    const entry: StoredReportEntry = {
      ...template,
      id: "local-medical-snpedia-rs9939609-a-t",
      category: "medical",
      title: "1.3x risk for T2D; obesity risk",
      summary: "1.3x risk for T2D; obesity risk",
      detail: "one copy of the genotype which increases production of the appetite stimulating hormone ghrelin. This increases your risk for obesity and Type-2 diabetes by approximately 20%.",
      conditions: ["obesity", "Type-2 diabetes"],
      matchedMarkers: [{ rsid: "rs9939609", genotype: "AT", chromosome: "16", position: 53820527, gene: "FTO" }],
      searchText: "",
    };
    entry.searchText = buildEntrySearchText(entry);
    installEntries([entry]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Is there anything about diabetes?",
      plan: {
        query: "diabetes",
        categories: [],
        genes: [],
        rsids: [],
        topics: [],
        conditions: ["diabetes"],
        relatedTerms: ["type-2 diabetes", "t2d", "ghrelin", "obesity"],
        evidence: [],
        rationale: "Search diabetes aliases and related traits.",
      },
    });

    expect(result.findings[0]).toMatchObject({
      id: "local-medical-snpedia-rs9939609-a-t",
      title: "1.3x risk for T2D; obesity risk",
    });
    expect(result.trace.searchedTerms).toContain("ghrelin");
  });

  it("retrieves saved baldness report findings through planner terms", async () => {
    const template = storedEntries()[0];
    const baldnessEntry = withSearchText({
      ...template,
      id: "local-traits-snpedia-rs2003046-c-c",
      category: "traits",
      subcategory: "snpedia",
      title: "Normal (higher) risk of Male Pattern Baldness",
      summary: "Normal (higher) risk of Male Pattern Baldness.",
      detail: "Discovered by 23andMe based on customer surveys, and considered preliminary research.",
      evidenceTier: "supplementary",
      conditions: [
        "Discovered by 23andMe based on customer surveys, and considered preliminary research.",
        "Normal (higher) risk of Male Pattern Baldness.",
      ],
      genes: [],
      topics: ["SNPedia", "Genotype page"],
      matchedMarkers: [{ rsid: "rs2003046", genotype: "CC", chromosome: "7", position: 123, gene: undefined }],
      sources: [{ id: "snpedia", name: "SNPedia", url: "https://example.com/snpedia" }],
      sourceNotes: ["SNPedia genotype page: Rs2003046(C;C)."],
    });
    const unrelatedEntry = withSearchText({
      ...template,
      id: "local-trait-gwas-rs11789015-16817",
      category: "traits",
      title: "Digestive system disease association near BARX1",
      summary: "GWAS Catalog links rs11789015-A with digestive system disease.",
      detail: "GWAS Catalog association with p-value 1E-9.",
      conditions: ["Digestive system disease"],
      genes: ["BARX1"],
      topics: ["GWAS", "Association"],
      matchedMarkers: [{ rsid: "rs11789015", genotype: "AA", chromosome: "9", position: 123, gene: "BARX1" }],
    });
    installEntries([unrelatedEntry, baldnessEntry]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "show me about baldness",
      plan: {
        query: "baldness",
        categories: [],
        genes: ["AR", "HR", "EDAR", "WNT10A"],
        rsids: [],
        topics: ["hair loss", "alopecia", "pattern baldness"],
        conditions: ["androgenetic alopecia", "alopecia", "male pattern baldness"],
        relatedTerms: ["balding", "MPB", "androgenic alopecia", "hair loss", "pattern baldness variants"],
        evidence: ["high", "moderate", "emerging", "preview", "supplementary"],
        rationale: "Search locally for entries related to baldness.",
      },
    });

    expect(result.findings[0]).toMatchObject({
      id: "local-traits-snpedia-rs2003046-c-c",
      title: "Normal (higher) risk of Male Pattern Baldness",
    });
    expect(result.findings.map((finding) => finding.id)).not.toContain(unrelatedEntry.id);
    expect(result.trace.returnedFindings[0].matchedFields).toContain("title");
  });

  it("keeps relevant supplementary SNPedia context when primary matches crowd the result set", async () => {
    const template = storedEntries()[0];
    const primaryMatches = Array.from({ length: 30 }, (_, index) => withSearchText({
      ...template,
      id: `local-traits-primary-baldness-${index}`,
      category: "traits",
      title: `Male Pattern Baldness primary context ${index}`,
      summary: "Male Pattern Baldness context.",
      detail: "Primary evidence context for pattern baldness.",
      evidenceTier: "high",
      genes: ["AR"],
      topics: ["Trait association"],
      conditions: ["Male Pattern Baldness"],
      sources: [{ id: "gwas", name: "GWAS Catalog", url: "https://example.com/gwas" }],
      matchedMarkers: [{ rsid: `rs${300000 + index}`, genotype: "AA", chromosome: "7", position: 100 + index, gene: "AR" }],
    }));
    const snpediaContext = withSearchText({
      ...template,
      id: "local-traits-snpedia-baldness-context",
      category: "traits",
      subcategory: "snpedia",
      title: "Male Pattern Baldness SNPedia context",
      summary: "Male Pattern Baldness genotype context.",
      detail: "Supplementary consumer-facing SNPedia context.",
      evidenceTier: "supplementary",
      magnitude: 2,
      genes: [],
      topics: ["SNPedia", "Genotype page"],
      conditions: ["Male Pattern Baldness"],
      sources: [{ id: "snpedia", name: "SNPedia", url: "https://example.com/snpedia" }],
      matchedMarkers: [{ rsid: "rs2003046", genotype: "CC", chromosome: "7", position: 123, gene: undefined }],
      sourceNotes: ["SNPedia genotype page: Rs2003046(C;C)."],
    });
    installEntries([...primaryMatches, snpediaContext]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "show me about baldness",
      plan: {
        query: "baldness",
        categories: ["traits"],
        genes: [],
        rsids: [],
        topics: ["pattern baldness"],
        conditions: ["male pattern baldness"],
        relatedTerms: ["baldness", "male pattern baldness"],
        evidence: [],
        rationale: "Search locally for baldness context.",
      },
    });

    expect(result.findings).toHaveLength(18);
    expect(result.findings.map((finding) => finding.id)).toContain("local-traits-snpedia-baldness-context");
    expect(result.trace.candidateWindowCount).toBe(31);
    expect(result.trace.sentCount).toBe(18);
    expect(result.trace.remainingCandidateCount).toBe(13);
    expect(result.trace.retrievalCursor?.hasMore).toBe(true);

    const nextResult = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: result.trace.searchPlan?.query ?? "baldness",
      plan: result.trace.searchPlan,
      excludeIds: result.trace.retrievalCursor?.sentFindingIds,
      offset: result.trace.retrievalCursor?.nextOffset,
    });

    expect(nextResult.findings.length).toBeGreaterThan(0);
    expect(nextResult.findings.some((finding) => result.findings.some((previous) => previous.id === finding.id))).toBe(false);
    expect(nextResult.trace.retrievalCursor?.sentFindingIds.length).toBeGreaterThan(result.trace.retrievalCursor?.sentFindingIds.length ?? 0);
  });

  it("keeps exact gene and title matches ahead of broad informational matches", async () => {
    const template = storedEntries()[0];
    const broadInformational = Array.from({ length: 36 }, (_, index) => withSearchText({
      ...template,
      id: `local-medical-apoe-broad-${index}`,
      category: "medical",
      title: `General informational note ${index}`,
      summary: "APOE appears in a broad background note.",
      detail: "Background evidence mentions APOE without a direct gene finding title.",
      genes: [],
      evidenceTier: "emerging",
      outcome: "informational",
      repute: "not-set",
      matchedMarkers: [{ rsid: `rs${100000 + index}`, genotype: "AA", chromosome: "19", position: 100 + index, gene: undefined }],
      sort: {
        ...template.sort,
        severity: 100,
      },
    }));
    const exactMatch = withSearchText({
      ...template,
      id: "local-medical-apoe-exact",
      category: "medical",
      title: "APOE Alzheimer disease risk context",
      summary: "APOE genotype context.",
      genes: ["APOE"],
      conditions: ["Alzheimer disease"],
      evidenceTier: "high",
      outcome: "negative",
      repute: "bad",
      matchedMarkers: [{ rsid: "rs429358", genotype: "CT", chromosome: "19", position: 44908684, gene: "APOE" }],
      sort: {
        ...template.sort,
        severity: 1,
      },
    });
    installEntries([...broadInformational, exactMatch]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "What does APOE mean for Alzheimer disease?",
      plan: {
        query: "APOE Alzheimer",
        categories: ["medical"],
        genes: ["APOE"],
        rsids: [],
        topics: [],
        conditions: ["Alzheimer disease"],
        relatedTerms: ["APOE"],
        evidence: ["high"],
        rationale: "Search for APOE Alzheimer context.",
      },
    });

    expect(result.findings[0]).toMatchObject({
      id: "local-medical-apoe-exact",
      title: "APOE Alzheimer disease risk context",
    });
    expect(result.trace.returnedFindings[0].matchedFields).toEqual(expect.arrayContaining(["conditions", "genes", "title"]));
  });

  it("does not send unrelated findings when the saved report has no matches", async () => {
    const template = storedEntries()[0];
    installEntries([
      withSearchText({
        ...template,
        id: "local-trait-unrelated",
        title: "Digestive system disease association near BARX1",
        summary: "GWAS Catalog links rs11789015-A with digestive system disease.",
        detail: "GWAS Catalog association with p-value 1E-9.",
        conditions: ["Digestive system disease"],
        genes: ["BARX1"],
        topics: ["GWAS", "Association"],
        matchedMarkers: [{ rsid: "rs11789015", genotype: "AA", chromosome: "9", position: 123, gene: "BARX1" }],
      }),
    ]);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "show me about zymase tolerance",
      plan: {
        query: "zymase tolerance",
        categories: [],
        genes: [],
        rsids: [],
        topics: [],
        conditions: [],
        relatedTerms: ["zymase"],
        evidence: ["moderate"],
        rationale: "Search report terms from the prompt.",
      },
    });

    expect(result.findings).toEqual([]);
    expect(result.resultCount).toBe(0);
    expect(result.trace.returnedFindings).toEqual([]);
    expect(result.trace.usedFallback).toBe(true);
    expect(result.trace.indexCandidateCount).toBe(0);
    expect(result.trace.timingMs?.fallbackScan).toBeGreaterThanOrEqual(0);
  });

  it("falls back to direct IndexedDB search when MiniSearch is skipped for memory budget", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    });
    const template = storedEntries()[0];
    const entries: StoredReportEntry[] = Array.from({ length: 125_001 }, (_, index) => ({
      ...template,
      id: `local-medical-budget-${index}`,
      category: "medical",
      title: index === 125_000 ? "Budget fallback Factor V finding" : `Budget filler ${index}`,
      summary: index === 125_000 ? "Factor V Leiden direct scan result." : "Unrelated budget filler.",
      detail: index === 125_000 ? "The direct IndexedDB scan should still find F5." : "Unrelated budget filler.",
      genes: index === 125_000 ? ["F5"] : ["GENE"],
      evidenceTier: "high",
      matchedMarkers: [{ rsid: `rs${700000 + index}`, genotype: "AA", chromosome: "1", position: index, gene: index === 125_000 ? "F5" : "GENE" }],
      searchText: "",
    }));
    entries[125_000] = withSearchText(entries[125_000]);
    installEntries(entries);

    const result = await searchReportEntriesForChat({
      profileId: "profile-ai-search",
      prompt: "Factor V Leiden",
      plan: {
        query: "Factor V Leiden",
        categories: ["medical"],
        genes: ["F5"],
        rsids: [],
        topics: [],
        conditions: [],
        relatedTerms: [],
        evidence: ["high"],
        rationale: "Search for Factor V.",
      },
    });

    expect(result.findings[0]).toMatchObject({
      id: "local-medical-budget-125000",
      title: "Budget fallback Factor V finding",
    });
    expect(result.trace.usedFallback).toBe(true);
    expect(result.trace.fallbackReason).toBe("memory-budget");
    expect(result.trace.indexCandidateCount).toBe(0);
    expect(result.trace.candidateWindowCount).toBe(1);
    expect(streamReportEntries).not.toHaveBeenCalled();
    expect(saveSearchIndexCache).not.toHaveBeenCalled();
  });
});

describe("buildEntrySearchText", () => {
  it("indexes full report finding fields used by chat search", () => {
    const entry = storedEntries()[0];
    const text = buildEntrySearchText({
      ...entry,
      warnings: ["warning-only phrase"],
      sourceNotes: ["source-note-only phrase"],
      sources: [{ id: "source-id", name: "Source Name Only", url: "https://example.com/source-only" }],
      confidenceNote: "confidence-only phrase",
      disclaimer: "disclaimer-only phrase",
      frequencyNote: "frequency-only phrase",
      clinicalSignificance: "clinical-only phrase",
      sourceGenotype: "genotype-only phrase",
      matchedMarkers: [{
        rsid: "rs123456",
        genotype: "AG",
        chromosome: "1",
        position: 123,
        gene: "GENEONLY",
        matchedAllele: "A",
        matchedAlleleCount: 1,
      }],
    });

    expect(text).toContain("warning-only phrase");
    expect(text).toContain("source-note-only phrase");
    expect(text).toContain("source name only");
    expect(text).toContain("confidence-only phrase");
    expect(text).toContain("disclaimer-only phrase");
    expect(text).toContain("frequency-only phrase");
    expect(text).toContain("clinical-only phrase");
    expect(text).toContain("genotype-only phrase");
    expect(text).toContain("geneonly");
  });
});
