import {
  clearSearchIndex,
  loadMarkerSummary,
  prewarmMarkerIndex,
  prewarmSearchIndex,
  queryCandidateIds,
  searchMarkerPage,
  searchExplorerEntryIds,
  searchWithFields,
  waitForIndex,
} from "../lib/ai/searchIndexCore";
import type { WorkerRequest, WorkerResponse } from "../lib/ai/searchIndexCore";

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, requestId } = event.data;
  try {
    switch (type) {
      case "prewarm": {
        const status = await prewarmSearchIndex(event.data.profileId);
        self.postMessage({ type: "prewarm", requestId, status } satisfies WorkerResponse);
        break;
      }
      case "waitForIndex": {
        const status = await waitForIndex(event.data.profileId);
        self.postMessage({ type: "waitForIndex", requestId, status } satisfies WorkerResponse);
        break;
      }
      case "searchExplorer": {
        const result = await searchExplorerEntryIds(event.data.payload);
        self.postMessage({ type: "searchExplorer", requestId, result } satisfies WorkerResponse);
        break;
      }
      case "prewarmMarkers": {
        const status = await prewarmMarkerIndex(event.data.profileId);
        self.postMessage({ type: "prewarmMarkers", requestId, status } satisfies WorkerResponse);
        break;
      }
      case "searchMarkers": {
        const result = await searchMarkerPage(event.data.payload);
        self.postMessage({ type: "searchMarkers", requestId, result } satisfies WorkerResponse);
        break;
      }
      case "loadMarker": {
        const result = await loadMarkerSummary(event.data.profileId, event.data.rsid);
        self.postMessage({ type: "loadMarker", requestId, result } satisfies WorkerResponse);
        break;
      }
      case "searchWithFields": {
        const result = await searchWithFields(event.data.profileId, event.data.terms, event.data.limit);
        self.postMessage({ type: "searchWithFields", requestId, result } satisfies WorkerResponse);
        break;
      }
      case "queryCandidates": {
        const result = await queryCandidateIds(event.data.profileId, event.data.terms, event.data.limit);
        self.postMessage({ type: "queryCandidates", requestId, result } satisfies WorkerResponse);
        break;
      }
      case "clearIndex": {
        clearSearchIndex(event.data.profileId, event.data.options);
        self.postMessage({ type: "clearIndex", requestId } satisfies WorkerResponse);
        break;
      }
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      requestId,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
