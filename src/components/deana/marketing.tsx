import type { ParsedDnaFile, SnpediaProgressSnapshot } from "../../types";
import { DeanaWordmark, Icon } from "./ui";

export interface SavedReportCard {
  id: string;
  name: string;
  provider: string;
  build: string;
  markerCount: number;
  coverageScore: number;
  totalFindings: number;
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
  onHowItWorks,
}: {
  onUpload?: () => void;
  onPrivacy?: () => void;
  onHowItWorks?: () => void;
}) {
  return (
    <main className="dn-marketing-shell dn-marketing-shell--first">
      <header className="dn-marketing-header">
        <DeanaWordmark />
        <nav className="dn-header-actions" aria-label="Homepage actions">
          <button className="dn-button dn-button--ghost" onClick={onPrivacy}><Icon name="lock" /> About privacy</button>
          <button className="dn-button dn-button--ghost dn-hide-mobile" onClick={onHowItWorks}><Icon name="help" /> How it works</button>
          <button className="dn-icon-button dn-show-mobile" aria-label="Menu"><Icon name="menu" /></button>
        </nav>
      </header>

      <section className="dn-hero dn-botanical-card">
        <div className="dn-leaf dn-leaf--left" aria-hidden="true" />
        <div className="dn-leaf dn-leaf--right" aria-hidden="true" />
        <p className="dn-eyebrow">Private by design</p>
        <h1>Private DNA reports, built in <em>your</em> browser.</h1>
        <p className="dn-hero-copy">
          Upload a raw DNA file from AncestryDNA, 23andMe, MyHeritage, or FamilyTreeDNA, then explore <strong>health insights</strong>, <strong>carrier status</strong>, <strong>traits</strong>, and <strong>evidence-backed findings</strong> without sending your raw DNA to Deana servers.
        </p>
        <div className="dn-hero-actions">
          <button className="dn-button dn-button--primary dn-button--large" onClick={onUpload}><Icon name="upload" /> Upload your DNA export</button>
          <button className="dn-button dn-button--secondary dn-button--large" onClick={onHowItWorks}><Icon name="help" /> How it works</button>
        </div>
        <p className="dn-support-line">Supports .zip, .txt, .csv, and .gz files</p>
      </section>

      <section className="dn-simple-card dn-steps-card" id="how-it-works" aria-labelledby="how-it-works-title">
        <h2 id="how-it-works-title">Simple. Private. All on your device.</h2>
        <div className="dn-step-grid">
          <Step number="1" icon="upload" title="Upload DNA export" copy="Select your raw DNA file from a supported provider." />
          <Step number="2" icon="folder" title="Name and save profile" copy="Review the parsed file and choose a local profile name." />
          <Step number="3" icon="spark" title="Build report and open Explorer" copy="Process your data locally and explore your results." />
        </div>
      </section>

      <ExplorerTeaser />
      <PrivacyBanner />
    </main>
  );
}

export function MarketingReturning({
  reports,
  onCreateNew,
  onOpenReport,
  onRemoveReport,
  onPrivacy,
  onHowItWorks,
}: {
  reports: SavedReportCard[];
  onCreateNew?: () => void;
  onOpenReport?: (id: string) => void;
  onRemoveReport?: (id: string) => void;
  onPrivacy?: () => void;
  onHowItWorks?: () => void;
}) {
  return (
    <main className="dn-marketing-shell dn-marketing-shell--returning">
      <header className="dn-marketing-header">
        <DeanaWordmark />
        <nav className="dn-header-actions" aria-label="Homepage actions">
          <button className="dn-button dn-button--ghost dn-hide-mobile" onClick={onPrivacy}><Icon name="lock" /> About privacy</button>
          <button className="dn-button dn-button--primary dn-hide-mobile" onClick={onCreateNew}><Icon name="plus" /> Create new report</button>
          <button className="dn-icon-button dn-show-mobile" aria-label="Menu"><Icon name="menu" /></button>
        </nav>
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
          <button className="dn-button dn-button--secondary dn-button--large" onClick={onHowItWorks}><Icon name="help" /> How Deana works</button>
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
                <span>Saved {formatDate(report.createdAt)}</span>
              </div>
              <div className="dn-coverage-badge" aria-label={`${report.coverageScore}% tracked coverage`}>{report.coverageScore}%</div>
              <button className="dn-button dn-button--secondary" onClick={() => onOpenReport?.(report.id)}><Icon name="folder" /> Open</button>
              <button className="dn-button dn-button--text" onClick={() => onRemoveReport?.(report.id)}>Remove</button>
            </article>
          ))}
        </div>
      </section>

      <section className="dn-privacy-banner">
        <span className="dn-round-icon"><Icon name="shield" /></span>
        <div>
          <h2>Your reports are saved only in this browser.</h2>
          <p>We never upload or store your DNA data. You are in control.</p>
        </div>
      </section>
      <ExplorerTeaser />
    </main>
  );
}

export function UploadReportModal({
  step,
  parsed,
  profileName = "",
  isParsing = false,
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
  isSaving?: boolean;
  error?: string | null;
  onClose?: () => void;
  onFileChange?: (file: File) => void;
  onProfileNameChange?: (value: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="dn-modal-backdrop" role="presentation">
      <section className="dn-modal dn-upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-modal-title">
        <button className="dn-icon-button dn-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
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
            <label className={`dn-dropzone ${isParsing ? "is-loading" : ""}`}>
              <input
                type="file"
                accept=".zip,.txt,.csv,.gz"
                disabled={isParsing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFileChange?.(file);
                  event.currentTarget.value = "";
                }}
              />
              <span className="dn-round-icon"><Icon name="upload" /></span>
              <strong>{isParsing ? "Parsing locally..." : "Drag and drop your file here"}</strong>
              <span>or click to browse</span>
              <small>.zip, .txt, .csv, or .gz</small>
            </label>
            <p className="dn-support-line">Supports AncestryDNA, 23andMe, MyHeritage, and FamilyTreeDNA</p>
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
            <div className="dn-callout"><Icon name="help" /> When you continue, your browser may request matching rsIDs from public sources such as SNPedia.</div>
            <div className="dn-modal-actions">
              <button className="dn-button dn-button--secondary" onClick={onCancel}>Cancel</button>
              <button className="dn-button dn-button--primary" disabled={isSaving || !profileName.trim()} onClick={onConfirm}><Icon name="upload" /> {isSaving ? "Building report..." : "Save and build report"}</button>
            </div>
            <p className="dn-support-line">Supports .zip, .txt, .csv, .gz · AncestryDNA, 23andMe, MyHeritage, FamilyTreeDNA</p>
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
  onPrivacy,
  onBackHome,
}: {
  snapshot: SnpediaProgressSnapshot;
  error?: string | null;
  onPrivacy?: () => void;
  onBackHome?: () => void;
}) {
  const isSyncingSnpediaSnapshot = typeof snapshot.snpediaSnapshotPage === "number";
  const snapshotTotalPages = snapshot.snpediaSnapshotTotalPages ?? null;
  const percent = isSyncingSnpediaSnapshot
    ? snapshotTotalPages
      ? Math.round((snapshot.snpediaSnapshotPage! / snapshotTotalPages) * 100)
      : Math.min(95, snapshot.snpediaSnapshotPage! * 5)
    : snapshot.totalRsids > 0
      ? Math.round((snapshot.processedRsids / snapshot.totalRsids) * 100)
      : 0;
  const progressSummary = isSyncingSnpediaSnapshot
    ? snapshotTotalPages
      ? (
        <span>
          Syncing SNPedia page <strong>{snapshot.snpediaSnapshotPage!.toLocaleString()}</strong> of{" "}
          <strong>{snapshotTotalPages.toLocaleString()}</strong>
        </span>
      )
      : (
        <span>
          Syncing SNPedia page <strong>{snapshot.snpediaSnapshotPage!.toLocaleString()}</strong>
        </span>
      )
    : (
      <span>Comparing <strong>{snapshot.processedRsids.toLocaleString()}</strong> of <strong>{snapshot.totalRsids.toLocaleString()}</strong> uploaded rsIDs</span>
    );
  const currentLabel = isSyncingSnpediaSnapshot ? "SNPedia snapshot" : "Current marker";
  const currentValue = isSyncingSnpediaSnapshot
    ? `${(snapshot.snpediaSnapshotRsids ?? 0).toLocaleString()} documented rsIDs found so far`
    : snapshot.currentRsid ?? "Starting...";

  return (
    <main className="dn-marketing-shell dn-processing-shell">
      <header className="dn-marketing-header">
        <DeanaWordmark />
        <nav className="dn-header-actions" aria-label="Processing actions">
          <button className="dn-button dn-button--ghost dn-hide-mobile" onClick={onPrivacy}><Icon name="lock" /> About privacy</button>
          <button className="dn-icon-button dn-show-mobile" aria-label="Menu"><Icon name="menu" /></button>
        </nav>
      </header>

      <section className="dn-processing-hero dn-botanical-card">
        <div className="dn-leaf dn-leaf--left" aria-hidden="true" />
        <div className="dn-leaf dn-leaf--right" aria-hidden="true" />
        <h1>Building <em>your</em> private report</h1>
        <p>Keep this tab open while Deana processes matching rsIDs locally and saves your report in this browser.</p>
        <div className="dn-warning"><Icon name="alert" /> Do not close your browser while processing.</div>
      </section>

      <section className="dn-simple-card dn-processing-card" aria-label="Processing progress">
        <h2>Processing your data</h2>
        <div className="dn-linear-progress" aria-label={`${percent}% complete`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="dn-progress-line">
          {progressSummary}
          <strong>{percent}%</strong>
        </div>
        <p className="dn-muted">{currentLabel}: <strong>{currentValue}</strong></p>
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

      <section className="dn-privacy-banner">
        <span className="dn-round-icon"><Icon name="shield" /></span>
        <div>
          <h2>Your raw DNA stays private on your device.</h2>
          <p>Requests to public sources happen from your browser.</p>
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
    ["globe", "Public-source lookups happen from your browser", "When Deana enriches findings, requests may go directly from your browser to public sources such as SNPedia. Those services may see marker requests and your IP address."],
    ["code", "Open source and transparent", "You can inspect the code, understand how the tool works, and review the project on GitHub."],
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

function Step({ number, icon, title, copy }: { number: string; icon: Parameters<typeof Icon>[0]["name"]; title: string; copy: string }) {
  return (
    <article className="dn-step-card">
      <span className="dn-step-number">{number}</span>
      <span className="dn-round-icon"><Icon name={icon} /></span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

function ExplorerTeaser() {
  return (
    <section className="dn-explorer-teaser" aria-label="What you can do in Explorer">
      <h2>Explore in your private Explorer</h2>
      <div className="dn-teaser-grid">
        <span><Icon name="heart" /> Health insights</span>
        <span><Icon name="user" /> Carrier status</span>
        <span><Icon name="spark" /> Traits</span>
        <span><Icon name="book" /> Source links</span>
        <span><Icon name="search" /> Filters & search</span>
      </div>
    </section>
  );
}

function PrivacyBanner() {
  return (
    <section className="dn-privacy-banner">
      <span className="dn-round-icon"><Icon name="shield" /></span>
      <div>
        <h2>Your data stays private.</h2>
        <p><Icon name="check" /> Processed locally on your device</p>
        <p><Icon name="check" /> No raw DNA uploaded to Deana</p>
      </div>
    </section>
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
