import { fetchLocalEvidencePack, matchEvidenceRecords } from "../lib/evidencePackData";
import {
  EvidenceProgressSnapshot,
  EvidenceSupplement,
  ParsedDnaFile,
} from "../types";

interface StartRequest {
  type: "start";
  dna: ParsedDnaFile;
}

type WorkerRequest = StartRequest;

type ProgressResponse = {
  type: "progress";
  snapshot: EvidenceProgressSnapshot;
};

type DoneResponse = {
  type: "done";
  supplement: EvidenceSupplement;
};

type ErrorResponse = {
  type: "error";
  error: string;
};

type WorkerResponse = ProgressResponse | DoneResponse | ErrorResponse;

function postProgress(
  post: (message: WorkerResponse) => void,
  dna: ParsedDnaFile,
  patch: Partial<EvidenceProgressSnapshot>,
) {
  post({
    type: "progress",
    snapshot: {
      status: "running",
      totalRsids: dna.markerCount,
      processedRsids: 0,
      matchedFindings: 0,
      unmatchedRsids: 0,
      failedRsids: 0,
      retries: 0,
      currentRsid: "Preparing local evidence pack",
      ...patch,
    },
  });
}

async function buildEvidenceSupplement(
  dna: ParsedDnaFile,
  post: (message: WorkerResponse) => void,
): Promise<EvidenceSupplement> {
  postProgress(post, dna, {
    packStage: "manifest",
    currentRsid: "Loading local evidence-pack manifest",
  });

  const { manifest, records } = await fetchLocalEvidencePack(fetch, dna.markers);

  postProgress(post, dna, {
    packStage: "matching",
    packVersion: manifest.version,
    processedRsids: Math.round(dna.markerCount * 0.35),
    currentRsid: "Matching bundled evidence sources locally",
  });

  const matchedRecords = matchEvidenceRecords(dna.markers, records, dna.build);
  const matchedRsids = new Set<string>();
  const matchedEntryIds = new Set<string>();
  for (const match of matchedRecords) {
    matchedEntryIds.add(match.record.entryId);
    for (const marker of match.matchedMarkers) {
      matchedRsids.add(marker.rsid.toLowerCase());
    }
  }
  const unmatchedRsids = Math.max(0, dna.markerCount - matchedRsids.size);

  postProgress(post, dna, {
    packStage: "matching",
    packVersion: manifest.version,
    processedRsids: dna.markerCount,
    matchedFindings: matchedEntryIds.size,
    unmatchedRsids,
    currentRsid: "Matched bundled evidence records",
  });

  return {
    status: "complete",
    fetchedAt: new Date().toISOString(),
    attribution: manifest.attribution,
    packVersion: manifest.version,
    manifest,
    totalRsids: dna.markerCount,
    processedRsids: dna.markerCount,
    matchedRecords,
    unmatchedRsids,
    failedItems: [],
    retries: 0,
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const post = (message: WorkerResponse) => postMessage(message);

  if (event.data.type !== "start") {
    post({ type: "error", error: "Unsupported evidence worker message." });
    return;
  }

  try {
    const supplement = await buildEvidenceSupplement(event.data.dna, post);
    post({ type: "done", supplement });
  } catch (error) {
    post({
      type: "error",
      error: error instanceof Error ? error.message : "Local evidence enrichment failed.",
    });
  }
};
