import type { EvidenceTier, MatchedMarker, ReportEntrySource } from "../types";

export interface RankingSignals {
  evidenceTier: unknown;
  outcome: unknown;
  repute: unknown;
  coverage?: unknown;
  publicationCount?: unknown;
  magnitude?: unknown;
  clingenClassification?: unknown;
  pharmgkbLevel?: unknown;
  cpicLevel?: unknown;
  cpicLevelStatus?: unknown;
  clinvarStars?: unknown;
  gwasPValue?: unknown;
  gwasEffect?: unknown;
  gwasHasReplication?: unknown;
  gwasInitialSampleSize?: unknown;
  gwasReplicationSampleSize?: unknown;
  gwasFullSummaryStats?: unknown;
  clinicalSignificance?: unknown;
  normalizedClinicalSignificance?: unknown;
  sources?: Array<Pick<ReportEntrySource, "id" | "name">>;
  matchedMarkers?: Array<Pick<MatchedMarker, "genotype" | "matchedAlleleCount">>;
}

function evidenceScore(evidenceTier: unknown): number {
  switch (evidenceTier) {
    case "high":
      return 130;
    case "moderate":
      return 95;
    case "emerging":
      return 55;
    case "preview":
      return 30;
    case "supplementary":
      return 12;
    default:
      return 0;
  }
}

function evidenceMultiplier(evidenceTier: unknown): number {
  switch (evidenceTier) {
    case "high":
      return 1.12;
    case "moderate":
      return 1.06;
    case "emerging":
      return 1;
    case "preview":
    case "supplementary":
      return 0.92;
    default:
      return 1;
  }
}

function outcomeScore(outcome: unknown): number {
  switch (outcome) {
    case "negative":
      return 95;
    case "positive":
      return 62;
    case "informational":
      return 24;
    case "missing":
      return -120;
    default:
      return 0;
  }
}

function outcomeMultiplier(outcome: unknown): number {
  switch (outcome) {
    case "negative":
      return 1.08;
    case "positive":
      return 1.05;
    case "informational":
      return 0.97;
    case "missing":
      return 0.85;
    default:
      return 1;
  }
}

function reputeScore(repute: unknown): number {
  switch (repute) {
    case "bad":
      return 38;
    case "mixed":
      return 24;
    case "good":
      return 18;
    case "not-set":
    default:
      return 0;
  }
}

function reputeMultiplier(repute: unknown): number {
  switch (repute) {
    case "bad":
      return 1.05;
    case "good":
      return 1.04;
    case "mixed":
      return 1.03;
    case "not-set":
    default:
      return 1;
  }
}

function coverageScore(coverage: unknown): number {
  switch (coverage) {
    case "full":
      return 240;
    case "partial":
      return 105;
    case "missing":
      return -180;
    default:
      return 0;
  }
}

function matchedMarkerScore(markers: RankingSignals["matchedMarkers"]): number {
  if (!markers || markers.length === 0) return 0;

  let presentGenotypes = 0;
  let strongestAlleleCount = 0;

  for (const marker of markers) {
    if (marker.genotype) presentGenotypes += 1;
    strongestAlleleCount = Math.max(
      strongestAlleleCount,
      typeof marker.matchedAlleleCount === "number" ? marker.matchedAlleleCount : 0,
    );
  }

  return Math.min(120, presentGenotypes * 24)
    + (strongestAlleleCount > 0 ? 100 + strongestAlleleCount * 32 : 0);
}

function sourceScore(ids: Set<string>): number {
  let score = 0;

  if (ids.has("clingen")) score += 58;
  if (ids.has("clinvar")) score += 46;
  if (ids.has("cpic")) score += 44;
  if (ids.has("pharmgkb")) score += 38;
  if (ids.has("gwas") || ids.has("gwas catalog")) score += 28;

  return score;
}

function sourceIds(sources: RankingSignals["sources"]): Set<string> {
  return new Set((sources ?? []).flatMap((source) => [source.id, source.name]).map((value) => value.toLowerCase()));
}

function clingenClassificationScore(value: unknown): number {
  const classification = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!classification) return 0;
  if (classification.includes("definitive")) return 58;
  if (classification.includes("strong")) return 46;
  if (classification.includes("moderate")) return 34;
  if (classification.includes("limited")) return 10;
  if (classification.includes("disputed") || classification.includes("refuted")) return -44;
  if (classification.includes("no known")) return -28;
  return 0;
}

function pharmgkbLevelScore(value: unknown): number {
  const level = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!level) return 0;
  if (level.startsWith("1a")) return 54;
  if (level.startsWith("1b")) return 48;
  if (level.startsWith("2a")) return 34;
  if (level.startsWith("2b")) return 28;
  if (level.startsWith("3")) return 12;
  if (level.startsWith("4")) return 0;
  return 0;
}

function clinicalSignificanceScore(...values: unknown[]): number {
  const text = values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (!text) return 0;
  if (text.includes("pathogenic")) return text.includes("likely") ? 56 : 66;
  if (text.includes("risk-variant") || text.includes("risk variant")) return 38;
  if (text.includes("risk-context") || text.includes("risk context")) return 22;
  if (text.includes("conflicting")) return 14;
  if (text.includes("benign")) return -18;
  return 0;
}

function publicationScore(publicationCount: unknown): number {
  if (typeof publicationCount !== "number" || publicationCount <= 0) return 0;
  return Math.min(36, Math.round(Math.log2(publicationCount + 1) * 8));
}

function magnitudeScore(magnitude: unknown): number {
  if (typeof magnitude !== "number" || !Number.isFinite(magnitude) || magnitude <= 0) return 0;
  if (magnitude >= 5) return 72;
  if (magnitude >= 3) return 54;
  if (magnitude >= 2) return 34;
  return 14;
}

function snpediaContextScore(signals: RankingSignals, ids: Set<string>): number {
  if (!ids.has("snpedia") || signals.coverage !== "full") return 0;

  const magnitude = typeof signals.magnitude === "number" && Number.isFinite(signals.magnitude)
    ? signals.magnitude
    : 0;
  const publicationCount = typeof signals.publicationCount === "number" ? signals.publicationCount : 0;
  const hasContextSignal =
    magnitude >= 2 ||
    publicationCount > 0 ||
    signals.repute === "bad" ||
    signals.repute === "mixed";

  return hasContextSignal ? 45 : 0;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedPublicationCount(signals: RankingSignals): number {
  const count = finiteNumber(signals.publicationCount);
  return count === null ? 0 : Math.max(0, Math.floor(count));
}

function snpediaValidityScore(signals: RankingSignals): number {
  const magnitude = finiteNumber(signals.magnitude) ?? 0;
  const publications = normalizedPublicationCount(signals);
  if (magnitude >= 5 && publications >= 2) return 170;
  if (magnitude >= 5 && publications === 1) return 130;
  if (magnitude >= 4 && publications >= 2) return 125;
  if (magnitude >= 3 && publications >= 1) return 96;
  if (magnitude >= 2 && publications >= 1) return 68;
  if (magnitude >= 2) return 48;
  return 0;
}

function clingenValidityScore(signals: RankingSignals): number {
  const classification = typeof signals.clingenClassification === "string"
    ? signals.clingenClassification.trim().toLowerCase()
    : "";
  if (!classification) return 0;

  const publications = normalizedPublicationCount(signals);
  const publicationBoost = Math.min(40, Math.max(0, Math.round(Math.log2(publications + 1) * 10)));
  if (classification.includes("definitive")) return (publications > 5 ? 150 : 118) + publicationBoost;
  if (classification.includes("strong")) return (publications > 3 ? 122 : 96) + publicationBoost;
  if (classification.includes("moderate")) return 74 + Math.min(24, publicationBoost);
  if (classification.includes("limited")) return 26;
  if (classification.includes("disputed") || classification.includes("refuted")) return -78;
  if (classification.includes("no known")) return -44;
  return 0;
}

function clinvarValidityScore(signals: RankingSignals): number {
  const stars = finiteNumber(signals.clinvarStars) ?? 0;
  const publications = normalizedPublicationCount(signals);
  const publicationBoost = Math.min(34, Math.max(0, Math.round(Math.log2(publications + 1) * 9)));
  if (stars >= 4) return 170 + publicationBoost;
  if (stars >= 3 && publications >= 3) return 162 + publicationBoost;
  if (stars >= 3) return 118 + publicationBoost;
  if (stars >= 2) return 76 + Math.min(22, publicationBoost);
  if (stars >= 1) return 34 + Math.min(16, publicationBoost);
  return 0;
}

function parseSampleCount(value: unknown): number {
  if (typeof value !== "string") return 0;
  let total = 0;
  for (const match of value.matchAll(/\d[\d,]*/g)) {
    const count = Number(match[0].replaceAll(",", ""));
    if (Number.isFinite(count)) total += count;
  }
  return total;
}

function gwasValidityScore(signals: RankingSignals): number {
  const pValue = finiteNumber(signals.gwasPValue);
  if (pValue === null || pValue <= 0) return 0;

  const hasReplication = signals.gwasHasReplication === true;
  const effect = finiteNumber(signals.gwasEffect);
  const sampleCount = parseSampleCount(signals.gwasInitialSampleSize) + parseSampleCount(signals.gwasReplicationSampleSize);

  let score = pValue <= 1e-10 ? 82 : pValue <= 5e-8 ? 58 : 0;
  if (hasReplication) score += 34;
  if (effect !== null && effect > 0) score += 20;
  if (sampleCount >= 100000) score += 24;
  else if (sampleCount >= 10000) score += 16;
  else if (sampleCount >= 1000) score += 8;
  if (signals.gwasFullSummaryStats === true) score += 10;

  return Math.min(152, score);
}

function cpicValidityScore(signals: RankingSignals): number {
  const level = typeof signals.cpicLevel === "string" ? signals.cpicLevel.trim().toUpperCase() : "";
  if (!level) return 0;
  const status = typeof signals.cpicLevelStatus === "string" ? signals.cpicLevelStatus.trim().toLowerCase() : "";
  const statusBoost = /final|current|published/.test(status) ? 8 : 0;
  if (level === "A") return 170 + statusBoost;
  if (level === "B") return 124 + statusBoost;
  if (level === "C") return 48;
  if (level === "D") return -12;
  return 0;
}

function pharmgkbValidityScore(signals: RankingSignals): number {
  const level = typeof signals.pharmgkbLevel === "string" ? signals.pharmgkbLevel.trim().toUpperCase() : "";
  if (level === "1A") return 172;
  if (level === "1B") return 154;
  if (level === "2A") return 116;
  if (level === "2B") return 94;
  if (level === "3") return 24;
  if (level === "4") return -8;
  return 0;
}

function sourceValidityScore(signals: RankingSignals, ids: Set<string>): number {
  let score = 0;
  if (ids.has("snpedia")) score += snpediaValidityScore(signals);
  if (ids.has("clingen")) score += clingenValidityScore(signals);
  if (ids.has("clinvar")) score += clinvarValidityScore(signals);
  if (ids.has("gwas") || ids.has("gwas catalog")) score += gwasValidityScore(signals);
  if (ids.has("cpic")) score += cpicValidityScore(signals);
  if (ids.has("pharmgkb")) score += pharmgkbValidityScore(signals);
  return score;
}

export function calculateFindingRank(signals: RankingSignals): number {
  const ids = sourceIds(signals.sources);
  const score =
    1_000
    + coverageScore(signals.coverage)
    + matchedMarkerScore(signals.matchedMarkers)
    + outcomeScore(signals.outcome)
    + evidenceScore(signals.evidenceTier)
    + sourceScore(ids)
    + clingenClassificationScore(signals.clingenClassification)
    + pharmgkbLevelScore(signals.pharmgkbLevel)
    + clinicalSignificanceScore(signals.clinicalSignificance, signals.normalizedClinicalSignificance)
    + reputeScore(signals.repute)
    + publicationScore(signals.publicationCount)
    + magnitudeScore(signals.magnitude)
    + snpediaContextScore(signals, ids)
    + sourceValidityScore(signals, ids);

  return Math.round(score);
}

export function rankingQualityMultiplier(signals: Pick<RankingSignals, "evidenceTier" | "outcome" | "repute">): number {
  return evidenceMultiplier(signals.evidenceTier)
    * outcomeMultiplier(signals.outcome)
    * reputeMultiplier(signals.repute);
}

export function evidenceTierSortValue(evidenceTier: EvidenceTier): number {
  switch (evidenceTier) {
    case "high":
      return 4;
    case "moderate":
      return 3;
    case "emerging":
      return 2;
    case "preview":
    case "supplementary":
      return 1;
  }
}
