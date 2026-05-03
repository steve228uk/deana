import { startTransition, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CategoryExplorerContent,
  EvidenceUpdateNotice,
  ExplorerReportCard,
  ExplorerShell,
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
import { prewarmSearchIndex } from "../lib/ai/searchIndex";
import { ExplorerTab, InsightCategory, ProfileMeta, ReportFacets, StoredReportEntry } from "../types";

interface ExplorerScreenProps {
  isLibraryReady: boolean;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const MULTI_FILTER_KEYS = ["evidence", "significance", "repute", "coverage", "publications", "gene", "tag"] as const;
const RESET_FILTER_KEYS = ["q", "source", "sort", ...MULTI_FILTER_KEYS] as const;
const SORT_FILTER_VALUES = new Set(SORT_FILTER_OPTIONS.map(([value]) => value));

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

function categoryForTab(tab: ExplorerTab): InsightCategory | undefined {
  if (tab === "medical") return "medical";
  if (tab === "traits") return "traits";
  if (tab === "drug") return "drug";
  return undefined;
}

function normalizeTab(value: string | null): ExplorerTab {
  if (value === "medical" || value === "traits" || value === "drug" || value === "ai") {
    return value;
  }
  return "overview";
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
  return Object.fromEntries([...RESET_FILTER_KEYS, "selected"].map((key) => [key, null]));
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
        />
      ) : tab === "ai" ? (
        <OverviewContent profile={profile} onExploreCategory={setTab} />
      ) : category ? (
        <CategoryExplorerPane
          key={`${profile.id}:${category}`}
          activeTab={category}
          profile={profile}
          facets={profile.report.categoryFacets[category]}
          filters={filters}
          searchParams={searchParams}
          setSearchParams={setSearchParams}
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
}: {
  activeTab: InsightCategory;
  profile: ProfileMeta;
  facets: ReportFacets;
  filters: ExplorerFilters;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(() => Boolean(searchParams.get("selected")));
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [visibleEntries, setVisibleEntries] = useState<StoredReportEntry[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedEntryFallback, setSelectedEntryFallback] = useState<StoredReportEntry | null>(null);
  const [searchInput, setSearchInput] = useState(filters.q);
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

    setIsPageLoading(true);

    void loadExplorerPage({
      profileId: profile.id,
      category: activeTab,
      filters,
      pageSize: PAGE_SIZE,
    })
      .then((page) => {
        if (cancelled) return;
        startTransition(() => {
          setVisibleEntries(page.entries);
          setPageCursor(page.nextCursor);
          setHasMore(page.hasMore);
          setSelectedEntryFallback(null);
        });
      })
      .finally(() => {
        if (cancelled) return;
        setIsPageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, filters, profile.id]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedEntryId) {
      startTransition(() => {
        setSelectedEntryFallback(null);
      });
      return;
    }

    if (visibleEntries.some((entry) => entry.id === selectedEntryId)) {
      startTransition(() => {
        setSelectedEntryFallback(null);
      });
      return;
    }

    void loadReportEntry(profile.id, selectedEntryId).then((entry) => {
      if (cancelled) return;
      startTransition(() => {
        setSelectedEntryFallback(
          entry &&
            matchesEntryFilters(entry, filters, activeTab)
            ? entry
            : null,
        );
      });
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
      isLoading={isPageLoading}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      isMobileSheetOpen={isMobileSheetOpen}
      searchValue={searchInput}
      onFilterChange={setFilter}
      onSearchChange={setSearchFilter}
      onResetFilters={resetFilters}
      onSelectEntry={selectCategoryEntry}
      onCloseMobileSheet={() => setIsMobileSheetOpen(false)}
      onLoadMore={() => void handleLoadMore()}
    />
  );
}
