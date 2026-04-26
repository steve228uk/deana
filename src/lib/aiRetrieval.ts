import { DEFAULT_FILTERS, matchesEntryFilters } from "./explorer";
import { findingToChatContext, MAX_CHAT_SEARCH_RESULTS, type ChatContextFinding, type ChatSearchPlan } from "./aiChat";
import { streamReportEntries } from "./storage";
import type { ChatRetrievalTrace, InsightCategory, StoredReportEntry } from "../types";

const ALL_CATEGORIES: InsightCategory[] = ["medical", "traits", "drug"];

export interface ChatRetrievalResult {
  plan: ChatSearchPlan;
  findings: ChatContextFinding[];
  resultCount: number;
  trace: ChatRetrievalTrace;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hasAnyNeedle(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => needle && haystack.includes(needle));
}

function matchedValues(values: string[], needles: string[]): string[] {
  const normalizedValues = new Set(values.map(normalize).filter(Boolean));
  return needles.filter((needle) => normalizedValues.has(needle));
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

function compactPlan(plan: ChatSearchPlan): ChatSearchPlan {
  const query = plan.query.trim();
  return {
    query,
    categories: plan.categories.filter((category, index, values) => ALL_CATEGORIES.includes(category) && values.indexOf(category) === index),
    genes: plan.genes.map(normalize).filter(Boolean).slice(0, 12),
    rsids: plan.rsids.map(normalize).filter((rsid) => /^rs\d+$/.test(rsid)).slice(0, 12),
    topics: plan.topics.map(normalize).filter(Boolean).slice(0, 12),
    conditions: plan.conditions.map(normalize).filter(Boolean).slice(0, 12),
    relatedTerms: uniqueValues(plan.relatedTerms ?? []).slice(0, 18),
    evidence: plan.evidence.filter((tier, index, values) => values.indexOf(tier) === index).slice(0, 5),
    rationale: plan.rationale.trim().slice(0, 220),
  };
}

function searchTerms(prompt: string, plan: ChatSearchPlan): string[] {
  const promptTerms = prompt
    .toLowerCase()
    .replace(/\brs\d+\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);

  return uniqueValues([
    plan.query,
    ...promptTerms,
    ...plan.relatedTerms,
    ...plan.genes,
    ...plan.rsids,
    ...plan.topics,
    ...plan.conditions,
  ]).slice(0, 48);
}

function entryFieldText(entry: StoredReportEntry): Array<{ field: string; text: string; weight: number }> {
  return [
    { field: "title", text: entry.title, weight: 50 },
    { field: "summary", text: entry.summary, weight: 40 },
    { field: "detail", text: entry.detail, weight: 36 },
    { field: "whyItMatters", text: entry.whyItMatters, weight: 32 },
    { field: "genotypeSummary", text: entry.genotypeSummary, weight: 32 },
    { field: "conditions", text: entry.conditions.join(" "), weight: 48 },
    { field: "topics", text: entry.topics.join(" "), weight: 34 },
    { field: "genes", text: entry.genes.join(" "), weight: 58 },
    { field: "warnings", text: entry.warnings.join(" "), weight: 28 },
    { field: "sourceNotes", text: entry.sourceNotes.join(" "), weight: 30 },
    { field: "sources", text: entry.sources.flatMap((source) => [source.id, source.name, source.url]).join(" "), weight: 22 },
    {
      field: "markers",
      text: entry.matchedMarkers
        .flatMap((marker) => [
          marker.rsid,
          marker.genotype,
          marker.gene,
          marker.matchedAllele,
          marker.matchedAlleleCount,
          marker.chromosome,
          marker.position,
        ])
        .join(" "),
      weight: 72,
    },
    { field: "clinicalSignificance", text: [entry.clinicalSignificance, entry.normalizedClinicalSignificance].join(" "), weight: 30 },
    { field: "confidenceNote", text: entry.confidenceNote, weight: 24 },
    { field: "disclaimer", text: entry.disclaimer, weight: 20 },
    { field: "frequencyNote", text: entry.frequencyNote ?? "", weight: 20 },
    { field: "sourceGenotype", text: [entry.sourceGenotype, entry.sourcePageKey, entry.sourcePageUrl].join(" "), weight: 28 },
    { field: "classification", text: [entry.entryKind, entry.category, entry.subcategory, entry.evidenceTier, entry.repute, entry.coverage, entry.tone, entry.outcome].join(" "), weight: 18 },
  ].map((field) => ({ ...field, text: normalize(field.text) }));
}

function fuzzyFieldMatch(text: string, term: string): boolean {
  if (term.length < 4) return false;
  return text
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .some((token) => token.includes(term));
}

function fieldIncludesTerm(text: string, term: string): boolean {
  if (term.length <= 3) {
    return text.split(/[^a-z0-9]+/).filter(Boolean).includes(term);
  }

  return text.includes(term);
}

function scoreEntry(entry: StoredReportEntry, prompt: string, plan: ChatSearchPlan, terms: string[]): { score: number; matchedFields: string[] } {
  const searchText = entry.searchText || "";
  let score = 0;
  const matchedFields = new Set<string>();

  if (plan.query && matchesEntryFilters(entry, { ...DEFAULT_FILTERS, q: plan.query }, entry.category)) {
    score += 42;
    matchedFields.add("searchText");
  }

  if (hasAnyNeedle(searchText, plan.rsids)) {
    score += 90;
    matchedFields.add("markers");
  }

  const geneMatches = matchedValues(entry.genes, plan.genes);
  if (geneMatches.length > 0) {
    score += geneMatches.length * 70;
    matchedFields.add("genes");
  }

  const topicMatches = matchedValues(entry.topics, plan.topics);
  if (topicMatches.length > 0) {
    score += topicMatches.length * 28;
    matchedFields.add("topics");
  }

  const conditionMatches = matchedValues(entry.conditions, plan.conditions);
  if (conditionMatches.length > 0) {
    score += conditionMatches.length * 28;
    matchedFields.add("conditions");
  }

  if (plan.evidence.includes(entry.evidenceTier)) score += 12;
  if (plan.query && entry.title.toLowerCase().includes(plan.query.toLowerCase())) score += 25;

  for (const { field, text, weight } of entryFieldText(entry)) {
    for (const term of terms) {
      if (!term) continue;
      if (fieldIncludesTerm(text, term)) {
        score += weight;
        matchedFields.add(field);
      } else if (fuzzyFieldMatch(text, term)) {
        score += Math.max(6, weight / 5);
        matchedFields.add(field);
      }
    }
  }

  if (plan.categories.includes(entry.category)) score += 6;
  if (prompt && matchesEntryFilters(entry, { ...DEFAULT_FILTERS, q: prompt }, entry.category)) {
    score += 30;
    matchedFields.add("searchText");
  }

  return {
    score: score + Math.min(entry.sort.severity, 100) / 100 + Math.min(entry.sort.evidence, 100) / 200,
    matchedFields: Array.from(matchedFields).sort(),
  };
}

function fallbackPlan(prompt: string): ChatSearchPlan {
  const rsids = Array.from(new Set(prompt.match(/\brs\d+\b/gi)?.map(normalize) ?? []));
  const words = prompt
    .toLowerCase()
    .replace(/\brs\d+\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
    .slice(0, 8);

  return {
    query: [...rsids, ...words].join(" ").trim() || prompt.trim().slice(0, 140),
    categories: [],
    genes: [],
    rsids,
    topics: [],
    conditions: [],
    relatedTerms: [],
    evidence: [],
    rationale: "Searched the local report for terms from your prompt.",
  };
}

export async function searchReportEntriesForChat({
  profileId,
  prompt,
  plan,
  limit = MAX_CHAT_SEARCH_RESULTS,
}: {
  profileId: string;
  prompt: string;
  plan?: ChatSearchPlan;
  limit?: number;
}): Promise<ChatRetrievalResult> {
  const effectivePlan = compactPlan(plan ?? fallbackPlan(prompt));
  const categories = ALL_CATEGORIES;
  const terms = searchTerms(prompt, effectivePlan);
  const ranked: Array<{ entry: StoredReportEntry; score: number; matchedFields: string[] }> = [];
  const seen = new Set<string>();

  for (const category of categories) {
    for await (const entry of streamReportEntries(profileId, category)) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const { score, matchedFields } = scoreEntry(entry, prompt, effectivePlan, terms);
      if (matchedFields.length > 0) {
        ranked.push({ entry, score, matchedFields });
      }
    }
  }

  ranked.sort((left, right) =>
    right.score - left.score ||
    right.entry.sort.severity - left.entry.sort.severity ||
    left.entry.title.localeCompare(right.entry.title),
  );

  const selectedRanked = ranked.slice(0, limit);
  const selected = selectedRanked.map(({ entry }) => findingToChatContext(entry));

  return {
    plan: effectivePlan,
    findings: selected,
    resultCount: selected.length,
    trace: {
      searchedAt: new Date().toISOString(),
      scannedCategories: categories,
      searchedTerms: terms,
      relatedTerms: effectivePlan.relatedTerms,
      resultCount: selected.length,
      returnedFindings: selectedRanked.map(({ entry, matchedFields }) => ({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        matchedFields,
        markerRsids: entry.matchedMarkers.map((marker) => marker.rsid).slice(0, 8),
        sourceNames: entry.sources.map((source) => source.name).slice(0, 5),
      })),
      rationale: effectivePlan.rationale,
    },
  };
}
