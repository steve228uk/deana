export const DEANA_MODELS = {
  cheap: "google/gemma-4-31b-it",
  default: "google/gemini-3-flash",
  strongFallback: "openai/gpt-5.4-mini",
} as const;

export const TITLE_GENERATION_MODELS = [DEANA_MODELS.cheap] as const;
