import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  deleteChatThread,
  deleteProfile,
  loadAiChatNoticeDismissal,
  loadAiConsent,
  loadCategoryPage,
  loadChatMessages,
  loadChatThreads,
  loadProfileMeta,
  loadProfileSummaries,
  loadReportEntriesByIds,
  loadReportEntry,
  saveAiConsent,
  saveAiChatNoticeDismissal,
  saveChatMessages,
  saveChatThread,
  saveProfile,
  streamReportEntries,
} from "./lib/storage";
import { EVIDENCE_PACK_VERSION } from "./lib/evidencePack";
import {
  loadMarkerSummary,
  prewarmMarkerIndex,
  prewarmSearchIndex,
  searchExplorerEntryIds,
  searchMarkerPage,
  waitForIndex,
} from "./lib/ai/searchIndex";
import { ExplorerFilters, buildEntrySearchText, compareEntries, matchesEntryFilters } from "./lib/explorer";
import { buildCategoryFacets, buildFacets } from "./lib/reportEngine";
import {
  makeParsedDnaFile,
  makeProfileMetaFromProfile,
  makeProfileSummary,
  makeSavedProfile,
} from "./test/fixtures";
import {
  ProfileMeta,
  SavedProfile,
  SavedProfileSummary,
  EvidenceSupplement,
  StoredChatMessage,
  StoredChatThread,
  StoredMarkerSummary,
  StoredReportEntry,
} from "./types";

const readySearchIndexStatus = vi.hoisted(() => (documentCount = 0) => ({
  state: "ready" as const,
  documentCount,
}));

vi.mock("./lib/storage", () => ({
  loadProfileSummaries: vi.fn(),
  loadProfileMeta: vi.fn(),
  loadAiConsent: vi.fn(),
  loadAiChatNoticeDismissal: vi.fn(),
  saveAiConsent: vi.fn(),
  saveAiChatNoticeDismissal: vi.fn(),
  loadChatThreads: vi.fn(),
  deleteChatThread: vi.fn(),
  saveChatThread: vi.fn(),
  loadChatMessages: vi.fn(),
  saveChatMessages: vi.fn(),
  loadCategoryPage: vi.fn(),
  loadReportEntriesByIds: vi.fn(),
  loadReportEntry: vi.fn(),
  streamReportEntries: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
}));

vi.mock("./lib/ai/searchIndex", () => ({
  clearSearchIndex: vi.fn(),
  loadMarkerSummary: vi.fn(),
  prewarmMarkerIndex: vi.fn(async () => readySearchIndexStatus()),
  prewarmSearchIndex: vi.fn(async () => readySearchIndexStatus()),
  searchExplorerEntryIds: vi.fn(),
  searchMarkerPage: vi.fn(),
  waitForIndex: vi.fn(async () => readySearchIndexStatus()),
}));

const parsed = makeParsedDnaFile();
const mockSupplement: EvidenceSupplement = {
  status: "complete",
  fetchedAt: new Date().toISOString(),
  attribution: "Local evidence attribution",
  packVersion: EVIDENCE_PACK_VERSION,
  manifest: null,
  totalRsids: parsed.markerCount,
  processedRsids: parsed.markerCount,
  matchedRecords: [
    {
      record: {
        id: "clinvar-rs6025",
        entryId: "medical-factor-v",
        sourceId: "clinvar",
        role: "primary",
        markerIds: ["rs6025"],
        genes: ["F5"],
        title: "F5 Factor V Leiden",
        url: "https://www.ncbi.nlm.nih.gov/clinvar/?term=rs6025",
        release: "ClinVar public release",
        evidenceLevel: "high",
        clinicalSignificance: "pathogenic",
        riskAllele: "C",
        pmids: ["8164741"],
        notes: ["ClinVar context for Factor V Leiden."],
      },
      matchedMarkers: [
        {
          rsid: "rs6025",
          genotype: "CT",
          chromosome: "1",
          position: 169519049,
          gene: "F5",
        },
      ],
    },
  ],
  unmatchedRsids: 0,
  failedItems: [],
  retries: 0,
};

let nextWorkerResponse: { ok: true; data: typeof parsed } | { ok: false; error: string };
let nextEvidenceResponse:
  | { type: "done"; supplement: EvidenceSupplement }
  | { type: "error"; error: string };
let storedProfiles: SavedProfile[] = [];
let storedAiConsents: Record<string, { accepted: true; version: number; acceptedAt: string; chatNoticeDismissedAt?: string }> = {};
let storedChatThreads: StoredChatThread[] = [];
let storedChatMessages: StoredChatMessage[] = [];
let workerPostCounts: Record<"parser" | "evidence", number>;

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private readonly workerKind: "parser" | "evidence";

  constructor(url: URL | string) {
    const value = String(url);
    this.workerKind = value.includes("evidenceEnrichment")
      ? "evidence"
      : "parser";
  }

  postMessage(payload: { file?: File; type?: string }) {
    workerPostCounts[this.workerKind] += 1;
    queueMicrotask(() => {
      if (payload.file || this.workerKind === "parser") {
        this.onmessage?.({ data: nextWorkerResponse } as MessageEvent);
        return;
      }

      this.onmessage?.({
        data: {
          type: "progress",
          snapshot: {
            status: "running",
            totalRsids: parsed.markerCount,
            processedRsids: parsed.markerCount,
            matchedFindings: 1,
            unmatchedRsids: 0,
            failedRsids: 0,
            retries: 0,
            currentRsid: "Matched bundled evidence records",
            packStage: "matching",
            packVersion: EVIDENCE_PACK_VERSION,
          },
        },
      } as MessageEvent);
      queueMicrotask(() => {
        this.onmessage?.({ data: nextEvidenceResponse } as MessageEvent);
      });
    });
  }

  terminate() {}
}

function profileSummaryFromProfile(profile: SavedProfile): SavedProfileSummary {
  return makeProfileSummary({
    id: profile.id,
    name: profile.name,
    fileName: profile.fileName,
    createdAt: profile.createdAt,
    dna: {
      provider: profile.dna.provider,
      build: profile.dna.build,
      markerCount: profile.dna.markerCount,
    },
    reportVersion: profile.reportVersion,
    evidencePackVersion: profile.evidencePackVersion,
    report: {
      overview: profile.report.overview,
    },
  });
}

function profileMetaFromProfile(profile: SavedProfile): ProfileMeta {
  return makeProfileMetaFromProfile(profile);
}

function storedEntriesFromProfile(profile: SavedProfile): StoredReportEntry[] {
  return profile.report.entries.map((entry) => ({
    ...entry,
    profileId: profile.id,
    searchText: buildEntrySearchText(entry),
  }));
}

function queryEntries(
  profile: SavedProfile,
  category: StoredReportEntry["category"],
  filters: ExplorerFilters,
): StoredReportEntry[] {
  return storedEntriesFromProfile(profile)
    .filter((entry) => matchesEntryFilters(entry, filters, category))
    .sort((left, right) => compareEntries(left, right, filters.sort));
}

function markerSummariesFromProfile(profile: SavedProfile): StoredMarkerSummary[] {
  const entries = storedEntriesFromProfile(profile);
  return profile.dna.markers.map(([rsid, chromosome, position, genotype]) => {
    const linkedEntries = entries.filter((entry) =>
      entry.matchedMarkers.some((marker) => marker.rsid.toLowerCase() === rsid.toLowerCase()),
    );
    return {
      rsid,
      chromosome,
      position,
      genotype,
      genes: Array.from(new Set(linkedEntries.flatMap((entry) => entry.genes))),
      findingIds: linkedEntries.map((entry) => entry.id),
      findingTitles: linkedEntries.map((entry) => entry.title),
      findingCount: linkedEntries.length,
    };
  });
}

function sliceEntries<T>(entries: T[], offset: number, limit: number): T[] {
  return entries.slice(offset, offset + limit);
}

function installStorageMocks() {
  vi.mocked(loadProfileSummaries).mockImplementation(async () =>
    storedProfiles.map(profileSummaryFromProfile).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  vi.mocked(loadProfileMeta).mockImplementation(async (profileId: string) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    return profile ? profileMetaFromProfile(profile) : null;
  });
  vi.mocked(loadAiConsent).mockImplementation(async (profileId: string) => storedAiConsents[profileId] ?? null);
  vi.mocked(loadAiChatNoticeDismissal).mockImplementation(async (profileId: string) => storedAiConsents[profileId]?.chatNoticeDismissedAt ?? null);
  vi.mocked(saveAiConsent).mockImplementation(async (profileId, consent) => {
    storedAiConsents[profileId] = { ...storedAiConsents[profileId], ...consent };
  });
  vi.mocked(saveAiChatNoticeDismissal).mockImplementation(async (profileId, dismissedAt) => {
    if (!storedAiConsents[profileId]) return;
    storedAiConsents[profileId] = {
      ...storedAiConsents[profileId],
      chatNoticeDismissedAt: dismissedAt,
    };
  });
  vi.mocked(loadChatThreads).mockImplementation(async (profileId: string) =>
    storedChatThreads
      .filter((thread) => thread.profileId === profileId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  );
  vi.mocked(saveChatThread).mockImplementation(async (thread: StoredChatThread) => {
    storedChatThreads = [thread, ...storedChatThreads.filter((candidate) => candidate.id !== thread.id)];
  });
  vi.mocked(deleteChatThread).mockImplementation(async (threadId: string) => {
    storedChatThreads = storedChatThreads.filter((thread) => thread.id !== threadId);
    storedChatMessages = storedChatMessages.filter((message) => message.threadId !== threadId);
  });
  vi.mocked(loadChatMessages).mockImplementation(async (threadId: string) =>
    storedChatMessages
      .filter((message) => message.threadId === threadId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  );
  vi.mocked(saveChatMessages).mockImplementation(async (threadId: string, messages: StoredChatMessage[]) => {
    storedChatMessages = [...storedChatMessages.filter((message) => message.threadId !== threadId), ...messages];
  });
  vi.mocked(loadCategoryPage).mockImplementation(async ({ profileId, category, filters, cursor, pageSize = 50 }) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      return {
        entries: [],
        nextCursor: null,
        totalLoaded: 0,
        hasMore: false,
      };
    }

    const entries = queryEntries(profile, category, filters);
    const start = cursor ? Number(cursor) : 0;
    const pageEntries = sliceEntries(entries, start, pageSize);
    const nextCursor = start + pageSize < entries.length ? String(start + pageSize) : null;

    return {
      entries: pageEntries,
      nextCursor,
      totalLoaded: start + pageEntries.length,
      hasMore: nextCursor !== null,
    };
  });
  vi.mocked(waitForIndex).mockImplementation(async () => readySearchIndexStatus());
  vi.mocked(prewarmMarkerIndex).mockImplementation(async () => readySearchIndexStatus());
  vi.mocked(searchExplorerEntryIds).mockImplementation(async ({ profileId, category, filters, offset, limit }) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return { ids: [], count: 0, indexStatus: readySearchIndexStatus() };

    const entries = queryEntries(profile, category, filters);
    return {
      ids: sliceEntries(entries, offset, limit).map((entry) => entry.id),
      count: entries.length,
      indexStatus: readySearchIndexStatus(entries.length),
    };
  });
  vi.mocked(searchMarkerPage).mockImplementation(async ({ profileId, query, sort, offset, limit }) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      return { markers: [], nextCursor: null, totalLoaded: 0, hasMore: false, indexStatus: readySearchIndexStatus() };
    }
    const normalizedQuery = query.trim().toLowerCase();
    const summaries = markerSummariesFromProfile(profile)
      .filter((marker) => {
        if (!normalizedQuery) return true;
        return [
          marker.rsid,
          marker.genotype,
          marker.chromosome,
          marker.position,
          marker.genes.join(" "),
          marker.findingTitles.join(" "),
        ].join(" ").toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (sort === "rsid") return Number(left.rsid.slice(2)) - Number(right.rsid.slice(2));
        if (sort === "location") return left.chromosome.localeCompare(right.chromosome) || left.position - right.position;
        if (sort === "raw") return profile.dna.markers.findIndex((marker) => marker[0] === left.rsid) - profile.dna.markers.findIndex((marker) => marker[0] === right.rsid);
        return right.findingCount - left.findingCount || Number(left.rsid.slice(2)) - Number(right.rsid.slice(2));
      });
    const pageMarkers = sliceEntries(summaries, offset, limit);
    const nextOffset = offset + pageMarkers.length;
    return {
      markers: pageMarkers,
      nextCursor: nextOffset < summaries.length ? JSON.stringify({ offset: nextOffset }) : null,
      totalLoaded: nextOffset,
      hasMore: nextOffset < summaries.length,
      indexStatus: readySearchIndexStatus(summaries.length),
    };
  });
  vi.mocked(loadMarkerSummary).mockImplementation(async (profileId: string, rsid: string) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return null;
    return markerSummariesFromProfile(profile).find((marker) => marker.rsid.toLowerCase() === rsid.toLowerCase()) ?? null;
  });
  vi.mocked(loadReportEntry).mockImplementation(async (profileId: string, entryId: string) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return null;
    return storedEntriesFromProfile(profile).find((entry) => entry.id === entryId) ?? null;
  });
  vi.mocked(loadReportEntriesByIds).mockImplementation(async (profileId: string, ids: string[]) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return [];
    const entryById = new Map(storedEntriesFromProfile(profile).map((entry) => [entry.id, entry]));
    return ids.map((id) => entryById.get(id)).filter((entry): entry is StoredReportEntry => Boolean(entry));
  });
  vi.mocked(streamReportEntries).mockImplementation(async function* (profileId: string) {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    for (const entry of storedEntriesFromProfile(profile)) {
      yield entry;
    }
  });
  vi.mocked(saveProfile).mockImplementation(async (profile: SavedProfile) => {
    storedProfiles = [profile, ...storedProfiles.filter((candidate) => candidate.id !== profile.id)];
  });
  vi.mocked(deleteProfile).mockImplementation(async (profileId: string) => {
    storedProfiles = storedProfiles.filter((candidate) => candidate.id !== profileId);
    delete storedAiConsents[profileId];
    storedChatThreads = storedChatThreads.filter((thread) => thread.profileId !== profileId);
    storedChatMessages = storedChatMessages.filter((message) => message.profileId !== profileId);
  });
}

function makePaginatedProfile(id: string, count: number): SavedProfile {
  const profile = makeSavedProfile({ id });
  const template = profile.report.entries.find((entry) => entry.category === "medical") ?? profile.report.entries[0];
  const medicalEntries = Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `medical-${index + 1}`,
    title: `Medical finding ${String(index + 1).padStart(2, "0")}`,
    summary: index === 54 ? "Paginated detail keeps loading smoothly." : template.summary,
    detail: template.detail,
    sort: {
      ...template.sort,
      severity: count - index,
      alphabetical: `medical finding ${String(index + 1).padStart(2, "0")}`,
    },
  }));

  return withReportEntries(profile, medicalEntries, { medical: count, traits: 0, drug: 0 });
}

function makeTabFacetProfile(id: string): SavedProfile {
  const profile = makeSavedProfile({ id });
  const medicalTemplate = profile.report.entries.find((entry) => entry.category === "medical") ?? profile.report.entries[0];
  const drugTemplate = profile.report.entries.find((entry) => entry.category === "drug") ?? profile.report.entries[0];
  const entries: SavedProfile["report"]["entries"] = [
    {
      ...medicalTemplate,
      id: "medical-only-facet",
      category: "medical",
      title: "Medical only facet",
      sources: [{ id: "medical-only", name: "Medical Only Source", url: "https://example.com/medical" }],
      genes: ["MEDGENE"],
      topics: ["Medical topic"],
      conditions: ["Medical condition"],
    },
    {
      ...drugTemplate,
      id: "drug-only-facet",
      category: "drug",
      title: "Drug only facet",
      sources: [{ id: "drug-only", name: "Drug Only Source", url: "https://example.com/drug" }],
      genes: ["DRUGGENE"],
      topics: ["Drug topic"],
      conditions: ["Drug condition"],
    },
  ];

  return withReportEntries(profile, entries, { medical: 1, traits: 0, drug: 1 });
}

function withReportEntries(
  profile: SavedProfile,
  entries: SavedProfile["report"]["entries"],
  counts: { medical: number; traits: number; drug: number },
): SavedProfile {
  return {
    ...profile,
    report: {
      ...profile.report,
      entries,
      tabs: profile.report.tabs.map((tab) => {
        if (tab.tab === "overview") return { ...tab, count: counts.medical + counts.traits + counts.drug };
        if (tab.tab === "medical" || tab.tab === "traits" || tab.tab === "drug") return { ...tab, count: counts[tab.tab] };
        return { ...tab, count: 0 };
      }),
      facets: buildFacets(entries),
      categoryFacets: buildCategoryFacets(entries),
    },
  };
}

function makeStaleEvidenceProfile(id: string): SavedProfile {
  const profile = makeSavedProfile({ id, evidencePackVersion: "legacy-pack" });

  return {
    ...profile,
    report: {
      ...profile.report,
      evidencePackVersion: "legacy-pack",
      overview: {
        ...profile.report.overview,
        evidencePackVersion: "legacy-pack",
      },
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderApp(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <App />
    </MemoryRouter>,
  );
}

async function uploadAndStartReport(
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  name?: string,
) {
  await screen.findByText(/Private DNA reports/i);
  await user.click(screen.getByRole("button", { name: /Upload your DNA export/i }));

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["dna"], "stephen-kit.txt", { type: "text/plain" });
  await user.upload(input, file);

  await screen.findByDisplayValue("stephen-kit");
  if (name) {
    await user.clear(screen.getByLabelText("Profile name"));
    await user.type(screen.getByLabelText("Profile name"), name);
  }
  await user.click(screen.getByRole("button", { name: /Save and build report/i }));
}

function fetchCallsFor(path: string): unknown[][] {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes(path));
}

beforeEach(() => {
  vi.clearAllMocks();
  nextWorkerResponse = { ok: true, data: parsed };
  nextEvidenceResponse = {
    type: "done",
    supplement: mockSupplement,
  };
  storedProfiles = [];
  storedAiConsents = {};
  storedChatThreads = [];
  storedChatMessages = [];
  workerPostCounts = { parser: 0, evidence: 0 };
  installStorageMocks();
  vi.stubGlobal("Worker", MockWorker);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/ai-status")) {
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Not mocked" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }));
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("crypto", {
    randomUUID: () => "profile-1",
  });
});

describe("Deana app", () => {
  it("requires upload then naming before saving and opening the explorer", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(/Private DNA reports/i);
    expect(screen.getByText(/optionally chat with AI about your local report/i)).toBeInTheDocument();
    expect(screen.getByText(/AI chat is opt-in and uses Vercel AI Gateway with zero data retention enabled/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upload your DNA export/i }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dna"], "stephen-kit.txt", { type: "text/plain" });
    await user.upload(input, file);

    await screen.findByDisplayValue("stephen-kit");
    await user.clear(screen.getByLabelText("Profile name"));
    await user.type(screen.getByLabelText("Profile name"), "Stephen");
    expect(screen.queryByText("Evidence sources")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/SNPedia/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save and build report/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));
    expect(workerPostCounts.evidence).toBe(1);
    expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-1?tab=overview");
    expect(await screen.findByText("Current report")).toBeInTheDocument();
  });

  it("accepts a raw DNA file dropped onto the upload target", async () => {
    const user = userEvent.setup();
    renderApp("/");

    await screen.findByText(/Private DNA reports/i);
    await user.click(screen.getByRole("button", { name: /Upload your DNA export/i }));

    const dropzone = screen.getByText(/Drag and drop your file here/i).closest("label");
    const file = new File(["dna"], "stephen-kit.txt", { type: "text/plain" });
    expect(dropzone).not.toBeNull();

    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [file],
        items: [
          {
            kind: "file",
            type: file.type,
            getAsFile: () => file,
          },
        ],
        types: ["Files"],
      },
    });

    await screen.findByDisplayValue("stephen-kit");
  });

  it("builds bundled evidence without a separate SNPedia worker pass", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await uploadAndStartReport(user, container, "Stephen");

    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));
    expect(workerPostCounts.evidence).toBe(1);
    expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-1?tab=overview");
  });

  it("shows a saving state after evidence matching finishes", async () => {
    const user = userEvent.setup();
    let resolveSave: (() => void) | undefined;
    vi.mocked(saveProfile).mockImplementationOnce(async (profile: SavedProfile) => {
      storedProfiles = [profile, ...storedProfiles.filter((candidate) => candidate.id !== profile.id)];
      await new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
    });
    const { container } = renderApp("/");

    await uploadAndStartReport(user, container);

    expect(await screen.findByText("Saving your report…")).toBeInTheDocument();
    expect(screen.queryByLabelText(/complete/i)).not.toBeInTheDocument();

    resolveSave?.();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-1?tab=overview");
    });
  });

  it("shows a search index state before opening the explorer", async () => {
    const user = userEvent.setup();
    let resolveIndex: (() => void) | undefined;
    vi.mocked(prewarmSearchIndex).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveIndex = resolve;
      });
      return readySearchIndexStatus();
    });
    const { container } = renderApp("/");

    await uploadAndStartReport(user, container);

    expect(await screen.findByText("Building search index…")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("/processing");

    resolveIndex?.();
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-1?tab=overview");
    });
  });

  it("opens an existing local report from the home screen", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-2" })];

    renderApp("/");

    await screen.findByText("Recent reports");
    await user.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-2?tab=overview"),
    );
    expect(screen.getByText("Current report")).toBeInTheDocument();
    await waitFor(() => expect(prewarmSearchIndex).toHaveBeenCalledWith("profile-2"));
  });

  it("shows a local evidence update notice for stale reports and refreshes on request", async () => {
    const user = userEvent.setup();
    let resolveIndex: (() => void) | undefined;
    vi.mocked(prewarmSearchIndex).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        resolveIndex = resolve;
      });
      return readySearchIndexStatus();
    });
    storedProfiles = [makeStaleEvidenceProfile("profile-stale")];

    renderApp("/explorer/profile-stale?tab=overview");

    expect(await screen.findByText("New evidence is available")).toBeInTheDocument();
    expect(screen.getAllByText(/legacy-pack/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(EVIDENCE_PACK_VERSION)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Refresh evidence/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/processing/refresh/profile-stale"),
    );
    expect(await screen.findByRole("heading", { name: /Refreshing evidence/i })).toBeInTheDocument();
    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));
    expect(workerPostCounts.evidence).toBe(1);
    expect(screen.getByText("Building search index…")).toBeInTheDocument();
    resolveIndex?.();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-stale?tab=overview"),
    );
    await waitFor(() => expect(screen.queryByText("New evidence is available")).not.toBeInTheDocument());
    expect(storedProfiles[0].evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(storedProfiles[0].report.overview.evidencePackVersion).toBe(EVIDENCE_PACK_VERSION);
  });

  it("leaves a stale report unchanged when evidence refresh fails", async () => {
    const user = userEvent.setup();
    nextEvidenceResponse = { type: "error", error: "Evidence worker failed" };
    storedProfiles = [makeStaleEvidenceProfile("profile-stale-failure")];

    renderApp("/explorer/profile-stale-failure?tab=overview");

    expect(await screen.findByText("New evidence is available")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Refresh evidence/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/processing/refresh/profile-stale-failure"),
    );
    expect(await screen.findByText(/Evidence refresh failed/i)).toBeInTheDocument();
    expect(saveProfile).not.toHaveBeenCalled();
    expect(storedProfiles[0].evidencePackVersion).toBe("legacy-pack");
  });

  it("removes a saved profile from the home library", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-3", name: "Mum" })];

    renderApp("/");

    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("dialog", { name: /Remove this report/i })).toBeInTheDocument();
    expect(deleteProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove report" }));

    await waitFor(() => expect(deleteProfile).toHaveBeenCalledWith("profile-3"));
    await waitFor(() => expect(screen.queryByText("Mum")).not.toBeInTheDocument());
  });

  it("updates tab and filter state in the URL and fills the inspector", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-4" })];

    renderApp("/explorer/profile-4");

    await screen.findByText("Current report");
    await user.click(screen.getByRole("button", { name: "Medical" }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("tab=medical"),
    );

    const search = screen.getByLabelText("Search");
    await user.type(search, "Factor");

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("q=Factor"),
    );

    await user.click(screen.getByRole("button", { name: /Factor V Leiden/i }));

    await waitFor(() =>
      expect(screen.getAllByText("Factor V Leiden", { selector: "h2" }).length).toBeGreaterThan(0),
    );
    const inspector = screen.getByLabelText("Finding inspector");
    expect(within(inspector).getByText("Details")).toBeInTheDocument();
    expect(within(inspector).getByText(/This is one of the clearer consumer-array medical markers/i)).toBeInTheDocument();
    expect(screen.getAllByText("Why it matters").length).toBeGreaterThan(0);
  });

  it("debounces explorer search before committing it to the URL and result loader", async () => {
    const user = userEvent.setup();
    const debounceMs = 300;
    storedProfiles = [makeSavedProfile({ id: "profile-debounced-search" })];

    renderApp("/explorer/profile-debounced-search");

    await screen.findByText("Current report");
    await user.click(screen.getByRole("button", { name: "Medical" }));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("tab=medical"),
    );

    const search = screen.getByLabelText("Search");
    vi.mocked(searchExplorerEntryIds).mockClear();
    vi.useFakeTimers();

    try {
      fireEvent.change(search, { target: { value: "Factor" } });

      expect(search).toHaveValue("Factor");
      expect(screen.getByTestId("location").textContent).not.toContain("q=Factor");
      expect(searchExplorerEntryIds).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(debounceMs - 1);
      });

      expect(screen.getByTestId("location").textContent).not.toContain("q=Factor");
      expect(searchExplorerEntryIds).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("q=Factor"),
    );
    await waitFor(() => expect(searchExplorerEntryIds).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(search).toHaveValue("");
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).not.toContain("q=Factor"),
    );
  });

  it("clears tab-scoped filters when switching category tabs", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeTabFacetProfile("profile-tab-filter-reset")];

    renderApp("/explorer/profile-tab-filter-reset?tab=medical");

    await screen.findByText("Current report");
    await user.selectOptions(screen.getByLabelText("Source"), "Medical Only Source");

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("source=Medical+Only+Source"),
    );

    await user.click(screen.getByRole("button", { name: "Drug response" }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("tab=drug"),
    );
    expect(screen.getByTestId("location").textContent).not.toContain("source=");
    await waitFor(() =>
      expect(vi.mocked(loadCategoryPage).mock.calls.some(([request]) =>
        request.category === "drug" &&
        request.filters.source === "" &&
        request.filters.evidence.length === 0 &&
        request.filters.sort === "rank",
      )).toBe(true),
    );
  });

  it("renders only the facet options for the active category tab", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeTabFacetProfile("profile-category-facets")];

    renderApp("/explorer/profile-category-facets?tab=medical");

    await screen.findByText("Current report");
    const medicalSource = screen.getByLabelText("Source");
    expect(within(medicalSource).getByRole("option", { name: "Medical Only Source" })).toBeInTheDocument();
    expect(within(medicalSource).queryByRole("option", { name: "Drug Only Source" })).not.toBeInTheDocument();
    expect(screen.getAllByText("MEDGENE").length).toBeGreaterThan(0);
    expect(screen.queryByText("DRUGGENE")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Drug response" }));
    await screen.findByRole("heading", { name: "Drug response" });

    const drugSource = screen.getByLabelText("Source");
    expect(within(drugSource).getByRole("option", { name: "Drug Only Source" })).toBeInTheDocument();
    expect(within(drugSource).queryByRole("option", { name: "Medical Only Source" })).not.toBeInTheDocument();
    expect(screen.getAllByText("DRUGGENE").length).toBeGreaterThan(0);
    expect(screen.queryByText("MEDGENE")).not.toBeInTheDocument();
  });

  it("gates AI chat behind explicit consent without making a request on tab open", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];

    renderApp("/explorer/profile-ai?tab=ai");

    await screen.findByText(/AI chat sends report context off this device/i);
    const explorerNav = within(screen.getByRole("navigation", { name: "Explorer sections" }));
    const explorerNavLabels = explorerNav.getAllByRole("button").map((button) => button.textContent);
    expect(explorerNavLabels).toEqual([
      "Overview",
      "AI Chat",
      "Medical",
      "Traits",
      "Drug response",
      "Markers",
    ]);
    expect(fetchCallsFor("/api/ai-status").length).toBeGreaterThan(0);
    expect(fetchCallsFor("/api/chat")).toHaveLength(0);

    expect(screen.getByText(/AI chat sends report context off this device/i)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "AI chat threads" })).not.toBeInTheDocument();
    expect(screen.queryByText("No chats yet.")).not.toBeInTheDocument();
    expect(fetchCallsFor("/api/chat")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "I understand" }));

    expect(screen.getByLabelText("Message Deana AI")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "AI chat threads" })).toBeInTheDocument();
    expect(fetchCallsFor("/api/chat")).toHaveLength(0);
  });

  it("hides the AI tab when AI Gateway credentials are unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/ai-status")) {
        return new Response(JSON.stringify({ enabled: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Not mocked" }), { status: 404 });
    });
    storedProfiles = [makeSavedProfile({ id: "profile-ai-disabled" })];

    renderApp("/explorer/profile-ai-disabled?tab=ai");

    await screen.findByText("Current report");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("tab=overview"));
    expect(screen.queryByRole("button", { name: "AI Chat" })).not.toBeInTheDocument();
  });

  it("shows chat privacy details from the empty-state learn more button without the old banner", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };

    renderApp("/explorer/profile-ai?tab=ai");

    await screen.findByRole("heading", { name: "Ask Deana about this report" });
    expect(screen.queryByText(/Private opt-in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deana sends compact report context first/i)).not.toBeInTheDocument();

    const learnMoreButtons = screen.getAllByRole("button", { name: "Learn more" });
    await user.click(learnMoreButtons[learnMoreButtons.length - 1]!);

    expect(await screen.findByRole("heading", { name: "How AI chat works" })).toBeInTheDocument();
    expect(screen.getByText(/Raw DNA files, full marker lists, profile names, and file names are not included/i)).toBeInTheDocument();
  });

  it("persists dismissal of the AI chat provider notice", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };

    const view = renderApp("/explorer/profile-ai?tab=ai");

    expect(await screen.findByText(/AI chat uses Vercel AI Gateway/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss AI chat note" }));

    await waitFor(() => expect(saveAiChatNoticeDismissal).toHaveBeenCalledWith("profile-ai", expect.any(String)));
    expect(screen.queryByText(/AI chat uses Vercel AI Gateway/i)).not.toBeInTheDocument();

    view.unmount();
    renderApp("/explorer/profile-ai?tab=ai");

    await screen.findByRole("heading", { name: "Ask Deana about this report" });
    expect(screen.queryByText(/AI chat uses Vercel AI Gateway/i)).not.toBeInTheDocument();
  });

  it("opens one unsaved blank chat and focuses the composer", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };
    storedChatThreads = [{
      id: "thread-old",
      profileId: "profile-ai",
      title: "Old chat",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T09:00:00.000Z",
    }];
    storedChatMessages = [{
      id: "message-old",
      threadId: "thread-old",
      profileId: "profile-ai",
      role: "user",
      content: "Previously selected question",
      createdAt: "2026-04-26T09:01:00.000Z",
    }];

    renderApp("/explorer/profile-ai?tab=ai");

    expect(await screen.findByText("Previously selected question")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New chat" }));
    await user.click(screen.getByRole("button", { name: "New chat" }));

    await waitFor(() => expect(screen.queryByText("Previously selected question")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Ask Deana about this report" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Message Deana AI")).toHaveFocus());
    expect(screen.queryByText("New chat", { selector: "strong" })).not.toBeInTheDocument();
    expect(saveChatThread).not.toHaveBeenCalled();
  });

  it("shows the first sent AI message immediately and then saves the chat", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };

    renderApp("/explorer/profile-ai?tab=ai");

    expect(await screen.findByRole("heading", { name: "Ask Deana about this report" })).toBeInTheDocument();
    const input = screen.getByLabelText("Message Deana AI");
    await user.type(input, "Summarize my medical findings");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getAllByText("Summarize my medical findings").length).toBeGreaterThan(0));
    expect(screen.queryByRole("heading", { name: "Ask Deana about this report" })).not.toBeInTheDocument();
    await waitFor(() => expect(saveChatThread).toHaveBeenCalledWith(expect.objectContaining({
      profileId: "profile-ai",
      title: "Summarize my medical findings",
    })));
  });

  it("deletes chats after confirmation", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };
    storedChatThreads = [
      {
        id: "thread-delete",
        profileId: "profile-ai",
        title: "Delete me",
        createdAt: "2026-04-26T10:00:00.000Z",
        updatedAt: "2026-04-26T10:00:00.000Z",
      },
      {
        id: "thread-keep",
        profileId: "profile-ai",
        title: "Keep me",
        createdAt: "2026-04-26T09:00:00.000Z",
        updatedAt: "2026-04-26T09:00:00.000Z",
      },
    ];
    storedChatMessages = [{
      id: "message-delete",
      threadId: "thread-delete",
      profileId: "profile-ai",
      role: "user",
      content: "Delete this message",
      createdAt: "2026-04-26T10:01:00.000Z",
    }];

    renderApp("/explorer/profile-ai?tab=ai");

    await screen.findByText("Delete this message");
    await user.click(screen.getByRole("button", { name: "Delete chat Delete me" }));
    expect(await screen.findByRole("heading", { name: "Remove this chat?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove chat" }));

    await waitFor(() => expect(deleteChatThread).toHaveBeenCalledWith("thread-delete"));
    expect(screen.queryByText("Delete this message")).not.toBeInTheDocument();
    expect(screen.getByText("Keep me", { selector: "strong" })).toBeInTheDocument();
  });

  it("opens deana entry chips in the chat inspector without navigating away", async () => {
    const user = userEvent.setup();
    storedProfiles = [makePaginatedProfile("profile-ai", 1)];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };
    storedChatThreads = [{
      id: "thread-chip",
      profileId: "profile-ai",
      title: "Finding link",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T09:00:00.000Z",
    }];
    storedChatMessages = [{
      id: "message-chip",
      threadId: "thread-chip",
      profileId: "profile-ai",
      role: "assistant",
      content: "Review <deana://entry/medical-1>.",
      createdAt: "2026-04-26T09:01:00.000Z",
    }];

    renderApp("/explorer/profile-ai?tab=ai");

    const message = await screen.findByText(/Review/i);
    const messageNode = message.closest(".dn-ai-message");
    expect(messageNode).not.toBeNull();
    const messageQueries = within(messageNode as HTMLElement);
    expect(messageQueries.queryByRole("button", { name: "deana://entry/medical-1" })).not.toBeInTheDocument();
    await user.click(messageQueries.getByRole("button", { name: "Medical finding 01" }));
    await waitFor(() => expect(loadReportEntry).toHaveBeenCalledWith("profile-ai", "medical-1"));

    const inspector = await screen.findByLabelText("Chat inspector");
    expect(within(inspector).getByText("Details")).toBeInTheDocument();
    expect(within(inspector).getByText("Medical finding 01", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-ai?tab=ai");
  });

  it("opens deana marker chips in the chat inspector", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai-marker" })];
    storedAiConsents["profile-ai-marker"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };
    storedChatThreads = [{
      id: "thread-marker-chip",
      profileId: "profile-ai-marker",
      title: "Marker link",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T09:00:00.000Z",
    }];
    storedChatMessages = [{
      id: "message-marker-chip",
      threadId: "thread-marker-chip",
      profileId: "profile-ai-marker",
      role: "assistant",
      content: "Review deana://marker/rs6025 and [missing](deana://marker/rs123456789).",
      createdAt: "2026-04-26T09:01:00.000Z",
    }];

    renderApp("/explorer/profile-ai-marker?tab=ai");

    const message = await screen.findByText(/Review/i);
    const messageNode = message.closest(".dn-ai-message");
    expect(messageNode).not.toBeNull();
    const messageQueries = within(messageNode as HTMLElement);

    await user.click(messageQueries.getByRole("button", { name: "rs6025" }));
    const inspector = await screen.findByLabelText("Chat inspector");
    expect(await within(inspector).findByRole("heading", { name: "rs6025" })).toBeInTheDocument();

    await user.click(messageQueries.getByRole("button", { name: "missing" }));
    expect(await within(inspector).findByRole("heading", { name: "Marker unavailable" })).toBeInTheDocument();
  });

  it("shows follow-up prompt suggestions and sends the follow-up body", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-ai" })];
    storedAiConsents["profile-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };
    storedChatThreads = [{
      id: "thread-follow-up",
      profileId: "profile-ai",
      title: "Coverage",
      createdAt: "2026-04-26T09:00:00.000Z",
      updatedAt: "2026-04-26T09:00:00.000Z",
    }];
    storedChatMessages = [{
      id: "message-follow-up",
      threadId: "thread-follow-up",
      profileId: "profile-ai",
      role: "assistant",
      content: [
        "Coverage is partial for some findings.",
        '<!-- deana-follow-ups: [{"title":"Explain coverage","body":"What does partial coverage mean in this report?"}] -->',
      ].join("\n"),
      createdAt: "2026-04-26T09:01:00.000Z",
    }];

    renderApp("/explorer/profile-ai?tab=ai");

    expect(await screen.findByText("Coverage is partial for some findings.")).toBeInTheDocument();
    expect(screen.queryByText(/deana-follow-ups/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Explain coverage" }));

    await waitFor(() => expect(screen.getByText("What does partial coverage mean in this report?")).toBeInTheDocument());
  });

  it("appends another page when the user loads more category results", async () => {
    const user = userEvent.setup();
    storedProfiles = [makePaginatedProfile("profile-5", 55)];

    renderApp("/explorer/profile-5?tab=medical");

    await screen.findByText("Current report");
    expect(await screen.findByText("50 visible results+")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("55 visible results")).toBeInTheDocument();
    expect(screen.getByText("Medical finding 55")).toBeInTheDocument();
  });

  it("lists raw markers with finding counts and opens linked findings from the marker inspector", async () => {
    const user = userEvent.setup();
    const baseProfile = makeSavedProfile({ id: "profile-markers" });
    const profile = {
      ...baseProfile,
      dna: {
        ...baseProfile.dna,
        markerCount: baseProfile.dna.markerCount + 1,
        markers: [...baseProfile.dna.markers, ["rs999999", "2", 123456, "AA"] as [string, string, number, string]],
      },
    };
    storedProfiles = [profile];
    const rs6025Summary = markerSummariesFromProfile(profile).find((marker) => marker.rsid === "rs6025");
    expect(rs6025Summary?.findingIds.length).toBeGreaterThan(0);

    renderApp("/explorer/profile-markers?tab=markers");

    await screen.findByRole("heading", { name: "Markers" });
    expect(await screen.findByText("rs999999")).toBeInTheDocument();
    expect(screen.getByText("0 findings")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /rs6025/i }));

    const inspector = await screen.findByLabelText("Marker inspector");
    expect(within(inspector).getByRole("heading", { name: "rs6025" })).toBeInTheDocument();
    expect(within(inspector).getByText(new RegExp(`${rs6025Summary?.findingCount ?? 0} findings?`))).toBeInTheDocument();
    const externalHeading = within(inspector).getByRole("heading", { name: "External marker source" });
    const linkedHeading = within(inspector).getByRole("heading", { name: "Linked findings" });
    expect(Boolean(externalHeading.compareDocumentPosition(linkedHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(within(inspector).getByRole("link", { name: /SNPedia rs6025/i })).toHaveAttribute("href", "https://www.snpedia.com/index.php/Rs6025");

    await user.click(within(inspector).getByRole("button", { name: new RegExp(rs6025Summary?.findingTitles[0] ?? "", "i") }));
    expect(await within(inspector).findByRole("heading", { name: rs6025Summary?.findingTitles[0] })).toBeInTheDocument();

    await user.click(within(inspector).getByRole("button", { name: /Back/i }));
    expect(within(inspector).getByRole("heading", { name: "rs6025" })).toBeInTheDocument();
  });

  it("starts an AI chat from the marker inspector when consent is already accepted", async () => {
    const user = userEvent.setup();
    let idCounter = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => `marker-ai-${++idCounter}`,
    });
    storedProfiles = [makeSavedProfile({ id: "profile-marker-ai" })];
    storedAiConsents["profile-marker-ai"] = { accepted: true, version: 1, acceptedAt: new Date().toISOString() };

    renderApp("/explorer/profile-marker-ai?tab=markers&selected=rs6025");

    const inspector = await screen.findByLabelText("Marker inspector");
    expect(await within(inspector).findByRole("heading", { name: "rs6025" })).toBeInTheDocument();
    await user.click(within(inspector).getByRole("button", { name: "Ask AI" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-marker-ai?tab=ai"));
    expect(await screen.findByText(/Tell me more about marker rs6025 in my Deana report/i)).toBeInTheDocument();
  });

  it("mounts a fresh category list with top scroll when switching tabs", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeTabFacetProfile("profile-tab-remount")];

    const { container } = renderApp("/explorer/profile-tab-remount?tab=medical");

    await screen.findByText("Current report");
    const medicalPanel = container.querySelector(".dn-finding-list-panel") as HTMLElement;
    medicalPanel.scrollTop = 180;

    await user.click(screen.getByRole("button", { name: "Drug response" }));
    await screen.findByRole("heading", { name: "Drug response" });

    const drugPanel = container.querySelector(".dn-finding-list-panel") as HTMLElement;
    expect(drugPanel).not.toBe(medicalPanel);
    expect(drugPanel.scrollTop).toBe(0);
  });

  it("loads the selected entry for the inspector even when it is not in the first page", async () => {
    const paginated = makePaginatedProfile("profile-6", 55);
    storedProfiles = [paginated];

    const { container } = renderApp("/explorer/profile-6?tab=medical&selected=medical-55");

    await screen.findByText("Current report");
    expect(await screen.findByText("Medical finding 55", { selector: "h2" })).toBeInTheDocument();
    expect(container.querySelector(".dn-mobile-sheet")).toBeInTheDocument();
    expect(loadReportEntry).toHaveBeenCalledWith("profile-6", "medical-55");
  });

  it("hides duplicate finding summaries when the summary matches the title", async () => {
    const profile = makePaginatedProfile("profile-9", 1);
    storedProfiles = [{
      ...profile,
      report: {
        ...profile.report,
        entries: profile.report.entries.map((entry) => ({
          ...entry,
          title: "Duplicate finding title",
          summary: "Duplicate finding title",
          detail: "The detail remains visible even when the summary is redundant.",
        })),
      },
    }];

    renderApp("/explorer/profile-9?tab=medical&selected=medical-1");

    await screen.findByText("Current report");
    const inspector = await screen.findByLabelText("Finding inspector");

    expect(await within(inspector).findByRole("heading", { name: "Duplicate finding title" })).toBeInTheDocument();
    expect(inspector.querySelector(".dn-inspector__intro")).toBeNull();
    expect(within(inspector).getByText("The detail remains visible even when the summary is redundant.")).toBeInTheDocument();
  });

  it("shows SNPedia genotype, repute, and magnitude without the elevated badge", async () => {
    const baseProfile = makeSavedProfile({ id: "profile-snpedia" });
    const template = baseProfile.report.entries.find((entry) => entry.category === "traits") ?? baseProfile.report.entries[0];
    const snpediaEntry = {
      ...template,
      id: "local-traits-snpedia-rs995030-gg",
      entryKind: "local-evidence" as const,
      category: "traits" as const,
      subcategory: "snpedia",
      title: "rs995030 genotype context",
      summary: "SNPedia summary for this genotype.",
      detail: "SNPedia detail for this genotype.",
      genotypeSummary: "Source genotype: G;G. rs995030 GG",
      matchedMarkers: [
        {
          rsid: "rs995030",
          genotype: "GG",
          chromosome: "1",
          position: 12345,
          gene: "TEST",
        },
      ],
      sources: [
        {
          id: "snpedia",
          name: "SNPedia",
          url: "https://bots.snpedia.com/index.php/Rs995030(G;G)",
        },
      ],
      sourceNotes: [
        "SNPedia cached page export; page timestamp 2013-08-13T19:59:30Z.",
        "SNPedia genotype page: Rs995030(G;G).",
        "PubMed PMID 16905672",
      ],
      evidenceTier: "supplementary" as const,
      clinicalSignificance: null,
      normalizedClinicalSignificance: null,
      repute: "bad" as const,
      publicationCount: 1,
      publicationBucket: "1-5" as const,
      magnitude: 1.5,
      sourceGenotype: "G;G",
      sourcePageKey: "snpedia-rs995030(g;g)",
      sourcePageUrl: "https://bots.snpedia.com/index.php/Rs995030(G;G)",
      coverage: "full" as const,
      tone: "caution" as const,
      outcome: "negative" as const,
      sort: {
        rank: 1_250,
        severity: 82,
        evidence: 1,
        alphabetical: "rs995030 genotype context",
        publications: 1,
      },
    };

    storedProfiles = [{
      ...baseProfile,
      report: {
        ...baseProfile.report,
        entries: [snpediaEntry],
        tabs: baseProfile.report.tabs.map((tab) =>
          tab.tab === "traits" || tab.tab === "overview" ? { ...tab, count: 1 } : { ...tab, count: 0 },
        ),
      },
    }];

    renderApp("/explorer/profile-snpedia?tab=traits&selected=local-traits-snpedia-rs995030-gg");

    await screen.findByText("Current report");
    const card = await screen.findByRole("button", { name: /rs995030 genotype context/i });
    expect(within(card).queryByText("Local evidence")).not.toBeInTheDocument();
    expect(within(card).getByText("Bad repute")).toBeInTheDocument();
    expect(within(card).getByText("DNA")).toBeInTheDocument();
    expect(within(card).getByText(/rs995030 GG/)).toBeInTheDocument();
    expect(within(card).getByText("Magnitude")).toBeInTheDocument();
    expect(within(card).getByText("1.5")).toBeInTheDocument();
    expect(within(card).queryByText("Elevated")).not.toBeInTheDocument();

    const inspector = screen.getByLabelText("Finding inspector");
    expect(within(inspector).getByText("Evidence snapshot")).toBeInTheDocument();
    expect(within(inspector).getByText("Your DNA")).toBeInTheDocument();
    expect(within(inspector).getByText("rs995030 GG")).toBeInTheDocument();
    expect(within(inspector).getByText("Source genotype")).toBeInTheDocument();
    expect(within(inspector).getByText("G;G")).toBeInTheDocument();
    expect(within(inspector).getByText("Bad")).toBeInTheDocument();
    expect(within(inspector).getByText("SNPedia magnitude")).toBeInTheDocument();
    expect(within(inspector).queryByText("Source page")).not.toBeInTheDocument();
    expect(within(inspector).getByRole("link", { name: /SNPedia/i })).toHaveAttribute(
      "href",
      "https://bots.snpedia.com/index.php/Rs995030(G;G)",
    );
  });

  it("shows ClinGen classifications as card metadata and inspector snapshot content", async () => {
    const baseProfile = makeSavedProfile({ id: "profile-clingen" });
    const template = baseProfile.report.entries.find((entry) => entry.category === "medical") ?? baseProfile.report.entries[0];
    const clingenEntry = {
      ...template,
      id: "local-medical-clingen-zmynd11-syndromic-complex-neurodevelopmental-disorder",
      entryKind: "local-evidence" as const,
      category: "medical" as const,
      subcategory: "gene-disease-validity",
      title: "ZMYND11 / syndromic complex neurodevelopmental disorder",
      summary:
        "ClinGen has classified the relationship between ZMYND11 and syndromic complex neurodevelopmental disorder as Definitive based on systematic evidence review.",
      detail:
        "ClinGen Definitive classification: expert curation found definitive evidence that ZMYND11 variants cause syndromic complex neurodevelopmental disorder.",
      matchedMarkers: [
        {
          rsid: "rs6025",
          genotype: "CT",
          chromosome: "1",
          position: 169519049,
          gene: "ZMYND11",
        },
      ],
      genes: ["ZMYND11"],
      topics: ["ClinGen", "Gene-disease validity"],
      conditions: ["syndromic complex neurodevelopmental disorder"],
      sources: [
        {
          id: "clingen",
          name: "ClinGen",
          url: "https://search.clinicalgenome.org/kb/gene-validity/test",
        },
      ],
      evidenceTier: "high" as const,
      repute: "bad" as const,
      publicationCount: 7,
      publicationBucket: "6-20" as const,
      clingenClassification: "Definitive",
    } satisfies SavedProfile["report"]["entries"][number];

    storedProfiles = [{
      ...baseProfile,
      report: {
        ...baseProfile.report,
        entries: [clingenEntry],
        tabs: baseProfile.report.tabs.map((tab) =>
          tab.tab === "medical" || tab.tab === "overview" ? { ...tab, count: 1 } : { ...tab, count: 0 },
        ),
      },
    }];

    renderApp("/explorer/profile-clingen?tab=medical&selected=local-medical-clingen-zmynd11-syndromic-complex-neurodevelopmental-disorder");

    await screen.findByText("Current report");
    const card = await screen.findByRole("button", { name: /ZMYND11 \/ syndromic complex neurodevelopmental disorder/i });
    expect(within(card).getByRole("heading")).not.toHaveTextContent("(ClinGen Definitive)");
    expect(within(card).getByText("ClinGen")).toBeInTheDocument();
    expect(within(card).getByText("Definitive")).toBeInTheDocument();

    const inspector = screen.getByLabelText("Finding inspector");
    expect(within(inspector).getByRole("heading", { name: "ZMYND11 / syndromic complex neurodevelopmental disorder" })).toBeInTheDocument();
    expect(within(inspector).getByText("ClinGen classification")).toBeInTheDocument();
    expect(within(inspector).getByText("Definitive")).toBeInTheDocument();
  });

  it("renders markdown formatting in the inspector content", async () => {
    const profile = makePaginatedProfile("profile-10", 1);
    storedProfiles = [{
      ...profile,
      report: {
        ...profile.report,
        entries: profile.report.entries.map((entry) => ({
          ...entry,
          summary: "**Important** marker summary.",
          detail: "Use `rsid` details.\n- First bullet\n- [Source detail](https://example.com)",
        })),
      },
    }];

    renderApp("/explorer/profile-10?tab=medical&selected=medical-1");

    await screen.findByText("Current report");
    expect((await screen.findAllByText("Important", { selector: "strong" })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("rsid", { selector: "code" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("First bullet").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Source detail" })[0]).toHaveAttribute("href", "https://example.com");
  });

  it("resets the inspector scroll position when the selected finding changes", async () => {
    const user = userEvent.setup();
    storedProfiles = [makePaginatedProfile("profile-7", 3)];

    renderApp("/explorer/profile-7?tab=medical&selected=medical-1");

    await screen.findByText("Current report");
    const inspector = await screen.findByLabelText("Finding inspector");
    inspector.scrollTop = 120;

    await user.click(await screen.findByRole("button", { name: /Medical finding 02/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toContain("selected=medical-2"),
    );
    expect(inspector.scrollTop).toBe(0);
  });

  it("opens and closes the mobile finding tray only after an explicit result tap", async () => {
    const user = userEvent.setup();
    storedProfiles = [makePaginatedProfile("profile-8", 3)];

    const { container } = renderApp("/explorer/profile-8?tab=medical");

    await screen.findByText("Current report");
    await screen.findByText("3 visible results");
    expect(container.querySelector(".dn-mobile-sheet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Medical finding 02/i }));

    const sheet = await waitFor(() => {
      const element = container.querySelector(".dn-mobile-sheet");
      expect(element).toBeInTheDocument();
      return element as HTMLElement;
    });
    expect(within(sheet).getByText("Genotype found")).toBeInTheDocument();
    expect(within(sheet).getByText("Sources")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(container.querySelector(".dn-mobile-sheet")).not.toBeInTheDocument());
  });
});
