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

function countMatchedFindings(evidenceSupplement: EvidenceSupplement): number {
  const entryIds = new Set<string>();
  for (const match of evidenceSupplement.matchedRecords) {
    entryIds.add(match.record.entryId);
  }
  return entryIds.size;
}

function createEvidenceWorker(): Worker {
  return new Worker(new URL("./workers/evidenceEnrichment.worker.ts", import.meta.url), {
    type: "module",
  });
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
    evidenceWorkerRef.current = createEvidenceWorker();

    return () => {
      parserWorkerRef.current?.terminate();
      evidenceWorkerRef.current?.terminate();
    };
  }, []);

  async function parseFile(file: File, onProgress?: (progress: DnaParseProgress) => void): Promise<ParsedDnaFile> {
    if (!parserWorkerRef.current) {
      throw new Error("Parser worker is not ready yet.");
    }

    const worker = parserWorkerRef.current;
    const result = await new Promise<Exclude<ParserWorkerResponse, { type: "progress" }>>((resolve) => {
      worker.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
        if ("type" in event.data && event.data.type === "progress") {
          onProgress?.(event.data.progress);
          return;
        }

        if ("ok" in event.data) {
          worker.onmessage = null;
          resolve(event.data);
        }
      };

      worker.postMessage({ file });
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

    const worker = evidenceWorkerRef.current;
    const result = await new Promise<EvidenceSupplement>((resolve, reject) => {
      const clearWorkerHandlers = () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
      };
      const resetWorkerAfterFailure = () => {
        clearWorkerHandlers();

        if (evidenceWorkerRef.current === worker) {
          worker.terminate();
          evidenceWorkerRef.current = createEvidenceWorker();
        }
      };
      const handleWorkerTransportFailure = () => {
        resetWorkerAfterFailure();
        reject(new Error("Local evidence enrichment failed."));
      };

      worker.onmessage = (event: MessageEvent<EvidenceWorkerResponse>) => {
        const message = event.data;
        if (message.type === "progress") {
          onProgress?.(message.snapshot);
          return;
        }

        if (message.type === "done") {
          clearWorkerHandlers();
          resolve(message.supplement);
          return;
        }

        clearWorkerHandlers();
        reject(new Error(message.error));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        handleWorkerTransportFailure();
      };
      worker.onmessageerror = handleWorkerTransportFailure;

      worker.postMessage({ type: "start", dna: parsed });
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
    return finalizeProfileEvidence(nextProfile, evidenceSupplement, onProgress, { preservePersistentCache: true });
  }

  async function refreshProfileEvidence(
    profileId: string,
    onProgress?: (snapshot: EvidenceProgressSnapshot) => void,
  ): Promise<SavedProfileSummary> {
    const existing = await loadProfileMeta(profileId);
    if (!existing) {
      throw new Error("Profile not found.");
    }

    onProgress?.({
      status: "running",
      totalRsids: existing.dna.markerCount,
      processedRsids: 0,
      matchedFindings: 0,
      unmatchedRsids: 0,
      failedRsids: 0,
      retries: 0,
      currentRsid: "Preparing bundled evidence sources",
    });

    const supplement = await enrichWithEvidence(existing.dna, onProgress);
    const report = generateReport(existing.dna, { ...existing.supplements, evidence: supplement });
    const refreshed = {
      ...existing,
      supplements: { ...existing.supplements, evidence: supplement },
      reportVersion: report.reportVersion,
      evidencePackVersion: report.evidencePackVersion,
      report,
    };
    return finalizeProfileEvidence(refreshed, supplement, onProgress);
  }

  async function finalizeProfileEvidence(
    profile: SavedProfile,
    supplement: EvidenceSupplement,
    onProgress?: (snapshot: EvidenceProgressSnapshot) => void,
    clearIndexOptions?: Parameters<typeof clearSearchIndex>[1],
  ): Promise<SavedProfileSummary> {
    const matchedFindings = countMatchedFindings(supplement);
    onProgress?.(completedEvidenceProgressSnapshot(supplement, matchedFindings, "Saving your report…", "saving"));
    await saveProfile(profile);
    clearSearchIndex(profile.id, clearIndexOptions);
    onProgress?.(completedEvidenceProgressSnapshot(supplement, matchedFindings, "Building search index…", "indexing"));
    await prewarmSearchIndex(profile.id);
    const summary = summaryFromProfile(profile);
    setProfiles((current) => [summary, ...current.filter((candidate) => candidate.id !== summary.id)]);
    void loadProfileSummaries().then(setProfiles).catch(() => {});
    return summary;
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
            refreshProfileEvidence={refreshProfileEvidence}
            clearPendingBuild={() => setPendingBuild(null)}
          />
        }
      />
      <Route
        path="/processing/refresh/:profileId"
        element={
          <ProcessingScreen
            pendingBuild={null}
            createProfile={createProfile}
            refreshProfileEvidence={refreshProfileEvidence}
            clearPendingBuild={() => setPendingBuild(null)}
          />
        }
      />
      <Route
        path="/explorer/:profileId"
        element={
          <ExplorerScreen
            isLibraryReady={isLibraryReady}
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
