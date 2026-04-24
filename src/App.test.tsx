import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { deleteProfile, loadProfiles, saveProfile } from "./lib/storage";
import { makeParsedDnaFile, makeSavedProfile } from "./test/fixtures";
import { SnpediaSupplement } from "./types";

vi.mock("./lib/storage", () => ({
  loadProfiles: vi.fn(),
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
  vi.mocked(loadProfiles).mockResolvedValue([]);
  vi.mocked(saveProfile).mockResolvedValue(undefined);
  vi.mocked(deleteProfile).mockResolvedValue(undefined);
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
    vi.mocked(loadProfiles).mockResolvedValue([makeSavedProfile({ id: "profile-2" })]);

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
    vi.mocked(loadProfiles).mockResolvedValue([makeSavedProfile({ id: "profile-3", name: "Mum" })]);

    renderApp("/");

    await screen.findByText("Mum");
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteProfile).toHaveBeenCalledWith("profile-3"));
    await waitFor(() => expect(screen.queryByText("Mum")).not.toBeInTheDocument());
  });

  it("updates tab and filter state in the URL and fills the inspector", async () => {
    const user = userEvent.setup();
    vi.mocked(loadProfiles).mockResolvedValue([makeSavedProfile({ id: "profile-4" })]);

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
});
