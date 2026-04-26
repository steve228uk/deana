import { describe, expect, it } from "vitest";
import type { EvidencePackManifest } from "../types";
import {
  annotateVariantRsids,
  fetchDbsnpAnnotationLookup,
  type DbsnpAnnotationRow,
} from "./dbsnpAnnotation";
import { LOCAL_EVIDENCE_PACK_VERSION } from "./evidencePackData";

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function annotationText(rows: DbsnpAnnotationRow[]): string {
  return `${JSON.stringify(rows)}\n`;
}

async function buildMockFetch() {
  const grch37Rows: DbsnpAnnotationRow[] = [["19", 45411941, "T", "C", ["rs429358"]]];
  const grch38Rows: DbsnpAnnotationRow[] = [["19", 44908684, "T", "C", ["rs429358"]]];
  const grch37Text = annotationText(grch37Rows);
  const grch38Text = annotationText(grch38Rows);
  const manifest: EvidencePackManifest = {
    version: LOCAL_EVIDENCE_PACK_VERSION,
    schemaVersion: 1,
    generatedAt: "2026-04-25T00:00:00.000Z",
    annotationIndexes: [
      {
        build: "GRCh37",
        recordsPath: "annotation/dbsnp-grch37.json",
        recordsSha256: await sha256(grch37Text),
        recordCount: grch37Rows.length,
        matchedRsidCount: 1,
        missingRsidCount: 0,
        sourcePath: ".evidence-cache/dbsnp/GRCh37.vcf.gz",
      },
      {
        build: "GRCh38",
        recordsPath: "annotation/dbsnp-grch38.json",
        recordsSha256: await sha256(grch38Text),
        recordCount: grch38Rows.length,
        matchedRsidCount: 1,
        missingRsidCount: 0,
        sourcePath: ".evidence-cache/dbsnp/GRCh38.vcf.gz",
      },
    ],
    attribution: "",
    sources: [],
  };
  const fetchedUrls: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url.endsWith("/manifest.json")) return Response.json(manifest);
    if (url.endsWith("/annotation/dbsnp-grch37.json")) return new Response(grch37Text);
    if (url.endsWith("/annotation/dbsnp-grch38.json")) return new Response(grch38Text);
    return new Response("", { status: 404 });
  };

  return { fetchImpl: fetchImpl as typeof fetch, fetchedUrls };
}

describe("dbsnpAnnotation", () => {
  it("fetches only the requested GRCh37 annotation index", async () => {
    const { fetchImpl, fetchedUrls } = await buildMockFetch();

    const lookup = await fetchDbsnpAnnotationLookup(fetchImpl, "GRCh37");

    expect(fetchedUrls.some((url) => url.endsWith("/annotation/dbsnp-grch37.json"))).toBe(true);
    expect(fetchedUrls.some((url) => url.endsWith("/annotation/dbsnp-grch38.json"))).toBe(false);
    expect(annotateVariantRsids(lookup, "GRCh37", "19", 45411941, "T", "C")).toEqual(["rs429358"]);
    expect(annotateVariantRsids(lookup, "GRCh38", "19", 44908684, "T", "C")).toEqual([]);
  });

  it("fetches only the requested GRCh38 annotation index", async () => {
    const { fetchImpl, fetchedUrls } = await buildMockFetch();

    const lookup = await fetchDbsnpAnnotationLookup(fetchImpl, "GRCh38");

    expect(fetchedUrls.some((url) => url.endsWith("/annotation/dbsnp-grch37.json"))).toBe(false);
    expect(fetchedUrls.some((url) => url.endsWith("/annotation/dbsnp-grch38.json"))).toBe(true);
    expect(annotateVariantRsids(lookup, "GRCh37", "19", 45411941, "T", "C")).toEqual([]);
    expect(annotateVariantRsids(lookup, "GRCh38", "19", 44908684, "T", "C")).toEqual(["rs429358"]);
  });

  it("keeps fetching all annotation indexes when no build is requested", async () => {
    const { fetchImpl, fetchedUrls } = await buildMockFetch();

    const lookup = await fetchDbsnpAnnotationLookup(fetchImpl);

    expect(fetchedUrls.some((url) => url.endsWith("/annotation/dbsnp-grch37.json"))).toBe(true);
    expect(fetchedUrls.some((url) => url.endsWith("/annotation/dbsnp-grch38.json"))).toBe(true);
    expect(annotateVariantRsids(lookup, "GRCh37", "19", 45411941, "T", "C")).toEqual(["rs429358"]);
    expect(annotateVariantRsids(lookup, "GRCh38", "19", 44908684, "T", "C")).toEqual(["rs429358"]);
  });
});
