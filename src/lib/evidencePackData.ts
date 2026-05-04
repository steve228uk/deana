import {
  CompactMarker,
  EvidencePackManifest,
  EvidencePackMatch,
  EvidencePackRecord,
  GenomeBuild,
  MatchedMarker,
} from "../types";

export const LOCAL_EVIDENCE_PACK_VERSION = "2026-05-core-2";
export const LOCAL_EVIDENCE_PACK_BASE = `/evidence-packs/${LOCAL_EVIDENCE_PACK_VERSION}`;

const DEFAULT_SHARD_MODULO = 256;

function canonicalGenotype(genotype: string | null): string | null {
  if (!genotype || genotype === "--") return null;
  if (/^[ACGT]{2}$/i.test(genotype)) {
    return genotype.toUpperCase().split("").sort().join("");
  }
  return genotype.toUpperCase();
}

function alleleCount(genotype: string | null, allele?: string): number | null {
  if (!genotype || !allele || allele.length !== 1) return null;
  return genotype.split("").filter((value) => value === allele.toUpperCase()).length;
}

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };
const CONSTRAINT_REQUIRED_SOURCES = new Set(["clingen", "clinvar", "cpic", "pharmgkb"]);

function complementGenotype(genotype: string): string {
  return genotype.toUpperCase().split("").map((a) => COMPLEMENT[a] ?? a).join("");
}

function validRiskAllele(allele?: string): string | null {
  if (!allele || !/^[ACGT]$/i.test(allele)) return null;
  return allele.toUpperCase();
}

function supportedGenomeBuild(build?: string): GenomeBuild | null {
  return build === "GRCh37" || build === "GRCh38" ? build : null;
}

function riskAlleleForBuild(record: EvidencePackRecord, build?: string): string | null {
  const supportedBuild = supportedGenomeBuild(build);
  if (record.riskAllelesByBuild) {
    if (supportedBuild) return validRiskAllele(record.riskAllelesByBuild[supportedBuild]);

    const alleles = Array.from(
      new Set(Object.values(record.riskAllelesByBuild).map(validRiskAllele).filter((allele): allele is string => Boolean(allele))),
    );
    return alleles.length === 1 ? alleles[0] : null;
  }

  return validRiskAllele(record.riskAllele);
}

function markerMatchesRecord(
  marker: CompactMarker | undefined,
  record: EvidencePackRecord,
  build?: string,
): boolean {
  const genotype = canonicalGenotype(marker?.[3] ?? null);
  if (!genotype) return false;

  if (record.genotype) {
    const stored = canonicalGenotype(record.genotype);
    const comp = canonicalGenotype(complementGenotype(record.genotype));
    return genotype === stored || (comp !== null && genotype === comp);
  }

  const riskAllele = riskAlleleForBuild(record, build);
  if (riskAllele) {
    return alleleCount(genotype, riskAllele) !== 0;
  }

  if (CONSTRAINT_REQUIRED_SOURCES.has(record.sourceId)) {
    return false;
  }

  return true;
}

function markerToMatchedMarker(
  marker: CompactMarker | undefined,
  rsid: string,
  gene?: string,
  record?: EvidencePackRecord,
  build?: string,
): MatchedMarker {
  const genotype = canonicalGenotype(marker?.[3] ?? null);
  const matchedAllele = record ? riskAlleleForBuild(record, build) ?? undefined : undefined;

  return {
    rsid,
    genotype,
    chromosome: marker?.[1] ?? null,
    position: marker?.[2] ?? null,
    gene,
    matchedAllele,
    matchedAlleleCount: matchedAllele ? alleleCount(genotype, matchedAllele) : null,
  };
}

const verifiedShardPaths = new Set<string>();

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rsidBucket(rsid: string, modulo: number): number {
  const numeric = Number.parseInt(rsid.replace(/^rs/i, ""), 10);
  if (Number.isFinite(numeric)) return numeric % modulo;
  let hash = 0;
  for (const char of rsid.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % modulo;
}

async function fetchRecordsFile(
  fetchImpl: typeof fetch,
  path: string,
  expectedSha256: string,
): Promise<EvidencePackRecord[]> {
  const recordsResponse = await fetchImpl(`${LOCAL_EVIDENCE_PACK_BASE}/${path}`, { cache: "force-cache" });
  if (!recordsResponse.ok) {
    throw new Error(`Local evidence pack records failed with ${recordsResponse.status}`);
  }

  const recordsText = await recordsResponse.text();

  if (!verifiedShardPaths.has(expectedSha256)) {
    const digest = await sha256(recordsText);
    if (digest !== expectedSha256) {
      throw new Error("Local evidence pack checksum did not match the manifest.");
    }
    verifiedShardPaths.add(expectedSha256);
  }

  return JSON.parse(recordsText) as EvidencePackRecord[];
}

export async function fetchLocalEvidencePack(
  fetchImpl: typeof fetch = fetch,
  markersForShardSelection: CompactMarker[] = [],
): Promise<{
  manifest: EvidencePackManifest;
  records: EvidencePackRecord[];
}> {
  const manifestResponse = await fetchImpl(`${LOCAL_EVIDENCE_PACK_BASE}/manifest.json`, {
    cache: "force-cache",
  });
  if (!manifestResponse.ok) {
    throw new Error(`Local evidence pack manifest failed with ${manifestResponse.status}`);
  }

  const manifest = (await manifestResponse.json()) as EvidencePackManifest;
  if (manifest.version !== LOCAL_EVIDENCE_PACK_VERSION || manifest.schemaVersion !== 1) {
    throw new Error("Local evidence pack manifest is not compatible with this app version.");
  }

  if (manifest.shards && manifest.shards.length > 0) {
    const modulo = manifest.shardModulo ?? DEFAULT_SHARD_MODULO;
    const neededBuckets = new Set(markersForShardSelection.map((marker) => rsidBucket(marker[0], modulo)));
    const selectedShards = markersForShardSelection.length > 0
      ? manifest.shards.filter((shard) => neededBuckets.has(shard.bucket))
      : manifest.shards;
    const records = (await Promise.all(
      selectedShards.map((shard) => fetchRecordsFile(fetchImpl, shard.recordsPath, shard.recordsSha256)),
    )).flat();

    return { manifest, records };
  }

  if (!manifest.recordsPath || !manifest.recordsSha256) {
    throw new Error("Local evidence pack manifest did not include records or shards.");
  }

  return {
    manifest,
    records: await fetchRecordsFile(fetchImpl, manifest.recordsPath, manifest.recordsSha256),
  };
}

export function matchEvidenceRecords(
  markers: CompactMarker[],
  records: EvidencePackRecord[],
  build?: string,
): EvidencePackMatch[] {
  const markerMap = new Map(markers.map((marker) => [marker[0].toLowerCase(), marker]));
  const matches: EvidencePackMatch[] = [];

  for (const record of records) {
    const matchedMarkers: MatchedMarker[] = [];

    record.markerIds.forEach((rsid, index) => {
      const marker = markerMap.get(rsid.toLowerCase());
      if (!markerMatchesRecord(marker, record, build)) return;

      const matchedMarker = markerToMatchedMarker(marker, rsid, record.genes[index] ?? record.genes[0], record, build);
      if (matchedMarker.genotype) {
        matchedMarkers.push(matchedMarker);
      }
    });

    if (matchedMarkers.length > 0) {
      matches.push({ record, matchedMarkers });
    }
  }

  return matches;
}
