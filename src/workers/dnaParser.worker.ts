import { annotationRetryBuild, parseDnaBytes } from "../lib/dnaParser";
import { fetchDbsnpAnnotationLookup } from "../lib/dbsnpAnnotation";
import type { DnaParseProgress, ParsedDnaFile } from "../types";

interface ParseRequest {
  file: File;
}

interface ParseResponse {
  ok: true;
  data: ParsedDnaFile;
}

interface ParseError {
  ok: false;
  error: string;
}

interface ParseProgressResponse {
  type: "progress";
  progress: DnaParseProgress;
}

type WorkerResponse = ParseResponse | ParseError | ParseProgressResponse;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const respond = (message: WorkerResponse) => postMessage(message);
  const reportParserProgress = (progress: DnaParseProgress) => {
    respond({
      type: "progress",
      progress: {
        ...progress,
        percent: Math.max(8, Math.min(92, Math.round(8 + (progress.percent * 0.84)))),
      },
    });
  };

  try {
    const { file } = event.data;
    respond({
      type: "progress",
      progress: { phase: "reading", percent: 4, message: "Reading file locally..." },
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    respond({
      type: "progress",
      progress: { phase: "parsing", percent: 8, message: "Starting local parser..." },
    });
    try {
      respond({
        ok: true,
        data: parseDnaBytes(file.name, bytes, { onProgress: reportParserProgress }),
      });
    } catch (error) {
      const annotationBuild = annotationRetryBuild(error);
      if (!annotationBuild) throw error;
      respond({
        type: "progress",
        progress: {
          phase: "annotating",
          percent: 94,
          message: `Loading local ${annotationBuild} rsID annotation index...`,
        },
      });
      const annotationLookup = await fetchDbsnpAnnotationLookup(fetch, annotationBuild);
      respond({
        type: "progress",
        progress: { phase: "parsing", percent: 8, message: "Parsing again with local rsID annotation..." },
      });
      respond({
        ok: true,
        data: parseDnaBytes(file.name, bytes, { annotationLookup, onProgress: reportParserProgress }),
      });
    }
  } catch (error) {
    respond({
      ok: false,
      error: error instanceof Error ? error.message : "Parsing failed.",
    });
  }
};
