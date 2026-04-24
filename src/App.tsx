import { useEffect, useRef, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { deleteProfile, loadProfileMeta, loadProfileSummaries, saveProfile } from "./lib/storage";
import { createProfile as buildProfile } from "./lib/profiles";
import { ParsedDnaFile, SavedProfileSummary, SnpediaProgressSnapshot, SnpediaSupplement } from "./types";
import { HomeScreen } from "./screens/HomeScreen";
import { ExplorerScreen } from "./screens/ExplorerScreen";
import { generateReport } from "./lib/reportEngine";
import { PendingProfileBuild, ProcessingScreen } from "./screens/ProcessingScreen";

type ParserWorkerResponse =
  | { ok: true; data: ParsedDnaFile }
  | { ok: false; error: string };

type EnrichmentWorkerResponse =
  | { type: "progress"; snapshot: SnpediaProgressSnapshot }
  | { type: "done"; supplement: SnpediaSupplement }
  | { type: "error"; error: string };

export default function App() {
  const parserWorkerRef = useRef<Worker | null>(null);
  const enrichmentWorkerRef = useRef<Worker | null>(null);
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
    enrichmentWorkerRef.current = new Worker(new URL("./workers/snpediaEnrichment.worker.ts", import.meta.url), {
      type: "module",
    });

    return () => {
      parserWorkerRef.current?.terminate();
      enrichmentWorkerRef.current?.terminate();
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

  async function enrichWithSnpedia(
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: SnpediaProgressSnapshot) => void,
  ): Promise<SnpediaSupplement> {
    if (!enrichmentWorkerRef.current) {
      throw new Error("SNPedia worker is not ready yet.");
    }

    const result = await new Promise<SnpediaSupplement>((resolve, reject) => {
      enrichmentWorkerRef.current!.onmessage = (event: MessageEvent<EnrichmentWorkerResponse>) => {
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

      enrichmentWorkerRef.current!.postMessage({ type: "start", dna: parsed });
    });

    return result;
  }

  async function createProfile(
    name: string,
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: SnpediaProgressSnapshot) => void,
  ): Promise<SavedProfileSummary> {
    const draftSupplement: SnpediaSupplement = {
      status: "running",
      fetchedAt: null,
      attribution: "",
      totalRsids: parsed.markerCount,
      processedRsids: 0,
      matchedFindings: [],
      unmatchedRsids: 0,
      failedItems: [],
      retries: 0,
    };

    const draftProfile = buildProfile(name, parsed, draftSupplement);
    await saveProfile(draftProfile);
    const draftSummaries = await loadProfileSummaries();
    setProfiles(draftSummaries);

    const supplement = await enrichWithSnpedia(parsed, onProgress);
    const nextProfile = {
      ...draftProfile,
      supplements: { snpedia: supplement },
      report: generateReport(parsed, supplement),
    };
    await saveProfile(nextProfile);
    const nextSummaries = await loadProfileSummaries();
    setProfiles(nextSummaries);
    return nextSummaries.find((candidate) => candidate.id === nextProfile.id) ?? draftSummaries[0];
  }

  async function refreshProfileSnpedia(profileId: string): Promise<void> {
    const existing = await loadProfileMeta(profileId);
    if (!existing) {
      throw new Error("Profile not found.");
    }

    const runningSupplement: SnpediaSupplement = {
      status: "running",
      fetchedAt: existing.supplements?.snpedia.fetchedAt ?? null,
      attribution: existing.supplements?.snpedia.attribution ?? "",
      totalRsids: existing.dna.markerCount,
      processedRsids: 0,
      matchedFindings: [],
      unmatchedRsids: 0,
      failedItems: [],
      retries: existing.supplements?.snpedia.retries ?? 0,
    };

    const runningProfile = {
      ...existing,
      supplements: { snpedia: runningSupplement },
      report: generateReport(existing.dna, runningSupplement),
    };
    await saveProfile(runningProfile);
    setProfiles(await loadProfileSummaries());

    const supplement = await enrichWithSnpedia(existing.dna);
    const refreshed = {
      ...runningProfile,
      supplements: { snpedia: supplement },
      report: generateReport(existing.dna, supplement),
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
            refreshProfileSnpedia={refreshProfileSnpedia}
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
