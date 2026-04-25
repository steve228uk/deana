const CLINICAL_SIGNIFICANCE_LABELS: Record<string, string> = {
  "pathogenic-likely-pathogenic": "Pathogenic / likely pathogenic",
  pathogenic: "Pathogenic",
  "likely-pathogenic": "Likely pathogenic",
  conflicting: "Conflicting",
  "risk-context": "Risk context",
  "risk-variant": "Risk variant",
  "carrier-screen": "Carrier screen",
  "enzyme-context": "Enzyme context",
  "drug-response": "Drug response",
  "trait-association": "Trait association",
  protective: "Protective",
  association: "Association",
  supplementary: "Supplementary context",
};

const CONDITION_ALIASES = new Map<string, string>([
  ["androgenetic alopecia", "baldness"],
  ["male pattern baldness", "baldness"],
  ["male-pattern baldness", "baldness"],
  ["pattern baldness", "baldness"],
  ["alopecia androgenetic", "baldness"],
  ["late onset alzheimer disease", "late-onset alzheimer disease"],
  ["late onset alzheimers disease", "late-onset alzheimer disease"],
  ["alzheimers disease", "alzheimer disease"],
]);

const CONDITION_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "association",
  "chance",
  "change",
  "disease",
  "for",
  "in",
  "of",
  "risk",
  "the",
  "to",
  "trait",
  "with",
]);

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleCase(value: string): string {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeClinicalSignificance(value: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase().replace(/\s+/g, " ").trim();

  if (/pathogenic\/likely pathogenic|pathogenic; likely pathogenic|likely pathogenic.*pathogenic/.test(lower)) {
    return "pathogenic-likely-pathogenic";
  }
  if (/conflicting/.test(lower)) return "conflicting";
  if (/likely pathogenic/.test(lower)) return "likely-pathogenic";
  if (/pathogenic/.test(lower)) return "pathogenic";
  if (/drug response|drug-response|pharmacogen|affects/.test(lower)) return "drug-response";
  if (/risk-context|risk factor/.test(lower)) return "risk-context";
  if (/risk-variant/.test(lower)) return "risk-variant";
  if (/carrier-style-screen|carrier screen/.test(lower)) return "carrier-screen";
  if (/enzyme-activity-context|enzyme context/.test(lower)) return "enzyme-context";
  if (/trait-association|trait association/.test(lower)) return "trait-association";
  if (/protective/.test(lower)) return "protective";
  if (/association/.test(lower)) return "association";
  if (/literature-context|supplementary|context/.test(lower)) return "supplementary";

  return slug(lower);
}

export function clinicalSignificanceLabel(value: string): string {
  return CLINICAL_SIGNIFICANCE_LABELS[value] ?? titleCase(value);
}

export function normalizeConditionKey(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(\.\d+)?\s*x\b/g, " ")
    .replace(/\b(increased|decreased|higher|lower|reduced|elevated)\b/g, " ")
    .replace(/\b(chance|risk|odds)\s+of\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const alias = CONDITION_ALIASES.get(cleaned);
  if (alias) return slug(alias);

  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length > 1 && !CONDITION_STOPWORDS.has(token));
  const key = tokens.join(" ").trim() || cleaned;
  return slug(CONDITION_ALIASES.get(key) ?? key);
}

export function normalizeConditions(values: string[]): string[] {
  const byKey = new Map<string, string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeConditionKey(trimmed);
    if (!key) continue;
    const label = CONDITION_ALIASES.get(trimmed.toLowerCase()) ?? trimmed.replace(/\s+/g, " ");
    const existing = byKey.get(key);
    if (!existing || label.length < existing.length) {
      byKey.set(key, label);
    }
  }

  return [...byKey.entries()]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([, label]) => label);
}
