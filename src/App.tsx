import { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { deleteProfile, loadProfileMeta, loadProfileSummaries, saveProfile } from "./lib/storage";
import { createProfile as buildProfile } from "./lib/profiles";
import {
  EvidenceProgressSnapshot,
  EvidenceSupplement,
  ParsedDnaFile,
  SavedProfileSummary,
} from "./types";
import { HomeScreen } from "./screens/HomeScreen";
import { ExplorerScreen } from "./screens/ExplorerScreen";
import { generateReport } from "./lib/reportEngine";
import { PendingProfileBuild, ProcessingScreen } from "./screens/ProcessingScreen";

type ParserWorkerResponse =
  | { ok: true; data: ParsedDnaFile }
  | { ok: false; error: string };

type EvidenceWorkerResponse =
  | { type: "progress"; snapshot: EvidenceProgressSnapshot }
  | { type: "done"; supplement: EvidenceSupplement }
  | { type: "error"; error: string };

function createRunningEvidenceSupplement(parsed: ParsedDnaFile): EvidenceSupplement {
  return {
    status: "running",
    fetchedAt: null,
    attribution: "Local evidence pack is being loaded in this browser.",
    packVersion: "pending",
    manifest: null,
    totalRsids: parsed.markerCount,
    processedRsids: 0,
    matchedRecords: [],
    unmatchedRsids: 0,
    failedItems: [],
    retries: 0,
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

  async function parseFile(file: File): Promise<ParsedDnaFile> {
    if (!parserWorkerRef.current) {
      throw new Error("Parser worker is not ready yet.");
    }

    const result = await new Promise<ParserWorkerResponse>((resolve) => {
      parserWorkerRef.current!.onmessage = (event: MessageEvent<ParserWorkerResponse>) => {
        resolve(event.data);
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
    const draftSupplement = createRunningEvidenceSupplement(parsed);

    const draftProfile = buildProfile(name, parsed, { evidence: draftSupplement });
    await saveProfile(draftProfile);
    const draftSummaries = await loadProfileSummaries();
    setProfiles(draftSummaries);

    const evidenceSupplement = await enrichWithEvidence(parsed, onProgress);
    const nextProfile = {
      ...draftProfile,
      supplements: { evidence: evidenceSupplement },
      report: generateReport(parsed, { evidence: evidenceSupplement }),
    };
    await saveProfile(nextProfile);
    const nextSummaries = await loadProfileSummaries();
    setProfiles(nextSummaries);
    return nextSummaries.find((candidate) => candidate.id === nextProfile.id) ?? draftSummaries[0];
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
    setProfiles(await loadProfileSummaries());

    const supplement = await enrichWithEvidence(existing.dna);
    const refreshed = {
      ...runningProfile,
      supplements: { ...runningProfile.supplements, evidence: supplement },
      report: generateReport(existing.dna, { ...runningProfile.supplements, evidence: supplement }),
    };
    await saveProfile(refreshed);
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
