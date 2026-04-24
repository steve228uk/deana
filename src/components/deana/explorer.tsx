import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExplorerFilters } from "../../lib/explorer";
import type { ExplorerTab, ProfileMeta, RawMarkerResult, ReportEntry, StoredReportEntry } from "../../types";
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
  { id: "raw", label: "Raw markers" },
];

const nav: Array<{ id: ExplorerTab; label: string; icon: IconName }> = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "medical", label: "Medical", icon: "heart" },
  { id: "traits", label: "Traits", icon: "leaf" },
  { id: "drug", label: "Drug response", icon: "pill" },
  { id: "raw", label: "Raw markers", icon: "list" },
];

export function ExplorerShell({
  report,
  activeTab,
  children,
  isExporting,
  onTabChange,
  onExportHtml,
  onPrint,
  onBackHome,
}: {
  report: ExplorerReportCard;
  activeTab: ExplorerTab;
  children: ReactNode;
  isExporting?: boolean;
  onTabChange?: (tab: ExplorerTab) => void;
  onExportHtml?: () => void;
  onPrint?: () => void;
  onBackHome?: () => void;
}) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  function runExportAction(action?: () => void) {
    setIsExportMenuOpen(false);
    action?.();
  }

  return (
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
          {nav.map((item) => (
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
          <button><Icon name="settings" /> <span>Settings</span></button>
          <button><Icon name="help" /> <span>Help</span></button>
        </nav>
        <div className="dn-sidebar-privacy"><Icon name="lock" /> Your data stays on this device. <button>Learn more</button></div>
      </aside>

      <div className="dn-explorer-main">
        <header className="dn-explorer-topbar">
          {activeTab === "overview" ? null : <span className="dn-screen-reader-text">Current report</span>}
          <DeanaWordmark compact className="dn-show-mobile" />
          <button className="dn-report-selector" onClick={onBackHome}>
            <Icon name="file" />
            <span><strong>{report.name}</strong><small>{report.provider} · {report.build} · {report.markerCount.toLocaleString()} markers</small></span>
          </button>
          <span className="dn-local-status"><Icon name="shield" /> All analysis is local <i /></span>
          <div className="dn-export-menu">
            <button
              className="dn-button dn-button--secondary"
              aria-haspopup="menu"
              aria-expanded={isExportMenuOpen}
              onClick={() => setIsExportMenuOpen((value) => !value)}
            >
              <Icon name="download" /> Export
            </button>
            {isExportMenuOpen ? (
              <div className="dn-export-menu__panel" role="menu">
                <button role="menuitem" onClick={() => runExportAction(onExportHtml)} disabled={isExporting}>
                  <Icon name="download" /> {isExporting ? "Preparing..." : "Export HTML"}
                </button>
                <button role="menuitem" onClick={() => runExportAction(onPrint)}>
                  <Icon name="print" /> Print / PDF
                </button>
              </div>
            ) : null}
          </div>
          <button className="dn-icon-button dn-hide-mobile" aria-label="Help"><Icon name="help" /></button>
          <button className="dn-avatar dn-hide-mobile">{initials(report.name)}</button>
          <button className="dn-icon-button dn-show-mobile" aria-label="Menu"><Icon name="menu" /></button>
        </header>

        <nav className="dn-tabbar" aria-label="Explorer sections">
          {tabs.map((tab) => (
            <button key={tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => onTabChange?.(tab.id)}>{tab.label}</button>
          ))}
        </nav>

        {children}
      </div>
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
  const categories = profile.report.tabs.filter((tab) => tab.tab !== "overview" && tab.tab !== "raw");
  const totalFindings = categories.reduce((sum, category) => sum + category.count, 0);

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
        <OverviewMetric icon="file" label="Total findings" value={totalFindings.toLocaleString()} />
      </section>

      <section className="dn-simple-card dn-category-jump-card">
        <h2>Start with the strongest signal</h2>
        <div className="dn-category-grid">
          {categories.map((category) => (
            <article key={category.tab} className={`dn-category-card dn-tone-${toneForTab(category.tab)}`}>
              <span className="dn-round-icon"><Icon name={iconForTab(category.tab)} /></span>
              <h3>{labelForTab(category.tab)}</h3>
              <strong>{category.count.toLocaleString()} <span>curated findings</span></strong>
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
          <h2>SNPedia processing</h2>
          <dl>
            <div><dt>Status</dt><dd>{profile.report.overview.snpediaStatus}</dd></div>
            <div><dt>Processed rsIDs</dt><dd>{profile.report.overview.snpediaProcessedRsids.toLocaleString()}</dd></div>
            <div><dt>Matched findings</dt><dd>{profile.report.overview.snpediaMatchedFindings.toLocaleString()}</dd></div>
            <div><dt>Failed lookups</dt><dd>{profile.report.overview.snpediaFailedRsids.toLocaleString()}</dd></div>
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
  activeTab: Exclude<ExplorerTab, "overview" | "raw">;
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
            <label className="dn-field dn-field--search">
              <span>Search</span>
              <div><Icon name="search" /><input value={filters.q} onChange={(event) => onFilterChange("q", event.target.value)} placeholder="Search findings..." /></div>
            </label>
            <FilterSelect label="Sort" value={filters.sort} onChange={(value) => onFilterChange("sort", value)} options={[["severity", "Severity / priority"], ["evidence", "Evidence strength"], ["publications", "Publication count"], ["alphabetical", "Alphabetical"]]} />
            <FilterSelect label="Source" value={filters.source} onChange={(value) => onFilterChange("source", value)} options={optionList(profile.report.facets.sources, "All sources")} />
            <FilterSelect label="Evidence level" value={filters.evidence} onChange={(value) => onFilterChange("evidence", value)} options={optionList(profile.report.facets.evidenceTiers, "All evidence")} />
            <FilterSelect label="Clinical significance" value={filters.significance} onChange={(value) => onFilterChange("significance", value)} options={optionList(profile.report.facets.clinicalSignificances, "All significance")} />
            <FilterSelect label="Repute" value={filters.repute} onChange={(value) => onFilterChange("repute", value)} options={optionList(profile.report.facets.reputes, "All repute")} />
            <FilterSelect label="Coverage" value={filters.coverage} onChange={(value) => onFilterChange("coverage", value)} options={optionList(profile.report.facets.coverages, "All coverage")} />
            <FilterSelect label="Publication bucket" value={filters.publications} onChange={(value) => onFilterChange("publications", value)} options={optionList(profile.report.facets.publicationBuckets, "All publication buckets")} />
            <FilterSelect label="Gene" value={filters.gene} onChange={(value) => onFilterChange("gene", value)} options={optionList(profile.report.facets.genes, "All genes")} />
            <FilterSelect label="Topic / condition" value={filters.tag} onChange={(value) => onFilterChange("tag", value)} options={optionList([...profile.report.facets.tags, ...profile.report.facets.conditions].filter((value, index, array) => array.indexOf(value) === index).sort(), "All topics")} />
            <div className="dn-callout dn-callout--success"><Icon name="shield" /> Filters saved locally</div>
          </>
        )}
      </aside>

      <section className="dn-finding-list-panel">
        <div className="dn-category-title-row">
          <div>
            <h1>{titleForTab(activeTab)}</h1>
            <p>{isLoading ? "Loading..." : `${entries.length.toLocaleString()} visible results${hasMore ? "+" : ""}`}</p>
          </div>
          <button className="dn-button dn-button--secondary dn-show-mobile"><Icon name="filter" /> Filters</button>
        </div>

        <div className="dn-chip-row">
          <span>Sort: {sortLabel(filters.sort)} <button onClick={() => onFilterChange("sort", "severity")}>x</button></span>
          {filters.source ? <span>Source: {filters.source} <button onClick={() => onFilterChange("source", "")}>x</button></span> : null}
          {filters.q ? <span>Search: {filters.q} <button onClick={() => onFilterChange("q", "")}>x</button></span> : null}
          <button onClick={onResetFilters}>Clear all</button>
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
    </main>
  );
}

export function RawMarkersContent({
  markers,
  isLoading,
  onJump,
}: {
  markers: RawMarkerResult[];
  isLoading: boolean;
  onJump: (entryId: string, category: ReportEntry["category"]) => void;
}) {
  return (
    <main className="dn-category-screen dn-raw-screen">
      <section className="dn-finding-list-panel dn-raw-list-panel">
        <div className="dn-category-title-row">
          <div>
            <h1>Raw markers</h1>
            <p>{isLoading ? "Loading links..." : `${markers.length.toLocaleString()} visible markers`}</p>
          </div>
        </div>
        <div className="dn-finding-list">
          {markers.map((marker) => (
            <article className="dn-raw-marker-card" key={marker.rsid}>
              <div>
                <h2>{marker.rsid}</h2>
                <p>Chr {marker.chromosome} · {marker.position.toLocaleString()} · genotype {marker.genotype}</p>
              </div>
              <div className="dn-raw-marker-links">
                {marker.linkedEntries.length === 0 ? (
                  <span>No curated interpretation linked</span>
                ) : (
                  marker.linkedEntries.map((entry) => (
                    <button key={entry.id} className="dn-button dn-button--secondary" onClick={() => onJump(entry.id, entry.category)}>
                      {entry.title}
                    </button>
                  ))
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function FindingCard({ entry, selected, onClick }: { entry: StoredReportEntry; selected?: boolean; onClick?: () => void }) {
  const firstMarker = entry.matchedMarkers[0];

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
        <p>{entry.summary}</p>
        <div className="dn-finding-card__foot">
          <span><Icon name="file" /> {entry.publicationCount.toLocaleString()} publications</span>
          {entry.genes[0] ? <span><Icon name="dna" /> {entry.genes.join(", ")}</span> : null}
        </div>
      </div>
      <Icon name="external" />
    </button>
  );
}

function FindingInspector({ finding }: { finding: StoredReportEntry | null }) {
  const inspectorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!inspectorRef.current) return;
    inspectorRef.current.scrollTop = 0;
  }, [finding?.id]);

  if (!finding) {
    return (
      <aside ref={inspectorRef} className="dn-inspector" aria-label="Finding inspector">
        <p className="dn-eyebrow">Inspector</p>
        <h2>Select a finding</h2>
        <p>Choose a result to review genotype context, evidence, warnings, and source links.</p>
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
  return (
    <section className="dn-mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-finding-title">
      <div className="dn-sheet-handle" />
      <button className="dn-icon-button dn-modal-close" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      <FindingDetailContent finding={finding} titleId="mobile-finding-title" titleLevel="h1" />
    </section>
  );
}

function FindingDetailContent({
  finding,
  titleId,
  titleLevel,
}: {
  finding: StoredReportEntry;
  titleId?: string;
  titleLevel: "h1" | "h2";
}) {
  const Title = titleLevel;

  return (
    <>
      <p className="dn-eyebrow">Inspector</p>
      <Title id={titleId}>{finding.title}</Title>
      <span className={`dn-priority-pill dn-finding-tone-${toneForEntry(finding)}`}>{priorityLabel(finding)}</span>
      <p className="dn-inspector__intro">{finding.summary}</p>
      <section>
        <h3>Genotype found</h3>
        <p>{finding.genotypeSummary}</p>
      </section>
      <section>
        <h3>Why it matters</h3>
        <p>{finding.whyItMatters}</p>
      </section>
      <section>
        <h3>Confidence / evidence</h3>
        <p>{finding.confidenceNote}</p>
      </section>
      {finding.warnings.length > 0 ? (
        <section>
          <h3>Warnings</h3>
          <ul>
            {finding.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}
      <section>
        <h3>Sources</h3>
        <div className="dn-source-link-list">
          {finding.sources.map((source) => (
            <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
              <span>{source.name}</span>
              <small>{source.id}</small>
              <Icon name="external" />
            </a>
          ))}
        </div>
      </section>
      <div className="dn-callout"><Icon name="alert" /> Informational only. Do not use for diagnosis or medication decisions.</div>
      <div className="dn-callout dn-callout--success"><Icon name="lock" /> Private by design. Your DNA stays on this device.</div>
    </>
  );
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

function optionList(values: string[], emptyLabel: string): Array<[string, string]> {
  return [["", emptyLabel], ...values.map((value): [string, string] => [value, value])];
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "D";
}

function labelForTab(tab: ExplorerTab): string {
  if (tab === "drug") return "Drug response";
  if (tab === "raw") return "Raw markers";
  return tab[0].toUpperCase() + tab.slice(1);
}

function titleForTab(tab: Exclude<ExplorerTab, "overview" | "raw">): string {
  return tab === "drug" ? "Drug response explorer" : `${labelForTab(tab)} explorer`;
}

function iconForTab(tab: ExplorerTab): IconName {
  if (tab === "medical") return "heart";
  if (tab === "traits") return "leaf";
  if (tab === "drug") return "pill";
  if (tab === "raw") return "list";
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
  if (normalized.includes("clin")) return "shield";
  if (normalized.includes("gwas")) return "chart";
  if (normalized.includes("cpic")) return "target";
  return "file";
}

function toneForEntry(entry: StoredReportEntry): "low" | "moderate" | "elevated" | "high" | "info" {
  if (entry.tone === "good") return "low";
  if (entry.tone === "caution") return entry.sort.severity > 70 ? "elevated" : "moderate";
  if (entry.evidenceTier === "high") return "high";
  return "info";
}

function priorityLabel(entry: StoredReportEntry): string {
  if (entry.category === "drug") return entry.evidenceTier === "high" ? "High relevance" : "PGx preview";
  if (entry.tone === "good") return "Low";
  if (entry.sort.severity > 70) return "Elevated";
  if (entry.sort.severity > 30) return "Moderate";
  return "Informational";
}

function sortLabel(sort: string): string {
  if (sort === "alphabetical") return "Alphabetical";
  if (sort === "publications") return "Publication count";
  if (sort === "evidence") return "Evidence strength";
  return "Severity / priority";
}
