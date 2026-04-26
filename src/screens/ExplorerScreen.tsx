import { startTransition, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CategoryExplorerContent,
  ExplorerReportCard,
  ExplorerShell,
  OverviewContent,
} from "../components/deana/explorer";
import { ExplorerAiChat } from "../components/deana/aiChat";
import {
  DEFAULT_FILTERS,
  ExplorerFilters,
  matchesEntryFilters,
} from "../lib/explorer";
import {
  loadCategoryPage,
  loadProfileMeta,
  loadReportEntry,
} from "../lib/storage";
import { ExplorerTab, ProfileMeta, ReportEntry, StoredReportEntry } from "../types";

interface ExplorerScreenProps {
  isLibraryReady: boolean;
  refreshProfileEvidence: (profileId: string) => Promise<void>;
}

const PAGE_SIZE = 50;

function formatFilters(searchParams: URLSearchParams): ExplorerFilters {
  const multiValue = (key: string): string[] => {
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

function categoryForTab(tab: ExplorerTab): ReportEntry["category"] | undefined {
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

export function ExplorerScreen({
  isLibraryReady,
  refreshProfileEvidence: _refreshProfileEvidence,
}: ExplorerScreenProps) {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(() => Boolean(searchParams.get("selected")));
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [profile, setProfile] = useState<ProfileMeta | null>(null);
  const [visibleEntries, setVisibleEntries] = useState<StoredReportEntry[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedEntryFallback, setSelectedEntryFallback] = useState<StoredReportEntry | null>(null);
  const [isAiEnabled, setIsAiEnabled] = useState<boolean | null>(null);

  const searchKey = searchParams.toString();
  const tab = useMemo(() => normalizeTab(searchParams.get("tab")), [searchKey]);
  const filters = useMemo(() => formatFilters(searchParams), [searchKey]);
  const category = categoryForTab(tab);
  const selectedEntryId = searchParams.get("selected") ?? "";

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
          entry &&
            matchesEntryFilters(entry, filters, category)
            ? entry
            : null,
        );
      });
    });

    return () => {
      cancelled = true;
    };
  }, [category, filters, profile, selectedEntryId, tab, visibleEntries]);

  const selectedEntry = useMemo(() => {
    return visibleEntries.find((entry) => entry.id === selectedEntryId) ?? selectedEntryFallback;
  }, [selectedEntryFallback, selectedEntryId, visibleEntries]);

  useEffect(() => {
    if (!category || tab === "overview") return;
    if (selectedEntryId || visibleEntries.length === 0) return;
    updateSearchParams(searchParams, { selected: visibleEntries[0].id }, setSearchParams);
  }, [category, searchParams, selectedEntryId, setSearchParams, tab, visibleEntries]);

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
    setIsMobileSheetOpen(false);
    updateSearchParams(
      searchParams,
      { tab: nextTab, selected: nextTab === "overview" || nextTab === "ai" ? null : "" },
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

  return (
    <>
      <ExplorerShell
        report={toReportCard(profile)}
        activeTab={tab}
        isAiEnabled={isAiEnabled === true}
        onTabChange={setTab}
        onBackHome={() => navigate("/")}
      >
        {tab === "overview" ? (
          <OverviewContent profile={profile} onExploreCategory={setTab} />
        ) : tab === "ai" && isAiEnabled === true ? (
          <ExplorerAiChat
            profile={profile}
            currentTab={tab}
            filters={filters}
            visibleEntries={visibleEntries}
            selectedEntry={selectedEntry}
          />
        ) : tab === "ai" ? (
          <OverviewContent profile={profile} onExploreCategory={setTab} />
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
    </>
  );
}
