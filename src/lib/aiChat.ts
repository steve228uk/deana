import type { ExplorerFilters } from "./explorer.js";
import type { ChatFollowUpSuggestion, ExplorerTab, ProfileMeta, ReportEntry, StoredReportEntry } from "../types.js";
export type { ChatFollowUpSuggestion, ChatSearchPlan } from "../types.js";

export const CHAT_CONTEXT_VERSION = 1;
export const CHAT_CONSENT_VERSION = 1;
export const MAX_CHAT_CONTEXT_FINDINGS = 18;
export const MAX_CHAT_SEARCH_RESULTS = 8;
export const MAX_CHAT_FOLLOW_UPS = 3;
const MAX_CHAT_FOLLOW_UP_TITLE_LENGTH = 44;
const MAX_CHAT_FOLLOW_UP_BODY_LENGTH = 220;

export interface ChatConsent {
  accepted: true;
  version: typeof CHAT_CONSENT_VERSION;
}

export interface ChatContextMarker {
  rsid: string;
  genotype: string | null;
  gene?: string;
  matchedAllele?: string;
  matchedAlleleCount?: number | null;
}

export interface ChatContextFinding {
  id: string;
  link: string;
  category: ReportEntry["category"];
  title: string;
  summary: string;
  detail: string;
  whyItMatters: string;
  genotypeSummary: string;
  genes: string[];
  topics: string[];
  conditions: string[];
  warnings: string[];
  sourceNotes: string[];
  markers: ChatContextMarker[];
  evidenceTier: ReportEntry["evidenceTier"];
  clinicalSignificance: string | null;
  normalizedClinicalSignificance: string | null;
  repute: ReportEntry["repute"];
  coverage: ReportEntry["coverage"];
  confidenceNote: string;
  disclaimer: string;
  frequencyNote: string;
  sourceGenotype: string;
  publicationCount: number;
  sourceNames: string[];
  sourceUrls: string[];
}

export function formatChatTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim();
  return title.length > 52 ? `${title.slice(0, 49)}...` : title;
}

function followUpMarkerPattern(): RegExp {
  return /<!--\s*deana-follow-ups\s*:\s*([\s\S]*?)\s*-->/gi;
}

function normalizeFollowUpText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

export function normalizeChatFollowUps(value: unknown): ChatFollowUpSuggestion[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "followUps" in value && Array.isArray(value.followUps)
      ? value.followUps
      : [];
  const seenBodies = new Set<string>();
  const followUps: ChatFollowUpSuggestion[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const title = normalizeFollowUpText("title" in candidate ? candidate.title : null, MAX_CHAT_FOLLOW_UP_TITLE_LENGTH);
    const body = normalizeFollowUpText("body" in candidate ? candidate.body : null, MAX_CHAT_FOLLOW_UP_BODY_LENGTH);
    const bodyKey = body.toLocaleLowerCase();
    if (!title || !body || seenBodies.has(bodyKey)) continue;
    seenBodies.add(bodyKey);
    followUps.push({ title, body });
    if (followUps.length >= MAX_CHAT_FOLLOW_UPS) break;
  }

  return followUps;
}

export function extractChatFollowUps(content: string): { content: string; followUps: ChatFollowUpSuggestion[] } {
  const followUps: ChatFollowUpSuggestion[] = [];
  const strippedContent = content.replace(followUpMarkerPattern(), (_match, payload: string) => {
    try {
      followUps.push(...normalizeChatFollowUps(JSON.parse(payload)));
    } catch {
      // Invalid model metadata should not leak into the visible chat.
    }
    return "";
  }).trim();

  return {
    content: strippedContent,
    followUps: normalizeChatFollowUps(followUps),
  };
}

export function buildGatewayProviderOptions(model: string, includeThoughts = false) {
  const isGeminiGatewayModel = model.startsWith("google/gemini-");
  const isOpenAiGatewayModel = model.startsWith("openai/");

  return {
    // Gemma routes use only gateway privacy flags; no Gemini/OpenAI provider options.
    ...(isGeminiGatewayModel
      ? {
          google: {
            thinkingLevel: "low",
            includeThoughts,
          },
        }
      : {}),
    ...(isOpenAiGatewayModel
      ? {
          openai: {
            reasoningEffort: "low",
          },
        }
      : {}),
    gateway: {
      zeroDataRetention: true,
      disallowPromptTraining: true,
      ...(isGeminiGatewayModel ? { only: ["vertex"] } : {}),
    },
  };
}

export interface ChatReportContext {
  contextVersion: typeof CHAT_CONTEXT_VERSION;
  currentTab: ExplorerTab;
  activeFilters: {
    q: string;
    source: string;
    evidence: string[];
    significance: string[];
    repute: string[];
    coverage: string[];
    publications: string[];
    gene: string[];
    tag: string[];
    sort: string;
  };
  report: {
    provider: string;
    build: string;
    markerCount: number;
    coverageScore: number;
    evidencePackVersion: string;
    evidenceStatus: string;
    evidenceMatchedFindings: number;
    localEvidenceEntryMatches: number;
    warnings: string[];
    categoryCounts: Array<{ tab: ExplorerTab; label: string; count: number }>;
  };
  selectedFindingId: string | null;
  findings: ChatContextFinding[];
}

interface BuildChatContextOptions {
  profile: ProfileMeta;
  currentTab: ExplorerTab;
  filters: ExplorerFilters;
  visibleEntries: StoredReportEntry[];
  selectedEntry: StoredReportEntry | null;
  retrievedFindings?: ChatContextFinding[];
}

function compactText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function compactList(values: string[], maxItems: number, maxLength = 80): string[] {
  return values
    .map((value) => compactText(value, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function safeSourceUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function findingToChatContext(entry: StoredReportEntry): ChatContextFinding {
  return {
    id: entry.id,
    link: `deana://entry/${encodeURIComponent(entry.id)}`,
    category: entry.category,
    title: compactText(entry.title, 140),
    summary: compactText(entry.summary, 900),
    detail: compactText(entry.detail, 1_400),
    whyItMatters: compactText(entry.whyItMatters, 900),
    genotypeSummary: compactText(entry.genotypeSummary, 700),
    genes: compactList(entry.genes, 10),
    topics: compactList(entry.topics, 10),
    conditions: compactList(entry.conditions, 10),
    warnings: compactList(entry.warnings, 8, 220),
    sourceNotes: compactList(entry.sourceNotes, 8, 220),
    markers: entry.matchedMarkers.slice(0, 8).map((marker) => ({
      rsid: marker.rsid,
      genotype: marker.genotype,
      gene: marker.gene,
      matchedAllele: marker.matchedAllele,
      matchedAlleleCount: marker.matchedAlleleCount,
    })),
    evidenceTier: entry.evidenceTier,
    clinicalSignificance: entry.clinicalSignificance,
    normalizedClinicalSignificance: entry.normalizedClinicalSignificance,
    repute: entry.repute,
    coverage: entry.coverage,
    confidenceNote: compactText(entry.confidenceNote, 500),
    disclaimer: compactText(entry.disclaimer, 500),
    frequencyNote: compactText(entry.frequencyNote ?? "", 300),
    sourceGenotype: compactText(entry.sourceGenotype ?? "", 120),
    publicationCount: entry.publicationCount,
    sourceNames: entry.sources.map((source) => compactText(source.name, 100)).filter(Boolean).slice(0, 5),
    sourceUrls: entry.sources.map((source) => safeSourceUrl(source.url)).filter((url): url is string => Boolean(url)).slice(0, 5),
  };
}

function rankedEntries(selectedEntry: StoredReportEntry | null, visibleEntries: StoredReportEntry[]): StoredReportEntry[] {
  const entries = selectedEntry ? [selectedEntry, ...visibleEntries] : visibleEntries;
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }).slice(0, MAX_CHAT_CONTEXT_FINDINGS);
}

export function mergeChatFindings(findings: ChatContextFinding[]): ChatContextFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) return false;
    seen.add(finding.id);
    return true;
  }).slice(0, MAX_CHAT_CONTEXT_FINDINGS);
}

export function buildChatContext({
  profile,
  currentTab,
  filters,
  visibleEntries,
  selectedEntry,
  retrievedFindings,
}: BuildChatContextOptions): ChatReportContext {
  const currentFindings = rankedEntries(selectedEntry, visibleEntries).map(findingToChatContext);

  return {
    contextVersion: CHAT_CONTEXT_VERSION,
    currentTab,
    activeFilters: {
      q: compactText(filters.q, 120),
      source: compactText(filters.source, 100),
      evidence: compactList(filters.evidence, 8),
      significance: compactList(filters.significance, 8),
      repute: compactList(filters.repute, 8),
      coverage: compactList(filters.coverage, 8),
      publications: compactList(filters.publications, 8),
      gene: compactList(filters.gene, 12),
      tag: compactList(filters.tag, 12),
      sort: compactText(filters.sort, 40),
    },
    report: {
      provider: profile.dna.provider,
      build: profile.dna.build,
      markerCount: profile.dna.markerCount,
      coverageScore: profile.report.overview.coverageScore,
      evidencePackVersion: profile.report.overview.evidencePackVersion,
      evidenceStatus: profile.report.overview.evidenceStatus,
      evidenceMatchedFindings: profile.report.overview.evidenceMatchedFindings,
      localEvidenceEntryMatches: profile.report.overview.localEvidenceEntryMatches,
      warnings: compactList(profile.report.overview.warnings, 8, 220),
      categoryCounts: profile.report.tabs.map((tab) => ({
        tab: tab.tab,
        label: tab.label,
        count: tab.count,
      })),
    },
    selectedFindingId: selectedEntry?.id ?? null,
    findings: mergeChatFindings([
      ...currentFindings,
      ...(retrievedFindings ?? []),
    ]),
  };
}
