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
  SnpediaSupplement,
  TabSummary,
} from "../types";

export const REPORT_VERSION = 5;

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
    clinicalSignificances: uniq(
      entries.map((entry) => entry.clinicalSignificance).filter((value): value is string => Boolean(value)),
    ),
    genes: uniq(entries.flatMap((entry) => entry.genes)),
    tags: uniq(entries.flatMap((entry) => entry.topics)),
    conditions: uniq(entries.flatMap((entry) => entry.conditions)),
    publicationBuckets: facetValues(
      uniq(entries.map((entry) => entry.publicationBucket)) as Array<ReportEntry["publicationBucket"]>,
      ["0", "1-5", "6-20", "21+"],
    ),
  };
}

function buildWarnings(entries: ReportEntry[], supplements?: ProfileSupplements): string[] {
  const warnings = [
    "DeaNA is informational and built from consumer-array data, not diagnostic sequencing.",
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

  if (supplements?.snpedia?.status === "partial" || supplements?.snpedia?.status === "failed") {
    warnings.push("Some local SNPedia-derived matches failed, so this report may be incomplete until you retry enrichment.");
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
    {
      tab: "other",
      label: "Other",
      description: "Source-derived local evidence entries grouped separately from the primary category navigation.",
      count: entries.filter((entry) => entry.entryKind === "local-evidence").length,
    },
    {
      tab: "raw",
      label: "Raw Markers",
      description: "Local genotype-page context with links back into SNPedia where DeaNA has interpretation context.",
      count: 0,
    },
  ];
}

function createSnpediaEntries(supplement?: SnpediaSupplement): ReportEntry[] {
  if (!supplement) return [];

  return supplement.matchedFindings.map((finding) => ({
    id: finding.id,
    entryKind: "snpedia",
    category: finding.category,
    subcategory: "snpedia",
    title: finding.pageTitle,
    summary: finding.summary,
    detail: finding.detail,
    whyItMatters: "This entry was discovered by looking up the uploaded rsID directly in SNPedia.",
    genotypeSummary: `${finding.rsid} ${finding.genotype ?? "page-level"}`,
    matchedMarkers: [
      {
        rsid: finding.rsid,
        genotype: finding.genotype,
        chromosome: finding.chromosome,
        position: finding.position,
        gene: finding.genes[0],
      },
    ],
    genes: finding.genes,
    topics: finding.topics,
    conditions: finding.conditions,
    warnings: [
      "SNPedia is a supplementary source and does not replace clinical interpretation.",
      "Consumer-array coverage and genotype orientation can limit interpretation fidelity.",
    ],
    sources: [
      {
        id: "snpedia",
        name: "SNPedia",
        url: finding.pageUrl,
      },
    ],
    sourceNotes: [
      "Matched from DeaNA's local SNPedia evidence pack using the uploaded rsID and genotype.",
      "SNPedia content is supplemental and should be treated cautiously for health decisions.",
    ],
    evidenceTier: "supplementary",
    clinicalSignificance: finding.clinicalSignificance,
    repute: finding.repute,
    publicationCount: finding.publicationCount,
    publicationBucket:
      finding.publicationCount === 0
        ? "0"
        : finding.publicationCount <= 5
          ? "1-5"
          : finding.publicationCount <= 20
            ? "6-20"
            : "21+",
    magnitude: finding.magnitude,
    sourcePageKey: finding.pageKey,
    sourcePageUrl: finding.pageUrl,
    coverage: "full",
    tone: finding.repute === "bad" ? "caution" : finding.repute === "good" ? "good" : "neutral",
    sort: {
      severity:
        finding.category === "medical"
          ? finding.repute === "bad"
            ? 90
            : 65
          : finding.category === "drug"
            ? 68
            : 38,
      evidence: 0,
      alphabetical: finding.pageTitle.toLowerCase(),
      publications: finding.publicationCount,
    },
    confidenceNote: "This SNPedia entry was matched locally from the bundled evidence pack.",
    disclaimer:
      "Supplementary reference only. SNPedia content is informational and should not be used alone for diagnosis or treatment.",
  }));
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
          "This finding came from DeaNA's bundled evidence database, so it can be matched locally without sending marker requests.",
        genotypeSummary: localEvidenceGenotypeSummary(match),
        matchedMarkers: match.matchedMarkers,
        genes: record.genes,
        topics: record.topics ?? [],
        conditions: record.conditions ?? [],
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
        sourceNotes: [
          `${sourceName}: ${record.release}.`,
          ...(record.technicalName ? [`Technical source name: ${record.technicalName}.`] : []),
          ...(record.magnitude !== undefined && record.magnitude !== null ? [`SNPedia magnitude: ${record.magnitude}.`] : []),
          ...record.notes,
          ...record.pmids.map((pmid) => `PubMed PMID ${pmid}`),
        ],
        evidenceTier: record.evidenceLevel,
        clinicalSignificance: record.clinicalSignificance,
        repute: record.repute ?? "not-set",
        publicationCount,
        publicationBucket: publicationBucket(publicationCount),
        frequencyNote: record.frequencyNote,
        sourcePageKey: record.id,
        sourcePageUrl: record.url,
        coverage: "full",
        tone: record.tone ?? "neutral",
        sort: {
          severity:
            category === "medical"
              ? record.repute === "bad"
                ? 82
                : 62
              : category === "drug"
                ? 66
                : 34,
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

function normalizeSupplements(supplements?: ProfileSupplements | SnpediaSupplement): ProfileSupplements | undefined {
  if (!supplements) return undefined;
  if ("matchedFindings" in supplements) {
    return { snpedia: supplements };
  }
  return supplements;
}

export function generateReport(dna: ParsedDnaFile, supplementsInput?: ProfileSupplements | SnpediaSupplement): ReportData {
  const supplements = normalizeSupplements(supplementsInput);
  const evidenceSupplement: EvidenceSupplement | undefined = supplements?.evidence;
  const snpediaSupplement = supplements?.snpedia;
  const map = markerMap(dna.markers);
  const curatedEntries = EVIDENCE_DEFINITIONS.map((definition) =>
    createEntryFromDefinition(definition, map, evidenceSupplement),
  );
  const localEvidenceEntries = createLocalEvidenceEntries(evidenceSupplement);
  const snpediaEntries = createSnpediaEntries(snpediaSupplement);
  const entries = [...curatedEntries, ...localEvidenceEntries, ...snpediaEntries];
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
      snpediaStatus: snpediaSupplement?.status ?? "idle",
      snpediaProcessedRsids: snpediaSupplement?.processedRsids ?? 0,
      snpediaTotalRsids: snpediaSupplement?.totalRsids ?? dna.markerCount,
      snpediaMatchedFindings: snpediaSupplement?.matchedFindings.length ?? 0,
      snpediaUnmatchedRsids: snpediaSupplement?.unmatchedRsids ?? 0,
      snpediaFailedRsids: snpediaSupplement?.failedItems.length ?? 0,
    },
    tabs: buildTabs(entries),
    entries,
    facets: buildFacets(entries),
  };
}
