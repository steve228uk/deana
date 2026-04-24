import {
  CompactMarker,
  InsightCategory,
  ReputeStatus,
  SnpediaFinding,
} from "../types";

export const SNPEDIA_API_URL = "https://bots.snpedia.com/api.php";
export const SNPEDIA_SITE_URL = "https://bots.snpedia.com";
export const SNPEDIA_ATTRIBUTION =
  "SNPedia content is available under Creative Commons Attribution-Noncommercial-Share Alike 3.0 Unported.";

interface SnpediaRevision {
  timestamp?: string;
  slots?: {
    main?: {
      content?: string;
    };
  };
}

export interface SnpediaQueryPage {
  missing?: boolean;
  title: string;
  revisions?: SnpediaRevision[];
}

interface SnpediaQueryResponse {
  query?: {
    pages?: SnpediaQueryPage[];
  };
}

interface SnpediaCategoryResponse {
  continue?: {
    cmcontinue?: string;
  };
  query?: {
    pages?: Array<{
      categoryinfo?: {
        pages?: number;
        size?: number;
      };
    }>;
    categorymembers?: Array<{
      title: string;
    }>;
  };
}

let documentedRsidsPromise: Promise<Set<string>> | null = null;
const SNAPSHOT_TIMEOUT_MS = 30000;
const SNAPSHOT_PAGE_SIZE = 500;

export interface SnpediaSnapshotProgress {
  currentPage: number;
  totalPages: number | null;
  fetchedRsids: number;
}

function pageUrl(title: string): string {
  return `${SNPEDIA_SITE_URL}/index.php/${encodeURIComponent(title)
    .replaceAll("%3B", ";")
    .replaceAll("%28", "(")
    .replaceAll("%29", ")")}`;
}

function firstRevisionContent(page: SnpediaQueryPage): string {
  return page.revisions?.[0]?.slots?.main?.content ?? "";
}

function templateValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`\\|${key}=([^\\n]+)`, "i"));
  return match?.[1]?.trim() ?? null;
}

function cleanWikiText(value: string): string {
  return value
    .replace(/\{\{[^{}]+\}\}/g, " ")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraphs(content: string, count: number): string {
  const body = content.replace(/\{\{[\s\S]*?\}\}\s*/u, "").trim();
  if (!body) return "";
  const parts = body
    .split(/\n{2,}/)
    .map((chunk) => cleanWikiText(chunk))
    .filter(Boolean);
  return parts.slice(0, count).join(" ");
}

function parseGenes(content: string): string[] {
  const genes = new Set<string>();
  for (const match of content.matchAll(/\[\[([A-Z0-9-]{2,})\]\]\s+gene/gu)) {
    genes.add(match[1]);
  }
  return [...genes];
}

function parseConditions(content: string, summary: string): string[] {
  const conditions = new Set<string>();
  const diseaseLine = templateValue(content, "Disease") ?? templateValue(content, "CLNDBN");
  if (diseaseLine) {
    for (const part of cleanWikiText(diseaseLine).split(/[;,]/)) {
      const value = part.trim();
      if (value) conditions.add(value);
    }
  }

  for (const match of content.matchAll(/\[\[([^\]]+)\]\]/gu)) {
    const value = match[1].split("|").pop()?.trim() ?? "";
    if (!value) continue;
    if (/^rs\d+$/i.test(value) || /^[A-Z0-9-]{2,}$/.test(value)) continue;
    if (value.length < 4) continue;
    conditions.add(value);
    if (conditions.size >= 6) break;
  }

  const summaryCondition = summary.match(/risk for ([^.]+)|susceptibility to ([^.]+)/i);
  if (summaryCondition?.[1] || summaryCondition?.[2]) {
    conditions.add((summaryCondition[1] ?? summaryCondition[2]).trim());
  }

  return [...conditions];
}

function parseClinicalSignificance(content: string): string | null {
  const raw = templateValue(content, "CLNSIG");
  if (!raw) return null;
  const value = raw.split(/[;,]/)[0]?.trim();
  switch (value) {
    case "5":
      return "pathogenic";
    case "4":
      return "probable-pathogenic";
    case "3":
      return "probable-non-pathogenic";
    case "2":
      return "non-pathogenic";
    case "6":
      return "drug-response";
    case "7":
      return "histocompatibility";
    case "255":
      return "other";
    default:
      return null;
  }
}

function parseRepute(raw: string | null): ReputeStatus {
  if (!raw) return "not-set";
  if (/good/i.test(raw)) return "good";
  if (/bad/i.test(raw)) return "bad";
  if (/mixed/i.test(raw)) return "mixed";
  return "not-set";
}

function parseMagnitude(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function publicationCount(content: string): number {
  return [...content.matchAll(/\{\{PMID/gi)].length;
}

function classifyCategory(
  summary: string,
  detail: string,
  conditions: string[],
  clinicalSignificance: string | null,
): InsightCategory {
  if (clinicalSignificance === "drug-response") return "drug";

  const text = `${summary} ${detail} ${conditions.join(" ")}`.toLowerCase();
  const drugTokens = [
    "drug",
    "statin",
    "warfarin",
    "clopidogrel",
    "pharmacogen",
    "metabolizer",
    "medication",
    "dose",
  ];
  if (drugTokens.some((token) => text.includes(token))) return "drug";

  const traitTokens = [
    "bald",
    "obesity",
    "eye color",
    "hair",
    "caffeine",
    "taste",
    "earwax",
    "lactose",
    "chronotype",
    "sleep",
    "athletic",
    "muscle",
    "height",
    "weight",
    "skin",
  ];
  if (traitTokens.some((token) => text.includes(token))) return "traits";

  return "medical";
}

export function snpediaRsidTitle(rsid: string): string {
  return rsid.replace(/^rs/i, "Rs");
}

export function snpediaGenotypeSuffix(genotype: string | null): string | null {
  if (!genotype || genotype === "--") return null;
  const alleles = genotype.toUpperCase().split("").sort();
  return `(${alleles.join(";")})`;
}

export function snpediaGenotypeTitle(rsid: string, genotype: string | null): string | null {
  const suffix = snpediaGenotypeSuffix(genotype);
  return suffix ? `${snpediaRsidTitle(rsid)}${suffix}` : null;
}

export async function querySnpediaPages(
  titles: string[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 12000,
): Promise<SnpediaQueryPage[]> {
  if (titles.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    titles: titles.join("|"),
    rvprop: "content|timestamp",
    rvslots: "main",
    formatversion: "2",
    format: "json",
    redirects: "1",
    origin: "*",
  });

  try {
    const response = await fetchImpl(`${SNPEDIA_API_URL}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`SNPedia request failed with ${response.status}`);
    }

    const data = (await response.json()) as SnpediaQueryResponse;
    return data.query?.pages ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryDocumentedSnpediaRsids(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = SNAPSHOT_TIMEOUT_MS,
  onProgress?: (progress: SnpediaSnapshotProgress) => void,
): Promise<Set<string>> {
  if (documentedRsidsPromise) {
    return documentedRsidsPromise;
  }

  documentedRsidsPromise = (async () => {
    const documented = new Set<string>();
    let cmcontinue: string | null = null;
    let currentPage = 0;
    let totalPages: number | null = null;

    do {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const params = new URLSearchParams({
        action: "query",
        prop: "categoryinfo",
        list: "categorymembers",
        titles: "Category:Is_a_snp",
        cmtitle: "Category:Is_a_snp",
        cmlimit: String(SNAPSHOT_PAGE_SIZE),
        formatversion: "2",
        format: "json",
        origin: "*",
      });

      if (cmcontinue) {
        params.set("cmcontinue", cmcontinue);
      }

      try {
        const response = await fetchImpl(`${SNPEDIA_API_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`SNPedia category snapshot failed with ${response.status}`);
        }

        const data = (await response.json()) as SnpediaCategoryResponse;
        const categorySize = data.query?.pages?.[0]?.categoryinfo?.pages ?? data.query?.pages?.[0]?.categoryinfo?.size;
        if (typeof categorySize === "number" && categorySize > 0) {
          totalPages = Math.max(1, Math.ceil(categorySize / SNAPSHOT_PAGE_SIZE));
        }

        for (const member of data.query?.categorymembers ?? []) {
          if (/^rs\d+$/i.test(member.title)) {
            documented.add(member.title.toLowerCase());
          }
        }
        currentPage += 1;
        onProgress?.({
          currentPage,
          totalPages,
          fetchedRsids: documented.size,
        });
        cmcontinue = data.continue?.cmcontinue ?? null;
      } catch (error) {
        documentedRsidsPromise = null;
        throw new Error(
          `SNPedia rsID snapshot failed${cmcontinue ? ` near continuation token ${cmcontinue}` : ""}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      } finally {
        clearTimeout(timeout);
      }
    } while (cmcontinue);

    return documented;
  })();

  return documentedRsidsPromise;
}

export function buildFindingFromPages(
  marker: CompactMarker,
  rsPage: SnpediaQueryPage | null,
  genotypePage: SnpediaQueryPage | null,
): SnpediaFinding | null {
  const genotypeContent = genotypePage ? firstRevisionContent(genotypePage) : "";
  const rsContent = rsPage ? firstRevisionContent(rsPage) : "";

  if (!genotypeContent && !rsContent) return null;

  const genotypeSummary = templateValue(genotypeContent, "summary");
  const rsSummary = firstParagraphs(rsContent, 1);
  const summary = cleanWikiText(genotypeSummary ?? rsSummary);
  const detail = cleanWikiText(firstParagraphs(genotypeContent || rsContent, genotypeContent ? 1 : 2));
  const genes = parseGenes(rsContent);
  const conditions = parseConditions(rsContent, summary);
  const clinicalSignificance = parseClinicalSignificance(rsContent);
  const magnitude = parseMagnitude(templateValue(genotypeContent, "magnitude"));
  const repute = parseRepute(templateValue(genotypeContent, "repute"));
  const page = genotypePage ?? rsPage!;
  const pageKey = page.title;

  return {
    id: `snpedia-${pageKey.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    rsid: marker[0],
    pageKey,
    pageTitle: page.title,
    pageUrl: pageUrl(page.title),
    genotype: marker[3] === "--" ? null : marker[3],
    summary: summary || `${marker[0]} appears in SNPedia.`,
    detail: detail || "SNPedia provides additional context for this marker, but the page did not include a structured summary.",
    genes,
    topics: [],
    conditions,
    clinicalSignificance,
    category: classifyCategory(summary, detail, conditions, clinicalSignificance),
    repute,
    publicationCount: publicationCount(rsContent),
    chromosome: templateValue(rsContent, "Chromosome") ?? marker[1] ?? null,
    position: Number(templateValue(rsContent, "position") ?? marker[2] ?? 0) || null,
    magnitude,
    fetchedAt: new Date().toISOString(),
  };
}
