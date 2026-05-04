import { describe, expect, it } from "vitest";
import {
  LOCAL_EVIDENCE_PACK_VERSION,
  fetchLocalEvidencePack,
  matchEvidenceRecords,
  matchLocalEvidencePack,
} from "./evidencePackData";
import type { CompactMarker, EvidencePackManifest, EvidencePackRecord } from "../types";

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

  it("matches selected shards sequentially without materializing the pack", async () => {
    const bucketZeroRecords = [makeRecord("bucket-zero", "rs2")];
    const bucketOneRecords = [
      makeRecord("bucket-one", "rs1"),
      { ...makeRecord("missing-risk", "rs1"), riskAllele: "G" },
    ];
    const bucketZeroText = text(bucketZeroRecords);
    const bucketOneText = text(bucketOneRecords);
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
          recordsSha256: await sha256(bucketZeroText),
          recordCount: bucketZeroRecords.length,
          bucket: 0,
        },
        {
          id: "m001",
          recordsPath: "shards/m001.json",
          recordsSha256: await sha256(bucketOneText),
          recordCount: bucketOneRecords.length,
          bucket: 1,
        },
      ],
      recordCount: bucketZeroRecords.length + bucketOneRecords.length,
      attribution: "test",
      sources: [],
    };
    const fetchedShards: string[] = [];
    let activeRecordFetches = 0;
    let maxActiveRecordFetches = 0;
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      const href = String(url);
      if (href.endsWith("/manifest.json")) {
        return Response.json(manifest);
      }

      activeRecordFetches += 1;
      maxActiveRecordFetches = Math.max(maxActiveRecordFetches, activeRecordFetches);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeRecordFetches -= 1;
      fetchedShards.push(href);

      if (href.endsWith("/shards/m000.json")) {
        return new Response(bucketZeroText);
      }
      if (href.endsWith("/shards/m001.json")) {
        return new Response(bucketOneText);
      }
      return new Response("not found", { status: 404 });
    };

    const markers: CompactMarker[] = [
      ["rs1", "1", 1, "AA"],
      ["rs2", "1", 2, "AG"],
    ];
    const result = await matchLocalEvidencePack(fetchImpl as typeof fetch, markers, "GRCh37");

    expect(result.matchedRecords).toEqual(matchEvidenceRecords(markers, [...bucketZeroRecords, ...bucketOneRecords], "GRCh37"));
    expect(fetchedShards.map((url) => url.slice(url.lastIndexOf("/") + 1))).toEqual(["m000.json", "m001.json"]);
    expect(maxActiveRecordFetches).toBe(1);
  });

  it("reports shard matching progress as each selected shard completes", async () => {
    const firstRecords = [makeRecord("first", "rs1")];
    const secondRecords = [makeRecord("second", "rs2")];
    const firstText = text(firstRecords);
    const secondText = text(secondRecords);
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
          recordsSha256: await sha256(secondText),
          recordCount: secondRecords.length,
          bucket: 0,
        },
        {
          id: "m001",
          recordsPath: "shards/m001.json",
          recordsSha256: await sha256(firstText),
          recordCount: firstRecords.length,
          bucket: 1,
        },
      ],
      recordCount: firstRecords.length + secondRecords.length,
      attribution: "test",
      sources: [],
    };
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      const href = String(url);
      if (href.endsWith("/manifest.json")) return Response.json(manifest);
      if (href.endsWith("/shards/m000.json")) return new Response(secondText);
      if (href.endsWith("/shards/m001.json")) return new Response(firstText);
      return new Response("not found", { status: 404 });
    };
    const progress: Array<{
      processedShards: number;
      processedRecords: number;
      matchedEntryCount: number;
      matchedRsidCount: number;
      currentPath: string | null;
    }> = [];

    await matchLocalEvidencePack(fetchImpl as typeof fetch, [
      ["rs1", "1", 1, "AA"],
      ["rs2", "1", 2, "AG"],
    ], undefined, (snapshot) => {
      progress.push({
        processedShards: snapshot.processedShards,
        processedRecords: snapshot.processedRecords,
        matchedEntryCount: snapshot.matchedEntryCount,
        matchedRsidCount: snapshot.matchedRsidCount,
        currentPath: snapshot.currentPath,
      });
    });

    expect(progress).toEqual([
      { processedShards: 0, processedRecords: 0, matchedEntryCount: 0, matchedRsidCount: 0, currentPath: null },
      { processedShards: 1, processedRecords: 1, matchedEntryCount: 1, matchedRsidCount: 1, currentPath: "shards/m000.json" },
      { processedShards: 2, processedRecords: 2, matchedEntryCount: 2, matchedRsidCount: 2, currentPath: "shards/m001.json" },
    ]);
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

  it("uses build-specific risk alleles when the source record provides them", () => {
    const record: EvidencePackRecord = {
      ...makeRecord("build-specific-clinvar", "rs1"),
      sourceId: "clinvar",
      riskAllelesByBuild: {
        GRCh37: "T",
        GRCh38: "A",
      },
    };

    expect(matchEvidenceRecords([["rs1", "1", 1, "AA"]], [record], "GRCh37")).toHaveLength(0);
    expect(matchEvidenceRecords([["rs1", "1", 1, "AA"]], [record], "GRCh38")).toHaveLength(1);
    expect(matchEvidenceRecords([["rs1", "1", 1, "AA"]], [record], "Unknown")).toHaveLength(0);
  });

  it("allows buildless matching when build-specific risk alleles are unambiguous", () => {
    const matches = matchEvidenceRecords(
      [["rs1", "1", 1, "AT"]],
      [
        {
          ...makeRecord("same-risk-allele", "rs1"),
          sourceId: "clinvar",
          riskAllelesByBuild: {
            GRCh37: "T",
            GRCh38: "T",
          },
        },
      ],
      "Unknown",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedMarkers[0].matchedAllele).toBe("T");
  });

  it("fails closed for unconstrained ClinGen, ClinVar, CPIC, and PharmGKB records", () => {
    const matches = matchEvidenceRecords(
      [["rs1", "1", 1, "AA"]],
      [
        { ...makeRecord("clingen", "rs1"), sourceId: "clingen" },
        { ...makeRecord("clinvar", "rs1"), sourceId: "clinvar" },
        { ...makeRecord("cpic", "rs1"), sourceId: "cpic" },
        { ...makeRecord("pharmgkb", "rs1"), sourceId: "pharmgkb" },
        { ...makeRecord("gwas", "rs1"), sourceId: "gwas" },
      ],
    );

    expect(matches.map((match) => match.record.id)).toEqual(["gwas"]);
  });

  it("allows constrained ClinGen, ClinVar, CPIC, and PharmGKB records to match", () => {
    const matches = matchEvidenceRecords(
      [
        ["rs1", "1", 1, "AG"],
        ["rs2", "1", 2, "CT"],
        ["rs3", "1", 3, "TT"],
        ["rs4", "1", 4, "AC"],
      ],
      [
        { ...makeRecord("clingen", "rs1"), sourceId: "clingen", riskAllele: "G" },
        { ...makeRecord("clinvar", "rs2"), sourceId: "clinvar", riskAllele: "T" },
        { ...makeRecord("cpic", "rs3"), sourceId: "cpic", riskAllele: "T" },
        { ...makeRecord("pharmgkb", "rs4"), sourceId: "pharmgkb", genotype: "AC" },
      ],
    );

    expect(matches.map((match) => match.record.id)).toEqual(["clingen", "clinvar", "cpic", "pharmgkb"]);
  });

  it("matches genotype pages by exact canonical genotype", () => {
    const matches = matchEvidenceRecords(
      [["rs7412", "19", 45412079, "GC"]],
      [
        {
          ...makeRecord("wrong-genotype", "rs7412"),
          sourceId: "snpedia",
          genotype: "CC",
        },
        {
          ...makeRecord("right-genotype", "rs7412"),
          sourceId: "snpedia",
          genotype: "CG",
        },
      ],
    );

    expect(matches.map((match) => match.record.id)).toEqual(["right-genotype"]);
  });

  it("does not match SNPedia genotype pages by complement", () => {
    const matches = matchEvidenceRecords(
      [["rs6025", "1", 169519049, "CT"]],
      [
        { ...makeRecord("snpedia-rs6025-a-g", "rs6025"), sourceId: "snpedia", genotype: "AG" },
        { ...makeRecord("snpedia-rs6025-a-a", "rs6025"), sourceId: "snpedia", genotype: "AA" },
        { ...makeRecord("snpedia-rs6025-c-t", "rs6025"), sourceId: "snpedia", genotype: "CT" },
      ],
    );

    expect(matches.map((m) => m.record.id)).toEqual(["snpedia-rs6025-c-t"]);
  });

  it("does not surface complementary SNPedia interpretations for rs63750875", () => {
    const matches = matchEvidenceRecords(
      [["rs63750875", "2", 47414450, "GG"]],
      [
        { ...makeRecord("snpedia-rs63750875-c-c", "rs63750875"), sourceId: "snpedia", genotype: "CC" },
        { ...makeRecord("snpedia-rs63750875-c-g", "rs63750875"), sourceId: "snpedia", genotype: "CG" },
        { ...makeRecord("snpedia-rs63750875-g-g", "rs63750875"), sourceId: "snpedia", genotype: "GG" },
      ],
    );

    expect(matches.map((m) => m.record.id)).toEqual(["snpedia-rs63750875-g-g"]);
  });

  it("still matches exact SNPedia homozygous genotypes after canonical normalization", () => {
    const matches = matchEvidenceRecords(
      [["rs6025", "1", 169519049, "CC"]],
      [
        { ...makeRecord("snpedia-rs6025-a-g", "rs6025"), sourceId: "snpedia", genotype: "AG" },
        { ...makeRecord("snpedia-rs6025-a-a", "rs6025"), sourceId: "snpedia", genotype: "AA" },
        { ...makeRecord("snpedia-rs6025-c-c", "rs6025"), sourceId: "snpedia", genotype: "CC" },
      ],
    );

    expect(matches.map((m) => m.record.id)).toEqual(["snpedia-rs6025-c-c"]);
  });
});
