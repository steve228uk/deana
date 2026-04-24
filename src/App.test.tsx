import { render, screen, waitFor } from "@testing-library/react";
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
  SnpediaSupplement,
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
const mockSupplement: SnpediaSupplement = {
  status: "complete",
  fetchedAt: new Date().toISOString(),
  attribution: "SNPedia attribution",
  totalRsids: parsed.markerCount,
  processedRsids: parsed.markerCount,
  matchedFindings: [
    {
      id: "snpedia-rs6025-ct",
      rsid: "rs6025",
      pageKey: "Rs6025(C;T)",
      pageTitle: "rs6025(C;T)",
      pageUrl: "https://www.snpedia.com/index.php/Rs6025(C;T)",
      genotype: "CT",
      summary: "Factor V Leiden risk context",
      detail: "Synthetic SNPedia detail for tests.",
      genes: ["F5"],
      topics: ["Clotting"],
      conditions: ["Venous thromboembolism"],
      clinicalSignificance: "pathogenic",
      category: "medical",
      repute: "bad",
      publicationCount: 12,
      chromosome: "1",
      position: 169519049,
      magnitude: 2.6,
      fetchedAt: new Date().toISOString(),
    },
  ],
  unmatchedRsids: 0,
  failedItems: [],
  retries: 0,
};

let nextWorkerResponse: { ok: true; data: typeof parsed } | { ok: false; error: string };
let nextEnrichmentResponse:
  | { type: "done"; supplement: SnpediaSupplement }
  | { type: "error"; error: string };
let storedProfiles: SavedProfile[] = [];

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(payload: { file?: File; type?: string }) {
    queueMicrotask(() => {
      if (payload.file) {
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
            currentRsid: parsed.markers[parsed.markers.length - 1][0],
          },
        },
      } as MessageEvent);
      queueMicrotask(() => {
        this.onmessage?.({ data: nextEnrichmentResponse } as MessageEvent);
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
            : { ...tab, count: tab.tab === "raw" ? 0 : 0 },
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
  nextEnrichmentResponse = {
    type: "done",
    supplement: mockSupplement,
  };
  storedProfiles = [];
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

    await screen.findByText("Create a profile");

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dna"], "stephen-kit.txt", { type: "text/plain" });
    await user.upload(input, file);

    await screen.findByDisplayValue("stephen-kit");
    await user.clear(screen.getByLabelText("Profile name"));
    await user.type(screen.getByLabelText("Profile name"), "Stephen");
    await user.click(screen.getByRole("button", { name: "Save, enrich, and open Explorer" }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-1");
    expect(await screen.findByText("Current report")).toBeInTheDocument();
  });

  it("opens an existing local report from the home screen", async () => {
    const user = userEvent.setup();
    storedProfiles = [makeSavedProfile({ id: "profile-2" })];

    renderApp("/");

    await screen.findByText("Recent reports");
    await user.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/explorer/profile-2"),
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

    expect(await screen.findByText("Factor V Leiden", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("Why it matters")).toBeInTheDocument();
  });

  it("appends another page when the user loads more category results", async () => {
    const user = userEvent.setup();
    storedProfiles = [makePaginatedProfile("profile-5", 55)];

    renderApp("/explorer/profile-5?tab=medical");

    await screen.findByText("Current report");
    expect(await screen.findByText("50 loaded+")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("55 loaded")).toBeInTheDocument();
    expect(screen.getByText("Medical finding 55")).toBeInTheDocument();
  });

  it("loads the selected entry for the inspector even when it is not in the first page", async () => {
    const paginated = makePaginatedProfile("profile-6", 55);
    storedProfiles = [paginated];

    renderApp("/explorer/profile-6?tab=medical&selected=medical-55");

    await screen.findByText("Current report");
    expect(await screen.findByText("Medical finding 55", { selector: "h2" })).toBeInTheDocument();
    expect(loadReportEntry).toHaveBeenCalledWith("profile-6", "medical-55");
  });
});
