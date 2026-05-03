import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CategoryExplorerContent,
  EvidenceUpdateNotice,
  ExplorerReportCard,
  ExplorerShell,
  MARKER_SORT_OPTIONS,
  MarkersExplorerContent,
  OverviewContent,
} from "../components/deana/explorer";
import { ExplorerAiChat } from "../components/deana/aiChat";
import {
  DEFAULT_FILTERS,
  ExplorerFilters,
  SORT_FILTER_OPTIONS,
  matchesEntryFilters,
} from "../lib/explorer";
import {
  loadProfileMeta,
  loadReportEntry,
} from "../lib/storage";
import { loadExplorerPage } from "../lib/explorerSearch";
import { EVIDENCE_PACK_VERSION } from "../lib/evidencePack";
import { loadMarkerSummary, prewarmMarkerIndex, prewarmSearchIndex, searchMarkerPage } from "../lib/ai/searchIndex";
import { ExplorerTab, InsightCategory, MarkerSort, ProfileMeta, ReportFacets, StoredMarkerSummary, StoredReportEntry } from "../types";

interface ExplorerScreenProps {
  isLibraryReady: boolean;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const MULTI_FILTER_KEYS = ["evidence", "significance", "repute", "coverage", "publications", "gene", "tag"] as const;
const RESET_FILTER_KEYS = ["q", "source", "sort", ...MULTI_FILTER_KEYS] as const;
const SORT_FILTER_VALUES = new Set(SORT_FILTER_OPTIONS.map(([value]) => value));
const MARKER_SORT_VALUES = new Set(MARKER_SORT_OPTIONS.map(([value]) => value));
const EXPLORER_TAB_VALUES = new Set<ExplorerTab>(["medical", "traits", "drug", "markers", "ai"]);
const MAX_AI_HANDOFF_PROMPT_LENGTH = 1_800;

function scheduleAfterNextPaint(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    const timeoutId = window.setTimeout(callback, 0);
    return () => window.clearTimeout(timeoutId);
  }

  let secondFrameId = 0;
  const firstFrameId = window.requestAnimationFrame(() => {
    secondFrameId = window.requestAnimationFrame(callback);
  });

  return () => {
    window.cancelAnimationFrame(firstFrameId);
    if (secondFrameId) {
      window.cancelAnimationFrame(secondFrameId);
    }
  };
}

function formatFilters(searchParams: URLSearchParams): ExplorerFilters {
  const multiValue = (key: (typeof MULTI_FILTER_KEYS)[number]): string[] => {
    const values = searchParams.getAll(key);
    const legacyValue = searchParams.get(key);
    return values.length > 0
      ? values.flatMap((value) => value.split(",")).filter(Boolean)
      : legacyValue
        ? legacyValue.split(",").filter(Boolean)
        : [];
  };

  return {
    q: searchParams.get("q") ?? DEFAULT_FILTERS.q,
    source: searchParams.get("source") ?? DEFAULT_FILTERS.source,
    evidence: multiValue("evidence"),
    significance: multiValue("significance"),
    repute: multiValue("repute"),
    coverage: multiValue("coverage"),
    publications: multiValue("publications"),
    gene: multiValue("gene"),
    tag: multiValue("tag"),
    sort: searchParams.get("sort") ?? DEFAULT_FILTERS.sort,
  };
}

function filterSearchKey(searchParams: URLSearchParams): string {
  return RESET_FILTER_KEYS.map((key) => `${key}=${searchParams.getAll(key).join(",")}`).join("&");
}

function explorerPageRequestKey(profileId: string, category: InsightCategory, filters: ExplorerFilters): string {
  return [
    profileId,
    category,
    filters.q,
    filters.source,
    filters.sort,
    filters.evidence.join(","),
    filters.significance.join(","),
    filters.repute.join(","),
    filters.coverage.join(","),
    filters.publications.join(","),
    filters.gene.join(","),
    filters.tag.join(","),
  ].join("\u001f");
}

function markerPageRequestKey(profileId: string, query: string, sort: MarkerSort): string {
  return [profileId, query, sort].join("\u001f");
}

function categoryForTab(tab: ExplorerTab): InsightCategory | undefined {
  if (tab === "medical") return "medical";
  if (tab === "traits") return "traits";
  if (tab === "drug") return "drug";
  return undefined;
}

function normalizeTab(value: string | null): ExplorerTab {
  return value && EXPLORER_TAB_VALUES.has(value as ExplorerTab) ? value as ExplorerTab : "overview";
}

function normalizeMarkerSort(value: string | null): MarkerSort {
  return value && MARKER_SORT_VALUES.has(value as MarkerSort) ? value as MarkerSort : "findings";
}

function markerLocationForPrompt(marker: StoredMarkerSummary): string {
  return marker.position > 0 ? `${marker.chromosome}:${marker.position}` : `chromosome ${marker.chromosome}`;
}

function trimAiHandoffPrompt(prompt: string): string {
  if (prompt.length <= MAX_AI_HANDOFF_PROMPT_LENGTH) return prompt;
  return `${prompt.slice(0, MAX_AI_HANDOFF_PROMPT_LENGTH - 1).trimEnd()}.`;
}

async function loadAiStatus(): Promise<boolean> {
  try {
    const response = await fetch("/api/ai-status", {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = await response.json() as { enabled?: unknown };
    return body.enabled === true;
  } catch {
    return false;
  }
}

function updateSearchParams(
  searchParams: URLSearchParams,
  patch: Partial<Record<string, string | string[] | null>>,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
) {
  const next = new URLSearchParams(searchParams);

  Object.entries(patch).forEach(([key, value]) => {
    next.delete(key);
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => next.append(key, item));
      return;
    }
    next.set(key, value);
  });

  setSearchParams(next, { replace: true });
}

function toReportCard(profile: ProfileMeta): ExplorerReportCard {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.dna.provider,
    build: profile.dna.build,
    markerCount: profile.dna.markerCount,
    evidencePackVersion: profile.evidencePackVersion,
  };
}

function resetFilterPatch(): Partial<Record<string, null>> {
  return Object.fromEntries([...RESET_FILTER_KEYS, "selected", "markerFinding"].map((key) => [key, null]));
}

function sanitizeFilterPatch(filters: ExplorerFilters, facets: ReportFacets): Partial<Record<string, string | string[] | null>> {
  const patch: Partial<Record<string, string | string[] | null>> = {};
  const keepKnownValues = (key: (typeof MULTI_FILTER_KEYS)[number], allowedValues: string[]) => {
    const allowed = new Set(allowedValues);
    const current = filters[key];
    const next = current.filter((value) => allowed.has(value));
    if (next.length !== current.length) {
      patch[key] = next.length > 0 ? next : null;
    }
  };

  if (filters.source && !facets.sources.includes(filters.source)) patch.source = null;
  if (!SORT_FILTER_VALUES.has(filters.sort)) patch.sort = null;
  keepKnownValues("evidence", facets.evidenceTiers);
  keepKnownValues("significance", facets.clinicalSignificances);
  keepKnownValues("repute", facets.reputes);
  keepKnownValues("coverage", facets.coverages);
  keepKnownValues("publications", facets.publicationBuckets);
  keepKnownValues("gene", facets.genes);
  keepKnownValues("tag", [...facets.tags, ...facets.conditions]);

  return patch;
}

function scheduleSearchIndexPrewarm(profileId: string): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    void prewarmSearchIndex(profileId).catch(() => {});
    void prewarmMarkerIndex(profileId).catch(() => {});
  };

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const handle = window.requestIdleCallback(run, { timeout: 1500 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(handle);
    };
  }

  const handle = setTimeout(run, 250);
  return () => {
    cancelled = true;
    clearTimeout(handle);
  };
}

function getEvidencePackStatus(profile: ProfileMeta | null): {
  currentPackVersion: string;
  isStale: boolean;
} {
  if (!profile) {
    return {
      currentPackVersion: EVIDENCE_PACK_VERSION,
      isStale: false,
    };
  }

  const currentPackVersion =
    profile.report.overview.evidencePackVersion ??
    profile.report.evidencePackVersion ??
    profile.evidencePackVersion;

  return {
    currentPackVersion,
    isStale:
      profile.evidencePackVersion !== EVIDENCE_PACK_VERSION ||
      profile.report.evidencePackVersion !== EVIDENCE_PACK_VERSION ||
      profile.report.overview.evidencePackVersion !== EVIDENCE_PACK_VERSION,
  };
}

export function ExplorerScreen({
  isLibraryReady,
}: ExplorerScreenProps) {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileMeta | null>(null);
  const [isAiEnabled, setIsAiEnabled] = useState<boolean | null>(null);
  const [pendingAiPrompt, setPendingAiPrompt] = useState<string | null>(null);
  const previousTabRef = useRef<ExplorerTab | null>(null);

  const filterKey = useMemo(() => filterSearchKey(searchParams), [searchParams]);
  const tab = useMemo(() => normalizeTab(searchParams.get("tab")), [searchParams]);
  const filters = useMemo(() => formatFilters(searchParams), [filterKey]);
  const category = categoryForTab(tab);
  const evidencePackStatus = getEvidencePackStatus(profile);

  useEffect(() => {
    let cancelled = false;

    void loadAiStatus().then((enabled) => {
      if (!cancelled) setIsAiEnabled(enabled);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isAiEnabled === false && tab === "ai") {
      updateSearchParams(searchParams, { tab: "overview", selected: null }, setSearchParams);
    }
  }, [isAiEnabled, searchParams, setSearchParams, tab]);

  useEffect(() => {
    let cancelled = false;

    if (!isLibraryReady || !profileId) {
      return;
    }

    setIsProfileLoading(true);

    void loadProfileMeta(profileId)
      .then((record) => {
        if (cancelled) return;
        setProfile(record);
      })
      .finally(() => {
        if (cancelled) return;
        setIsProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLibraryReady, profileId]);

  useEffect(() => {
    if (!profile?.id) return;
    return scheduleSearchIndexPrewarm(profile.id);
  }, [profile?.id]);

  useEffect(() => {
    if (previousTabRef.current === "ai" && tab !== "ai" && pendingAiPrompt) {
      setPendingAiPrompt(null);
    }
    previousTabRef.current = tab;
  }, [pendingAiPrompt, tab]);

  if (!isLibraryReady || isProfileLoading) {
    return (
      <main className="dn-loading-screen" aria-live="polite" aria-busy="true">
        <div className="dn-loading-indicator" role="status">
          <span className="dn-screen-reader-text">Loading local profiles</span>
        </div>
      </main>
    );
  }

  if (!profile) {
    return <Navigate to="/" replace />;
  }

  function setTab(nextTab: ExplorerTab) {
    if (nextTab === "ai" && isAiEnabled !== true) return;
    if (nextTab === tab) return;
    updateSearchParams(
      searchParams,
      { ...resetFilterPatch(), tab: nextTab },
      setSearchParams,
    );
  }

  function openAiWithPrompt(prompt: string) {
    if (isAiEnabled !== true) return;
    setPendingAiPrompt(prompt);
    updateSearchParams(
      searchParams,
      { ...resetFilterPatch(), tab: "ai" },
      setSearchParams,
    );
  }

  function promptForMarker(marker: StoredMarkerSummary): string {
    const genes = marker.genes.length > 0 ? ` Genes linked in the report: ${marker.genes.join(", ")}.` : "";
    const linkedFindings = marker.findingCount > 0
      ? ` This marker has ${marker.findingCount} linked report ${marker.findingCount === 1 ? "finding" : "findings"}; search my saved report for ${marker.rsid} so you can reference the relevant findings.`
      : " The report does not currently list linked findings for this marker.";
    return trimAiHandoffPrompt(`Tell me more about marker ${marker.rsid} in my Deana report. My genotype is ${marker.genotype || "not available"} at ${markerLocationForPrompt(marker)}.${genes}${linkedFindings} Explain what this marker is, what the gene does if relevant, what findings relate to it, how strong the evidence is, and the main limitations. Use only my report context and browser-local report search if needed.`);
  }

  function promptForFinding(finding: StoredReportEntry): string {
    const markers = finding.matchedMarkers.map((marker) => `${marker.rsid} ${marker.genotype ?? "not found"}`).join(", ");
    const genes = finding.genes.length > 0 ? ` Genes: ${finding.genes.join(", ")}.` : "";
    return trimAiHandoffPrompt(`Tell me more about this Deana finding: ${finding.title}.${genes}${markers ? ` Markers: ${markers}.` : ""} Explain what it means, what the marker or gene does, what evidence supports it, and what limitations I should keep in mind. Use only my report context and browser-local report search if needed.`);
  }

  const askAiAboutMarker = isAiEnabled === true
    ? (marker: StoredMarkerSummary) => openAiWithPrompt(promptForMarker(marker))
    : undefined;
  const askAiAboutFinding = isAiEnabled === true
    ? (finding: StoredReportEntry) => openAiWithPrompt(promptForFinding(finding))
    : undefined;

  return (
    <ExplorerShell
      report={toReportCard(profile)}
      activeTab={tab}
      isAiEnabled={isAiEnabled === true}
      notice={
        evidencePackStatus.isStale ? (
          <EvidenceUpdateNotice
            currentPackVersion={evidencePackStatus.currentPackVersion}
            latestVersion={EVIDENCE_PACK_VERSION}
            onRefresh={() => navigate(`/processing/refresh/${profile.id}`)}
          />
        ) : null
      }
      onTabChange={setTab}
      onBackHome={() => navigate("/")}
    >
      {tab === "overview" ? (
        <OverviewContent profile={profile} onExploreCategory={setTab} />
      ) : tab === "ai" && isAiEnabled === true ? (
        <ExplorerAiChat
          profile={profile}
          currentTab={tab}
          filters={DEFAULT_FILTERS}
          visibleEntries={[]}
          selectedEntry={null}
          pendingPrompt={pendingAiPrompt}
          onPendingPromptConsumed={() => setPendingAiPrompt(null)}
        />
      ) : tab === "ai" ? (
        <OverviewContent profile={profile} onExploreCategory={setTab} />
      ) : tab === "markers" ? (
        <MarkersExplorerPane
          key={`${profile.id}:markers`}
          profile={profile}
          searchParams={searchParams}
          setSearchParams={setSearchParams}
          onAskAiAboutMarker={askAiAboutMarker}
          onAskAiAboutFinding={askAiAboutFinding}
        />
      ) : category ? (
        <CategoryExplorerPane
          key={`${profile.id}:${category}`}
          activeTab={category}
          profile={profile}
          facets={profile.report.categoryFacets[category]}
          filters={filters}
          searchParams={searchParams}
          setSearchParams={setSearchParams}
          onAskAiAboutFinding={askAiAboutFinding}
        />
      ) : null}
    </ExplorerShell>
  );
}

function CategoryExplorerPane({
  activeTab,
  profile,
  facets,
  filters,
  searchParams,
  setSearchParams,
  onAskAiAboutFinding,
}: {
  activeTab: InsightCategory;
  profile: ProfileMeta;
  facets: ReportFacets;
  filters: ExplorerFilters;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  onAskAiAboutFinding?: (finding: StoredReportEntry) => void;
}) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(() => Boolean(searchParams.get("selected")));
  const pageRequestKey = useMemo(
    () => explorerPageRequestKey(profile.id, activeTab, filters),
    [
      activeTab,
      filters.coverage,
      filters.evidence,
      filters.gene,
      filters.publications,
      filters.q,
      filters.repute,
      filters.significance,
      filters.sort,
      filters.source,
      filters.tag,
      profile.id,
    ],
  );
  const [loadedPageRequestKey, setLoadedPageRequestKey] = useState<string | null>(null);
  const [isSelectedEntryLoading, setIsSelectedEntryLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [visibleEntries, setVisibleEntries] = useState<StoredReportEntry[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedEntryFallback, setSelectedEntryFallback] = useState<StoredReportEntry | null>(null);
  const [searchInput, setSearchInput] = useState(filters.q);
  const isPageLoading = loadedPageRequestKey !== pageRequestKey;
  const selectedEntryId = searchParams.get("selected") ?? "";
  const sanitizedFilterPatch = useMemo(
    () => sanitizeFilterPatch(filters, facets),
    [
      facets,
      filters.source,
      filters.evidence,
      filters.significance,
      filters.repute,
      filters.coverage,
      filters.publications,
      filters.gene,
      filters.tag,
      filters.sort,
    ],
  );

  useEffect(() => {
    if (Object.keys(sanitizedFilterPatch).length === 0) return;
    updateSearchParams(searchParams, { ...sanitizedFilterPatch, selected: null }, setSearchParams);
  }, [sanitizedFilterPatch, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedEntryId) {
      setIsMobileSheetOpen(false);
    }
  }, [selectedEntryId]);

  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q, profile.id, activeTab]);

  useEffect(() => {
    if (searchInput === filters.q) return;

    const handle = setTimeout(() => {
      updateSearchParams(searchParams, { q: searchInput || null, selected: null }, setSearchParams);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [filters.q, searchInput, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    let cancelLoadingClear = () => {};

    void loadExplorerPage({
      profileId: profile.id,
      category: activeTab,
      filters,
      pageSize: PAGE_SIZE,
    })
      .then((page) => {
        if (cancelled) return;
        setVisibleEntries(page.entries);
        setPageCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setSelectedEntryFallback(null);
      })
      .finally(() => {
        if (cancelled) return;
        cancelLoadingClear = scheduleAfterNextPaint(() => {
          if (!cancelled) setLoadedPageRequestKey(pageRequestKey);
        });
      });

    return () => {
      cancelled = true;
      cancelLoadingClear();
    };
  }, [activeTab, filters, pageRequestKey, profile.id]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedEntryId) {
      setIsSelectedEntryLoading(false);
      startTransition(() => {
        setSelectedEntryFallback(null);
      });
      return;
    }

    if (visibleEntries.some((entry) => entry.id === selectedEntryId)) {
      setIsSelectedEntryLoading(false);
      startTransition(() => {
        setSelectedEntryFallback(null);
      });
      return;
    }

    setIsSelectedEntryLoading(true);
    void loadReportEntry(profile.id, selectedEntryId)
      .then((entry) => {
        if (cancelled) return;
        startTransition(() => {
          setSelectedEntryFallback(
            entry &&
              matchesEntryFilters(entry, filters, activeTab)
              ? entry
              : null,
          );
        });
      })
      .finally(() => {
        if (!cancelled) setIsSelectedEntryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, filters, profile.id, selectedEntryId, visibleEntries]);

  const selectedEntry = useMemo(() => {
    return visibleEntries.find((entry) => entry.id === selectedEntryId) ?? selectedEntryFallback;
  }, [selectedEntryFallback, selectedEntryId, visibleEntries]);

  useEffect(() => {
    if (selectedEntryId || visibleEntries.length === 0) return;
    updateSearchParams(searchParams, { selected: visibleEntries[0].id }, setSearchParams);
  }, [searchParams, selectedEntryId, setSearchParams, visibleEntries]);

  function setFilter<K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) {
    setIsMobileSheetOpen(false);
    updateSearchParams(searchParams, { [key]: value || null, selected: null }, setSearchParams);
  }

  function setSearchFilter(value: string) {
    setIsMobileSheetOpen(false);
    setSearchInput(value);
  }

  function resetFilters() {
    setIsMobileSheetOpen(false);
    setSearchInput("");
    updateSearchParams(searchParams, resetFilterPatch(), setSearchParams);
  }

  function selectCategoryEntry(id: string) {
    setIsMobileSheetOpen(true);
    updateSearchParams(searchParams, { selected: id }, setSearchParams);
  }

  async function handleLoadMore() {
    if (!pageCursor || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const page = await loadExplorerPage({
        profileId: profile.id,
        category: activeTab,
        filters,
        cursor: pageCursor,
        pageSize: PAGE_SIZE,
      });

      startTransition(() => {
        setVisibleEntries((current) => [...current, ...page.entries]);
        setPageCursor(page.nextCursor);
        setHasMore(page.hasMore);
      });
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <CategoryExplorerContent
      activeTab={activeTab}
      facets={facets}
      filters={filters}
      entries={visibleEntries}
      selectedEntry={selectedEntry}
      isLoading={isPageLoading || isSelectedEntryLoading}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      isMobileSheetOpen={isMobileSheetOpen}
      searchValue={searchInput}
      onFilterChange={setFilter}
      onSearchChange={setSearchFilter}
      onResetFilters={resetFilters}
      onSelectEntry={selectCategoryEntry}
      onCloseMobileSheet={() => setIsMobileSheetOpen(false)}
      onAskAiAboutFinding={onAskAiAboutFinding}
      onLoadMore={() => void handleLoadMore()}
    />
  );
}

function decodeMarkerCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(cursor) as { offset?: unknown };
    return typeof parsed.offset === "number" && parsed.offset > 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

function MarkersExplorerPane({
  profile,
  searchParams,
  setSearchParams,
  onAskAiAboutMarker,
  onAskAiAboutFinding,
}: {
  profile: ProfileMeta;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  onAskAiAboutMarker?: (marker: StoredMarkerSummary) => void;
  onAskAiAboutFinding?: (finding: StoredReportEntry) => void;
}) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(() => Boolean(searchParams.get("selected")));
  const query = searchParams.get("q") ?? "";
  const markerSort = normalizeMarkerSort(searchParams.get("sort"));
  const pageRequestKey = useMemo(
    () => markerPageRequestKey(profile.id, query, markerSort),
    [markerSort, profile.id, query],
  );
  const [loadedPageRequestKey, setLoadedPageRequestKey] = useState<string | null>(null);
  const [isSelectedMarkerLoading, setIsSelectedMarkerLoading] = useState(false);
  const [isSelectedFindingLoading, setIsSelectedFindingLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [markers, setMarkers] = useState<StoredMarkerSummary[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedMarkerFallback, setSelectedMarkerFallback] = useState<StoredMarkerSummary | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<StoredReportEntry | null>(null);
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");
  const isPageLoading = loadedPageRequestKey !== pageRequestKey;
  const selectedRsid = searchParams.get("selected") ?? "";
  const selectedFindingId = searchParams.get("markerFinding") ?? "";
  const selectedVisibleMarker = useMemo(() => {
    return markers.find((marker) => marker.rsid.toLowerCase() === selectedRsid.toLowerCase()) ?? null;
  }, [markers, selectedRsid]);

  useEffect(() => {
    if (!selectedRsid) {
      setIsMobileSheetOpen(false);
    }
  }, [selectedRsid]);

  useEffect(() => {
    setSearchInput(query);
  }, [query, profile.id]);

  useEffect(() => {
    if (searchInput === query) return;
    const handle = setTimeout(() => {
      updateSearchParams(searchParams, { q: searchInput || null, selected: null, markerFinding: null }, setSearchParams);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query, searchInput, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    let cancelLoadingClear = () => {};

    void searchMarkerPage({
      profileId: profile.id,
      query,
      sort: markerSort,
      offset: 0,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (cancelled) return;
        setMarkers(page.markers);
        setPageCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setSelectedMarkerFallback(null);
      })
      .finally(() => {
        if (cancelled) return;
        cancelLoadingClear = scheduleAfterNextPaint(() => {
          if (!cancelled) setLoadedPageRequestKey(pageRequestKey);
        });
      });

    return () => {
      cancelled = true;
      cancelLoadingClear();
    };
  }, [markerSort, pageRequestKey, profile.id, query]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedRsid) {
      setIsSelectedMarkerLoading(false);
      startTransition(() => setSelectedMarkerFallback(null));
      return;
    }

    if (selectedVisibleMarker) {
      setIsSelectedMarkerLoading(false);
      startTransition(() => setSelectedMarkerFallback(null));
      return;
    }

    setIsSelectedMarkerLoading(true);
    void loadMarkerSummary(profile.id, selectedRsid)
      .then((marker) => {
        if (cancelled) return;
        startTransition(() => setSelectedMarkerFallback(marker));
      })
      .finally(() => {
        if (!cancelled) setIsSelectedMarkerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile.id, selectedRsid, selectedVisibleMarker]);

  const selectedMarker = useMemo(() => {
    return selectedVisibleMarker ?? selectedMarkerFallback;
  }, [selectedMarkerFallback, selectedVisibleMarker]);

  useEffect(() => {
    if (selectedRsid || markers.length === 0) return;
    updateSearchParams(searchParams, { selected: markers[0].rsid, markerFinding: null }, setSearchParams);
  }, [markers, searchParams, selectedRsid, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedFindingId) {
      setIsSelectedFindingLoading(false);
      startTransition(() => setSelectedFinding(null));
      return;
    }

    setIsSelectedFindingLoading(true);
    void loadReportEntry(profile.id, selectedFindingId)
      .then((entry) => {
        if (cancelled) return;
        startTransition(() => setSelectedFinding(entry));
      })
      .finally(() => {
        if (!cancelled) setIsSelectedFindingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile.id, selectedFindingId]);

  const selectMarker = useCallback((rsid: string) => {
    setIsMobileSheetOpen(true);
    updateSearchParams(searchParams, { selected: rsid, markerFinding: null }, setSearchParams);
  }, [searchParams, setSearchParams]);

  const openFinding = useCallback((entryId: string) => {
    updateSearchParams(searchParams, { markerFinding: entryId }, setSearchParams);
  }, [searchParams, setSearchParams]);

  const setMarkerSort = useCallback((value: MarkerSort) => {
    updateSearchParams(searchParams, { sort: value === "findings" ? null : value, selected: null, markerFinding: null }, setSearchParams);
  }, [searchParams, setSearchParams]);

  const closeMobileSheet = useCallback(() => setIsMobileSheetOpen(false), []);

  const backToMarker = useCallback(() => {
    updateSearchParams(searchParams, { markerFinding: null }, setSearchParams);
  }, [searchParams, setSearchParams]);

  const handleLoadMore = useCallback(async () => {
    if (!pageCursor || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const page = await searchMarkerPage({
        profileId: profile.id,
        query,
        sort: markerSort,
        offset: decodeMarkerCursor(pageCursor),
        limit: PAGE_SIZE,
      });

      startTransition(() => {
        setMarkers((current) => [...current, ...page.markers]);
        setPageCursor(page.nextCursor);
        setHasMore(page.hasMore);
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, markerSort, pageCursor, profile.id, query]);

  const loadMore = useCallback(() => {
    void handleLoadMore();
  }, [handleLoadMore]);

  return (
    <MarkersExplorerContent
      markers={markers}
      selectedMarker={selectedMarker}
      selectedFinding={selectedFinding}
      isLoading={isPageLoading || isSelectedMarkerLoading || isSelectedFindingLoading}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      isMobileSheetOpen={isMobileSheetOpen}
      searchValue={searchInput}
      sortValue={markerSort}
      onSearchChange={setSearchInput}
      onSortChange={setMarkerSort}
      onSelectMarker={selectMarker}
      onCloseMobileSheet={closeMobileSheet}
      onAskAiAboutMarker={onAskAiAboutMarker}
      onAskAiAboutFinding={onAskAiAboutFinding}
      onOpenFinding={openFinding}
      onBackToMarker={backToMarker}
      onLoadMore={loadMore}
    />
  );
}
