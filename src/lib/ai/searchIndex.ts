import type {
  SearchCandidate,
  SearchExplorerEntryIdsRequest,
  SearchExplorerEntryIdsResult,
  SearchIndexStatus,
  SearchMarkerPageRequest,
  SearchMarkerPageResult,
  WorkerRequest,
  WorkerResponse,
} from "./searchIndexCore";
import {
  clearSearchIndex as clearDirect,
  loadMarkerSummary as loadMarkerSummaryDirect,
  prewarmMarkerIndex as prewarmMarkerDirect,
  prewarmSearchIndex as prewarmDirect,
  queryCandidateIds as queryCandidateIdsDirect,
  searchMarkerPage as searchMarkerPageDirect,
  searchExplorerEntryIds as searchExplorerEntryIdsDirect,
  searchWithFields as searchWithFieldsDirect,
  waitForIndex as waitForIndexDirect,
} from "./searchIndexCore";
import type { StoredMarkerSummary } from "../../types";

export type { SearchCandidate, SearchExplorerEntryIdsResult, SearchIndexStatus, SearchMarkerPageResult };

// ---- Worker client ----
// All MiniSearch operations run in a dedicated worker to isolate memory from the
// main thread, preventing iOS Safari from killing the tab on memory spikes.
// When Worker is unavailable (e.g. test environments) the core runs directly.

let worker: Worker | null = null;
let workerInitAttempted = false;
let requestCounter = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

function failedIndexStatus(error: unknown): SearchIndexStatus {
  return {
    state: "failed",
    reason: "index-error",
    message: error instanceof Error ? error.message : "Search index is unavailable.",
  };
}

function resetWorkerAfterFailure(): Worker | null {
  const failedWorker = worker;
  worker = null;
  workerInitAttempted = false;
  return failedWorker;
}

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  if (workerInitAttempted) return null;

  workerInitAttempted = true;
  try {
    worker = new Worker(new URL("../../workers/searchIndex.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const handler = pending.get(event.data.requestId);
      if (!handler) return;
      pending.delete(event.data.requestId);
      if (event.data.type === "error") {
        handler.reject(new Error(event.data.error));
      } else {
        handler.resolve(event.data);
      }
    };
    worker.onerror = (event) => {
      for (const handler of pending.values()) {
        handler.reject(new Error(event.message ?? "Search worker error"));
      }
      pending.clear();
      resetWorkerAfterFailure()?.terminate();
    };
    return worker;
  } catch {
    resetWorkerAfterFailure();
    return null;
  }
}

function sendToWorker<T>(w: Worker, message: WorkerRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(message.requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    w.postMessage(message);
  });
}

function buildStatusRequestMessage(
  type: "prewarm" | "waitForIndex" | "prewarmMarkers",
  requestId: string,
  profileId: string,
): WorkerRequest {
  switch (type) {
    case "prewarm":
      return { type: "prewarm", requestId, profileId };
    case "prewarmMarkers":
      return { type: "prewarmMarkers", requestId, profileId };
    case "waitForIndex":
      return { type: "waitForIndex", requestId, profileId };
  }
}

async function sendStatusRequest(
  type: "prewarm" | "waitForIndex" | "prewarmMarkers",
  profileId: string,
  runDirect: (profileId: string) => Promise<SearchIndexStatus>,
): Promise<SearchIndexStatus> {
  const w = getWorker();
  if (!w) {
    try {
      return await runDirect(profileId);
    } catch (error) {
      return failedIndexStatus(error);
    }
  }

  const requestId = String(++requestCounter);
  const message = buildStatusRequestMessage(type, requestId, profileId);

  try {
    const response = await sendToWorker<{
      type: "prewarm" | "waitForIndex" | "prewarmMarkers";
      requestId: string;
      status: SearchIndexStatus;
    }>(w, message);
    return response.status;
  } catch (error) {
    return failedIndexStatus(error);
  }
}

// ---- Public API ----

export async function prewarmSearchIndex(profileId: string): Promise<SearchIndexStatus> {
  return sendStatusRequest("prewarm", profileId, prewarmDirect);
}

export async function queryCandidateIds(profileId: string, terms: string[], limit = 50): Promise<string[]> {
  const w = getWorker();
  if (!w) return queryCandidateIdsDirect(profileId, terms, limit);
  const requestId = String(++requestCounter);
  const response = await sendToWorker<{ type: "queryCandidates"; requestId: string; result: string[] }>(
    w,
    { type: "queryCandidates", requestId, profileId, terms, limit },
  );
  return response.result;
}

export async function searchWithFields(
  profileId: string,
  terms: string[],
  limit: number,
): Promise<SearchCandidate[]> {
  const w = getWorker();
  if (!w) return searchWithFieldsDirect(profileId, terms, limit);
  const requestId = String(++requestCounter);
  const response = await sendToWorker<{ type: "searchWithFields"; requestId: string; result: SearchCandidate[] }>(
    w,
    { type: "searchWithFields", requestId, profileId, terms, limit },
  );
  return response.result;
}

export async function searchExplorerEntryIds(
  request: SearchExplorerEntryIdsRequest,
): Promise<SearchExplorerEntryIdsResult> {
  const w = getWorker();
  if (!w) return searchExplorerEntryIdsDirect(request);
  const requestId = String(++requestCounter);
  const response = await sendToWorker<{ type: "searchExplorer"; requestId: string; result: SearchExplorerEntryIdsResult }>(
    w,
    { type: "searchExplorer", requestId, payload: request },
  );
  return response.result;
}

export async function prewarmMarkerIndex(profileId: string): Promise<SearchIndexStatus> {
  return sendStatusRequest("prewarmMarkers", profileId, prewarmMarkerDirect);
}

export async function searchMarkerPage(
  request: SearchMarkerPageRequest,
): Promise<SearchMarkerPageResult> {
  const w = getWorker();
  if (!w) return searchMarkerPageDirect(request);
  const requestId = String(++requestCounter);
  const response = await sendToWorker<{ type: "searchMarkers"; requestId: string; result: SearchMarkerPageResult }>(
    w,
    { type: "searchMarkers", requestId, payload: request },
  );
  return response.result;
}

export async function loadMarkerSummary(profileId: string, rsid: string): Promise<StoredMarkerSummary | null> {
  const w = getWorker();
  if (!w) return loadMarkerSummaryDirect(profileId, rsid);
  const requestId = String(++requestCounter);
  const response = await sendToWorker<{ type: "loadMarker"; requestId: string; result: StoredMarkerSummary | null }>(
    w,
    { type: "loadMarker", requestId, profileId, rsid },
  );
  return response.result;
}

export async function waitForIndex(profileId: string): Promise<SearchIndexStatus> {
  return sendStatusRequest("waitForIndex", profileId, waitForIndexDirect);
}

export function clearSearchIndex(
  profileId?: string,
  options: { preservePersistentCache?: boolean } = {},
): void {
  const w = getWorker();
  if (!w) {
    clearDirect(profileId, options);
    return;
  }
  // Fire-and-forget: worker processes messages in order so this clears before
  // any subsequent prewarm sent in the same tick.
  const requestId = String(++requestCounter);
  w.postMessage({ type: "clearIndex", requestId, profileId, options } satisfies WorkerRequest);
}
