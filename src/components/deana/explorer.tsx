import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ExplorerFilters } from "../../lib/explorer";
import type { ExplorerTab, InsightCategory, ProfileMeta, ReportEntry, StoredReportEntry } from "../../types";
import { DEANA_GITHUB_URL, PrivacyModal } from "./marketing";
import { DeanaWordmark, Icon, IconName } from "./ui";

export interface ExplorerReportCard {
  id: string;
  name: string;
  provider: string;
  build: string;
  markerCount: number;
  evidencePackVersion: string;
}

const tabs: Array<{ id: ExplorerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "medical", label: "Medical" },
  { id: "traits", label: "Traits" },
  { id: "drug", label: "Drug response" },
  { id: "ai", label: "AI" },
];

const nav: Array<{ id: ExplorerTab; label: string; icon: IconName }> = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "medical", label: "Medical", icon: "heart" },
  { id: "traits", label: "Traits", icon: "leaf" },
  { id: "drug", label: "Drug response", icon: "pill" },
  { id: "ai", label: "AI", icon: "spark" },
];

export function ExplorerShell({
  report,
  activeTab,
  isAiEnabled = false,
  children,
  onTabChange,
  onBackHome,
}: {
  report: ExplorerReportCard;
  activeTab: ExplorerTab;
  isAiEnabled?: boolean;
  children: ReactNode;
  onTabChange?: (tab: ExplorerTab) => void;
  onBackHome?: () => void;
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [modal, setModal] = useState<"privacy" | "help" | null>(null);
  const visibleNav = isAiEnabled ? nav : nav.filter((item) => item.id !== "ai");
  const visibleTabs = isAiEnabled ? tabs : tabs.filter((item) => item.id !== "ai");

  return (
    <>
      <div className={`dn-explorer-shell ${isSidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
        <aside className={`dn-explorer-sidebar ${isSidebarCollapsed ? "is-collapsed" : ""}`} aria-label="Explorer navigation">
        <div className="dn-sidebar-head">
          <DeanaWordmark />
          <button
            className="dn-icon-button"
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          >
            <Icon name={isSidebarCollapsed ? "chevronRight" : "chevronLeft"} />
          </button>
        </div>
        <nav>
          {visibleNav.map((item) => (
            <button
              key={item.id}
              aria-label={`Open ${item.label}`}
              className={activeTab === item.id ? "is-active" : ""}
              onClick={() => onTabChange?.(item.id)}
            >
              <Icon name={item.icon} /> <span>{item.label}</span>
            </button>
          ))}
          <hr />
          <button onClick={onBackHome}><Icon name="upload" /> <span>Upload DNA</span></button>
          <button onClick={onBackHome}><Icon name="file" /> <span>Reports</span></button>
          <hr />
          <button onClick={() => setModal("help")}><Icon name="help" /> <span>Help</span></button>
        </nav>
        <div className="dn-sidebar-privacy"><Icon name="lock" /> Your data stays on this device. <button onClick={() => setModal("privacy")}>Learn more</button></div>
        </aside>

        <div className="dn-explorer-main">
        <header className="dn-explorer-topbar">
          {activeTab === "overview" ? null : <span className="dn-screen-reader-text">Current report</span>}
          <DeanaWordmark compact className="dn-show-mobile" />
          <button className="dn-report-selector" onClick={onBackHome}>
            <Icon name="file" />
            <span>
              <strong>{report.name}</strong>
              <small>
                <span className="dn-report-selector__meta">{report.provider} · {report.build}</span>
                <span className="dn-report-selector__markers">{report.markerCount.toLocaleString()} markers</span>
              </small>
            </span>
          </button>
          <button className="dn-local-status" onClick={() => setModal("privacy")}><Icon name="shield" /> All analysis is local <i /></button>
          <button className="dn-icon-button dn-hide-mobile" aria-label="Help" onClick={() => setModal("help")}><Icon name="help" /></button>
        </header>

        <div className="dn-tabbar-wrap">
          <nav className="dn-tabbar" aria-label="Explorer sections">
            {visibleTabs.map((tab) => (
              <button key={tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => onTabChange?.(tab.id)}>{tab.label}</button>
            ))}
          </nav>
        </div>

        {children}
        </div>
      </div>
      {modal === "privacy" ? (
        <PrivacyModal
          onClose={() => setModal(null)}
          onGithub={() => window.open(DEANA_GITHUB_URL, "_blank", "noopener,noreferrer")}
        />
      ) : null}
      {modal === "help" ? <HelpModal onClose={() => setModal(null)} /> : null}
    </>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <button className="dn-icon-button dn-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        <DeanaWordmark compact />
        <h1 id="help-title">About Deana</h1>
        <p className="dn-modal-intro">
          Deana reads a consumer DNA export in your browser and matches markers against bundled evidence for medical,
          trait, and drug-response context.
        </p>
        <div className="dn-help-point-list">
          <article>
            <Icon name="shield" />
            <h2>Local by default</h2>
            <p>Your raw DNA file, saved profiles, and matched report entries stay in this browser.</p>
          </article>
          <article>
            <Icon name="filter" />
            <h2>Evidence first</h2>
            <p>Findings are labelled by source, confidence, coverage, and whether they are negative, positive, missing, or informational.</p>
          </article>
          <article>
            <Icon name="alert" />
            <h2>Not clinical advice</h2>
            <p>Consumer-array results are incomplete and should not be used for diagnosis, treatment, or medication changes.</p>
          </article>
        </div>
        <div className="dn-modal-actions">
          <button className="dn-button dn-button--primary" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

export function OverviewContent({
  profile,
  onExploreCategory,
}: {
  profile: ProfileMeta;
  onExploreCategory: (tab: ExplorerTab) => void;
}) {
  const categories = profile.report.tabs.filter((tab) => tab.tab !== "overview");
  const totalFindings = profile.report.tabs.find((tab) => tab.tab === "overview")?.count ?? 0;
  const localEvidenceEntryMatches =
    profile.report.overview.localEvidenceEntryMatches ?? profile.report.overview.evidenceMatchedFindings ?? 0;
  const localEvidenceRecordMatches =
    profile.report.overview.localEvidenceRecordMatches ?? localEvidenceEntryMatches;
  const localEvidenceMatchedRsids =
    profile.report.overview.localEvidenceMatchedRsids ?? localEvidenceEntryMatches;

  return (
    <main className="dn-overview-screen">
      <section className="dn-report-hero">
        <p className="dn-eyebrow">Current report</p>
        <h1>{profile.name}</h1>
        <p>{profile.dna.provider} data with tabs, shared filters, and a focused inspector.</p>
      </section>

      <section className="dn-overview-metrics" aria-label="Report summary">
        <OverviewMetric icon="leaf" label="Provider" value={profile.dna.provider} />
        <OverviewMetric icon="folder" label="Build" value={profile.dna.build} />
        <OverviewMetric icon="activity" label="Markers parsed" value={profile.dna.markerCount.toLocaleString()} />
        <OverviewMetric icon="target" label="Tracked coverage" value={`${profile.report.overview.coverageScore}%`} />
        <OverviewMetric icon="file" label="Report entries" value={totalFindings.toLocaleString()} />
        <OverviewMetric icon="database" label="Local evidence entries" value={localEvidenceEntryMatches.toLocaleString()} />
      </section>

      <section className="dn-simple-card dn-category-jump-card">
        <h2>Start with the strongest signal</h2>
        <div className="dn-category-grid">
          {categories.map((category) => (
            <article key={category.tab} className={`dn-category-card dn-tone-${toneForTab(category.tab)}`}>
              <span className="dn-round-icon"><Icon name={iconForTab(category.tab)} /></span>
              <h3>{labelForTab(category.tab)}</h3>
              <strong>{category.count.toLocaleString()} <span>report entries</span></strong>
              <p>{category.description}</p>
              <button className="dn-button dn-button--secondary" onClick={() => onExploreCategory(category.tab)}>Explore {labelForTab(category.tab).toLowerCase()} <Icon name="external" /></button>
            </article>
          ))}
        </div>
      </section>

      <section className="dn-overview-two-col">
        <article className="dn-simple-card dn-source-card">
          <h2>What powers this report <Icon name="help" /></h2>
          <dl>
            {profile.report.overview.sourceMix.map((source) => (
              <div key={source.source}>
                <dt><Icon name={iconForSource(source.source)} /> {source.source}</dt>
                <dd>{source.count.toLocaleString()} linked entries</dd>
              </div>
            ))}
          </dl>
        </article>

        <article className="dn-simple-card dn-glance-card">
          <h2>Explorer at a glance <Icon name="help" /></h2>
          <ul>
            <li><Icon name="search" /> <strong>Search</strong> Find markers, genes, conditions, and more.</li>
            <li><Icon name="filter" /> <strong>Filter</strong> Refine by topic, severity, source, and evidence.</li>
            <li><Icon name="target" /> <strong>Inspect</strong> Open any marker to review data and context.</li>
            <li><Icon name="external" /> <strong>Jump</strong> Switch between Medical, Traits, and Drug response.</li>
          </ul>
          <div className="dn-callout dn-callout--success"><Icon name="shield" /> Private by design. Your DNA never leaves this device.</div>
        </article>
      </section>

      <section className="dn-overview-two-col dn-overview-support">
        <article className="dn-simple-card dn-source-card">
          <h2>Evidence pack</h2>
          <dl>
            <div><dt>Status</dt><dd>{profile.report.overview.evidenceStatus}</dd></div>
            <div><dt>Pack</dt><dd>{profile.report.overview.evidencePackVersion}</dd></div>
            <div><dt>Processed rsIDs</dt><dd>{profile.report.overview.evidenceProcessedRsids.toLocaleString()}</dd></div>
            <div><dt>Matched local entries</dt><dd>{localEvidenceEntryMatches.toLocaleString()}</dd></div>
            <div><dt>Matched local records</dt><dd>{localEvidenceRecordMatches.toLocaleString()}</dd></div>
            <div><dt>Matched rsIDs</dt><dd>{localEvidenceMatchedRsids.toLocaleString()}</dd></div>
            <div><dt>Failed items</dt><dd>{profile.report.overview.evidenceFailedItems.toLocaleString()}</dd></div>
          </dl>
        </article>
        <article className="dn-simple-card dn-glance-card">
          <h2>Coverage warnings</h2>
          <ul>
            {profile.report.overview.warnings.map((warning) => (
              <li key={warning}><Icon name="alert" /> {warning}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

export function CategoryExplorerContent({
  activeTab,
  profile,
  filters,
  entries,
  selectedEntry,
  isLoading,
  hasMore,
  isLoadingMore,
  isMobileSheetOpen,
  onFilterChange,
  onResetFilters,
  onSelectEntry,
  onCloseMobileSheet,
  onLoadMore,
}: {
  activeTab: InsightCategory;
  profile: ProfileMeta;
  filters: ExplorerFilters;
  entries: StoredReportEntry[];
  selectedEntry: StoredReportEntry | null;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  isMobileSheetOpen: boolean;
  onFilterChange: <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) => void;
  onResetFilters: () => void;
  onSelectEntry: (id: string) => void;
  onCloseMobileSheet: () => void;
  onLoadMore: () => void;
}) {
  const [areFiltersCollapsed, setAreFiltersCollapsed] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  return (
    <main className={`dn-category-screen ${areFiltersCollapsed ? "is-filter-collapsed" : ""}`}>
      <aside className={`dn-filter-sidebar ${areFiltersCollapsed ? "is-collapsed" : ""}`} aria-label="Filters">
        {areFiltersCollapsed ? (
          <button
            className="dn-filter-rail-button"
            aria-label="Expand filters"
            aria-expanded="false"
            onClick={() => setAreFiltersCollapsed(false)}
          >
            <Icon name="filter" />
            <span>Filter</span>
            <Icon name="chevronRight" size={16} />
          </button>
        ) : (
          <>
            <div className="dn-filter-heading">
              <span>Filter</span>
              <div className="dn-filter-heading-actions">
                <button onClick={onResetFilters}>Reset</button>
                <button
                  className="dn-icon-button"
                  aria-label="Collapse filters"
                  aria-expanded="true"
                  onClick={() => setAreFiltersCollapsed(true)}
                >
                  <Icon name="chevronLeft" />
                </button>
              </div>
            </div>
            <ExplorerFiltersForm profile={profile} filters={filters} onFilterChange={onFilterChange} />
          </>
        )}
      </aside>

      <section className="dn-finding-list-panel">
        <div className="dn-category-title-row">
          <div>
            <h1>{titleForTab(activeTab)}</h1>
            <p>{isLoading ? "Loading..." : `${entries.length.toLocaleString()} visible results${hasMore ? "+" : ""}`}</p>
          </div>
          <button
            className="dn-button dn-button--secondary dn-show-mobile"
            onClick={() => setIsMobileFiltersOpen(true)}
          >
            <Icon name="filter" /> Filters
          </button>
        </div>

        <div className="dn-finding-list">
          {entries.map((entry) => (
            <FindingCard key={entry.id} entry={entry} selected={entry.id === selectedEntry?.id} onClick={() => onSelectEntry(entry.id)} />
          ))}
          {entries.length === 0 && !isLoading ? (
            <div className="dn-empty-state">
              <h2>No matching result</h2>
              <p>Adjust filters or choose another tab to repopulate the explorer.</p>
            </div>
          ) : null}
        </div>

        {hasMore ? (
          <div className="dn-result-footer">
            <button className="dn-button dn-button--secondary" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading more..." : "Load more"}
            </button>
          </div>
        ) : null}
      </section>

      <FindingInspector finding={selectedEntry} />
      {selectedEntry && isMobileSheetOpen ? <MobileFindingSheet finding={selectedEntry} onClose={onCloseMobileSheet} /> : null}
      {isMobileFiltersOpen ? (
        <div className="dn-modal-backdrop" role="presentation" onClick={() => setIsMobileFiltersOpen(false)}>
          <section
            className="dn-modal dn-filters-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="filters-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dn-filters-modal__header">
              <h1 id="filters-title">Filters</h1>
              <div className="dn-filters-modal__actions">
                <button className="dn-button dn-button--secondary" onClick={onResetFilters}>Reset filters</button>
                <button
                  className="dn-icon-button dn-filters-modal__close"
                  onClick={() => setIsMobileFiltersOpen(false)}
                  aria-label="Close filters"
                >
                  <Icon name="x" />
                </button>
              </div>
            </div>
            <ExplorerFiltersForm profile={profile} filters={filters} onFilterChange={onFilterChange} />
            <div className="dn-modal-actions">
              <button className="dn-button dn-button--primary" onClick={() => setIsMobileFiltersOpen(false)}>Done</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function ExplorerFiltersForm({
  profile,
  filters,
  onFilterChange,
}: {
  profile: ProfileMeta;
  filters: ExplorerFilters;
  onFilterChange: <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) => void;
}) {
  return (
    <div className="dn-filter-form">
      <label className="dn-field dn-field--search">
        <span>Search</span>
        <div><Icon name="search" /><input value={filters.q} onChange={(event) => onFilterChange("q", event.target.value)} placeholder="Search findings..." /></div>
      </label>
      <FilterSelect label="Sort" value={filters.sort} onChange={(value) => onFilterChange("sort", value)} options={[["severity", "Severity / priority"], ["evidence", "Evidence strength"], ["publications", "Publication count"], ["alphabetical", "Alphabetical"]]} />
      <FilterSelect label="Source" value={filters.source} onChange={(value) => onFilterChange("source", value)} options={optionList(profile.report.facets.sources, "All sources")} />
      <MultiFilterSelect label="Evidence level" values={filters.evidence} onChange={(value) => onFilterChange("evidence", value)} options={profile.report.facets.evidenceTiers.map((value) => [value, value])} />
      <MultiFilterSelect
        label="Clinical significance"
        values={filters.significance}
        onChange={(value) => onFilterChange("significance", value)}
        options={profile.report.facets.clinicalSignificances.map((value) => [value, profile.report.facets.clinicalSignificanceLabels[value] ?? value])}
      />
      <MultiFilterSelect label="Repute" values={filters.repute} onChange={(value) => onFilterChange("repute", value)} options={profile.report.facets.reputes.map((value) => [value, value])} />
      <MultiFilterSelect label="Coverage" values={filters.coverage} onChange={(value) => onFilterChange("coverage", value)} options={profile.report.facets.coverages.map((value) => [value, value])} />
      <MultiFilterSelect label="Publication bucket" values={filters.publications} onChange={(value) => onFilterChange("publications", value)} options={profile.report.facets.publicationBuckets.map((value) => [value, value])} />
      <MultiFilterSelect label="Gene" values={filters.gene} onChange={(value) => onFilterChange("gene", value)} options={profile.report.facets.genes.map((value) => [value, value])} />
      <MultiFilterSelect
        label="Topic / condition"
        values={filters.tag}
        onChange={(value) => onFilterChange("tag", value)}
        options={[...profile.report.facets.tags, ...profile.report.facets.conditions].filter((value, index, array) => array.indexOf(value) === index).sort().map((value) => [value, value])}
      />
    </div>
  );
}

function FindingCard({ entry, selected, onClick }: { entry: StoredReportEntry; selected?: boolean; onClick?: () => void }) {
  const firstMarker = entry.matchedMarkers[0];
  const summary = summaryUnlessTitle(entry.summary, entry.title);
  const snapshot = evidenceSnapshotItems(entry);

  return (
    <button className={`dn-finding-card ${selected ? "is-selected" : ""} dn-finding-tone-${toneForEntry(entry)}`} onClick={onClick}>
        <span className="dn-finding-card__icon"><Icon name={iconForTab(entry.category)} /></span>
      <div className="dn-finding-card__main">
        <div className="dn-finding-card__meta">
          <span>{entry.sources[0]?.name ?? "Source"}</span>
          <span>{entry.evidenceTier} · {entry.coverage}</span>
          <span className="dn-priority-pill">{priorityLabel(entry)}</span>
        </div>
        <h2>{entry.title} {firstMarker ? <small>{firstMarker.rsid} ({firstMarker.genotype ?? "n/a"})</small> : null}</h2>
        {summary ? <p>{summary}</p> : null}
        {snapshot.length > 0 ? (
          <div className="dn-finding-card__snapshot" aria-label="Evidence snapshot">
            {snapshot.map((item) => (
              <span key={item.label}><strong>{item.label}</strong> {item.value}</span>
            ))}
          </div>
        ) : null}
        <div className="dn-finding-card__foot">
          <span><Icon name="file" /> {entry.publicationCount.toLocaleString()} publications</span>
          {entry.genes[0] ? <span><Icon name="dna" /> {entry.genes.join(", ")}</span> : null}
        </div>
      </div>
      <Icon name="external" />
    </button>
  );
}

export function FindingInspector({
  finding,
  emptyTitle = "Select a finding",
  emptyDescription = "Choose a result to review genotype context, evidence, warnings, and source links.",
  emptyContent,
}: {
  finding: StoredReportEntry | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyContent?: ReactNode;
}) {
  const inspectorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!inspectorRef.current) return;
    inspectorRef.current.scrollTop = 0;
  }, [finding?.id]);

  if (!finding) {
    return (
      <aside ref={inspectorRef} className="dn-inspector" aria-label="Finding inspector">
        <p className="dn-eyebrow">Inspector</p>
        <h2>{emptyTitle}</h2>
        {emptyContent ?? <p>{emptyDescription}</p>}
      </aside>
    );
  }

  return (
    <aside ref={inspectorRef} className="dn-inspector" aria-label="Finding inspector">
      <FindingDetailContent finding={finding} titleLevel="h2" />
    </aside>
  );
}

function MobileFindingSheet({ finding, onClose }: { finding: StoredReportEntry; onClose: () => void }) {
  function handleClose() {
    onClose();
  }

  return (
    <div className="dn-mobile-sheet-backdrop" role="presentation" onClick={handleClose}>
      <section
        className="dn-mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-finding-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dn-icon-button dn-modal-close" aria-label="Close" onClick={handleClose}><Icon name="x" /></button>
        <FindingDetailContent finding={finding} titleId="mobile-finding-title" titleLevel="h1" />
      </section>
    </div>
  );
}

export function FindingDetailContent({
  finding,
  titleId,
  titleLevel,
}: {
  finding: StoredReportEntry;
  titleId?: string;
  titleLevel: "h1" | "h2";
}) {
  const Title = titleLevel;
  const summary = summaryUnlessTitle(finding.summary, finding.title);

  return (
    <>
      <p className="dn-eyebrow">Inspector</p>
      <Title id={titleId}>{finding.title}</Title>
      <span className={`dn-priority-pill dn-finding-tone-${toneForEntry(finding)}`}>{priorityLabel(finding)}</span>
      {summary ? <div className="dn-inspector__intro">{renderMarkdown(summary)}</div> : null}
      {finding.detail.trim() ? (
        <section>
          <h3>Details</h3>
          {renderMarkdown(finding.detail)}
        </section>
      ) : null}
      <EvidenceSnapshot finding={finding} />
      <section>
        <h3>Genotype found</h3>
        {renderMarkdown(finding.genotypeSummary)}
      </section>
      <section>
        <h3>Why it matters</h3>
        {renderMarkdown(finding.whyItMatters)}
      </section>
      <section>
        <h3>Confidence / evidence</h3>
        {renderMarkdown(finding.confidenceNote)}
      </section>
      {finding.warnings.length > 0 ? (
        <section>
          <h3>Warnings</h3>
          <ul>
            {finding.warnings.map((warning) => <li key={warning}>{renderMarkdownInline(warning)}</li>)}
          </ul>
        </section>
      ) : null}
      <section>
        <h3>Sources</h3>
        <div className="dn-source-link-list">
          {finding.sources.map((source) => (
            <a key={source.id} href={ensureAbsoluteUrl(source.url)} target="_blank" rel="noreferrer">
              <span>{source.name}</span>
              <small>{source.id}</small>
              <Icon name="external" />
            </a>
          ))}
        </div>
      </section>
      {finding.sourceNotes.length > 0 ? (
        <section>
          <h3>Source details</h3>
          <ul>
            {finding.sourceNotes.map((note) => <li key={note}>{renderMarkdownInline(note)}</li>)}
          </ul>
        </section>
      ) : null}
      <div className="dn-callout"><Icon name="alert" /> Informational only. Do not use for diagnosis or medication decisions.</div>
      <div className="dn-callout dn-callout--success"><Icon name="lock" /> Private by design. Your DNA stays on this device.</div>
    </>
  );
}

function EvidenceSnapshot({ finding }: { finding: StoredReportEntry }) {
  const firstMarker = finding.matchedMarkers[0];
  const magnitude = typeof finding.magnitude === "number" ? finding.magnitude : null;
  const magnitudeWidth = magnitude === null ? 0 : Math.max(0, Math.min(100, magnitude * 10));

  return (
    <section>
      <h3>Evidence snapshot</h3>
      <dl className="dn-evidence-snapshot">
        {firstMarker ? (
          <div>
            <dt>Your DNA</dt>
            <dd>{firstMarker.rsid} {firstMarker.genotype ?? "not found"}</dd>
          </div>
        ) : null}
        {finding.sourceGenotype ? (
          <div>
            <dt>Source genotype</dt>
            <dd>{finding.sourceGenotype}</dd>
          </div>
        ) : null}
        <div>
          <dt>Repute</dt>
          <dd><span className={`dn-repute-chip dn-repute-chip--${finding.repute}`}>{reputeValueLabel(finding.repute)}</span></dd>
        </div>
        {magnitude !== null ? (
          <div>
            <dt>SNPedia magnitude</dt>
            <dd>
              <strong>{formatMagnitude(magnitude)}</strong>
              <span className="dn-magnitude-bar" aria-label={`SNPedia magnitude ${formatMagnitude(magnitude)} out of 10`}>
                <i style={{ width: `${magnitudeWidth}%` }} />
              </span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Evidence</dt>
          <dd>{finding.evidenceTier} · {finding.publicationCount.toLocaleString()} publications</dd>
        </div>
      </dl>
    </section>
  );
}

function renderMarkdown(value: string): ReactNode {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const unorderedMatch = /^[-*]\s+(.+)$/.exec(line);
    if (unorderedMatch) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const itemLine = lines[index].trim();
        const itemMatch = /^[-*]\s+(.+)$/.exec(itemLine);
        if (!itemMatch) break;
        items.push(<li key={`markdown-li-${index}`}>{renderMarkdownInline(itemMatch[1])}</li>);
        index += 1;
      }
      blocks.push(<ul key={`markdown-ul-${index}`}>{items}</ul>);
      continue;
    }

    const orderedMatch = /^(\d+)\.\s+(.+)$/.exec(line);
    if (orderedMatch) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const itemLine = lines[index].trim();
        const itemMatch = /^(\d+)\.\s+(.+)$/.exec(itemLine);
        if (!itemMatch) break;
        items.push(<li key={`markdown-ol-li-${index}`}>{renderMarkdownInline(itemMatch[2])}</li>);
        index += 1;
      }
      blocks.push(<ol key={`markdown-ol-${index}`}>{items}</ol>);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index].trim();
      if (!paragraphLine) break;
      if (/^[-*]\s+/.test(paragraphLine) || /^\d+\.\s+/.test(paragraphLine)) break;
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    blocks.push(<p key={`markdown-p-${index}`}>{renderMarkdownInline(paragraphLines.join(" "))}</p>);
  }

  return blocks;
}

function ensureAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function renderMarkdownInline(value: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const tokenIndex = match.index ?? 0;
    if (tokenIndex > lastIndex) {
      nodes.push(value.slice(lastIndex, tokenIndex));
    }

    if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const label = token.slice(1, token.indexOf("]("));
      const url = token.slice(token.indexOf("](") + 2, -1).trim();
      nodes.push(
        <a key={`${tokenIndex}-${url}`} href={ensureAbsoluteUrl(url)} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(<strong key={tokenIndex}>{token.slice(2, -2)}</strong>);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      nodes.push(<em key={tokenIndex}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={tokenIndex}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(token);
    }
    lastIndex = tokenIndex + token.length;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : value;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="dn-field dn-field--select">
      <span>{label}</span>
      <div className="dn-select-control">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue || optionLabel} value={optionValue}>{optionLabel}</option>
          ))}
        </select>
        <Icon name="chevronDown" size={18} />
      </div>
    </label>
  );
}

function MultiFilterSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: Array<[string, string]>;
  onChange: (value: string[]) => void;
}) {
  const fieldId = useId();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter(([, optionLabel]) => optionLabel.toLowerCase().includes(normalizedQuery))
    : options;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  return (
    <div className="dn-filter-group">
      <span>{label}</span>
      <div className="dn-filter-checklist">
        <div className="dn-filter-checklist__actions">
          <span>{values.length === 0 ? "All" : `${values.length} selected`}</span>
          {values.length > 0 ? <button type="button" onClick={() => onChange([])}>Clear</button> : null}
        </div>
        <label className="dn-filter-search">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} />
        </label>
        <div className="dn-filter-checklist__options" role="listbox" aria-multiselectable="true">
          {visibleOptions.map(([optionValue, optionLabel], optionIndex) => {
            const optionId = `${fieldId}-${optionIndex}-${optionValue.replace(/[^a-z0-9_-]+/gi, "-")}`;
            return (
              <label key={optionValue} className="dn-filter-check" htmlFor={optionId}>
                <input
                  id={optionId}
                  className="dn-filter-check__input"
                  type="checkbox"
                  checked={values.includes(optionValue)}
                  onChange={() => toggle(optionValue)}
                />
                <span className="dn-filter-check__label">{optionLabel}</span>
              </label>
            );
          })}
          {visibleOptions.length === 0 ? <p>No matching options</p> : null}
        </div>
      </div>
    </div>
  );
}

function optionList(values: string[], emptyLabel: string): Array<[string, string]> {
  return [["", emptyLabel], ...values.map((value): [string, string] => [value, value])];
}

function summaryUnlessTitle(summary: string, title: string): string | null {
  const cleanedSummary = summary.trim();
  const normalizedSummary = cleanedSummary.replace(/\s+/g, " ").toLowerCase();
  const normalizedTitle = title.trim().replace(/\s+/g, " ").toLowerCase();
  return normalizedSummary && normalizedSummary !== normalizedTitle ? cleanedSummary : null;
}

function OverviewMetric({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <article className="dn-overview-metric">
      <Icon name={icon} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function labelForTab(tab: ExplorerTab): string {
  if (tab === "drug") return "Drug response";
  return tab[0].toUpperCase() + tab.slice(1);
}

function titleForTab(tab: InsightCategory): string {
  return tab === "drug" ? "Drug response explorer" : `${labelForTab(tab)} explorer`;
}

function iconForTab(tab: ExplorerTab): IconName {
  if (tab === "medical") return "heart";
  if (tab === "traits") return "leaf";
  if (tab === "drug") return "pill";
  return "home";
}

function toneForTab(tab: ExplorerTab): "green" | "coral" | "amber" {
  if (tab === "medical") return "coral";
  if (tab === "drug") return "amber";
  return "green";
}

function iconForSource(source: string): IconName {
  const normalized = source.toLowerCase();
  if (normalized.includes("pub")) return "book";
  if (normalized.includes("snp")) return "dna";
  if (normalized.includes("gwas")) return "chart";
  if (normalized.includes("cpic")) return "target";
  if (normalized.includes("pharm")) return "target";
  if (normalized.includes("clin")) return "shield";
  return "file";
}

function toneForEntry(entry: StoredReportEntry): "low" | "moderate" | "elevated" | "high" | "info" {
  if (entry.outcome === "missing") return "info";
  if (entry.outcome === "positive") return "low";
  if (entry.outcome === "negative") return entry.sort.severity > 70 ? "elevated" : "moderate";
  if (entry.evidenceTier === "high") return "high";
  return "info";
}

function hasSnpediaSource(entry: Pick<StoredReportEntry, "sources" | "subcategory">): boolean {
  return entry.subcategory === "snpedia" || entry.sources.some((source) => {
    const sourceKey = `${source.id} ${source.name}`.toLowerCase();
    return sourceKey.includes("snpedia");
  });
}

function reputeValueLabel(repute: ReportEntry["repute"]): string {
  if (repute === "good") return "Good";
  if (repute === "bad") return "Bad";
  if (repute === "mixed") return "Mixed";
  return "Not set";
}

function reputePriorityLabel(repute: ReportEntry["repute"]): string {
  if (repute === "not-set") return "Unrated";
  return `${reputeValueLabel(repute)} repute`;
}

function formatMagnitude(magnitude: number): string {
  return Number.isInteger(magnitude)
    ? String(magnitude)
    : new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(magnitude);
}

function evidenceSnapshotItems(entry: StoredReportEntry): Array<{ label: string; value: string }> {
  const firstMarker = entry.matchedMarkers[0];
  const snapshot: Array<{ label: string; value: string }> = [];

  if (firstMarker) {
    snapshot.push({ label: "DNA", value: `${firstMarker.rsid} ${firstMarker.genotype ?? "not found"}` });
  }

  if (typeof entry.magnitude === "number") {
    snapshot.push({ label: "Magnitude", value: formatMagnitude(entry.magnitude) });
  }

  return snapshot;
}

function priorityLabel(entry: StoredReportEntry): string {
  if (entry.outcome === "missing") return "Missing";
  if (hasSnpediaSource(entry)) return reputePriorityLabel(entry.repute);
  if (entry.category === "drug") return entry.evidenceTier === "high" ? "High relevance" : "PGx preview";
  if (entry.outcome === "positive") return "Lower concern";
  if (entry.sort.severity > 70) return "High priority";
  if (entry.sort.severity > 30) return "Moderate priority";
  return "Informational";
}
