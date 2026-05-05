import {
  CompactMarker,
  EvidencePackManifest,
  EvidencePackMatch,
  EvidencePackRecord,
  GenomeBuild,
  MatchedMarker,
} from "../types";
import { LOCAL_EVIDENCE_PACK_BASE, LOCAL_EVIDENCE_PACK_VERSION } from "./evidencePackConfig";

// Preserve the existing module-level import surface while the version source is generated from the lockfile.
export { LOCAL_EVIDENCE_PACK_BASE, LOCAL_EVIDENCE_PACK_VERSION } from "./evidencePackConfig";

const DEFAULT_SHARD_MODULO = 256;

type EvidencePackShard = NonNullable<EvidencePackManifest["shards"]>[number];
type MarkerLookup = Map<string, CompactMarker>;

export interface LocalEvidencePackMatchProgress {
  manifest: EvidencePackManifest;
  totalShards: number;
  processedShards: number;
  totalRecords: number;
  processedRecords: number;
  matchedEntryCount: number;
  matchedRsidCount: number;
  currentPath: string | null;
}

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

const CONSTRAINT_REQUIRED_SOURCES = new Set(["clingen", "clinvar", "cpic", "pharmgkb"]);

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
    return genotype === stored;
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

async function fetchLocalEvidencePackManifest(fetchImpl: typeof fetch): Promise<EvidencePackManifest> {
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

  return manifest;
}

function selectShardsForMarkers(
  manifest: EvidencePackManifest,
  markersForShardSelection: CompactMarker[],
): EvidencePackShard[] {
  if (!manifest.shards || manifest.shards.length === 0) return [];

  if (markersForShardSelection.length === 0) return manifest.shards;

  const modulo = manifest.shardModulo ?? DEFAULT_SHARD_MODULO;
  const neededBuckets = new Set<number>();
  for (const marker of markersForShardSelection) {
    neededBuckets.add(rsidBucket(marker[0], modulo));
  }
  return manifest.shards.filter((shard) => neededBuckets.has(shard.bucket));
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
  const manifest = await fetchLocalEvidencePackManifest(fetchImpl);

  if (manifest.shards && manifest.shards.length > 0) {
    const selectedShards = selectShardsForMarkers(manifest, markersForShardSelection);
    const records: EvidencePackRecord[] = [];
    for (const shard of selectedShards) {
      records.push(...await fetchRecordsFile(fetchImpl, shard.recordsPath, shard.recordsSha256));
    }

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

function createMarkerLookup(markers: CompactMarker[]): MarkerLookup {
  const lookup: MarkerLookup = new Map();
  for (const marker of markers) {
    lookup.set(marker[0].toLowerCase(), marker);
  }
  return lookup;
}

function matchEvidenceRecord(
  markerLookup: MarkerLookup,
  record: EvidencePackRecord,
  build?: string,
): EvidencePackMatch | null {
  const matchedMarkers: MatchedMarker[] = [];

  for (let index = 0; index < record.markerIds.length; index += 1) {
    const rsid = record.markerIds[index];
    const marker = markerLookup.get(rsid.toLowerCase());
    if (!markerMatchesRecord(marker, record, build)) continue;

    const matchedMarker = markerToMatchedMarker(marker, rsid, record.genes[index] ?? record.genes[0], record, build);
    if (matchedMarker.genotype) {
      matchedMarkers.push(matchedMarker);
    }
  }

  return matchedMarkers.length > 0 ? { record, matchedMarkers } : null;
}

function matchEvidenceRecordsWithMarkerLookup(
  markerLookup: MarkerLookup,
  records: EvidencePackRecord[],
  build?: string,
): EvidencePackMatch[] {
  const matches: EvidencePackMatch[] = [];

  for (const record of records) {
    const match = matchEvidenceRecord(markerLookup, record, build);
    if (match) matches.push(match);
  }

  return matches;
}

export async function matchLocalEvidencePack(
  fetchImpl: typeof fetch = fetch,
  markers: CompactMarker[] = [],
  build?: string,
  onProgress?: (progress: LocalEvidencePackMatchProgress) => void,
): Promise<{
  manifest: EvidencePackManifest;
  matchedRecords: EvidencePackMatch[];
  matchedEntryCount: number;
  matchedRsidCount: number;
}> {
  const manifest = await fetchLocalEvidencePackManifest(fetchImpl);
  const markerLookup = createMarkerLookup(markers);
  const matchedRecords: EvidencePackMatch[] = [];
  const matchedEntryIds = new Set<string>();
  const matchedRsids = new Set<string>();

  const addMatch = (match: EvidencePackMatch) => {
    matchedRecords.push(match);
    matchedEntryIds.add(match.record.entryId);
    for (const marker of match.matchedMarkers) {
      matchedRsids.add(marker.rsid.toLowerCase());
    }
  };

  const addRecordMatches = (records: EvidencePackRecord[]) => {
    for (const record of records) {
      const match = matchEvidenceRecord(markerLookup, record, build);
      if (match) addMatch(match);
    }
  };

  const emitProgress = (
    totalShards: number,
    processedShards: number,
    totalRecords: number,
    processedRecords: number,
    currentPath: string | null,
  ) => {
    onProgress?.({
      manifest,
      totalShards,
      processedShards,
      totalRecords,
      processedRecords,
      matchedEntryCount: matchedEntryIds.size,
      matchedRsidCount: matchedRsids.size,
      currentPath,
    });
  };

  if (manifest.shards && manifest.shards.length > 0) {
    const selectedShards = selectShardsForMarkers(manifest, markers);
    const totalRecords = selectedShards.reduce((total, shard) => total + shard.recordCount, 0);
    let processedRecords = 0;
    let processedShards = 0;

    emitProgress(selectedShards.length, processedShards, totalRecords, processedRecords, null);

    for (const shard of selectedShards) {
      const records = await fetchRecordsFile(fetchImpl, shard.recordsPath, shard.recordsSha256);
      addRecordMatches(records);
      processedRecords += shard.recordCount;
      processedShards += 1;

      emitProgress(selectedShards.length, processedShards, totalRecords, processedRecords, shard.recordsPath);
    }

    return {
      manifest,
      matchedRecords,
      matchedEntryCount: matchedEntryIds.size,
      matchedRsidCount: matchedRsids.size,
    };
  }

  if (!manifest.recordsPath || !manifest.recordsSha256) {
    throw new Error("Local evidence pack manifest did not include records or shards.");
  }

  emitProgress(1, 0, manifest.recordCount ?? 0, 0, null);

  const records = await fetchRecordsFile(fetchImpl, manifest.recordsPath, manifest.recordsSha256);
  addRecordMatches(records);

  const totalRecords = manifest.recordCount ?? records.length;
  emitProgress(1, 1, totalRecords, totalRecords, manifest.recordsPath);

  return {
    manifest,
    matchedRecords,
    matchedEntryCount: matchedEntryIds.size,
    matchedRsidCount: matchedRsids.size,
  };
}

export function matchEvidenceRecords(
  markers: CompactMarker[],
  records: EvidencePackRecord[],
  build?: string,
): EvidencePackMatch[] {
  return matchEvidenceRecordsWithMarkerLookup(createMarkerLookup(markers), records, build);
}
