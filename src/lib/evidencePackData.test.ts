import { describe, expect, it } from "vitest";
import { LOCAL_EVIDENCE_PACK_VERSION, fetchLocalEvidencePack, matchEvidenceRecords } from "./evidencePackData";
import type { EvidencePackManifest, EvidencePackRecord } from "../types";

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function text(records: EvidencePackRecord[]): string {
  return `${JSON.stringify(records)}\n`;
}

function makeRecord(id: string, rsid: string): EvidencePackRecord {
  return {
    id,
    entryId: `local-trait-${id}`,
    sourceId: "gwas",
    role: "primary",
    category: "traits",
    subcategory: "association",
    markerIds: [rsid],
    genes: ["GENE"],
    title: id,
    url: "https://example.com",
    release: "test",
    evidenceLevel: "moderate",
    clinicalSignificance: "trait-association",
    pmids: [],
    notes: ["test"],
  };
}

describe("fetchLocalEvidencePack", () => {
  it("fetches only shards needed for uploaded markers", async () => {
    const neededRecords = [makeRecord("needed", "rs1")];
    const skippedRecords = [makeRecord("skipped", "rs2")];
    const neededText = text(neededRecords);
    const skippedText = text(skippedRecords);
    const manifest: EvidencePackManifest = {
      version: LOCAL_EVIDENCE_PACK_VERSION,
      schemaVersion: 1,
      generatedAt: "2026-04-25T00:00:00.000Z",
      shardStrategy: "rsid-modulo",
      shardModulo: 2,
      shards: [
        {
          id: "m000",
          recordsPath: "shards/m000.json",
          recordsSha256: await sha256(skippedText),
          recordCount: 1,
          bucket: 0,
        },
        {
          id: "m001",
          recordsPath: "shards/m001.json",
          recordsSha256: await sha256(neededText),
          recordCount: 1,
          bucket: 1,
        },
      ],
      recordCount: 2,
      attribution: "test",
      sources: [],
    };
    const fetchedUrls: string[] = [];
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      const href = String(url);
      fetchedUrls.push(href);
      if (href.endsWith("/manifest.json")) {
        return Response.json(manifest);
      }
      if (href.endsWith("/shards/m001.json")) {
        return new Response(neededText);
      }
      if (href.endsWith("/shards/m000.json")) {
        return new Response(skippedText);
      }
      return new Response("not found", { status: 404 });
    };

    const pack = await fetchLocalEvidencePack(fetchImpl as typeof fetch, [["rs1", "1", 1, "AA"]]);

    expect(pack.records).toEqual(neededRecords);
    expect(fetchedUrls.some((url) => url.endsWith("/shards/m000.json"))).toBe(false);
    expect(fetchedUrls.some((url) => url.endsWith("/shards/m001.json"))).toBe(true);
  });

  it("normalizes uploaded genotypes when matching local records", () => {
    const matches = matchEvidenceRecords(
      [["rs762551", "15", 75041917, "CA"]],
      [makeRecord("caffeine", "rs762551")],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedMarkers).toEqual([
      {
        rsid: "rs762551",
        genotype: "AC",
        chromosome: "15",
        position: 75041917,
        gene: "GENE",
        matchedAllele: undefined,
        matchedAlleleCount: null,
      },
    ]);
  });

  it("requires risk alleles when the source record provides one", () => {
    const matches = matchEvidenceRecords(
      [
        ["rs1", "1", 1, "AA"],
        ["rs2", "1", 2, "AG"],
      ],
      [
        {
          ...makeRecord("absent-risk", "rs1"),
          riskAllele: "G",
        },
        {
          ...makeRecord("present-risk", "rs2"),
          riskAllele: "G",
        },
      ],
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].record.id).toBe("present-risk");
    expect(matches[0].matchedMarkers[0].matchedAlleleCount).toBe(1);
  });

  it("matches SNPedia genotype pages on either strand", () => {
    const matches = matchEvidenceRecords(
      [["rs7412", "19", 45412079, "CC"]],
      [
        {
          ...makeRecord("wrong-genotype", "rs7412"),
          sourceId: "snpedia",
          genotype: "CT",
        },
        {
          ...makeRecord("right-genotype", "rs7412"),
          sourceId: "snpedia",
          genotype: "CC",
        },
      ],
    );

    expect(matches.map((match) => match.record.id)).toEqual(["right-genotype"]);
  });

  it("matches a minus-strand heterozygous genotype against its plus-strand SNPedia record", () => {
    // Consumer arrays report rs6025 as CT (minus strand) but SNPedia stores AG (plus strand)
    const matches = matchEvidenceRecords(
      [["rs6025", "1", 169519049, "CT"]],
      [
        { ...makeRecord("snpedia-rs6025-a-g", "rs6025"), sourceId: "snpedia", genotype: "AG" },
        { ...makeRecord("snpedia-rs6025-a-a", "rs6025"), sourceId: "snpedia", genotype: "AA" },
        { ...makeRecord("snpedia-rs6025-g-g", "rs6025"), sourceId: "snpedia", genotype: "GG" },
      ],
    );

    expect(matches.map((m) => m.record.id)).toEqual(["snpedia-rs6025-a-g"]);
  });

  it("matches minus-strand homozygous risk against plus-strand SNPedia record", () => {
    const matches = matchEvidenceRecords(
      [["rs6025", "1", 169519049, "TT"]],
      [
        { ...makeRecord("snpedia-rs6025-a-g", "rs6025"), sourceId: "snpedia", genotype: "AG" },
        { ...makeRecord("snpedia-rs6025-a-a", "rs6025"), sourceId: "snpedia", genotype: "AA" },
        { ...makeRecord("snpedia-rs6025-g-g", "rs6025"), sourceId: "snpedia", genotype: "GG" },
      ],
    );

    expect(matches.map((m) => m.record.id)).toEqual(["snpedia-rs6025-a-a"]);
  });

  it("matches minus-strand homozygous reference against plus-strand SNPedia record", () => {
    const matches = matchEvidenceRecords(
      [["rs6025", "1", 169519049, "CC"]],
      [
        { ...makeRecord("snpedia-rs6025-a-g", "rs6025"), sourceId: "snpedia", genotype: "AG" },
        { ...makeRecord("snpedia-rs6025-a-a", "rs6025"), sourceId: "snpedia", genotype: "AA" },
        { ...makeRecord("snpedia-rs6025-g-g", "rs6025"), sourceId: "snpedia", genotype: "GG" },
      ],
    );

    expect(matches.map((m) => m.record.id)).toEqual(["snpedia-rs6025-g-g"]);
  });
});
