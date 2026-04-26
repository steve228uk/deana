import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  deleteProfile,
  loadCategoryPage,
  loadProfileMeta,
  loadProfileSummaries,
  loadReportEntry,
  saveProfile,
  streamReportEntries,
} from "./lib/storage";
import { ExplorerFilters, buildEntrySearchText, compareEntries, matchesEntryFilters } from "./lib/explorer";
import {
  makeParsedDnaFile,
  makeProfileMeta,
  makeProfileSummary,
  makeSavedProfile,
} from "./test/fixtures";
import {
  ProfileMeta,
  SavedProfile,
  SavedProfileSummary,
  EvidenceSupplement,
  StoredReportEntry,
} from "./types";

vi.mock("./lib/storage", () => ({
  loadProfileSummaries: vi.fn(),
  loadProfileMeta: vi.fn(),
  loadCategoryPage: vi.fn(),
  loadReportEntry: vi.fn(),
  streamReportEntries: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
}));

const parsed = makeParsedDnaFile();
const mockSupplement: EvidenceSupplement = {
  status: "complete",
  fetchedAt: new Date().toISOString(),
  attribution: "Local evidence attribution",
  packVersion: "2026-04-core",
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
            packVersion: "2026-04-core",
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
  return makeProfileMeta({
    id: profile.id,
    name: profile.name,
    fileName: profile.fileName,
    createdAt: profile.createdAt,
    dna: profile.dna,
    supplements: profile.supplements,
    reportVersion: profile.reportVersion,
    evidencePackVersion: profile.evidencePackVersion,
    report: {
      reportVersion: profile.report.reportVersion,
      evidencePackVersion: profile.report.evidencePackVersion,
      overview: profile.report.overview,
      tabs: profile.report.tabs,
      facets: profile.report.facets,
    },
  });
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

function installStorageMocks() {
  vi.mocked(loadProfileSummaries).mockImplementation(async () =>
    storedProfiles.map(profileSummaryFromProfile).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
  vi.mocked(loadProfileMeta).mockImplementation(async (profileId: string) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    return profile ? profileMetaFromProfile(profile) : null;
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
    const pageEntries = entries.slice(start, start + pageSize);
    const nextCursor = start + pageSize < entries.length ? String(start + pageSize) : null;

    return {
      entries: pageEntries,
      nextCursor,
      totalLoaded: start + pageEntries.length,
      hasMore: nextCursor !== null,
    };
  });
  vi.mocked(loadReportEntry).mockImplementation(async (profileId: string, entryId: string) => {
    const profile = storedProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return null;
    return storedEntriesFromProfile(profile).find((entry) => entry.id === entryId) ?? null;
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

  return {
    ...profile,
    report: {
      ...profile.report,
      entries: medicalEntries,
      tabs: profile.report.tabs.map((tab) =>
        tab.tab === "medical"
          ? { ...tab, count }
          : tab.tab === "overview"
            ? { ...tab, count }
            : { ...tab, count: 0 },
      ),
      facets: {
        ...profile.report.facets,
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

beforeEach(() => {
  vi.clearAllMocks();
  nextWorkerResponse = { ok: true, data: parsed };
  nextEvidenceResponse = {
    type: "done",
    supplement: mockSupplement,
  };
  storedProfiles = [];
  workerPostCounts = { parser: 0, evidence: 0 };
  installStorageMocks();
  vi.stubGlobal("Worker", MockWorker);
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal("crypto", {
    randomUUID: () => "profile-1",
  });
});

describe("DeaNA app", () => {
  it("requires upload then naming before saving and opening the explorer", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(/Private DNA reports/i);
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

  it("builds bundled evidence without a separate SNPedia worker pass", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/");

    await screen.findByText(/Private DNA reports/i);
    await user.click(screen.getByRole("button", { name: /Upload your DNA export/i }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dna"], "stephen-kit.txt", { type: "text/plain" });
    await user.upload(input, file);

    await screen.findByDisplayValue("stephen-kit");
    await user.clear(screen.getByLabelText("Profile name"));
    await user.type(screen.getByLabelText("Profile name"), "Stephen");
    await user.click(screen.getByRole("button", { name: /Save and build report/i }));

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

    await screen.findByText(/Private DNA reports/i);
    await user.click(screen.getByRole("button", { name: /Upload your DNA export/i }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dna"], "stephen-kit.txt", { type: "text/plain" });
    await user.upload(input, file);

    await screen.findByDisplayValue("stephen-kit");
    await user.click(screen.getByRole("button", { name: /Save and build report/i }));

    expect(await screen.findByText("Saving your report…")).toBeInTheDocument();
    expect(screen.queryByLabelText(/complete/i)).not.toBeInTheDocument();

    resolveSave?.();
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
  });

  it("removes a saved profile from the home library", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-3", name: "Mum" })];

    renderApp("/");

    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Remove" }));

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
