import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEntrySearchText } from "./explorer";
import { searchReportEntriesForChat } from "./aiRetrieval";
import { loadReportEntriesByIds, streamReportEntries } from "./storage";
import { makeSavedProfile } from "../test/fixtures";
import type { ChatSearchPlan } from "./aiChat";
import type { InsightCategory, StoredReportEntry } from "../types";

vi.mock("./storage", () => ({
  streamReportEntries: vi.fn(),
  loadReportEntriesByIds: vi.fn(),
}));

function storedEntries(): StoredReportEntry[] {
  const profile = makeSavedProfile({ id: "profile-ai-search" });
  return profile.report.entries.map((entry) => ({
    ...entry,
    profileId: profile.id,
    searchText: buildEntrySearchText(entry),
  }));
}

function installEntries(entries: StoredReportEntry[]) {
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
      title: "Normal (higher) risk of Male Pattern Baldness",
      summary: "Normal (higher) risk of Male Pattern Baldness.",
      detail: "Discovered by 23andMe based on customer surveys, and considered preliminary research.",
      conditions: [
        "Discovered by 23andMe based on customer surveys, and considered preliminary research.",
        "Normal (higher) risk of Male Pattern Baldness.",
      ],
      genes: [],
      topics: ["SNPedia", "Genotype page"],
      matchedMarkers: [{ rsid: "rs2003046", genotype: "CC", chromosome: "7", position: 123, gene: undefined }],
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
