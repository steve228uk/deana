import { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { deleteProfile, loadProfileMeta, loadProfileSummaries, saveProfile } from "./lib/storage";
import { createProfile as buildProfile } from "./lib/profiles";
import { clearSearchIndex, prewarmSearchIndex } from "./lib/ai/searchIndex";
import {
  DnaParseProgress,
  EvidenceProgressSnapshot,
  EvidenceSupplement,
  ParsedDnaFile,
  SavedProfile,
  SavedProfileSummary,
} from "./types";
import { HomeScreen } from "./screens/HomeScreen";
import { ExplorerScreen } from "./screens/ExplorerScreen";
import { generateReport } from "./lib/reportEngine";
import { PendingProfileBuild, ProcessingScreen } from "./screens/ProcessingScreen";

type ParserWorkerResponse =
  | { type: "progress"; progress: DnaParseProgress }
  | { ok: true; data: ParsedDnaFile }
  | { ok: false; error: string };

type EvidenceWorkerResponse =
  | { type: "progress"; snapshot: EvidenceProgressSnapshot }
  | { type: "done"; supplement: EvidenceSupplement }
  | { type: "error"; error: string };

function summaryFromProfile(profile: SavedProfile): SavedProfileSummary {
  return {
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
  };
}

function completedEvidenceProgressSnapshot(
  evidenceSupplement: EvidenceSupplement,
  matchedFindings: number,
  currentRsid: string,
  packStage: NonNullable<EvidenceProgressSnapshot["packStage"]>,
): EvidenceProgressSnapshot {
  return {
    status: "complete",
    totalRsids: evidenceSupplement.totalRsids,
    processedRsids: evidenceSupplement.processedRsids,
    matchedFindings,
    unmatchedRsids: evidenceSupplement.unmatchedRsids,
    failedRsids: evidenceSupplement.failedItems.length,
    retries: evidenceSupplement.retries,
    currentRsid,
    packStage,
    packVersion: evidenceSupplement.packVersion,
  };
}

export default function App() {
  const parserWorkerRef = useRef<Worker | null>(null);
  const evidenceWorkerRef = useRef<Worker | null>(null);
  const [profiles, setProfiles] = useState<SavedProfileSummary[]>([]);
  const [isLibraryReady, setIsLibraryReady] = useState(false);
  const [pendingBuild, setPendingBuild] = useState<PendingProfileBuild | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadProfileSummaries().then((records) => {
      if (cancelled) return;
      setProfiles(records);
      setIsLibraryReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    parserWorkerRef.current = new Worker(new URL("./workers/dnaParser.worker.ts", import.meta.url), {
      type: "module",
    });
    evidenceWorkerRef.current = new Worker(new URL("./workers/evidenceEnrichment.worker.ts", import.meta.url), {
      type: "module",
    });

    return () => {
      parserWorkerRef.current?.terminate();
      evidenceWorkerRef.current?.terminate();
    };
  }, []);

  async function parseFile(file: File, onProgress?: (progress: DnaParseProgress) => void): Promise<ParsedDnaFile> {
    if (!parserWorkerRef.current) {
      throw new Error("Parser worker is not ready yet.");
    }

    const result = await new Promise<Exclude<ParserWorkerResponse, { type: "progress" }>>((resolve) => {
      parserWorkerRef.current!.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
        if ("type" in event.data && event.data.type === "progress") {
          onProgress?.(event.data.progress);
          return;
        }

        if ("ok" in event.data) {
          resolve(event.data);
        }
      };

      parserWorkerRef.current!.postMessage({ file });
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    return result.data;
  }

  async function enrichWithEvidence(
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: EvidenceProgressSnapshot) => void,
  ): Promise<EvidenceSupplement> {
    if (!evidenceWorkerRef.current) {
      throw new Error("Evidence worker is not ready yet.");
    }

    const result = await new Promise<EvidenceSupplement>((resolve, reject) => {
      evidenceWorkerRef.current!.onmessage = (event: MessageEvent<EvidenceWorkerResponse>) => {
        const message = event.data;
        if (message.type === "progress") {
          onProgress?.(message.snapshot);
          return;
        }

        if (message.type === "done") {
          resolve(message.supplement);
          return;
        }

        reject(new Error(message.error));
      };

      evidenceWorkerRef.current!.postMessage({ type: "start", dna: parsed });
    });

    return result;
  }

  async function createProfile(
    name: string,
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: EvidenceProgressSnapshot) => void,
  ): Promise<SavedProfileSummary> {
    const evidenceSupplement = await enrichWithEvidence(parsed, onProgress);
    const nextProfile = buildProfile(name, parsed, { evidence: evidenceSupplement });
    const matchedFindings = new Set(evidenceSupplement.matchedRecords.map((match) => match.record.entryId)).size;
    onProgress?.(completedEvidenceProgressSnapshot(evidenceSupplement, matchedFindings, "Saving your report…", "saving"));
    await saveProfile(nextProfile);
    clearSearchIndex(nextProfile.id, { preservePersistentCache: true });
    onProgress?.(completedEvidenceProgressSnapshot(evidenceSupplement, matchedFindings, "Building search index…", "indexing"));
    await prewarmSearchIndex(nextProfile.id);
    const summary = summaryFromProfile(nextProfile);
    setProfiles((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)]);
    void loadProfileSummaries().then(setProfiles).catch(() => {});
    return summary;
  }

  async function refreshProfileEvidence(profileId: string): Promise<void> {
    const existing = await loadProfileMeta(profileId);
    if (!existing) {
      throw new Error("Profile not found.");
    }

    const runningSupplement: EvidenceSupplement = {
      status: "running",
      fetchedAt: existing.supplements?.evidence?.fetchedAt ?? null,
      attribution: existing.supplements?.evidence?.attribution ?? "Local evidence pack is being loaded in this browser.",
      packVersion: existing.supplements?.evidence?.packVersion ?? "pending",
      manifest: existing.supplements?.evidence?.manifest ?? null,
      totalRsids: existing.dna.markerCount,
      processedRsids: 0,
      matchedRecords: [],
      unmatchedRsids: 0,
      failedItems: existing.supplements?.evidence?.failedItems ?? [],
      retries: existing.supplements?.evidence?.retries ?? 0,
    };

    const runningProfile = {
      ...existing,
      supplements: { ...existing.supplements, evidence: runningSupplement },
      report: generateReport(existing.dna, { ...existing.supplements, evidence: runningSupplement }),
    };
    await saveProfile(runningProfile);
    clearSearchIndex(runningProfile.id);
    setProfiles(await loadProfileSummaries());

    const supplement = await enrichWithEvidence(existing.dna);
    const refreshed = {
      ...runningProfile,
      supplements: { ...runningProfile.supplements, evidence: supplement },
      report: generateReport(existing.dna, { ...runningProfile.supplements, evidence: supplement }),
    };
    await saveProfile(refreshed);
    clearSearchIndex(refreshed.id);
    setProfiles(await loadProfileSummaries());
  }

  async function removeProfile(id: string): Promise<void> {
    await deleteProfile(id);
    setProfiles(await loadProfileSummaries());
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <HomeScreen
            profiles={profiles}
            isLibraryReady={isLibraryReady}
            parseFile={parseFile}
            removeProfile={removeProfile}
            startProcessing={(name, parsed) => setPendingBuild({ name, parsed })}
          />
        }
      />
      <Route
        path="/processing"
        element={
          <ProcessingScreen
            pendingBuild={pendingBuild}
            createProfile={createProfile}
            clearPendingBuild={() => setPendingBuild(null)}
          />
        }
      />
      <Route
        path="/explorer/:profileId"
        element={
          <ExplorerScreen
            isLibraryReady={isLibraryReady}
            refreshProfileEvidence={refreshProfileEvidence}
          />
        }
      />
      <Route
        path="*"
        element={
          <HomeScreen
            profiles={profiles}
            isLibraryReady={isLibraryReady}
            parseFile={parseFile}
            removeProfile={removeProfile}
            startProcessing={(name, parsed) => setPendingBuild({ name, parsed })}
          />
        }
      />
    </Routes>
  );
}
