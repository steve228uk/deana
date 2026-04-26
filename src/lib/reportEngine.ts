import { EVIDENCE_DEFINITIONS, EVIDENCE_PACK_VERSION, SOURCE_LIBRARY, createEntryFromDefinition } from "./evidencePack";
import {
  CompactMarker,
  CoverageStatus,
  EvidencePackMatch,
  EvidenceSupplement,
  EvidenceTier,
  ParsedDnaFile,
  ProfileSupplements,
  ReportData,
  ReportEntry,
  ReportFacets,
  TabSummary,
} from "../types";
import {
  clinicalSignificanceLabel,
  normalizeClinicalSignificance,
  normalizeConditions,
} from "./normalization";

export const REPORT_VERSION = 7;

type MarkerMap = Map<string, CompactMarker>;

function markerMap(markers: CompactMarker[]): MarkerMap {
  return new Map(markers.map((marker) => [marker[0], marker]));
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function facetValues<T extends string>(values: readonly T[], preferred: readonly T[]): T[] {
  return preferred.filter((value) => values.includes(value));
}

function buildFacets(entries: ReportEntry[]): ReportFacets {
  const clinicalSignificances = uniq(
    entries
      .map((entry) => entry.normalizedClinicalSignificance)
      .filter((value): value is string => Boolean(value)),
  );

  return {
    sources: uniq(entries.flatMap((entry) => entry.sources.map((source) => source.name))),
    evidenceTiers: facetValues(
      uniq(entries.map((entry) => entry.evidenceTier)) as EvidenceTier[],
      ["high", "moderate", "emerging", "preview", "supplementary"],
    ),
    coverages: facetValues(
      uniq(entries.map((entry) => entry.coverage)) as CoverageStatus[],
      ["full", "partial", "missing"],
    ),
    reputes: facetValues(
      uniq(entries.map((entry) => entry.repute)) as Array<ReportEntry["repute"]>,
      ["bad", "mixed", "good", "not-set"],
    ),
    clinicalSignificances,
    clinicalSignificanceLabels: Object.fromEntries(
      clinicalSignificances.map((value) => [value, clinicalSignificanceLabel(value)]),
    ),
    genes: uniq(entries.flatMap((entry) => entry.genes)),
    tags: uniq(entries.flatMap((entry) => entry.topics)),
    conditions: normalizeConditions(entries.flatMap((entry) => entry.conditions)),
    publicationBuckets: facetValues(
      uniq(entries.map((entry) => entry.publicationBucket)) as Array<ReportEntry["publicationBucket"]>,
      ["0", "1-5", "6-20", "21+"],
    ),
  };
}

function buildWarnings(entries: ReportEntry[], supplements?: ProfileSupplements): string[] {
  const warnings = [
    "Deana is informational and built from consumer-array data, not diagnostic sequencing.",
  ];

  if (entries.some((entry) => entry.category === "drug")) {
    warnings.push("Drug-response entries are preview-only unless full pharmacogene coverage is available.");
  }

  if (entries.some((entry) => entry.coverage !== "full")) {
    warnings.push("Some findings are limited by missing chip markers, so absence of a hit is not absence of risk.");
  }

  if (supplements?.evidence?.status === "partial" || supplements?.evidence?.status === "failed") {
    warnings.push("Local evidence-pack matching did not finish, so this report may be incomplete until you retry.");
  }

  return warnings;
}

function buildSourceMix(entries: ReportEntry[]): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    for (const source of entry.sources) {
      counts.set(source.name, (counts.get(source.name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, count]) => ({ source, count }));
}

function buildTabs(entries: ReportEntry[]): TabSummary[] {
  const medical = entries.filter((entry) => entry.category === "medical").length;
  const traits = entries.filter((entry) => entry.category === "traits").length;
  const drug = entries.filter((entry) => entry.category === "drug").length;

  return [
    {
      tab: "overview",
      label: "Overview",
      description: "Coverage, source mix, and quick jumps into the strongest evidence-backed findings.",
      count: entries.length,
    },
    {
      tab: "medical",
      label: "Medical",
      description: "ClinVar-led medical context with conservative wording and chip-coverage caveats.",
      count: medical,
    },
    {
      tab: "traits",
      label: "Traits",
      description: "High-signal lifestyle and phenotype markers, clearly labeled when evidence is lighter.",
      count: traits,
    },
    {
      tab: "drug",
      label: "Drug Response",
      description: "PGx preview cards kept clearly below a clinical-report certainty bar.",
      count: drug,
    },
  ];
}

function outcomeForLocalEvidence(record: EvidencePackMatch["record"]): ReportEntry["outcome"] {
  if (record.tone === "good" || record.repute === "good") return "positive";
  if (record.tone === "caution" || record.repute === "bad" || record.repute === "mixed") return "negative";
  return "informational";
}

function severityForLocalEvidence(record: EvidencePackMatch["record"], category: ReportEntry["category"]): number {
  const outcome = outcomeForLocalEvidence(record);
  if (outcome === "positive") return category === "medical" ? 22 : 18;
  if (outcome === "informational") return category === "drug" ? 34 : category === "medical" ? 30 : 24;
  return category === "medical" ? (record.repute === "bad" ? 82 : 62) : category === "drug" ? 66 : 34;
}

function publicationBucket(publicationCount: number): ReportEntry["publicationBucket"] {
  return publicationCount === 0
    ? "0"
    : publicationCount <= 5
      ? "1-5"
      : publicationCount <= 20
        ? "6-20"
        : "21+";
}

function sourceNotesForLocalEvidence(record: EvidencePackMatch["record"], sourceName: string): string[] {
  const structuredNotePatterns = [
    /^SNPedia magnitude:/i,
    /^SNPedia repute:/i,
  ];

  return [
    `${sourceName}: ${record.release}.`,
    ...record.notes.filter((note) => !structuredNotePatterns.some((pattern) => pattern.test(note))),
    ...record.pmids.map((pmid) => `PubMed PMID ${pmid}`),
  ];
}

function markerLabel(marker: ReportEntry["matchedMarkers"][number]): string {
  const base = `${marker.rsid} ${marker.genotype ?? "not found"}`;
  if (!marker.matchedAllele) return base;
  const copies = marker.matchedAlleleCount ?? 0;
  return `${base} (${copies} ${marker.matchedAllele} ${copies === 1 ? "allele" : "alleles"})`;
}

function localEvidenceGenotypeSummary(match: EvidencePackMatch): string {
  const genotype = match.record.genotype ? `Source genotype: ${match.record.genotype}. ` : "";
  return `${genotype}${match.matchedMarkers.map(markerLabel).join(" • ")}`;
}

function createLocalEvidenceEntries(supplement?: EvidenceSupplement): ReportEntry[] {
  if (!supplement || supplement.status !== "complete") return [];
  const curatedIds = new Set(EVIDENCE_DEFINITIONS.map((definition) => definition.id));

  return supplement.matchedRecords
    .filter((match) => !curatedIds.has(match.record.entryId))
    .map((match: EvidencePackMatch): ReportEntry => {
      const record = match.record;
      const publicationCount = record.pmids.length;
      const category = record.category ?? "traits";
      const sourceName = SOURCE_LIBRARY[record.sourceId]?.name ?? record.sourceId;
      const normalizedClinicalSignificance = normalizeClinicalSignificance(record.clinicalSignificance);
      const conditions = normalizeConditions(record.conditions ?? []);

      return {
        id: record.entryId,
        entryKind: "local-evidence",
        category,
        subcategory: record.subcategory ?? record.sourceId,
        title: record.title,
        summary:
          record.summary ??
          `${match.matchedMarkers.map((marker) => `${marker.rsid} ${marker.genotype}`).join(" • ")} matched a local ${sourceName} evidence record.`,
        detail:
          record.detail ??
          record.notes.join(" ") ??
          "This local evidence-pack entry adds source context for a marker present in the uploaded file.",
        whyItMatters:
          record.whyItMatters ??
          "This finding came from Deana's bundled evidence database, so it can be matched locally without sending marker requests.",
        genotypeSummary: localEvidenceGenotypeSummary(match),
        matchedMarkers: match.matchedMarkers,
        genes: record.genes,
        topics: record.topics ?? [],
        conditions,
        warnings: [
          "This is local evidence-pack context, not a diagnosis or treatment recommendation.",
          "Consumer-array coverage and genotype orientation can limit interpretation fidelity.",
        ],
        sources: [
          {
            id: record.sourceId,
            name: sourceName,
            url: record.url,
          },
        ],
        sourceNotes: sourceNotesForLocalEvidence(record, sourceName),
        evidenceTier: record.evidenceLevel,
        clinicalSignificance: record.clinicalSignificance,
        normalizedClinicalSignificance,
        repute: record.repute ?? "not-set",
        publicationCount,
        publicationBucket: publicationBucket(publicationCount),
        frequencyNote: record.frequencyNote,
        magnitude: record.magnitude ?? null,
        sourceGenotype: record.genotype,
        sourcePageKey: record.id,
        sourcePageUrl: record.url,
        coverage: "full",
        tone: record.tone ?? "neutral",
        outcome: outcomeForLocalEvidence(record),
        sort: {
          severity: severityForLocalEvidence(record, category),
          evidence:
            record.evidenceLevel === "high"
              ? 4
              : record.evidenceLevel === "moderate"
                ? 3
                : record.evidenceLevel === "emerging"
                  ? 2
                  : 1,
          alphabetical: record.title.toLowerCase(),
          publications: publicationCount,
        },
        confidenceNote: `Matched locally from evidence pack ${supplement.packVersion}.`,
        disclaimer: "Informational only. Do not use this result alone for diagnosis, treatment, or prescribing decisions.",
      };
    });
}

export function generateReport(dna: ParsedDnaFile, supplements?: ProfileSupplements): ReportData {
  const evidenceSupplement: EvidenceSupplement | undefined = supplements?.evidence;
  const map = markerMap(dna.markers);
  const curatedEntries = EVIDENCE_DEFINITIONS.map((definition) =>
    createEntryFromDefinition(definition, map, evidenceSupplement),
  );
  const localEvidenceEntries = createLocalEvidenceEntries(evidenceSupplement);
  const entries = [...curatedEntries, ...localEvidenceEntries];
  const curatedMarkerMatches = curatedEntries.flatMap((entry) => entry.matchedMarkers).filter((marker) => marker.genotype).length;
  const totalTrackedMarkers = curatedEntries.flatMap((entry) => entry.matchedMarkers).length;
  const coverageScore = totalTrackedMarkers === 0 ? 0 : Math.round((curatedMarkerMatches / totalTrackedMarkers) * 100);
  const localEvidenceRecordMatches = evidenceSupplement?.matchedRecords.length ?? 0;
  const localEvidenceEntryMatches = evidenceSupplement
    ? new Set(evidenceSupplement.matchedRecords.map((match) => match.record.entryId)).size
    : 0;
  const localEvidenceMatchedRsids = evidenceSupplement
    ? new Set(
      evidenceSupplement.matchedRecords.flatMap((match) =>
        match.matchedMarkers.map((marker) => marker.rsid.toLowerCase()),
      ),
    ).size
    : 0;

  return {
    reportVersion: REPORT_VERSION,
    evidencePackVersion: EVIDENCE_PACK_VERSION,
    overview: {
      provider: dna.provider,
      build: dna.build,
      markerCount: dna.markerCount,
      parsedAt: new Date().toISOString(),
      coverageScore,
      curatedMarkerMatches,
      sourceMix: buildSourceMix(entries),
      warnings: buildWarnings(entries, supplements),
      evidenceStatus: evidenceSupplement?.status ?? "idle",
      evidencePackVersion: evidenceSupplement?.packVersion ?? EVIDENCE_PACK_VERSION,
      evidenceProcessedRsids: evidenceSupplement?.processedRsids ?? 0,
      evidenceMatchedFindings: localEvidenceEntryMatches,
      localEvidenceRecordMatches,
      localEvidenceEntryMatches,
      localEvidenceMatchedRsids,
      evidenceUnmatchedRsids: evidenceSupplement?.unmatchedRsids ?? dna.markerCount,
      evidenceFailedItems: evidenceSupplement?.failedItems.length ?? 0,
    },
    tabs: buildTabs(entries),
    entries,
    facets: buildFacets(entries),
  };
}
