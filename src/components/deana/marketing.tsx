import type { DragEvent } from "react";
import type { DnaParseProgress, EvidenceProgressSnapshot, ParsedDnaFile } from "../../types";
import { DeanaWordmark, Icon } from "./ui";

export const DEANA_GITHUB_URL = "https://github.com/steve228uk/deana";
export const DEANA_LICENSE_URL = `${DEANA_GITHUB_URL}/blob/HEAD/LICENSE.md`;
export const DEANA_SUBREDDIT_URL = "https://www.reddit.com/r/deanadna";
export const DEANA_SUPPORT_URL = "https://ko-fi.com/steve228uk";

export interface SavedReportCard {
  id: string;
  name: string;
  provider: string;
  build: string;
  markerCount: number;
  coverageScore: number;
  interpretedFindings: number;
  localEvidenceFindings: number;
  createdAt: string;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function MarketingFirstVisit({
  onUpload,
  onPrivacy,
  onSupport,
}: {
  onUpload?: () => void;
  onPrivacy?: () => void;
  onSupport?: () => void;
}) {
  return (
    <main className="dn-marketing-shell dn-marketing-shell--first">
      <header className="dn-marketing-header">
        <DeanaWordmark />
        <MarketingHeaderActions onPrivacy={onPrivacy} onSupport={onSupport} />
      </header>

      <section className="dn-hero dn-botanical-card">
        <div className="dn-leaf dn-leaf--left" aria-hidden="true" />
        <div className="dn-leaf dn-leaf--right" aria-hidden="true" />
        <p className="dn-eyebrow">Private by design</p>
        <h1>Private DNA reports, built in <em>your</em> browser.</h1>
        <p className="dn-hero-copy">
          Upload a raw DNA file from common microarray providers, then explore <strong>health insights</strong>, <strong>carrier status</strong>, <strong>traits</strong>, and <strong>evidence-backed findings</strong> without sending your raw DNA to Deana servers.
        </p>
        <div className="dn-hero-actions">
          <button className="dn-button dn-button--primary dn-button--large" onClick={onUpload}><Icon name="upload" /> Upload your DNA export</button>
        </div>
        <p className="dn-support-line">Supports .zip, .txt, .csv, .vcf, .vcf.gz, and .gz VCF files</p>
      </section>

      <section className="dn-simple-card dn-steps-card" id="how-it-works" aria-labelledby="how-it-works-title">
        <h2 id="how-it-works-title">Simple. Private. All on your device.</h2>
        <div className="dn-step-grid">
          <Step number="1" icon="upload" title="Upload DNA export" copy="Select your raw DNA file from a supported provider." />
          <Step number="2" icon="folder" title="Name and save profile" copy="Review the parsed file and choose a local profile name." />
          <Step number="3" icon="spark" title="Build report and open Explorer" copy="Process your data locally and explore your results." />
        </div>
      </section>

      <HomepageInfoRow />
      <AssuranceGrid />
      <HomepageFooter />
    </main>
  );
}

export function MarketingReturning({
  reports,
  onCreateNew,
  onOpenReport,
  onRemoveReport,
  onPrivacy,
  onSupport,
}: {
  reports: SavedReportCard[];
  onCreateNew?: () => void;
  onOpenReport?: (id: string) => void;
  onRemoveReport?: (id: string) => void;
  onPrivacy?: () => void;
  onSupport?: () => void;
}) {
  return (
    <main className="dn-marketing-shell dn-marketing-shell--returning">
      <header className="dn-marketing-header">
        <DeanaWordmark />
        <MarketingHeaderActions onCreateNew={onCreateNew} onPrivacy={onPrivacy} onSupport={onSupport} />
      </header>

      <section className="dn-hero dn-botanical-card">
        <div className="dn-leaf dn-leaf--left" aria-hidden="true" />
        <div className="dn-leaf dn-leaf--right" aria-hidden="true" />
        <h1>Welcome back. Pick up where <em>you</em> left off.</h1>
        <p className="dn-hero-copy">
          Open a saved report or create a new one to explore <strong>health insights</strong>, <strong>carrier status</strong>, <strong>traits</strong>, and <strong>evidence-backed findings</strong> all on your device.
        </p>
        <div className="dn-hero-actions">
          <button className="dn-button dn-button--primary dn-button--large" onClick={onCreateNew}><Icon name="plus" /> Create new report</button>
        </div>
      </section>

      <section className="dn-simple-card dn-report-list-card" aria-labelledby="recent-reports-title">
        <div className="dn-section-heading">
          <h2 id="recent-reports-title"><Icon name="clock" /> Recent reports</h2>
          <span>Saved locally</span>
        </div>
        <div className="dn-report-list">
          {reports.map((report) => (
            <article className="dn-report-row" key={report.id}>
              <span className="dn-round-icon"><Icon name="user" /></span>
              <div className="dn-report-row__main">
                <strong>{report.name}</strong>
                <span>{report.provider} · {report.build} · {report.markerCount.toLocaleString()} markers</span>
                <span>
                  Saved {formatDate(report.createdAt)} · {report.localEvidenceFindings.toLocaleString()} local evidence entries
                </span>
              </div>
              <div className="dn-coverage-badge" aria-label={`${report.coverageScore}% tracked coverage`}>{report.coverageScore}%</div>
              <button className="dn-button dn-button--secondary" onClick={() => onOpenReport?.(report.id)}><Icon name="folder" /> Open</button>
              <button className="dn-button dn-button--text" onClick={() => onRemoveReport?.(report.id)}>Remove</button>
            </article>
          ))}
        </div>
      </section>

      <HomepageInfoRow />
      <AssuranceGrid />
      <HomepageFooter />
    </main>
  );
}

function MarketingHeaderActions({
  onCreateNew,
  onPrivacy,
  onSupport,
}: {
  onCreateNew?: () => void;
  onPrivacy?: () => void;
  onSupport?: () => void;
}) {
  return (
    <nav className="dn-header-actions" aria-label="Homepage actions">
      <button className="dn-button dn-button--ghost dn-header-action-icon" aria-label="Support Deana" onClick={onSupport}><Icon name="heart" /> Support Deana</button>
      <button className="dn-button dn-button--ghost dn-header-action-icon" aria-label="About privacy" onClick={onPrivacy}><Icon name="lock" /> About privacy</button>
      {onCreateNew ? (
        <button className="dn-button dn-button--primary dn-hide-mobile" onClick={onCreateNew}><Icon name="plus" /> Create new report</button>
      ) : null}
    </nav>
  );
}

export function RemoveReportModal({
  report,
  isRemoving = false,
  error,
  onCancel,
  onConfirm,
}: {
  report: SavedReportCard;
  isRemoving?: boolean;
  error?: string | null;
  onCancel?: () => void;
  onConfirm?: () => void;
}) {
  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-report-title">
        <button className="dn-icon-button dn-modal-close" disabled={isRemoving} onClick={onCancel} aria-label="Close"><Icon name="x" /></button>
        <span className="dn-round-icon"><Icon name="alert" /></span>
        <h1 id="remove-report-title">Remove this report?</h1>
        <p className="dn-modal-intro">
          This will remove <strong>{report.name}</strong> and its saved report data from this browser.
        </p>
        <div className="dn-modal-actions">
          <button className="dn-button dn-button--secondary" disabled={isRemoving} onClick={onCancel}>Cancel</button>
          <button className="dn-button dn-button--coral" disabled={isRemoving} onClick={onConfirm}>
            {isRemoving ? "Removing..." : "Remove report"}
          </button>
        </div>
        {error ? <p className="dn-error-text" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

export function UploadReportModal({
  step,
  parsed,
  profileName = "",
  isParsing = false,
  parseProgress,
  isSaving = false,
  error,
  onClose,
  onFileChange,
  onProfileNameChange,
  onConfirm,
  onCancel,
}: {
  step: "choose-file" | "name-profile";
  parsed?: ParsedDnaFile;
  profileName?: string;
  isParsing?: boolean;
  parseProgress?: DnaParseProgress | null;
  isSaving?: boolean;
  error?: string | null;
  onClose?: () => void;
  onFileChange?: (file: File) => void;
  onProfileNameChange?: (value: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!isParsing) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (isParsing) return;

    const file = event.dataTransfer.files[0];
    if (file) {
      onFileChange?.(file);
    }
  }

  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title">
        <button className="dn-icon-button dn-modal-close" onClick={onClose} disabled={isParsing} aria-label="Close"><Icon name="x" /></button>
        <DeanaWordmark />
        <div className="dn-modal-stepper" aria-label="Upload steps">
          <span className={step === "name-profile" ? "is-complete" : "is-active"}>{step === "name-profile" ? <Icon name="check" /> : "1"} Upload file</span>
          <i />
          <span className={step === "name-profile" ? "is-active" : ""}>2 Name profile</span>
        </div>

        {step === "choose-file" ? (
          <>
            <h1 id="upload-modal-title">Upload your DNA export</h1>
            <p className="dn-modal-intro">{isParsing ? "Parsing your file locally..." : "Choose a supported raw DNA export. The file is parsed locally in your browser."}</p>
            {isParsing ? (
              <div className="dn-parse-status" role="status" aria-live="polite">
                <span className="dn-round-icon"><Icon name="dna" /></span>
                <strong>{parseProgress?.message ?? "Parsing locally..."}</strong>
                <div
                  className="dn-linear-progress"
                  aria-label={`${parseProgress?.percent ?? 0}% parsed`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={parseProgress?.percent ?? 0}
                  role="progressbar"
                >
                  <span style={{ width: `${parseProgress?.percent ?? 0}%` }} />
                </div>
                <div className="dn-progress-line">
                  <span>Working locally in this browser</span>
                  <strong>{parseProgress?.percent ?? 0}%</strong>
                </div>
              </div>
            ) : (
              <label
                className="dn-dropzone"
                onDragEnter={handleDragOver}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept=".zip,.txt,.csv,.vcf,.vcf.gz,.gz"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onFileChange?.(file);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="dn-round-icon"><Icon name="upload" /></span>
                <strong>Drag and drop your file here</strong>
                <span>or click to browse</span>
                <small>.zip, .txt, .csv, .vcf, .vcf.gz, or .gz VCF</small>
              </label>
            )}
            <p className="dn-support-line">Supports common rsID-backed microarray and VCF exports</p>
            <p className="dn-local-note"><Icon name="lock" /> Your file is never uploaded. Everything happens locally.</p>
          </>
        ) : (
          <>
            <h1 id="upload-modal-title">Create a new local report.</h1>
            <p className="dn-modal-intro">Your file has been parsed. Choose a profile name before building your report.</p>
            <article className="dn-parsed-file-card">
              <span className="dn-round-icon"><Icon name="file" /></span>
              <dl>
                <div><dt>Provider</dt><dd>{parsed?.provider}</dd></div>
                <div><dt>Reference build</dt><dd>{parsed?.build}</dd></div>
                <div><dt>Markers parsed</dt><dd>{parsed?.markerCount.toLocaleString()}</dd></div>
                <div><dt>Imported file</dt><dd>{parsed?.fileName}</dd></div>
              </dl>
            </article>
            <label className="dn-field" htmlFor="profile-name">
              <span>Profile name</span>
              <input id="profile-name" value={profileName} onChange={(event) => onProfileNameChange?.(event.target.value)} placeholder="Stephen" />
            </label>
            <div className="dn-callout dn-callout--success"><Icon name="shield" /> Your file is parsed locally. No DNA is uploaded to Deana.</div>
            <div className="dn-callout"><Icon name="help" /> Public evidence sources are matched locally from the bundled evidence pack.</div>
            <div className="dn-modal-actions">
              <button className="dn-button dn-button--secondary" onClick={onCancel}>Cancel</button>
              <button className="dn-button dn-button--primary" disabled={isSaving || !profileName.trim()} onClick={onConfirm}><Icon name="upload" /> {isSaving ? "Building report..." : "Save and build report"}</button>
            </div>
            <p className="dn-support-line">Supports .zip, .txt, .csv, .vcf, .vcf.gz, .gz VCF · rsID-backed microarray and VCF exports</p>
          </>
        )}
        {error ? <p className="dn-error-text" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

export function MarketingProcessing({
  snapshot,
  error,
  mode = "create",
  onPrivacy,
  onBackHome,
}: {
  snapshot: EvidenceProgressSnapshot;
  error?: string | null;
  mode?: "create" | "refresh";
  onPrivacy?: () => void;
  onBackHome?: () => void;
}) {
  const isRefreshMode = mode === "refresh";
  const heroVerb = isRefreshMode ? "Refreshing" : "Building";
  const bodyVerb = isRefreshMode ? "rematches" : "processes";
  const progressTitle = isRefreshMode ? "Refreshing evidence" : "Processing your data";
  const isPreparingPack = snapshot.packStage && snapshot.packStage !== "matching";
  const percent = isPreparingPack
    ? 20
    : snapshot.totalRsids > 0
      ? Math.round((snapshot.processedRsids / snapshot.totalRsids) * 100)
      : 0;
  const isSavingReport = snapshot.packStage === "saving";
  const isIndexingReport = snapshot.packStage === "indexing";
  let blockingReportMessage: string | null = null;
  if (isIndexingReport) {
    blockingReportMessage = "Building search index…";
  } else if (isSavingReport) {
    blockingReportMessage = "Saving your report…";
  }
  const progressSummary = isPreparingPack
    ? <span>Loading fixed evidence pack <strong>{snapshot.packVersion ?? "locally"}</strong></span>
    : (
      <span>Comparing <strong>{snapshot.processedRsids.toLocaleString()}</strong> of <strong>{snapshot.totalRsids.toLocaleString()}</strong> uploaded rsIDs locally</span>
    );
  const currentLabel = isPreparingPack ? "Evidence pack" : "Current step";
  const currentValue = snapshot.currentRsid ?? "Starting...";

  return (
    <main className="dn-marketing-shell dn-processing-shell">
      <header className="dn-marketing-header">
        <DeanaWordmark />
        <nav className="dn-header-actions" aria-label="Processing actions">
          <button className="dn-button dn-button--ghost" onClick={onPrivacy}><Icon name="lock" /> About privacy</button>
        </nav>
      </header>

      <section className="dn-processing-hero dn-botanical-card">
        <div className="dn-leaf dn-leaf--left" aria-hidden="true" />
        <div className="dn-leaf dn-leaf--right" aria-hidden="true" />
        <h1>{heroVerb} <em>your</em> private report</h1>
        <p>
          Keep this tab open while Deana {bodyVerb} bundled evidence sources and saves your report in this browser.
        </p>
        <div className="dn-warning"><Icon name="alert" /> Do not close your browser while processing.</div>
      </section>

      <section className="dn-simple-card dn-processing-card" aria-label="Processing progress">
        <h2>{progressTitle}</h2>
        {blockingReportMessage ? (
          <div className="dn-processing-saving" role="status" aria-live="polite">
            <div className="dn-loading-indicator" aria-hidden="true" />
            <p>{blockingReportMessage}</p>
          </div>
        ) : (
          <>
            <div className="dn-linear-progress" aria-label={`${percent}% complete`}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="dn-progress-line">
              {progressSummary}
              <strong>{percent}%</strong>
            </div>
            <p className="dn-muted">{currentLabel}: <strong>{currentValue}</strong></p>
          </>
        )}
      </section>

      <section className="dn-metric-grid" aria-label="Processing metrics">
        <Metric icon="upload" label="Uploaded rsIDs" value={snapshot.totalRsids} />
        <Metric icon="check" label="Processed" value={snapshot.processedRsids} />
        <Metric icon="spark" label="Matched findings" value={snapshot.matchedFindings} />
        <Metric icon="x" label="Unmatched" value={snapshot.unmatchedRsids} />
        <Metric icon="alert" label="Failed" value={snapshot.failedRsids} tone="coral" />
        <Metric icon="refresh" label="Retries" value={snapshot.retries} />
      </section>

      {error ? (
        <section className="dn-callout dn-callout--error" role="alert">
          <Icon name="alert" />
          <div>
            <strong>Processing could not finish.</strong>
            <p>{error}</p>
            <button className="dn-button dn-button--secondary" onClick={onBackHome}>Back home</button>
          </div>
        </section>
      ) : null}

      <section className="dn-privacy-banner dn-processing-privacy">
        <span className="dn-round-icon"><Icon name="shield" /></span>
        <div>
          <h2>Your raw DNA stays private on your device.</h2>
          <p>Evidence is matched on your device from the bundled local pack.</p>
        </div>
      </section>

      <p className="dn-processing-footnote"><Icon name="clock" /> This may take a while depending on file size and connection.</p>
    </main>
  );
}

export function PrivacyModal({ onClose, onGithub }: { onClose?: () => void; onGithub?: () => void }) {
  const points = [
    ["shield", "Your raw DNA stays on your device", "Deana does not upload or store your raw DNA file or finished reports on its own servers."],
    ["folder", "Saved only in this browser", "Reports are stored locally in this browser, so you can reopen them later or remove them at any time."],
    ["globe", "Evidence matching is local", "Deana uses a fixed local evidence pack without sending marker requests from your browser."],
    ["code", "Source available and transparent", "You can inspect the code, understand how the tool works, and review the project on GitHub."],
  ] as const;

  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <button className="dn-icon-button dn-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        <DeanaWordmark compact />
        <h1 id="privacy-title">About your privacy</h1>
        <p className="dn-modal-intro">Deana is designed to keep your DNA data local and make privacy easy to understand.</p>
        <div className="dn-privacy-point-list">
          {points.map(([icon, title, copy], index) => (
            <article className="dn-privacy-point" key={title}>
              <span className="dn-round-icon"><Icon name={icon} /></span>
              <div>
                <h2>{index + 1}. {title}</h2>
                <p>{copy}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="dn-modal-actions">
          <button className="dn-button dn-button--secondary" onClick={onGithub}><Icon name="external" /> Learn more on GitHub</button>
          <button className="dn-button dn-button--primary" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

export function SupportDeanaModal({ onClose }: { onClose?: () => void }) {
  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-support-modal" role="dialog" aria-modal="true" aria-labelledby="support-title">
        <button className="dn-icon-button dn-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        <span className="dn-round-icon"><Icon name="heart" /></span>
        <h1 id="support-title">Support Deana</h1>
        <p className="dn-modal-intro">
          Deana is a small project I build and run myself. I made it because I have always cared about people
          owning their own data, keeping private things private, and using tech for preventative medicine.
        </p>
        <div className="dn-support-copy">
          <p>
            If Deana has been useful to you, Ko-fi helps pay for the less glamorous bits: hosting,
            ongoing development, and the AI tokens used by the optional chat features.
          </p>
          <p>
            There is no account or subscription. A Ko-fi contribution just helps me keep improving Deana and keep it online.
          </p>
        </div>
        <div className="dn-modal-actions">
          <a className="dn-button dn-button--primary" href={DEANA_SUPPORT_URL} target="_blank" rel="noreferrer">
            <Icon name="heart" /> Support on Ko-fi
          </a>
          <button className="dn-button dn-button--secondary" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function Step({ number, icon, title, copy }: { number: string; icon: Parameters<typeof Icon>[0]["name"]; title: string; copy: string }) {
  return (
    <article className="dn-step-card">
      <span className="dn-step-visual">
        <span className="dn-round-icon"><Icon name={icon} /></span>
        <span className="dn-step-number">{number}</span>
      </span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

function ExplorerTeaser() {
  const features = [
    ["heart", "Health insights"],
    ["user", "Carrier status"],
    ["spark", "Traits"],
    ["chat", "Opt-in AI chat"],
    ["book", "Source links"],
    ["search", "Filters & search"],
  ] as const;

  return (
    <section className="dn-explorer-teaser" aria-label="What you can do in Explorer">
      <div className="dn-explorer-teaser-head">
        <span className="dn-round-icon"><Icon name="search" /></span>
        <div>
          <h2>Explore in your private Explorer</h2>
          <p>Search, filter, inspect, and optionally chat with AI about your local report without sending raw DNA to Deana.</p>
        </div>
      </div>
      <div className="dn-teaser-grid">
        {features.map(([icon, label]) => (
          <span key={label}><Icon name={icon} /> {label}</span>
        ))}
      </div>
    </section>
  );
}

function HomepageInfoRow() {
  return (
    <div className="dn-home-info-row">
      <ExplorerTeaser />
      <DataSourcesCard />
    </div>
  );
}

function DataSourcesCard() {
  return (
    <section className="dn-data-sources-card" aria-labelledby="data-sources-title">
      <div className="dn-data-sources-head">
        <span className="dn-round-icon"><Icon name="book" /></span>
        <h2 id="data-sources-title">Data sources</h2>
      </div>
      <p>
        Deana uses public evidence sources for clinical, trait, frequency, and literature context.
      </p>
      <dl className="dn-source-summary-list">
        <div>
          <dt>Clinical</dt>
          <dd>ClinVar, CPIC</dd>
        </div>
        <div>
          <dt>Traits</dt>
          <dd>GWAS Catalog, PubMed</dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd>gnomAD, SNPedia</dd>
        </div>
      </dl>
      <p className="dn-source-note">
        <Icon name="globe" /> Processing uses bundled public sources matched locally from the evidence pack.
      </p>
    </section>
  );
}

function AssuranceGrid() {
  return (
    <div className="dn-assurance-grid">
      <PrivacyBanner />
      <OpenSourceBanner />
    </div>
  );
}

function PrivacyBanner() {
  return (
    <section className="dn-privacy-banner">
      <span className="dn-round-icon"><Icon name="shield" /></span>
      <div>
        <h2>Your data stays private.</h2>
        <div className="dn-assurance-points">
          <p><Icon name="check" /> Processed locally on your device</p>
          <p><Icon name="check" /> No raw DNA uploaded to Deana</p>
          <p><Icon name="check" /> AI chat is opt-in and uses Vercel AI Gateway with zero data retention enabled</p>
        </div>
      </div>
    </section>
  );
}

function OpenSourceBanner() {
  return (
    <section className="dn-privacy-banner dn-privacy-banner--source">
      <span className="dn-round-icon"><Icon name="code" /></span>
      <div>
        <h2>Free for non-commercial use.</h2>
        <div className="dn-assurance-points">
          <p><Icon name="check" /> Source available on GitHub</p>
          <p><Icon name="check" /> No account or subscription required</p>
        </div>
        <a className="dn-button dn-button--secondary" href={DEANA_GITHUB_URL} target="_blank" rel="noreferrer">
          <Icon name="external" /> View on GitHub
        </a>
      </div>
    </section>
  );
}

function HomepageFooter() {
  return (
    <footer className="dn-home-footer">
      <span>&copy; 2026 Stephen Radford</span>
      <a href={DEANA_SUBREDDIT_URL} target="_blank" rel="noreferrer">r/deanadna</a>
      <a href={DEANA_LICENSE_URL} target="_blank" rel="noreferrer">Non-commercial license</a>
    </footer>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: number;
  tone?: "coral";
}) {
  return (
    <article className={`dn-metric-card ${tone === "coral" ? "dn-metric-card--coral" : ""}`}>
      <span className="dn-round-icon"><Icon name={icon} /></span>
      <div>
        <span>{label}</span>
        <strong>{value.toLocaleString()}</strong>
      </div>
    </article>
  );
}
