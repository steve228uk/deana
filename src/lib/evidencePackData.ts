import {
  CompactMarker,
  EvidencePackManifest,
  EvidencePackMatch,
  EvidencePackRecord,
  MatchedMarker,
} from "../types";

export const LOCAL_EVIDENCE_PACK_VERSION = "2026-04-core";
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

function markerMatchesRecord(marker: CompactMarker | undefined, record: EvidencePackRecord): boolean {
  const genotype = canonicalGenotype(marker?.[3] ?? null);
  if (!genotype) return false;

  if (record.genotype) {
    return genotype === canonicalGenotype(record.genotype);
  }

  if (record.riskAllele && /^[ACGT]$/i.test(record.riskAllele)) {
    return alleleCount(genotype, record.riskAllele) !== 0;
  }

  return true;
}

function markerToMatchedMarker(
  marker: CompactMarker | undefined,
  rsid: string,
  gene?: string,
  record?: EvidencePackRecord,
): MatchedMarker {
  const genotype = canonicalGenotype(marker?.[3] ?? null);
  const matchedAllele = record?.riskAllele && /^[ACGT]$/i.test(record.riskAllele)
    ? record.riskAllele.toUpperCase()
    : undefined;

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
): EvidencePackMatch[] {
  const markerMap = new Map(markers.map((marker) => [marker[0].toLowerCase(), marker]));
  const matches: EvidencePackMatch[] = [];

  for (const record of records) {
    const matchedMarkers = record.markerIds
      .filter((rsid) => markerMatchesRecord(markerMap.get(rsid.toLowerCase()), record))
      .map((rsid, index) => {
        const marker = markerMap.get(rsid.toLowerCase());
        return markerToMatchedMarker(marker, rsid, record.genes[index] ?? record.genes[0], record);
      })
      .filter((marker) => marker.genotype);

    if (matchedMarkers.length > 0) {
      matches.push({ record, matchedMarkers });
    }
  }

  return matches;
}
