import type { EvidencePackManifest, GenomeBuild } from "../types";
import { LOCAL_EVIDENCE_PACK_BASE, LOCAL_EVIDENCE_PACK_VERSION } from "./evidencePackData";

export type DbsnpAnnotationRow = [
  chromosome: string,
  position: number,
  ref: string,
  alt: string,
  rsids: string[],
];

export type DbsnpAnnotationLookup = Map<string, string[]>;

export function normalizeChromosome(raw: string): string {
  const refseqMatch = raw.trim().match(/^NC_0*(\d+)\.\d+$/i);
  if (refseqMatch) {
    const numeric = Number.parseInt(refseqMatch[1], 10);
    if (numeric >= 1 && numeric <= 22) return String(numeric);
    if (numeric === 23) return "X";
    if (numeric === 24) return "Y";
  }
  if (/^NC_012920\.\d+$/i.test(raw.trim())) return "MT";
  const normalized = raw.trim().replace(/^chr/i, "");
  if (normalized === "23") return "X";
  if (normalized === "24") return "Y";
  if (normalized === "25") return "XY";
  if (normalized === "26" || /^m(?:t)?$/i.test(normalized)) return "MT";
  return normalized;
}

function lookupKey(build: GenomeBuild, chromosome: string, position: number, ref: string, alt: string): string {
  return [
    build,
    normalizeChromosome(chromosome),
    String(position),
    ref.toUpperCase(),
    alt.toUpperCase(),
  ].join(":");
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildDbsnpAnnotationLookup(
  indexes: Partial<Record<GenomeBuild, DbsnpAnnotationRow[]>>,
): DbsnpAnnotationLookup {
  const lookup: DbsnpAnnotationLookup = new Map();

  for (const [build, rows] of Object.entries(indexes) as Array<[GenomeBuild, DbsnpAnnotationRow[] | undefined]>) {
    for (const [chromosome, position, ref, alt, rsids] of rows ?? []) {
      lookup.set(lookupKey(build, chromosome, position, ref, alt), rsids);
    }
  }

  return lookup;
}

export function annotateVariantRsids(
  lookup: DbsnpAnnotationLookup | undefined,
  build: string,
  chromosome: string,
  position: number,
  ref: string,
  alt: string,
): string[] {
  if (!lookup || (build !== "GRCh37" && build !== "GRCh38")) return [];
  return lookup.get(lookupKey(build, chromosome, position, ref, alt)) ?? [];
}

export async function fetchDbsnpAnnotationLookup(
  fetchImpl: typeof fetch = fetch,
  build?: GenomeBuild,
): Promise<DbsnpAnnotationLookup> {
  const manifestResponse = await fetchImpl(`${LOCAL_EVIDENCE_PACK_BASE}/manifest.json`, { cache: "force-cache" });
  if (!manifestResponse.ok) {
    throw new Error(`Local evidence pack manifest failed with ${manifestResponse.status}`);
  }

  const manifest = (await manifestResponse.json()) as EvidencePackManifest;
  if (manifest.version !== LOCAL_EVIDENCE_PACK_VERSION || manifest.schemaVersion !== 1) {
    throw new Error("Local evidence pack manifest is not compatible with this app version.");
  }

  const filteredIndexes = (manifest.annotationIndexes ?? []).filter((index) => !build || index.build === build);
  const indexEntries = await Promise.all(
    filteredIndexes.map(async (index) => {
      const response = await fetchImpl(`${LOCAL_EVIDENCE_PACK_BASE}/${index.recordsPath}`, { cache: "force-cache" });
      if (!response.ok) {
        throw new Error(`Local dbSNP annotation index failed with ${response.status}`);
      }
      const text = await response.text();
      const digest = await sha256(text);
      if (digest !== index.recordsSha256) {
        throw new Error("Local dbSNP annotation checksum did not match the manifest.");
      }
      return [index.build, JSON.parse(text) as DbsnpAnnotationRow[]] as const;
    }),
  );

  return buildDbsnpAnnotationLookup(Object.fromEntries(indexEntries));
}
