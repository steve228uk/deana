import { EVIDENCE_DEFINITIONS, EVIDENCE_PACK_VERSION, SOURCE_LIBRARY, createEntryFromDefinition } from "./evidencePack";
import {
  CompactMarker,
  CoverageStatus,
  EvidencePackMatch,
  EvidenceSupplement,
  EvidenceTier,
  InsightCategory,
  InsightTone,
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
import { calculateFindingRank, evidenceTierSortValue } from "./ranking";

export const REPORT_VERSION = 10;

type MarkerMap = Map<string, CompactMarker>;

const CLINGEN_CLASSIFICATION_NOTE_PATTERN = /^ClinGen classification:\s*([^.]+)\./i;
const CLINGEN_TITLE_SUFFIX_PATTERN = /\s*\(ClinGen\s+([^)]+)\)\s*$/i;

function markerMap(markers: CompactMarker[]): MarkerMap {
  const map = new Map<string, CompactMarker>();
  for (const marker of markers) {
    if (!map.has(marker[0])) map.set(marker[0], marker);
  }
  return map;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function facetValues<T extends string>(values: readonly T[], preferred: readonly T[]): T[] {
  return preferred.filter((value) => values.includes(value));
}

export function buildFacets(entries: ReportEntry[]): ReportFacets {
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

export function buildCategoryFacets(entries: ReportEntry[]): Record<InsightCategory, ReportFacets> {
  const entriesByCategory: Record<InsightCategory, ReportEntry[]> = {
    medical: [],
    traits: [],
    drug: [],
  };

  for (const entry of entries) {
    entriesByCategory[entry.category].push(entry);
  }

  return {
    medical: buildFacets(entriesByCategory.medical),
    traits: buildFacets(entriesByCategory.traits),
    drug: buildFacets(entriesByCategory.drug),
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

function outcomeForTone(tone: InsightTone, repute: ReportEntry["repute"]): ReportEntry["outcome"] {
  if (tone === "good" || repute === "good") return "positive";
  if (tone === "caution" || repute === "bad" || repute === "mixed") return "negative";
  return "informational";
}

function severityForLocalEvidence(outcome: ReportEntry["outcome"], repute: ReportEntry["repute"], category: ReportEntry["category"]): number {
  if (outcome === "positive") return category === "medical" ? 22 : 18;
  if (outcome === "informational") return category === "drug" ? 34 : category === "medical" ? 30 : 24;
  return category === "medical" ? (repute === "bad" ? 82 : 62) : category === "drug" ? 66 : 34;
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

function sourcesForLocalEvidence(record: EvidencePackMatch["record"], sourceName: string): ReportEntry["sources"] {
  const sources = new Map<string, ReportEntry["sources"][number]>();
  const addSource = (id: string, name: string, url: string) => {
    if (!sources.has(id)) sources.set(id, { id, name, url });
  };

  addSource(record.sourceId, sourceName, record.url || SOURCE_LIBRARY[record.sourceId]?.url || "");

  for (const context of record.relatedContexts ?? []) {
    const relatedSource = SOURCE_LIBRARY[context.sourceId];
    addSource(context.sourceId, relatedSource?.name ?? context.sourceId, context.url || relatedSource?.url || "");
  }

  return Array.from(sources.values());
}

function markerLabel(marker: ReportEntry["matchedMarkers"][number]): string {
  const base = `${marker.rsid} ${marker.genotype ?? "not found"}`;
  if (!marker.matchedAllele) return base;
  const copies = marker.matchedAlleleCount ?? 0;
  return `${base} (${copies} ${marker.matchedAllele} ${copies === 1 ? "allele" : "alleles"})`;
}

function toneForLocalEvidence(
  riskCount: number | null,
  repute: ReportEntry["repute"],
  fallbackTone?: InsightTone,
): InsightTone {
  if (riskCount !== null && riskCount > 0 && repute === "bad") return "caution";
  if (riskCount !== null && riskCount > 0 && repute === "good") return "good";
  return fallbackTone ?? "neutral";
}

function summaryForLocalEvidence(
  matchedMarker: ReportEntry["matchedMarkers"][number] | undefined,
  genotype: string | null,
  riskCount: number | null,
  riskSummary: string | undefined,
): string | null {
  if (!genotype) return `This upload did not include the ${matchedMarker?.rsid ?? "relevant"} marker.`;
  if (riskCount === 0 && matchedMarker) return `No risk allele detected at ${matchedMarker.rsid}.`;
  if (riskCount === 1 && riskSummary) return `One copy of the risk allele detected. ${riskSummary}.`;
  if (riskCount === 2 && riskSummary) return `Two copies of the risk allele detected. ${riskSummary}.`;
  return null;
}

function riskCountForLocalEvidence(
  matchedMarker: ReportEntry["matchedMarkers"][number] | undefined,
  riskAllele: string | undefined,
  genotype: string | null,
): number | null {
  if (typeof matchedMarker?.matchedAlleleCount === "number") return matchedMarker.matchedAlleleCount;
  if (!riskAllele || !genotype) return null;
  return [...genotype].filter((a) => a === riskAllele).length;
}

function localEvidenceGenotypeSummary(match: EvidencePackMatch): string {
  const genotype = match.record.genotype ? `Source genotype: ${match.record.genotype}. ` : "";
  return `${genotype}${match.matchedMarkers.map(markerLabel).join(" • ")}`;
}

function clinGenClassificationForRecord(record: EvidencePackMatch["record"]): string | undefined {
  if (record.clingenClassification) return record.clingenClassification;
  const canContainClinGenClassification = record.sourceId === "clingen" || record.subcategory === "gene-disease-validity";
  if (!canContainClinGenClassification) return undefined;

  for (const note of record.notes) {
    const noteMatch = CLINGEN_CLASSIFICATION_NOTE_PATTERN.exec(note.trim())?.[1]?.trim();
    if (noteMatch) return noteMatch;
  }

  return CLINGEN_TITLE_SUFFIX_PATTERN.exec(record.title)?.[1]?.trim();
}

function titleWithoutClinGenClassification(title: string, classification?: string): string {
  if (!classification) return title;
  return title.replace(CLINGEN_TITLE_SUFFIX_PATTERN, "").trim();
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
      const sources = sourcesForLocalEvidence(record, sourceName);
      const normalizedClinicalSignificance = normalizeClinicalSignificance(record.clinicalSignificance);
      const conditions = normalizeConditions(record.conditions ?? []);

      const matchedMarker = match.matchedMarkers[0];
      const genotype = matchedMarker?.genotype ?? null;
      const riskAllele = matchedMarker?.matchedAllele ?? record.riskAllele;
      const riskCount = riskCountForLocalEvidence(matchedMarker, riskAllele, genotype);

      const repute = record.repute ?? "not-set";
      const coverage: CoverageStatus = genotype ? "full" : "missing";
      const tone = toneForLocalEvidence(riskCount, repute, record.tone);
      const outcome = outcomeForTone(tone, repute);
      const clingenClassification = clinGenClassificationForRecord(record);
      const title = titleWithoutClinGenClassification(record.title, clingenClassification);

      const riskSummary = record.riskSummary;
      const computedSummary = summaryForLocalEvidence(matchedMarker, genotype, riskCount, riskSummary);

      const summary =
        computedSummary ??
        record.summary ??
        `${match.matchedMarkers.map((marker) => `${marker.rsid} ${marker.genotype}`).join(" • ")} matched a local ${sourceName} evidence record.`;

      return {
        id: record.entryId,
        entryKind: "local-evidence",
        category,
        subcategory: record.subcategory ?? record.sourceId,
        title,
        summary,
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
        sources,
        sourceNotes: sourceNotesForLocalEvidence(record, sourceName),
        relatedContexts: record.relatedContexts ?? [],
        evidenceTier: record.evidenceLevel,
        clinicalSignificance: record.clinicalSignificance,
        normalizedClinicalSignificance,
        repute,
        publicationCount,
        publicationBucket: publicationBucket(publicationCount),
        frequencyNote: record.frequencyNote,
        magnitude: record.magnitude ?? null,
        sourceGenotype: record.genotype,
        sourcePageKey: record.id,
        sourcePageUrl: record.url,
        coverage,
        tone,
        outcome,
        sort: {
          rank: calculateFindingRank({
            evidenceTier: record.evidenceLevel,
            outcome,
            repute,
            coverage,
            publicationCount,
            magnitude: record.magnitude,
            clingenClassification,
            pharmgkbLevel: record.pharmgkbLevel,
            cpicLevel: record.cpicLevel,
            cpicLevelStatus: record.cpicLevelStatus,
            clinvarStars: record.clinvarStars,
            gwasPValue: record.gwasPValue,
            gwasEffect: record.gwasEffect,
            gwasHasReplication: record.gwasHasReplication,
            gwasInitialSampleSize: record.gwasInitialSampleSize,
            gwasReplicationSampleSize: record.gwasReplicationSampleSize,
            gwasFullSummaryStats: record.gwasFullSummaryStats,
            clinicalSignificance: record.clinicalSignificance,
            normalizedClinicalSignificance,
            sources: sources.map((source) => ({ id: source.id, name: source.name })),
            matchedMarkers: match.matchedMarkers,
          }),
          severity: severityForLocalEvidence(outcome, repute, category),
          evidence: evidenceTierSortValue(record.evidenceLevel),
          alphabetical: title.toLowerCase(),
          publications: publicationCount,
        },
        confidenceNote: `Matched locally from evidence pack ${supplement.packVersion}.`,
        disclaimer: "Informational only. Do not use this result alone for diagnosis, treatment, or prescribing decisions.",
        pharmgkbLevel: record.pharmgkbLevel,
        cpicLevel: record.cpicLevel,
        cpicLevelStatus: record.cpicLevelStatus,
        clingenClassification,
        clinvarReviewStatus: record.clinvarReviewStatus,
        clinvarStars: record.clinvarStars,
        gwasPValue: record.gwasPValue,
        gwasEffect: record.gwasEffect,
        gwasHasReplication: record.gwasHasReplication,
        gwasInitialSampleSize: record.gwasInitialSampleSize,
        gwasReplicationSampleSize: record.gwasReplicationSampleSize,
        gwasStudyAccession: record.gwasStudyAccession,
        gwasFullSummaryStats: record.gwasFullSummaryStats,
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

  let curatedMarkerMatches = 0;
  let totalTrackedMarkers = 0;
  for (const entry of curatedEntries) {
    for (const marker of entry.matchedMarkers) {
      totalTrackedMarkers += 1;
      if (marker.genotype) curatedMarkerMatches += 1;
    }
  }

  const coverageScore = totalTrackedMarkers === 0 ? 0 : Math.round((curatedMarkerMatches / totalTrackedMarkers) * 100);
  const localEvidenceRecordMatches = evidenceSupplement?.matchedRecords.length ?? 0;
  const localEvidenceEntryIds = new Set<string>();
  const localEvidenceMatchedRsidSet = new Set<string>();
  for (const match of evidenceSupplement?.matchedRecords ?? []) {
    localEvidenceEntryIds.add(match.record.entryId);
    for (const marker of match.matchedMarkers) {
      localEvidenceMatchedRsidSet.add(marker.rsid.toLowerCase());
    }
  }
  const localEvidenceEntryMatches = localEvidenceEntryIds.size;
  const localEvidenceMatchedRsids = localEvidenceMatchedRsidSet.size;

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
    categoryFacets: buildCategoryFacets(entries),
  };
}
