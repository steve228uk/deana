export const DEANA_MODELS = {
  cheap: "google/gemma-4-31b-it",
  default: "google/gemini-3-flash",
  strongFallback: "openai/gpt-5.4-mini",
} as const;

export type DeanaModelId = typeof DEANA_MODELS[keyof typeof DEANA_MODELS];

// Chat requires reliable tool-call support — never use the cheap model.
export const CHAT_MODELS: readonly DeanaModelId[] = [DEANA_MODELS.default, DEANA_MODELS.strongFallback];

export const TASK_MODELS = {
  titleGeneration: [DEANA_MODELS.cheap, DEANA_MODELS.default],
  uploadParsingExplanations: [DEANA_MODELS.cheap, DEANA_MODELS.default],
  traitSummaries: [DEANA_MODELS.cheap, DEANA_MODELS.default],
  medicalFindingSummaries: [DEANA_MODELS.default, DEANA_MODELS.strongFallback],
  drugResponseSummaries: [DEANA_MODELS.default, DEANA_MODELS.strongFallback],
  jsonExtraction: [DEANA_MODELS.cheap, DEANA_MODELS.default],
  safetyReview: [DEANA_MODELS.default, DEANA_MODELS.strongFallback],
} as const satisfies Record<string, readonly DeanaModelId[]>;

const ADVISORY_INTENT_PATTERN = /\b(should i|what should|diagnose|treat|medication|recommend|advice)\b/i;

export function selectChatModels(
  findings: Array<{ category: string; evidenceTier: string }>,
  userMessage: string,
): readonly DeanaModelId[] {
  if (findings.length === 0) return [DEANA_MODELS.default, DEANA_MODELS.strongFallback];
  if (findings.some((finding) => finding.category === "medical" || finding.category === "drug")) return [DEANA_MODELS.default, DEANA_MODELS.strongFallback];
  if (findings.some((finding) => finding.evidenceTier === "high" || finding.evidenceTier === "moderate")) return [DEANA_MODELS.default, DEANA_MODELS.strongFallback];
  if (ADVISORY_INTENT_PATTERN.test(userMessage)) return [DEANA_MODELS.default, DEANA_MODELS.strongFallback];
  return [DEANA_MODELS.cheap, DEANA_MODELS.default];
}
