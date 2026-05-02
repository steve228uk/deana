import { DEFAULT_FILTERS, matchesEntryFilters } from "./explorer";
import { findingToChatContext, MAX_CHAT_CONTEXT_FINDINGS, type ChatContextFinding } from "./aiChat";
import { searchWithFields, waitForIndex, type SearchCandidate, type SearchIndexStatus } from "./ai/searchIndex";
import { rankingQualityMultiplier } from "./ai/ranking";
import { loadCategoryPage, loadReportEntriesByIds } from "./storage";
import type { ChatRetrievalTrace, ChatSearchPlan, InsightCategory, StoredReportEntry } from "../types";

const ALL_CATEGORIES: InsightCategory[] = ["medical", "traits", "drug"];
const MIN_CHAT_SEARCH_FINDINGS = 5;
const INDEX_CANDIDATE_LIMIT = 180;
const FALLBACK_SEARCH_BOUNDS = {
  queryLimit: 8,
  pageSize: 60,
  maxPagesPerQuery: 3,
} as const;
const SUPPLEMENTAL_CONTEXT_LIMIT = 2;
const RANKING_WEIGHTS = {
  rsid: 90,
  gene: 70,
  topic: 28,
  condition: 28,
  evidenceTier: 12,
  titleQuery: 25,
} as const;

export interface ChatRetrievalResult {
  plan: ChatSearchPlan;
  findings: ChatContextFinding[];
  resultCount: number;
  trace: ChatRetrievalTrace;
}

interface ChatRetrievalRequest {
  profileId: string;
  prompt: string;
  plan?: ChatSearchPlan;
  limit?: number;
  excludeIds?: string[];
  offset?: number;
}

interface RankedChatEntry {
  entry: StoredReportEntry;
  score: number;
  matchedFields: string[];
}

interface EntrySearchField {
  field: string;
  text: string;
  weight: number;
  exactTokens: Set<string>;
  fuzzyTokens: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hasAnyNeedle(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => needle && haystack.includes(needle));
}

function matchedSetValues(values: Set<string>, needles: string[]): string[] {
  return needles.filter((needle) => values.has(needle));
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

function exactFieldTokens(text: string): Set<string> {
  return new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
}

function fuzzyFieldTokens(text: string): string[] {
  return text.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
}

function entryFieldText(entry: StoredReportEntry): EntrySearchField[] {
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
    {
      field: "classification",
      text: [
        entry.entryKind,
        entry.category,
        entry.subcategory,
        entry.evidenceTier,
        entry.repute,
        entry.coverage,
        entry.tone,
        entry.outcome,
        entry.pharmgkbLevel,
        entry.clingenClassification,
      ].join(" "),
      weight: 18,
    },
  ].map((field) => {
    const text = normalize(field.text);
    return {
      ...field,
      text,
      exactTokens: exactFieldTokens(text),
      fuzzyTokens: fuzzyFieldTokens(text),
    };
  });
}

function fuzzyFieldMatch(tokens: string[], term: string): boolean {
  if (term.length < 4) return false;
  return tokens.some((token) => token.includes(term));
}

function fieldIncludesTerm(field: EntrySearchField, term: string): boolean {
  if (term.length <= 3) {
    return field.exactTokens.has(term);
  }

  return field.text.includes(term);
}

function compareRankedChatEntries(left: RankedChatEntry, right: RankedChatEntry): number {
  return right.score - left.score
    || right.entry.sort.severity - left.entry.sort.severity
    || left.entry.title.localeCompare(right.entry.title);
}

function scoreEntry(entry: StoredReportEntry, prompt: string, plan: ChatSearchPlan, terms: string[]): { score: number; matchedFields: string[] } {
  const searchText = entry.searchText || "";
  let score = 0;
  const matchedFields = new Set<string>();
  const normalizedGenes = new Set(entry.genes.map(normalize).filter(Boolean));
  const normalizedTopics = new Set(entry.topics.map(normalize).filter(Boolean));
  const normalizedConditions = new Set(entry.conditions.map(normalize).filter(Boolean));

  if (plan.query && matchesEntryFilters(entry, { ...DEFAULT_FILTERS, q: plan.query }, entry.category)) {
    score += 42;
    matchedFields.add("searchText");
  }

  if (hasAnyNeedle(searchText, plan.rsids)) {
    score += RANKING_WEIGHTS.rsid;
    matchedFields.add("markers");
  }

  const geneMatches = matchedSetValues(normalizedGenes, plan.genes);
  if (geneMatches.length > 0) {
    score += geneMatches.length * RANKING_WEIGHTS.gene;
    matchedFields.add("genes");
  }

  const topicMatches = matchedSetValues(normalizedTopics, plan.topics);
  if (topicMatches.length > 0) {
    score += topicMatches.length * RANKING_WEIGHTS.topic;
    matchedFields.add("topics");
  }

  const conditionMatches = matchedSetValues(normalizedConditions, plan.conditions);
  if (conditionMatches.length > 0) {
    score += conditionMatches.length * RANKING_WEIGHTS.condition;
    matchedFields.add("conditions");
  }

  if (plan.evidence.includes(entry.evidenceTier)) score += RANKING_WEIGHTS.evidenceTier;
  if (plan.query && entry.title.toLowerCase().includes(plan.query.toLowerCase())) score += RANKING_WEIGHTS.titleQuery;

  for (const fieldSearch of entryFieldText(entry)) {
    for (const term of terms) {
      if (!term) continue;
      if (fieldIncludesTerm(fieldSearch, term)) {
        score += fieldSearch.weight;
        matchedFields.add(fieldSearch.field);
      } else if (fuzzyFieldMatch(fieldSearch.fuzzyTokens, term)) {
        score += Math.max(6, fieldSearch.weight / 5);
        matchedFields.add(fieldSearch.field);
      }
    }
  }

  if (plan.categories.includes(entry.category)) score += 6;
  if (prompt && matchesEntryFilters(entry, { ...DEFAULT_FILTERS, q: prompt }, entry.category)) {
    score += 30;
    matchedFields.add("searchText");
  }

  return {
    score: (score * rankingQualityMultiplier(entry))
      + Math.min(entry.sort.severity, 100) / 100
      + Math.min(entry.sort.evidence, 100) / 200,
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

function isSupplementalContext(entry: StoredReportEntry): boolean {
  return entry.evidenceTier === "supplementary" || entry.subcategory === "snpedia";
}

function resolveCandidateGuidedLimit(candidates: SearchCandidate[], rankedCount: number, explicitLimit?: number): number {
  const maxLimit = Math.min(MAX_CHAT_CONTEXT_FINDINGS, rankedCount);
  if (explicitLimit !== undefined) return Math.min(explicitLimit, maxLimit);
  if (maxLimit <= MIN_CHAT_SEARCH_FINDINGS) return maxLimit;

  const topScore = candidates[0]?.score ?? 0;
  if (topScore <= 0) return Math.min(12, maxLimit);

  const relevantCandidateCount = candidates
    .slice(0, MAX_CHAT_CONTEXT_FINDINGS)
    .filter((candidate) => candidate.score >= topScore * 0.35).length;

  return Math.min(
    maxLimit,
    Math.max(MIN_CHAT_SEARCH_FINDINGS, relevantCandidateCount),
  );
}

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function selectRankedEntries(
  ranked: RankedChatEntry[],
  limit: number,
): RankedChatEntry[] {
  if (limit <= 0) return [];

  const selected = ranked.slice(0, limit);
  const selectedIds = new Set(selected.map(({ entry }) => entry.id));
  const supplementalTarget = Math.min(SUPPLEMENTAL_CONTEXT_LIMIT, Math.max(1, Math.floor(limit / 6)));
  let supplementalCount = selected.filter(({ entry }) => isSupplementalContext(entry)).length;

  for (const supplemental of ranked) {
    if (supplementalCount >= supplementalTarget) break;
    if (!isSupplementalContext(supplemental.entry) || selectedIds.has(supplemental.entry.id)) continue;

    let replaceIndex = -1;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (!isSupplementalContext(selected[index].entry)) {
        replaceIndex = index;
        break;
      }
    }
    if (replaceIndex === -1) break;

    selectedIds.delete(selected[replaceIndex].entry.id);
    selected[replaceIndex] = supplemental;
    selectedIds.add(supplemental.entry.id);
    supplementalCount += 1;
  }

  return selected.sort(compareRankedChatEntries);
}

function preScoreCandidate(candidate: SearchCandidate, plan: ChatSearchPlan): number {
  const normRsids = candidate.rsids.toLowerCase();
  const normGenes = candidate.genes.toLowerCase();
  const normTopics = candidate.topics.toLowerCase();
  const normConditions = candidate.conditions.toLowerCase();
  const normTitle = candidate.title.toLowerCase();
  let score = 0;

  if (plan.rsids.some((rsid) => normRsids.includes(rsid))) score += RANKING_WEIGHTS.rsid;

  const geneTokens = new Set(normGenes.split(/\s+/).filter(Boolean));
  score += plan.genes.filter((g) => geneTokens.has(g)).length * RANKING_WEIGHTS.gene;

  score += plan.topics.filter((t) => normTopics.includes(t)).length * RANKING_WEIGHTS.topic;
  score += plan.conditions.filter((c) => normConditions.includes(c)).length * RANKING_WEIGHTS.condition;

  if (plan.evidence.includes(candidate.evidenceTier)) score += RANKING_WEIGHTS.evidenceTier;
  if (plan.query && normTitle.includes(plan.query.toLowerCase())) score += RANKING_WEIGHTS.titleQuery;

  return (score * rankingQualityMultiplier(candidate))
    + Math.min(candidate.sortSeverity, 100) / 100
    + Math.min(candidate.sortEvidence, 100) / 200;
}

function fallbackReasonForIndexStatus(status: SearchIndexStatus): ChatRetrievalTrace["fallbackReason"] | undefined {
  if (status.state === "ready") return undefined;
  if (status.reason === "memory-budget") return "memory-budget";
  return status.state === "failed" ? "index-error" : "unavailable";
}

function fallbackSearchQueries(prompt: string, plan: ChatSearchPlan): string[] {
  return uniqueValues([
    plan.query,
    ...plan.rsids,
    ...plan.genes,
    ...plan.conditions,
    ...plan.topics,
    ...plan.relatedTerms,
    prompt,
  ]).slice(0, FALLBACK_SEARCH_BOUNDS.queryLimit);
}

function addFallbackPageEntries(
  seenEntryIds: Set<string>,
  entries: StoredReportEntry[],
  excludedIds: Set<string>,
  onEntry: (entry: StoredReportEntry) => void,
): boolean {
  for (const entry of entries) {
    if (excludedIds.has(entry.id) || seenEntryIds.has(entry.id)) continue;
    seenEntryIds.add(entry.id);
    onEntry(entry);
    if (seenEntryIds.size >= INDEX_CANDIDATE_LIMIT) return true;
  }

  return false;
}

async function loadFallbackReportEntryCount(
  profileId: string,
  prompt: string,
  plan: ChatSearchPlan,
  excludedIds: Set<string>,
  onEntry: (entry: StoredReportEntry) => void,
): Promise<number> {
  const seenEntryIds = new Set<string>();
  const categories = plan.categories.length > 0 ? plan.categories : ALL_CATEGORIES;

  for (const query of fallbackSearchQueries(prompt, plan)) {
    for (const category of categories) {
      let cursor: string | null = null;
      for (let pageCount = 0; pageCount < FALLBACK_SEARCH_BOUNDS.maxPagesPerQuery; pageCount += 1) {
        const page = await loadCategoryPage({
          profileId,
          category,
          filters: { ...DEFAULT_FILTERS, q: query },
          cursor,
          pageSize: FALLBACK_SEARCH_BOUNDS.pageSize,
        });

        if (addFallbackPageEntries(seenEntryIds, page.entries, excludedIds, onEntry)) {
          return seenEntryIds.size;
        }

        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
    }
  }

  return seenEntryIds.size;
}

export async function searchReportEntriesForChat({
  profileId,
  prompt,
  plan,
  limit,
  excludeIds = [],
  offset = 0,
}: ChatRetrievalRequest): Promise<ChatRetrievalResult> {
  const effectivePlan = compactPlan(plan ?? fallbackPlan(prompt));
  const categories = ALL_CATEGORIES;
  const terms = searchTerms(prompt, effectivePlan);
  const ranked: RankedChatEntry[] = [];
  const seen = new Set<string>();
  const excludedIds = new Set(excludeIds);

  const startedAt = performance.now();
  let fallbackReason: ChatRetrievalTrace["fallbackReason"] | undefined;
  let isIndexReady = false;
  try {
    const status = await waitForIndex(profileId);
    isIndexReady = status.state === "ready";
    fallbackReason = fallbackReasonForIndexStatus(status);
  } catch {
    fallbackReason = "index-error";
  }
  const indexReadyAt = performance.now();

  let candidates: SearchCandidate[] = [];
  if (isIndexReady) {
    try {
      candidates = await searchWithFields(profileId, terms, INDEX_CANDIDATE_LIMIT);
    } catch {
      fallbackReason = "index-error";
      candidates = [];
    }
  }
  const indexSearchedAt = performance.now();

  const rankEntry = (entry: StoredReportEntry) => {
    if (excludedIds.has(entry.id)) return;
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    const { score, matchedFields } = scoreEntry(entry, prompt, effectivePlan, terms);
    if (matchedFields.length > 0) ranked.push({ entry, score, matchedFields });
  };

  // Pre-score from stored index fields to identify the most relevant candidates,
  // then load full entries from IDB only for those — avoiding large batch reads.
  const candidateScores: Array<{ id: string; score: number; order: number }> = [];
  candidates.forEach((candidate, order) => {
    if (excludedIds.has(candidate.id)) return;
    candidateScores.push({
      id: candidate.id,
      score: preScoreCandidate(candidate, effectivePlan),
      order,
    });
  });
  const candidateIds = candidateScores
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((candidate) => candidate.id);

  const indexedEntries = candidateIds.length > 0
    ? await loadReportEntriesByIds(profileId, candidateIds)
    : [];
  const idbReadAt = performance.now();
  for (const entry of indexedEntries) {
    rankEntry(entry);
  }
  const indexedScoredAt = performance.now();

  // Fallback: bounded IndexedDB category-page search when the index is unavailable or empty.
  const usedFallback = !isIndexReady || candidates.length === 0;
  if (usedFallback && !fallbackReason) fallbackReason = isIndexReady ? "no-index-candidates" : "unavailable";
  let fallbackEntryCount = 0;
  let fallbackScannedAt = indexedScoredAt;
  if (usedFallback) {
    fallbackEntryCount = await loadFallbackReportEntryCount(profileId, prompt, effectivePlan, excludedIds, rankEntry);
    fallbackScannedAt = performance.now();
  }

  ranked.sort(compareRankedChatEntries);

  const effectiveLimit = resolveCandidateGuidedLimit(candidates, ranked.length, limit);
  const selectedRankedEntries = selectRankedEntries(ranked, effectiveLimit);
  const selectedFindings = selectedRankedEntries.map(({ entry }) => findingToChatContext(entry));
  const completedAt = performance.now();
  const selectedIds = selectedRankedEntries.map(({ entry }) => entry.id);
  const sentFindingIds = uniqueIds([...excludeIds, ...selectedIds]);
  const candidateWindowCount = usedFallback ? fallbackEntryCount : candidates.length;
  const remainingCandidateCount = usedFallback
    ? Math.max(0, fallbackEntryCount - selectedFindings.length)
    : Math.max(0, candidates.length - sentFindingIds.length);
  const hasMore = remainingCandidateCount > 0 && selectedFindings.length > 0;
  const timingMs = {
    total: Math.round(completedAt - startedAt),
    indexWait: Math.round(indexReadyAt - startedAt),
    indexSearch: Math.round(indexSearchedAt - indexReadyAt),
    idbRead: Math.round(idbReadAt - indexSearchedAt),
    fallbackScan: Math.round(fallbackScannedAt - indexedScoredAt),
    scoring: Math.round((indexedScoredAt - idbReadAt) + (completedAt - fallbackScannedAt)),
  };

  return {
    plan: effectivePlan,
    findings: selectedFindings,
    resultCount: selectedFindings.length,
    trace: {
      searchedAt: new Date().toISOString(),
      scannedCategories: categories,
      searchedTerms: terms,
      relatedTerms: effectivePlan.relatedTerms,
      resultCount: selectedFindings.length,
      sentCount: selectedFindings.length,
      candidateWindowCount,
      remainingCandidateCount,
      returnedFindings: selectedRankedEntries.map(({ entry, matchedFields }) => ({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        matchedFields,
        markerRsids: entry.matchedMarkers.map((marker) => marker.rsid).slice(0, 8),
        sourceNames: entry.sources.map((source) => source.name).slice(0, 5),
      })),
      rationale: effectivePlan.rationale,
      searchPlan: effectivePlan,
      retrievalCursor: {
        hasMore,
        nextOffset: offset + selectedFindings.length,
        sentFindingIds,
      },
      indexCandidateCount: candidates.length,
      usedFallback,
      fallbackReason,
      timingMs,
    },
  };
}
