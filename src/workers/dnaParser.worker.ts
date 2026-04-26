import { parseDnaBytes } from "../lib/dnaParser";
import type { ParsedDnaFile } from "../types";

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

type WorkerResponse = ParseResponse | ParseError;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const respond = (message: WorkerResponse) => postMessage(message);

  try {
    const { file } = event.data;
    const bytes = new Uint8Array(await file.arrayBuffer());
    respond({
      ok: true,
      data: parseDnaBytes(file.name, bytes),
    });
  } catch (error) {
    respond({
      ok: false,
      error: error instanceof Error ? error.message : "Parsing failed.",
    });
  }
};
