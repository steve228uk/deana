export interface RankingSignals {
  evidenceTier: unknown;
  outcome: unknown;
  repute: unknown;
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

export function rankingQualityMultiplier(signals: RankingSignals): number {
  return evidenceMultiplier(signals.evidenceTier)
    * outcomeMultiplier(signals.outcome)
    * reputeMultiplier(signals.repute);
}
