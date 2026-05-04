import { matchLocalEvidencePack, type LocalEvidencePackMatchProgress } from "../lib/evidencePackData";
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

const MATCHING_PROGRESS_FLOOR = 0.05;
const MATCHING_PROGRESS_WEIGHT = 0.9;
const FINALIZING_PROGRESS_RATIO = 0.95;

function recordProgressRatio(progress: LocalEvidencePackMatchProgress): number {
  if (progress.totalRecords > 0) {
    return progress.processedRecords / progress.totalRecords;
  }
  if (progress.totalShards === 0) {
    return 1;
  }
  return progress.processedShards / progress.totalShards;
}

function estimateProcessedRsids(markerCount: number, progress: LocalEvidencePackMatchProgress): number {
  const weightedProgress = Math.max(MATCHING_PROGRESS_FLOOR, recordProgressRatio(progress) * MATCHING_PROGRESS_WEIGHT);
  return Math.min(markerCount, Math.round(markerCount * weightedProgress));
}

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

  const { manifest, matchedRecords, matchedEntryCount, matchedRsidCount } = await matchLocalEvidencePack(fetch, dna.markers, dna.build, (progress) => {
    postProgress(post, dna, {
      packStage: progress.processedShards === 0 ? "records" : "matching",
      packVersion: progress.manifest.version,
      processedRsids: estimateProcessedRsids(dna.markerCount, progress),
      matchedFindings: progress.matchedEntryCount,
      unmatchedRsids: Math.max(0, dna.markerCount - progress.matchedRsidCount),
      currentRsid: progress.currentPath
        ? `Matched evidence shard ${progress.processedShards} of ${progress.totalShards}`
        : "Loading local evidence shards",
    });
  });

  postProgress(post, dna, {
    packStage: "matching",
    packVersion: manifest.version,
    processedRsids: Math.round(dna.markerCount * FINALIZING_PROGRESS_RATIO),
    currentRsid: "Finalizing bundled evidence matches",
  });

  const unmatchedRsids = Math.max(0, dna.markerCount - matchedRsidCount);

  postProgress(post, dna, {
    packStage: "matching",
    packVersion: manifest.version,
    processedRsids: dna.markerCount,
    matchedFindings: matchedEntryCount,
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
