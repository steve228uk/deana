import {
  buildFindingFromPages,
  queryDocumentedSnpediaRsids,
  querySnpediaPages,
  snpediaGenotypeTitle,
  snpediaRsidTitle,
  SNPEDIA_ATTRIBUTION,
} from "../lib/snpedia";
import {
  CompactMarker,
  ParsedDnaFile,
  SnpediaFailedItem,
  SnpediaFinding,
  SnpediaProgressSnapshot,
  SnpediaSupplement,
} from "../types";

interface StartRequest {
  type: "start";
  dna: ParsedDnaFile;
}

type WorkerRequest = StartRequest;

type ProgressResponse = {
  type: "progress";
  snapshot: SnpediaProgressSnapshot;
};

type DoneResponse = {
  type: "done";
  supplement: SnpediaSupplement;
};

type ErrorResponse = {
  type: "error";
  error: string;
};

type WorkerResponse = ProgressResponse | DoneResponse | ErrorResponse;

const BATCH_SIZE = 24;
const CONCURRENCY = 4;
const MAX_RETRIES = 2;

interface BatchResult {
  findings: SnpediaFinding[];
  unmatched: number;
  failedItems: SnpediaFailedItem[];
  retries: number;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBatchWithRetry(
  titles: string[],
  stage: SnpediaFailedItem["stage"],
  markers: CompactMarker[],
): Promise<{ pages: Map<string, Awaited<ReturnType<typeof querySnpediaPages>>[number]>; failedItems: SnpediaFailedItem[]; retries: number }> {
  if (titles.length === 0) {
    return { pages: new Map(), failedItems: [], retries: 0 };
  }

  let retries = 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const pages = await querySnpediaPages(titles);
      return {
        pages: new Map(pages.map((page) => [page.title.toLowerCase(), page])),
        failedItems: [],
        retries,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("SNPedia lookup failed.");
      retries += 1;
      if (attempt < MAX_RETRIES) {
        await delay(350 * (attempt + 1));
      }
    }
  }

  return {
    pages: new Map(),
    retries,
    failedItems: markers.map((marker) => ({
      rsid: marker[0],
      stage,
      attempts: MAX_RETRIES + 1,
      message: lastError?.message ?? "SNPedia lookup failed.",
    })),
  };
}

function pageHasContent(page: { missing?: boolean; revisions?: Array<{ slots?: { main?: { content?: string } } }> } | null): boolean {
  return Boolean(page && !page.missing && page.revisions?.[0]?.slots?.main?.content);
}

async function processBatch(markers: CompactMarker[]): Promise<BatchResult> {
  const rsTitles = markers.map((marker) => snpediaRsidTitle(marker[0]));
  const genotypeTitles = markers
    .map((marker) => snpediaGenotypeTitle(marker[0], marker[3]))
    .filter((title): title is string => Boolean(title));

  const rsResult = await fetchBatchWithRetry(rsTitles, "rs-page", markers);
  const genotypeResult = await fetchBatchWithRetry(genotypeTitles, "genotype-page", markers);

  const findings: SnpediaFinding[] = [];
  let unmatched = 0;

  for (const marker of markers) {
    const rsPage = rsResult.pages.get(snpediaRsidTitle(marker[0]).toLowerCase()) ?? null;
    const genotypeTitle = snpediaGenotypeTitle(marker[0], marker[3]);
    const genotypePage = genotypeTitle ? genotypeResult.pages.get(genotypeTitle.toLowerCase()) ?? null : null;
    const finding = buildFindingFromPages(
      marker,
      pageHasContent(rsPage) ? rsPage : null,
      pageHasContent(genotypePage) ? genotypePage : null,
    );

    if (finding) {
      findings.push(finding);
    } else {
      unmatched += 1;
    }
  }

  return {
    findings,
    unmatched,
    retries: rsResult.retries + genotypeResult.retries,
    failedItems: [...rsResult.failedItems, ...genotypeResult.failedItems],
  };
}

async function processAllMarkers(markers: CompactMarker[], post: (message: WorkerResponse) => void): Promise<SnpediaSupplement> {
  post({
    type: "progress",
    snapshot: {
      status: "running",
      totalRsids: markers.length,
      processedRsids: 0,
      matchedFindings: 0,
      unmatchedRsids: 0,
      failedRsids: 0,
      retries: 0,
      currentRsid: "Syncing SNPedia rsID snapshot",
    },
  });

  const documentedRsids = await queryDocumentedSnpediaRsids();
  const matchedMarkers = markers.filter((marker) => documentedRsids.has(marker[0].toLowerCase()));
  const skippedRsids = markers.length - matchedMarkers.length;
  const batches = chunk(matchedMarkers, BATCH_SIZE);
  const findings: SnpediaFinding[] = [];
  const failedItems: SnpediaFailedItem[] = [];

  let processedRsids = skippedRsids;
  let unmatchedRsids = skippedRsids;
  let retries = 0;
  let nextIndex = 0;

  const updateProgress = (currentRsid: string | null) => {
    post({
      type: "progress",
      snapshot: {
        status: "running",
        totalRsids: markers.length,
        processedRsids,
        matchedFindings: findings.length,
        unmatchedRsids,
        failedRsids: failedItems.length,
        retries,
        currentRsid,
      },
    });
  };

  updateProgress(matchedMarkers[0]?.[0] ?? "No uploaded rsIDs are documented by SNPedia");

  if (matchedMarkers.length === 0) {
    return {
      status: "complete",
      fetchedAt: new Date().toISOString(),
      attribution: SNPEDIA_ATTRIBUTION,
      totalRsids: markers.length,
      processedRsids,
      matchedFindings: [],
      unmatchedRsids,
      failedItems: [],
      retries,
    };
  }

  async function runNext(): Promise<void> {
    const batchIndex = nextIndex;
    nextIndex += 1;
    if (batchIndex >= batches.length) return;

    const batch = batches[batchIndex];
    const result = await processBatch(batch);

    findings.push(...result.findings);
    failedItems.push(...result.failedItems);
    unmatchedRsids += result.unmatched;
    retries += result.retries;
    processedRsids += batch.length;
    updateProgress(batch[batch.length - 1]?.[0] ?? null);

    await runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => runNext()),
  );

  const dedupedFindings = Array.from(new Map(findings.map((finding) => [finding.id, finding])).values());

  return {
    status: failedItems.length > 0 ? "partial" : "complete",
    fetchedAt: new Date().toISOString(),
    attribution: SNPEDIA_ATTRIBUTION,
    totalRsids: markers.length,
    processedRsids,
    matchedFindings: dedupedFindings,
    unmatchedRsids,
    failedItems,
    retries,
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const post = (message: WorkerResponse) => postMessage(message);

  if (event.data.type !== "start") {
    post({ type: "error", error: "Unsupported SNPedia worker message." });
    return;
  }

  try {
    const supplement = await processAllMarkers(event.data.dna.markers, post);
    post({ type: "done", supplement });
  } catch (error) {
    post({
      type: "error",
      error: error instanceof Error ? error.message : "SNPedia enrichment failed.",
    });
  }
};
