import { startTransition, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CategoryExplorerContent,
  ExplorerReportCard,
  ExplorerShell,
  OverviewContent,
  RawMarkersContent,
} from "../components/deana/explorer";
import {
  DEFAULT_FILTERS,
  ExplorerFilters,
  buildRawMarkerResults,
  matchesEntryFilters,
} from "../lib/explorer";
import { exportReportHtml } from "../lib/exporters";
import {
  loadCategoryPage,
  loadProfileMeta,
  loadReportEntry,
  streamReportEntries,
} from "../lib/storage";
import { ExplorerTab, ProfileMeta, ReportEntry, StoredReportEntry } from "../types";

interface ExplorerScreenProps {
  isLibraryReady: boolean;
  refreshProfileSnpedia: (profileId: string) => Promise<void>;
}

const PAGE_SIZE = 50;

function formatFilters(searchParams: URLSearchParams): ExplorerFilters {
  return {
    q: searchParams.get("q") ?? DEFAULT_FILTERS.q,
    source: searchParams.get("source") ?? DEFAULT_FILTERS.source,
    evidence: searchParams.get("evidence") ?? DEFAULT_FILTERS.evidence,
    significance: searchParams.get("significance") ?? DEFAULT_FILTERS.significance,
    repute: searchParams.get("repute") ?? DEFAULT_FILTERS.repute,
    coverage: searchParams.get("coverage") ?? DEFAULT_FILTERS.coverage,
    publications: searchParams.get("publications") ?? DEFAULT_FILTERS.publications,
    gene: searchParams.get("gene") ?? DEFAULT_FILTERS.gene,
    tag: searchParams.get("tag") ?? DEFAULT_FILTERS.tag,
    sort: searchParams.get("sort") ?? DEFAULT_FILTERS.sort,
  };
}

function categoryForTab(tab: ExplorerTab): ReportEntry["category"] | undefined {
  if (tab === "medical") return "medical";
  if (tab === "traits") return "traits";
  if (tab === "drug") return "drug";
  return undefined;
}

function normalizeTab(value: string | null): ExplorerTab {
  if (value === "medical" || value === "traits" || value === "drug" || value === "raw") {
    return value;
  }
  return "overview";
}

function updateSearchParams(
  searchParams: URLSearchParams,
  patch: Partial<Record<string, string | null>>,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
) {
  const next = new URLSearchParams(searchParams);

  Object.entries(patch).forEach(([key, value]) => {
    if (!value) {
      next.delete(key);
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

export function ExplorerScreen({ isLibraryReady, refreshProfileSnpedia }: ExplorerScreenProps) {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isRetryingSnpedia, setIsRetryingSnpedia] = useState(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(() => Boolean(searchParams.get("selected")));
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRawLoading, setIsRawLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [profile, setProfile] = useState<ProfileMeta | null>(null);
  const [visibleEntries, setVisibleEntries] = useState<StoredReportEntry[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedEntryFallback, setSelectedEntryFallback] = useState<StoredReportEntry | null>(null);
  const [rawEntries, setRawEntries] = useState<StoredReportEntry[]>([]);

  const searchKey = searchParams.toString();
  const tab = useMemo(() => normalizeTab(searchParams.get("tab")), [searchKey]);
  const filters = useMemo(() => formatFilters(searchParams), [searchKey]);
  const category = categoryForTab(tab);
  const selectedEntryId = searchParams.get("selected") ?? "";

  useEffect(() => {
    if (!selectedEntryId) {
      setIsMobileSheetOpen(false);
    }
  }, [selectedEntryId]);

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
    let cancelled = false;

    if (!profile || !category) {
      startTransition(() => {
        setVisibleEntries([]);
        setPageCursor(null);
        setHasMore(false);
      });
      return;
    }

    setIsPageLoading(true);

    void loadCategoryPage({
      profileId: profile.id,
      category,
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
  }, [category, filters, profile]);

  useEffect(() => {
    let cancelled = false;

    if (!profile || tab !== "raw") {
      startTransition(() => {
        setRawEntries([]);
      });
      return;
    }

    setIsRawLoading(true);

    void (async () => {
      const entries: StoredReportEntry[] = [];
      for await (const entry of streamReportEntries(profile.id)) {
        entries.push(entry);
      }

      if (cancelled) return;
      startTransition(() => {
        setRawEntries(entries);
      });
    })().finally(() => {
      if (cancelled) return;
      setIsRawLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [profile, tab]);

  useEffect(() => {
    let cancelled = false;

    if (!profile || !category || !selectedEntryId) {
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
          entry && matchesEntryFilters(entry, filters, category) ? entry : null,
        );
      });
    });

    return () => {
      cancelled = true;
    };
  }, [category, filters, profile, selectedEntryId, visibleEntries]);

  const selectedEntry = useMemo(() => {
    return visibleEntries.find((entry) => entry.id === selectedEntryId) ?? selectedEntryFallback;
  }, [selectedEntryFallback, selectedEntryId, visibleEntries]);

  useEffect(() => {
    if (!category || tab === "overview" || tab === "raw") return;
    if (selectedEntryId || visibleEntries.length === 0) return;
    updateSearchParams(searchParams, { selected: visibleEntries[0].id }, setSearchParams);
  }, [category, searchParams, selectedEntryId, setSearchParams, tab, visibleEntries]);

  const rawMarkers = useMemo(() => {
    if (!profile) return [];
    return buildRawMarkerResults(profile.dna.markers, rawEntries, filters.q || filters.gene || filters.tag);
  }, [filters.gene, filters.q, filters.tag, profile, rawEntries]);

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
    setIsMobileSheetOpen(false);
    updateSearchParams(
      searchParams,
      { tab: nextTab, selected: nextTab === "overview" || nextTab === "raw" ? null : "" },
      setSearchParams,
    );
  }

  function setFilter<K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) {
    setIsMobileSheetOpen(false);
    updateSearchParams(searchParams, { [key]: value || null, selected: null }, setSearchParams);
  }

  function resetFilters() {
    setIsMobileSheetOpen(false);
    updateSearchParams(
      searchParams,
      {
        q: null,
        source: null,
        evidence: null,
        significance: null,
        repute: null,
        coverage: null,
        publications: null,
        gene: null,
        tag: null,
        sort: null,
        selected: null,
      },
      setSearchParams,
    );
  }

  function jumpToEntry(entryId: string, categoryValue: ReportEntry["category"]) {
    setIsMobileSheetOpen(true);
    updateSearchParams(searchParams, { tab: categoryValue, selected: entryId }, setSearchParams);
  }

  function selectCategoryEntry(id: string) {
    setIsMobileSheetOpen(true);
    updateSearchParams(searchParams, { selected: id }, setSearchParams);
  }

  async function handleLoadMore() {
    if (!profile || !category || !pageCursor || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const page = await loadCategoryPage({
        profileId: profile.id,
        category,
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

  async function handleExport() {
    const currentProfile = profile;
    if (!currentProfile) return;

    setIsExporting(true);

    try {
      const entries: StoredReportEntry[] = [];
      for await (const entry of streamReportEntries(currentProfile.id)) {
        entries.push(entry);
      }
      exportReportHtml(currentProfile, entries);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleRefreshSnpedia() {
    if (!profile || isRetryingSnpedia) return;

    setIsRetryingSnpedia(true);
    try {
      await refreshProfileSnpedia(profile.id);
      const nextProfile = await loadProfileMeta(profile.id);
      startTransition(() => {
        setProfile(nextProfile);
      });
    } finally {
      setIsRetryingSnpedia(false);
    }
  }

  return (
    <ExplorerShell
      report={toReportCard(profile)}
      activeTab={tab}
      isExporting={isExporting}
      onTabChange={setTab}
      onExportHtml={() => void handleExport()}
      onPrint={() => window.print()}
      onBackHome={() => navigate("/")}
    >
      {tab === "overview" ? (
        <>
          <OverviewContent profile={profile} onExploreCategory={setTab} />
          {(profile.report.overview.snpediaStatus === "partial" || profile.report.overview.snpediaStatus === "failed") ? (
            <div className="dn-overview-retry">
              <button className="dn-button dn-button--secondary" onClick={() => void handleRefreshSnpedia()} disabled={isRetryingSnpedia}>
                <span>{isRetryingSnpedia ? "Retrying SNPedia..." : "Retry SNPedia enrichment"}</span>
              </button>
            </div>
          ) : null}
        </>
      ) : tab === "raw" ? (
        <RawMarkersContent markers={rawMarkers} isLoading={isRawLoading} onJump={jumpToEntry} />
      ) : (
        <CategoryExplorerContent
          activeTab={tab}
          profile={profile}
          filters={filters}
          entries={visibleEntries}
          selectedEntry={selectedEntry}
          isLoading={isPageLoading}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          isMobileSheetOpen={isMobileSheetOpen}
          onFilterChange={setFilter}
          onResetFilters={resetFilters}
          onSelectEntry={selectCategoryEntry}
          onCloseMobileSheet={() => setIsMobileSheetOpen(false)}
          onLoadMore={() => void handleLoadMore()}
        />
      )}
    </ExplorerShell>
  );
}
