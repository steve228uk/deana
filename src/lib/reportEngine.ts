import { EVIDENCE_DEFINITIONS, EVIDENCE_PACK_VERSION, createEntryFromDefinition } from "./evidencePack";
import {
  CompactMarker,
  CoverageStatus,
  EvidenceTier,
  ParsedDnaFile,
  ReportData,
  ReportEntry,
  ReportFacets,
  SnpediaSupplement,
  TabSummary,
} from "../types";

export const REPORT_VERSION = 2;

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

function buildWarnings(entries: ReportEntry[], supplement?: SnpediaSupplement): string[] {
  const warnings = [
    "DeaNA is informational and built from consumer-array data, not diagnostic sequencing.",
  ];

  if (entries.some((entry) => entry.category === "drug")) {
    warnings.push("Drug-response entries are preview-only unless full pharmacogene coverage is available.");
  }

  if (entries.some((entry) => entry.coverage !== "full")) {
    warnings.push("Some findings are limited by missing chip markers, so absence of a hit is not absence of risk.");
  }

  if (supplement?.status === "partial" || supplement?.status === "failed") {
    warnings.push("Some SNPedia lookups failed, so this report may be incomplete until you retry enrichment.");
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
      tab: "raw",
      label: "Raw Markers",
      description: "Direct rsID lookup with links back into curated entries where DeaNA has interpretation context.",
      count: 0,
    },
  ];
}

function createSnpediaEntries(supplement?: SnpediaSupplement): ReportEntry[] {
  if (!supplement) return [];

  return supplement.matchedFindings.map((finding) => ({
    id: finding.id,
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
      "Fetched live from SNPedia using the uploaded rsID and genotype where available.",
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
    confidenceNote: "This SNPedia entry was generated from the uploaded raw marker and cached locally after lookup.",
    disclaimer:
      "Supplementary reference only. SNPedia content is informational and should not be used alone for diagnosis or treatment.",
  }));
}

export function generateReport(dna: ParsedDnaFile, supplement?: SnpediaSupplement): ReportData {
  const map = markerMap(dna.markers);
  const curatedEntries = EVIDENCE_DEFINITIONS.map((definition) => createEntryFromDefinition(definition, map));
  const snpediaEntries = createSnpediaEntries(supplement);
  const entries = [...curatedEntries, ...snpediaEntries];
  const curatedMarkerMatches = curatedEntries.flatMap((entry) => entry.matchedMarkers).filter((marker) => marker.genotype).length;
  const totalTrackedMarkers = curatedEntries.flatMap((entry) => entry.matchedMarkers).length;
  const coverageScore = totalTrackedMarkers === 0 ? 0 : Math.round((curatedMarkerMatches / totalTrackedMarkers) * 100);

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
      warnings: buildWarnings(entries, supplement),
      snpediaStatus: supplement?.status ?? "idle",
      snpediaProcessedRsids: supplement?.processedRsids ?? 0,
      snpediaTotalRsids: supplement?.totalRsids ?? dna.markerCount,
      snpediaMatchedFindings: supplement?.matchedFindings.length ?? 0,
      snpediaUnmatchedRsids: supplement?.unmatchedRsids ?? 0,
      snpediaFailedRsids: supplement?.failedItems.length ?? 0,
    },
    tabs: buildTabs(entries),
    entries,
    facets: buildFacets(entries),
  };
}
