import {
  CompactMarker,
  CoverageStatus,
  EvidenceSource,
  EvidencePackMatch,
  EvidenceSupplement,
  EvidenceTier,
  InsightCategory,
  InsightTone,
  MatchedMarker,
  ReputeStatus,
  ReportEntry,
} from "../types";
import { normalizeClinicalSignificance } from "./normalization";
import { calculateFindingRank, evidenceTierSortValue } from "./ranking";
export const EVIDENCE_PACK_VERSION = "2026-05-core-3";

export const SOURCE_LIBRARY: Record<string, EvidenceSource> = {
  clinvar: {
    id: "clinvar",
    name: "ClinVar",
    url: "https://www.ncbi.nlm.nih.gov/clinvar/",
    citation: "NCBI ClinVar",
    evidenceNote: "Primary clinical interpretation source for medically relevant variants.",
    populationNote: "Clinical submissions can reflect varied cohorts and labs; evidence quality is not uniform.",
    chipCaveat: "Consumer SNP arrays can miss clinically relevant variants outside the assayed markers.",
    disclaimer: "Informational only. Do not use this result alone for diagnosis or treatment decisions.",
  },
  cpic: {
    id: "cpic",
    name: "CPIC",
    url: "https://cpicpgx.org/guidelines/",
    citation: "Clinical Pharmacogenetics Implementation Consortium",
    evidenceNote: "Best-used public guideline source for genotype-guided prescribing context.",
    populationNote: "Drug-response translation varies by ancestry and by which alleles a chip actually covers.",
    chipCaveat: "Consumer arrays usually provide incomplete pharmacogene coverage and limited haplotype resolution.",
    disclaimer: "Preview only. Never change medicines without clinical review and confirmatory testing.",
  },
  gwas: {
    id: "gwas",
    name: "GWAS Catalog",
    url: "https://www.ebi.ac.uk/gwas/",
    citation: "NHGRI-EBI GWAS Catalog",
    evidenceNote: "Curated trait-association source for common-variant findings.",
    populationNote: "Association strength and transferability vary substantially across ancestry groups.",
    chipCaveat: "A single assayed SNP is often only one contributor to a polygenic trait.",
    disclaimer: "Association is not diagnosis. Treat this as a tendency signal, not a certainty.",
  },
  gnomad: {
    id: "gnomad",
    name: "gnomAD",
    url: "https://gnomad.broadinstitute.org/",
    citation: "Genome Aggregation Database",
    evidenceNote: "Population frequency context helps distinguish common from relatively rare findings.",
    populationNote: "Frequencies differ by ancestry group and cohort composition.",
    chipCaveat: "Frequency context is supportive metadata, not an interpretation on its own.",
    disclaimer: "Population frequency does not measure your personal outcome risk.",
  },
  snpedia: {
    id: "snpedia",
    name: "SNPedia",
    url: "https://www.snpedia.com/",
    citation: "SNPedia reference pages",
    evidenceNote: "Useful explanatory layer for consumer-facing context and genotype pages.",
    populationNote: "Coverage and wording quality vary; use as supporting context rather than primary authority.",
    chipCaveat: "Consumer-friendly summaries can oversimplify clinical nuance.",
    disclaimer: "Supplementary reference only; Deana does not treat SNPedia as a primary clinical source.",
  },
  pharmgkb: {
    id: "pharmgkb",
    name: "PharmGKB",
    url: "https://www.pharmgkb.org/",
    citation: "Pharmacogenomics Knowledge Base",
    evidenceNote: "Curated pharmacogenomic evidence with clinical annotation levels 1A–2B backed by expert review.",
    populationNote: "Drug-response associations can vary by ancestry and by which alleles a chip covers.",
    chipCaveat: "Consumer arrays may miss pharmacogenomically relevant variants and haplotypes.",
    disclaimer: "Preview only. Medication decisions require clinical pharmacogenomic review and testing.",
  },
  clingen: {
    id: "clingen",
    name: "ClinGen",
    url: "https://clinicalgenome.org/",
    citation: "Clinical Genome Resource",
    evidenceNote: "Expert-curated gene-disease validity classifications backed by systematic evidence review.",
    populationNote: "Gene-disease classifications are based on published literature and may not reflect all populations.",
    chipCaveat: "Consumer arrays cover only a subset of variants in any given gene.",
    disclaimer: "Informational only. Gene-disease validity classifications do not replace diagnostic genetic testing.",
  },
  pubmed: {
    id: "pubmed",
    name: "PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov/",
    citation: "PubMed-indexed literature",
    evidenceNote: "Adds literature context beyond the structured primary source.",
    populationNote: "Study sizes and cohorts vary widely, so findings should be contextualized.",
    chipCaveat: "Published associations do not guarantee reliable interpretation from a consumer array.",
    disclaimer: "Research context only; not a medical recommendation.",
  },
};

type MarkerMap = Map<string, CompactMarker>;

export interface GenericDefinitionParams {
  id: string;
  rsid: string;
  gene: string;
  riskAllele: string | null;
  category: InsightCategory;
  subcategory: string;
  title: string;
  riskSummary: string;
  topics: string[];
  conditions: string[];
  evidenceTier: EvidenceTier;
  clinicalSignificance: string | null;
  repute: ReputeStatus;
  publicationCount: number;
  sourceIds: string[];
  frequencyNote?: string;
}

export function makeGenericDefinition(p: GenericDefinitionParams): EvidenceDefinition {
  return {
    id: p.id,
    category: p.category,
    subcategory: p.subcategory,
    title: p.title,
    markerIds: [p.rsid],
    genes: p.gene ? [p.gene] : [],
    topics: p.topics,
    conditions: p.conditions,
    evidenceTier: p.evidenceTier,
    clinicalSignificance: p.clinicalSignificance,
    repute: p.repute,
    publicationCount: p.publicationCount,
    sourceIds: p.sourceIds,
    frequencyNote: p.frequencyNote,
    evaluate: (map) => {
      const markers = [readMarker(map, p.rsid, p.gene || undefined)];
      const genotype = markers[0].genotype;
      const riskCount =
        p.riskAllele && genotype
          ? [...genotype].filter((a) => a === p.riskAllele).length
          : null;
      const tone: InsightTone =
        riskCount !== null && riskCount > 0 && p.repute === "bad"
          ? "caution"
          : riskCount !== null && riskCount > 0 && p.repute === "good"
            ? "good"
            : "neutral";
      const summary =
        genotype === null
          ? `This upload did not include the ${p.rsid} marker.`
          : riskCount === 0
            ? `No risk allele detected at ${p.rsid}.`
            : riskCount === 1
              ? `One copy of the risk allele detected. ${p.riskSummary}.`
              : riskCount === 2
                ? `Two copies of the risk allele detected. ${p.riskSummary}.`
                : `${p.rsid} present (${genotype}). ${p.riskSummary}.`;
      return {
        tone,
        coverage: coverageFrom(markers),
        summary,
        detail: p.riskSummary,
        whyItMatters: `${p.gene || p.rsid} is one of the better-characterised loci for ${p.conditions[0] ?? p.title}.`,
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "This finding came from an automatically ingested source; interpret alongside clinical context.",
          "Consumer array coverage may not capture all relevant variants at this locus.",
        ],
        confidenceNote:
          genotype === null
            ? `The ${p.rsid} marker was not present in this upload.`
            : `The ${p.rsid} marker was present.`,
      };
    },
  };
}

export interface EvidenceDefinition {
  id: string;
  category: InsightCategory;
  subcategory: string;
  title: string;
  markerIds: string[];
  genes: string[];
  topics: string[];
  conditions: string[];
  evidenceTier: EvidenceTier;
  clinicalSignificance: string | null;
  repute: ReputeStatus;
  publicationCount: number;
  sourceIds: string[];
  frequencyNote?: string;
  evaluate: (map: MarkerMap) => {
    tone: InsightTone;
    coverage: CoverageStatus;
    summary: string;
    detail: string;
    whyItMatters: string;
    genotypeSummary: string;
    matchedMarkers: MatchedMarker[];
    warnings: string[];
    confidenceNote: string;
  };
}

function canonicalGenotype(genotype: string | null): string | null {
  if (!genotype || genotype === "--") return null;
  if (/^[ACGT]{2}$/i.test(genotype)) {
    return genotype.toUpperCase().split("").sort().join("");
  }
  return genotype.toUpperCase();
}

function readMarker(map: MarkerMap, rsid: string, gene?: string): MatchedMarker {
  const hit = map.get(rsid);
  return {
    rsid,
    genotype: canonicalGenotype(hit?.[3] ?? null),
    chromosome: hit?.[1] ?? null,
    position: hit?.[2] ?? null,
    gene,
  };
}

function markerPresent(marker: MatchedMarker): boolean {
  return Boolean(marker.genotype);
}

function coverageFrom(markers: MatchedMarker[]): CoverageStatus {
  const found = markers.filter(markerPresent).length;
  if (found === 0) return "missing";
  if (found === markers.length) return "full";
  return "partial";
}

function summaryList(markers: MatchedMarker[]): string {
  return markers
    .map((marker) => `${marker.rsid} ${marker.genotype ?? "not found"}`)
    .join(" • ");
}

function sourceEntries(sourceIds: string[], matches: EvidencePackMatch[] = []): ReportEntry["sources"] {
  const recordSources = matches.map(({ record }) => {
    const source = SOURCE_LIBRARY[record.sourceId];
    const recordUrl = record.url.trim();
    return {
      id: source?.id ?? record.sourceId,
      name: source?.name ?? record.sourceId,
      url: recordUrl || source?.url || "",
    };
  });
  if (recordSources.length > 0) {
    return Array.from(
      new Map(recordSources.map((source) => [`${source.id}:${source.url}`, source])).values(),
    );
  }

  return sourceIds.map((sourceId) => {
    const source = SOURCE_LIBRARY[sourceId];
    return {
      id: source.id,
      name: source.name,
      url: source.url,
    };
  });
}

function sourceNotes(sourceIds: string[], matches: EvidencePackMatch[] = []): string[] {
  const libraryNotes = sourceIds.flatMap((sourceId) => {
    const source = SOURCE_LIBRARY[sourceId];
    return [source.evidenceNote, source.populationNote, source.chipCaveat];
  });
  const recordNotes = matches.flatMap(({ record }) => [
    `${SOURCE_LIBRARY[record.sourceId]?.name ?? record.sourceId}: ${record.title}.`,
    ...record.notes,
    ...record.pmids.map((pmid) => `PubMed PMID ${pmid}`),
  ]);

  return Array.from(new Set([...libraryNotes, ...recordNotes]));
}

function combinedDisclaimer(sourceIds: string[]): string {
  return Array.from(new Set(sourceIds.map((sourceId) => SOURCE_LIBRARY[sourceId].disclaimer))).join(" ");
}

function outcomeFromEvaluation(evaluation: ReturnType<EvidenceDefinition["evaluate"]>): ReportEntry["outcome"] {
  if (evaluation.coverage === "missing" || (evaluation.coverage === "partial" && evaluation.tone === "neutral")) return "missing";
  if (evaluation.tone === "caution") return "negative";
  if (evaluation.tone === "good") return "positive";
  return "informational";
}

function severityForDefinition(
  definition: EvidenceDefinition,
  evaluation: ReturnType<EvidenceDefinition["evaluate"]>,
): number {
  const outcome = outcomeFromEvaluation(evaluation);
  if (outcome === "missing") return 5;
  if (outcome === "positive") return definition.category === "medical" ? 22 : 18;
  if (outcome === "informational") return definition.category === "drug" ? 34 : definition.category === "medical" ? 30 : 24;

  if (definition.category === "medical") {
    return definition.repute === "bad" ? 100 : definition.repute === "mixed" ? 80 : 60;
  }

  return definition.category === "drug" ? 70 : 40;
}

export const EVIDENCE_DEFINITIONS: EvidenceDefinition[] = [
  {
    id: "medical-apoe",
    category: "medical",
    subcategory: "neurology",
    title: "APOE / late-onset Alzheimer’s context",
    markerIds: ["rs429358", "rs7412"],
    genes: ["APOE"],
    topics: ["Memory", "Neuro"],
    conditions: ["Late-onset Alzheimer disease"],
    evidenceTier: "high",
    clinicalSignificance: "risk-context",
    repute: "bad",
    publicationCount: 120,
    sourceIds: ["clinvar", "pubmed", "gnomad"],
    frequencyNote: "APOE e4 is common enough to appear in many populations, but impact differs by ancestry and family context.",
    evaluate: (map) => {
      const markers = [readMarker(map, "rs429358", "APOE"), readMarker(map, "rs7412", "APOE")];
      const coverage = coverageFrom(markers);
      const apoe429358 = markers[0].genotype;
      const apoe7412 = markers[1].genotype;

      let tone: InsightTone = "neutral";
      let summary = "APOE status could not be resolved from the uploaded markers.";
      let detail =
        "This result is context, not a diagnosis. APOE explains only one part of late-onset Alzheimer’s risk.";
      let whyItMatters =
        "APOE is one of the most clinically discussed common marker pairs in consumer DNA data, but it should be interpreted alongside age, family history, and lifestyle.";
      let confidenceNote =
        coverage === "full"
          ? "Both APOE markers needed for the common consumer-array interpretation were present."
          : "One or both APOE markers were missing, so Deana cannot provide a confident common-pattern read.";

      if (coverage === "full") {
        if (apoe429358 === "TT" && apoe7412 === "CC") {
          summary = "Pattern is consistent with APOE e3/e3, the most common baseline combination.";
        } else if (apoe429358 === "CT" && apoe7412 === "CC") {
          summary = "Pattern is consistent with one APOE e4 allele, which is associated with higher late-onset Alzheimer’s risk.";
          tone = "caution";
        } else if (apoe429358 === "CC" && apoe7412 === "CC") {
          summary = "Pattern is consistent with APOE e4/e4, which carries substantially higher late-onset Alzheimer’s risk in many studies.";
          tone = "caution";
        } else if (apoe429358 === "TT" && apoe7412 === "CT") {
          summary = "Pattern is consistent with APOE e2/e3, often discussed as a lower-risk configuration for late-onset Alzheimer’s disease.";
          tone = "good";
        } else {
          summary = "APOE markers were present, but the unphased combination is ambiguous and should be treated carefully.";
        }
      }

      return {
        tone,
        coverage,
        summary,
        detail,
        whyItMatters,
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "APOE should never be treated as a stand-alone prediction.",
          "Consumer-array interpretation does not replace clinical counseling or confirmatory testing.",
        ],
        confidenceNote,
      };
    },
  },
  {
    id: "medical-factor-v",
    category: "medical",
    subcategory: "clotting",
    title: "Factor V Leiden",
    markerIds: ["rs6025"],
    genes: ["F5"],
    topics: ["Clotting"],
    conditions: ["Venous thromboembolism"],
    evidenceTier: "high",
    clinicalSignificance: "risk-variant",
    repute: "bad",
    publicationCount: 85,
    sourceIds: ["clinvar", "gnomad"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs6025", "F5")];
      const genotype = markers[0].genotype;
      // Risk allele is A on the plus strand (GRCh38 ALT) or T on the minus strand
      // (how AncestryDNA/23andMe report this SNP). Count either to get allele count.
      const riskCount = genotype ? [...genotype].filter((a) => a === "A" || a === "T").length : 0;
      return {
        tone: riskCount > 0 ? "caution" : "good",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "Factor V Leiden was not covered by this file."
            : riskCount === 0
              ? "No Leiden allele was detected at this marker."
              : riskCount === 1
                ? "One Leiden allele is present, which is associated with elevated venous thrombosis risk."
                : "Two Leiden alleles are present, which is associated with substantially elevated thrombosis risk.",
        detail:
          "This is one of the clearer consumer-array medical markers, but overall clotting risk still depends on medical history, hormones, surgery, pregnancy, and other factors.",
        whyItMatters:
          "Factor V Leiden is a clinically recognized common thrombophilia marker that often appears in direct-to-consumer arrays.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "Absence of this marker does not rule out clotting disorders.",
          "Confirmatory testing is appropriate before any clinical action.",
        ],
        confidenceNote:
          genotype === null
            ? "The key Factor V Leiden marker was not present in the uploaded chip data."
            : "The main Factor V Leiden marker was present in the uploaded chip data.",
      };
    },
  },
  {
    id: "medical-prothrombin",
    category: "medical",
    subcategory: "clotting",
    title: "Prothrombin G20210A",
    markerIds: ["rs1799963"],
    genes: ["F2"],
    topics: ["Clotting"],
    conditions: ["Inherited thrombophilia"],
    evidenceTier: "high",
    clinicalSignificance: "risk-variant",
    repute: "bad",
    publicationCount: 60,
    sourceIds: ["clinvar", "gnomad"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs1799963", "F2")];
      const genotype = markers[0].genotype;
      // Risk allele is A on the plus strand or T on the minus strand (consumer array reporting)
      const riskCount = genotype ? [...genotype].filter((a) => a === "A" || a === "T").length : 0;
      return {
        tone: riskCount > 0 ? "caution" : "good",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "This upload did not include the main prothrombin thrombophilia marker."
            : riskCount === 0
              ? "No risk allele was detected at this marker."
              : riskCount === 1
                ? "One risk allele is present, which is associated with elevated clotting risk."
                : "Two risk alleles are present. This is uncommon and should be treated as clinically significant until confirmed.",
        detail:
          "Prothrombin G20210A is commonly discussed alongside Factor V Leiden in clotting risk context, but chip data alone is still incomplete.",
        whyItMatters:
          "This marker is a clinically recognized thrombophilia signal that pairs well with conservative evidence-first reporting.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "Do not interpret this without personal and family history.",
          "Consumer-array results should be clinically confirmed.",
        ],
        confidenceNote:
          genotype === null
            ? "The main prothrombin marker was missing from this upload."
            : "The main prothrombin marker was present in this upload.",
      };
    },
  },
  {
    id: "medical-hfe",
    category: "medical",
    subcategory: "metabolic",
    title: "Hereditary haemochromatosis screen",
    markerIds: ["rs1800562", "rs1799945"],
    genes: ["HFE"],
    topics: ["Iron metabolism"],
    conditions: ["Hereditary haemochromatosis"],
    evidenceTier: "moderate",
    clinicalSignificance: "carrier-style-screen",
    repute: "mixed",
    publicationCount: 45,
    sourceIds: ["clinvar", "gnomad"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs1800562", "HFE"), readMarker(map, "rs1799945", "HFE")];
      const c282y = markers[0].genotype;
      const h63d = markers[1].genotype;
      const riskHit =
        c282y === "AA" || c282y === "AG" || h63d === "CG" || h63d === "GG";

      return {
        tone: riskHit ? "caution" : "good",
        coverage: coverageFrom(markers),
        summary:
          c282y || h63d
            ? `HFE markers were present. C282Y: ${c282y ?? "not tested"}, H63D: ${h63d ?? "not tested"}.`
            : "This upload did not include the common HFE markers used for a consumer-array haemochromatosis screen.",
        detail:
          "This is a limited array-based look at two common HFE variants. It cannot rule out iron overload or replace ferritin and transferrin-saturation testing.",
        whyItMatters:
          "These two HFE markers are among the few carrier-style findings consumer arrays can sometimes surface reasonably well.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "This is not a full haemochromatosis workup.",
          "Normal chip findings do not exclude iron overload or other HFE variants.",
        ],
        confidenceNote:
          coverageFrom(markers) === "missing"
            ? "Neither of the common HFE markers was available in the upload."
            : "One or both of the common HFE markers were available, which supports a limited screen only.",
      };
    },
  },
  {
    id: "medical-mthfr",
    category: "medical",
    subcategory: "metabolism",
    title: "MTHFR C677T",
    markerIds: ["rs1801133"],
    genes: ["MTHFR"],
    topics: ["Folate metabolism"],
    conditions: ["Homocysteine context"],
    evidenceTier: "moderate",
    clinicalSignificance: "enzyme-activity-context",
    repute: "mixed",
    publicationCount: 70,
    sourceIds: ["clinvar", "gwas", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs1801133", "MTHFR")];
      const genotype = markers[0].genotype;
      return {
        tone: genotype === "TT" ? "caution" : genotype === "CT" ? "neutral" : "good",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "This upload did not include the main MTHFR C677T marker."
            : genotype === "TT"
              ? "Two copies of the T allele are present, which is associated with meaningfully reduced MTHFR enzyme activity."
              : genotype === "CT"
                ? "One T allele is present, which is associated with moderately reduced enzyme activity."
                : "No T alleles were detected at this marker.",
        detail:
          "MTHFR is widely discussed online, often without enough nuance. Deana treats it as one biochemical input rather than a stand-alone medical explanation.",
        whyItMatters:
          "This marker is common in consumer DNA discussion, but trustworthy UX depends on explicitly avoiding overclaiming.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "MTHFR alone should not be used to explain broad symptoms or disease.",
          "Biochemical follow-up matters more than chip data if clinical concern exists.",
        ],
        confidenceNote:
          genotype === null
            ? "The single common MTHFR marker Deana uses was not present."
            : "The single common MTHFR marker Deana uses was present.",
      };
    },
  },
  {
    id: "trait-eye-colour",
    category: "traits",
    subcategory: "appearance",
    title: "Eye colour tendency",
    markerIds: ["rs12913832"],
    genes: ["HERC2", "OCA2"],
    topics: ["Appearance"],
    conditions: [],
    evidenceTier: "high",
    clinicalSignificance: "trait-association",
    repute: "not-set",
    publicationCount: 40,
    sourceIds: ["gwas", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs12913832", "HERC2")];
      const genotype = markers[0].genotype;
      return {
        tone: "neutral",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "This upload did not include the strongest common HERC2 eye-colour marker."
            : genotype === "GG"
              ? "Pattern is consistent with a stronger blue or lighter-eye tendency."
              : genotype === "AG"
                ? "Pattern suggests an intermediate eye-colour tendency."
                : "Pattern is consistent with a stronger brown-eye tendency.",
        detail:
          "Eye colour is polygenic, but rs12913832 is one of the most informative common markers on consumer arrays.",
        whyItMatters:
          "This is a high-signal, low-stakes trait card that demonstrates how Deana handles common-variant evidence cleanly.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: ["Trait tendency only; many other loci contribute to real-world eye colour."],
        confidenceNote:
          genotype === null
            ? "The strongest common eye-colour marker was missing."
            : "The strongest common eye-colour marker used here was present.",
      };
    },
  },
  {
    id: "trait-lactase",
    category: "traits",
    subcategory: "digestion",
    title: "Lactose tolerance",
    markerIds: ["rs4988235"],
    genes: ["MCM6", "LCT"],
    topics: ["Digestion"],
    conditions: [],
    evidenceTier: "high",
    clinicalSignificance: "trait-association",
    repute: "good",
    publicationCount: 55,
    sourceIds: ["gwas", "gnomad"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs4988235", "MCM6")];
      const genotype = markers[0].genotype;
      return {
        tone: genotype === "TT" || genotype === "CT" ? "good" : "neutral",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "The common lactase-persistence marker was not found in this file."
            : genotype === "TT" || genotype === "CT"
              ? "At least one persistence allele is present, which is often associated with better lactose tolerance into adulthood."
              : "No persistence allele was detected at this marker, which is often associated with lower adult lactose tolerance.",
        detail:
          "This is one of the cleaner consumer-DNA trait examples, but real-world tolerance still depends on diet, microbiome, and symptoms.",
        whyItMatters:
          "It is a good example of a common trait marker with a relatively strong and well-understood signal.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: ["Genetics is only one part of lactose tolerance."],
        confidenceNote:
          genotype === null
            ? "The main lactase-persistence marker was missing."
            : "The main lactase-persistence marker was present.",
      };
    },
  },
  {
    id: "trait-caffeine",
    category: "traits",
    subcategory: "lifestyle",
    title: "Caffeine metabolism",
    markerIds: ["rs762551"],
    genes: ["CYP1A2"],
    topics: ["Lifestyle", "Sleep"],
    conditions: [],
    evidenceTier: "moderate",
    clinicalSignificance: "trait-association",
    repute: "mixed",
    publicationCount: 30,
    sourceIds: ["gwas", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs762551", "CYP1A2")];
      const genotype = markers[0].genotype;
      return {
        tone: genotype === "CC" ? "caution" : "neutral",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "The CYP1A2 caffeine-metabolism marker was not found in this file."
            : genotype === "AA"
              ? "Pattern is consistent with faster caffeine clearance."
              : genotype === "AC"
                ? "Pattern suggests mid-range caffeine metabolism."
                : "Pattern is consistent with slower caffeine clearance, which can mean stronger or longer-lasting effects.",
        detail:
          "Coffee tolerance is personal, but this marker is one of the more useful lifestyle cards for timing and dose awareness.",
        whyItMatters:
          "This is a recognizable lifestyle example with enough evidence to be useful while still requiring careful wording.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: ["Use lived experience over genotype when adjusting caffeine intake."],
        confidenceNote:
          genotype === null
            ? "The caffeine-metabolism marker was missing."
            : "The caffeine-metabolism marker was present.",
      };
    },
  },
  {
    id: "trait-actn3",
    category: "traits",
    subcategory: "performance",
    title: "Power vs endurance bias",
    markerIds: ["rs1815739"],
    genes: ["ACTN3"],
    topics: ["Performance"],
    conditions: [],
    evidenceTier: "emerging",
    clinicalSignificance: "trait-association",
    repute: "not-set",
    publicationCount: 25,
    sourceIds: ["gwas", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs1815739", "ACTN3")];
      const genotype = markers[0].genotype;
      return {
        tone: "neutral",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "ACTN3 R577X was not available in this upload."
            : genotype === "CC"
              ? "Pattern leans toward preserved ACTN3 function, often discussed in power and sprint contexts."
              : genotype === "TT"
                ? "Pattern reflects ACTN3 deficiency, often discussed in endurance adaptation contexts."
                : "Pattern sits in the mixed middle and should be treated as one small input among many.",
        detail:
          "Athletic performance is overwhelmingly shaped by training and physiology. This marker works best as a light-touch tendency card.",
        whyItMatters:
          "This entry stays in the seed pack because it is recognizable and interesting, but Deana labels it as emerging rather than overconfident.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: ["Do not treat this as destiny or a coaching prescription."],
        confidenceNote:
          genotype === null
            ? "The main ACTN3 marker was missing."
            : "The main ACTN3 marker was present, but the trait itself remains multifactorial.",
      };
    },
  },
  {
    id: "drug-cyp2c19",
    category: "drug",
    subcategory: "cardiology",
    title: "CYP2C19 / clopidogrel preview",
    markerIds: ["rs4244285"],
    genes: ["CYP2C19"],
    topics: ["Drug response"],
    conditions: ["Clopidogrel response"],
    evidenceTier: "preview",
    clinicalSignificance: "drug-response",
    repute: "mixed",
    publicationCount: 50,
    sourceIds: ["cpic", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs4244285", "CYP2C19")];
      const genotype = markers[0].genotype;
      return {
        tone: genotype && genotype !== "GG" ? "caution" : "neutral",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "The main CYP2C19 *2 marker was not covered in this file."
            : genotype === "AG" || genotype === "AA"
              ? "At least one reduced-function allele is present, which can matter for clopidogrel activation and some antidepressants or PPIs."
              : "No reduced-function allele was detected at the main CYP2C19 *2 marker.",
        detail:
          "This is a PGx preview, not a full diplotype call. Consumer arrays rarely cover all the alleles needed for confident prescribing guidance.",
        whyItMatters:
          "CYP2C19 is high-value PGx territory, but honest product design means labeling it clearly as preview-only until fuller allele support exists.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "Preview only because this chip does not provide full CYP2C19 haplotype coverage.",
          "Never use this result to change medication without clinician review.",
        ],
        confidenceNote:
          genotype === null
            ? "The one reduced-function marker used for this preview was missing."
            : "One key reduced-function marker was present, but the full pharmacogene picture remains incomplete.",
      };
    },
  },
  {
    id: "drug-warfarin",
    category: "drug",
    subcategory: "cardiology",
    title: "Warfarin sensitivity preview",
    markerIds: ["rs1057910", "rs9923231"],
    genes: ["CYP2C9", "VKORC1"],
    topics: ["Drug response"],
    conditions: ["Warfarin dosing"],
    evidenceTier: "preview",
    clinicalSignificance: "drug-response",
    repute: "mixed",
    publicationCount: 55,
    sourceIds: ["cpic", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs1057910", "CYP2C9"), readMarker(map, "rs9923231", "VKORC1")];
      const cyp2c9 = markers[0].genotype;
      const vkorc1 = markers[1].genotype;
      return {
        tone: (cyp2c9 && cyp2c9 !== "AA") || (vkorc1 && vkorc1 !== "CC") ? "caution" : "neutral",
        coverage: coverageFrom(markers),
        summary:
          cyp2c9 || vkorc1
            ? `Markers present: CYP2C9 rs1057910 ${cyp2c9 ?? "not tested"}, VKORC1 rs9923231 ${vkorc1 ?? "not tested"}.`
            : "The common warfarin-sensitivity preview markers were not available in this upload.",
        detail:
          "Warfarin is one of the better-known PGx examples, but dosing decisions need full clinical context and formal testing.",
        whyItMatters:
          "This preview shows why Deana needs a distinct drug-response tab and stronger caveats than lifestyle traits.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "Preview only; missing alleles and non-genetic factors still matter.",
          "Do not use this to self-adjust anticoagulant therapy.",
        ],
        confidenceNote:
          coverageFrom(markers) === "missing"
            ? "Neither preview marker was available."
            : "One or both preview markers were available, but they are not enough for dosing decisions.",
      };
    },
  },
  {
    id: "drug-slco1b1",
    category: "drug",
    subcategory: "lipids",
    title: "SLCO1B1 / statin muscle-side-effect preview",
    markerIds: ["rs4149056"],
    genes: ["SLCO1B1"],
    topics: ["Drug response"],
    conditions: ["Simvastatin myopathy risk"],
    evidenceTier: "preview",
    clinicalSignificance: "drug-response",
    repute: "mixed",
    publicationCount: 35,
    sourceIds: ["cpic", "pubmed"],
    evaluate: (map) => {
      const markers = [readMarker(map, "rs4149056", "SLCO1B1")];
      const genotype = markers[0].genotype;
      return {
        tone: genotype && genotype !== "TT" ? "caution" : "neutral",
        coverage: coverageFrom(markers),
        summary:
          genotype === null
            ? "The SLCO1B1 marker was not included in this upload."
            : genotype === "CT" || genotype === "CC"
              ? "A decreased-function allele is present, which can be associated with higher simvastatin-related muscle-side-effect risk."
              : "No decreased-function allele was detected at the main SLCO1B1 preview marker.",
        detail:
          "This is a narrow pharmacogenomic preview. It is useful context, but not a substitute for a formal PGx panel.",
        whyItMatters:
          "It is a good example of how Deana can surface high-value PGx context without pretending consumer-array data is complete.",
        genotypeSummary: summaryList(markers),
        matchedMarkers: markers,
        warnings: [
          "Preview only; drug choice and dose belong in clinical care.",
          "A single marker does not cover all statin safety considerations.",
        ],
        confidenceNote:
          genotype === null
            ? "The key SLCO1B1 preview marker was missing."
            : "The key SLCO1B1 preview marker was present, but the interpretation remains limited.",
      };
    },
  },
];

export function createEntryFromDefinition(
  definition: EvidenceDefinition,
  map: MarkerMap,
  evidence?: EvidenceSupplement,
): ReportEntry {
  const evaluation = definition.evaluate(map);
  const outcome = outcomeFromEvaluation(evaluation);
  const evidenceMatches =
    evidence?.status === "complete"
      ? evidence.matchedRecords.filter((match) => match.record.entryId === definition.id)
      : [];
  const publicationCount = Math.max(
    definition.publicationCount,
    new Set(evidenceMatches.flatMap((match) => match.record.pmids)).size,
  );
  const frequencyNote =
    evidenceMatches.map((match) => match.record.frequencyNote).find(Boolean) ?? definition.frequencyNote;
  const normalizedClinicalSignificance = normalizeClinicalSignificance(definition.clinicalSignificance);
  const clinvarStars = Math.max(0, ...evidenceMatches.map((match) => match.record.clinvarStars ?? 0));
  const clinvarReviewStatus = evidenceMatches.map((match) => match.record.clinvarReviewStatus).find(Boolean);
  const clingenClassification = evidenceMatches.map((match) => match.record.clingenClassification).find(Boolean);
  const pharmgkbLevel = evidenceMatches.map((match) => match.record.pharmgkbLevel).find(Boolean);
  const cpicLevel = evidenceMatches.map((match) => match.record.cpicLevel).find(Boolean);
  const cpicLevelStatus = evidenceMatches.map((match) => match.record.cpicLevelStatus).find(Boolean);
  const sources = sourceEntries(definition.sourceIds, evidenceMatches);

  return {
    id: definition.id,
    entryKind: "curated",
    category: definition.category,
    subcategory: definition.subcategory,
    title: definition.title,
    summary: evaluation.summary,
    detail: evaluation.detail,
    whyItMatters: evaluation.whyItMatters,
    genotypeSummary: evaluation.genotypeSummary,
    matchedMarkers: evaluation.matchedMarkers,
    genes: definition.genes,
    topics: definition.topics,
    conditions: definition.conditions,
    warnings: evaluation.warnings,
    sources,
    sourceNotes: sourceNotes(definition.sourceIds, evidenceMatches),
    relatedContexts: [],
    evidenceTier: definition.evidenceTier,
    clinicalSignificance: definition.clinicalSignificance,
    normalizedClinicalSignificance,
    repute: definition.repute,
    publicationCount,
    publicationBucket:
      publicationCount === 0
        ? "0"
        : publicationCount <= 5
          ? "1-5"
          : publicationCount <= 20
            ? "6-20"
            : "21+",
    frequencyNote,
    coverage: evaluation.coverage,
    tone: evaluation.tone,
    outcome,
    sort: {
      rank: calculateFindingRank({
        evidenceTier: definition.evidenceTier,
        outcome,
        repute: definition.repute,
        coverage: evaluation.coverage,
        publicationCount,
        clinvarStars: clinvarStars > 0 ? clinvarStars : undefined,
        clingenClassification,
        pharmgkbLevel,
        cpicLevel,
        cpicLevelStatus,
        clinicalSignificance: definition.clinicalSignificance,
        normalizedClinicalSignificance,
        sources,
        matchedMarkers: evaluation.matchedMarkers,
      }),
      severity: severityForDefinition(definition, evaluation),
      evidence: evidenceTierSortValue(definition.evidenceTier),
      alphabetical: definition.title.toLowerCase(),
      publications: publicationCount,
    },
    confidenceNote: evidenceMatches.length
      ? `${evaluation.confidenceNote} Source context came from local evidence pack ${evidence?.packVersion}.`
      : evaluation.confidenceNote,
    disclaimer: combinedDisclaimer(definition.sourceIds),
    pharmgkbLevel,
    cpicLevel,
    cpicLevelStatus,
    clingenClassification,
    clinvarReviewStatus,
    clinvarStars: clinvarStars > 0 ? clinvarStars : undefined,
  };
}

export function evidenceMarkerGeneMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const definition of EVIDENCE_DEFINITIONS) {
    for (const rsid of definition.markerIds) {
      const genes = map.get(rsid) ?? [];
      for (const gene of definition.genes) {
        if (!genes.includes(gene)) genes.push(gene);
      }
      map.set(rsid, genes);
    }
  }

  return map;
}
