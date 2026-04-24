import { ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { ParsedDnaFile, SavedProfileSummary, SnpediaProgressSnapshot } from "../types";

interface HomeScreenProps {
  profiles: SavedProfileSummary[];
  isLibraryReady: boolean;
  parseFile: (file: File) => Promise<ParsedDnaFile>;
  createProfile: (
    name: string,
    parsed: ParsedDnaFile,
    onProgress?: (snapshot: SnpediaProgressSnapshot) => void,
  ) => Promise<SavedProfileSummary>;
  removeProfile: (id: string) => Promise<void>;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function HomeScreen({
  profiles,
  isLibraryReady,
  parseFile,
  createProfile,
  removeProfile,
}: HomeScreenProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [parsed, setParsed] = useState<ParsedDnaFile | null>(null);
  const [profileName, setProfileName] = useState("");
  const [status, setStatus] = useState("Upload a raw DNA export to build a private report.");
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<SnpediaProgressSnapshot | null>(null);

  function resetImport() {
    setStep(1);
    setParsed(null);
    setProfileName("");
    setError(null);
    setProgress(null);
    setStatus("Upload a raw DNA export to build a private report.");
  }

  async function handleFile(file: File) {
    setIsParsing(true);
    setError(null);
    setStatus(`Parsing ${file.name} locally...`);

    try {
      const nextParsed = await parseFile(file);
      const suggestedName = file.name.replace(/\.[^.]+$/, "");
      setParsed(nextParsed);
      setProfileName(suggestedName);
      setStep(2);
      setStatus("Parsing complete. Name this profile before saving it locally.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Parsing failed.");
      setStatus("That file did not parse cleanly.");
    } finally {
      setIsParsing(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void handleFile(file);
    event.target.value = "";
  }

  async function confirmProfile() {
    if (!parsed) return;
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setError("Give the profile a name before saving it.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setStep(3);
    setProgress({
      status: "running",
      totalRsids: parsed.markerCount,
      processedRsids: 0,
      matchedFindings: 0,
      unmatchedRsids: 0,
      failedRsids: 0,
      retries: 0,
      currentRsid: null,
    });
    setStatus("Downloading SNPedia's documented rsID snapshot and building a local report...");

    try {
      const profile = await createProfile(trimmedName, parsed, (snapshot) => {
        setProgress(snapshot);
        setStatus(
          snapshot.processedRsids === snapshot.totalRsids
            ? "Finalizing the local report..."
            : `Comparing ${snapshot.processedRsids.toLocaleString()} of ${snapshot.totalRsids.toLocaleString()} uploaded rsIDs against SNPedia...`,
        );
      });
      resetImport();
      navigate(`/explorer/${profile.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "SNPedia enrichment failed.");
      setStatus("The SNPedia enrichment pass could not finish.");
      setStep(2);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="app-shell home-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-pills">
          <span className="privacy-pill">Local-first</span>
          <span className="privacy-pill">No DNA uploads</span>
          <span className="privacy-pill">Private report explorer</span>
        </div>
      </header>

      <main className="home-layout">
        <section className="hero-panel">
          <p className="eyebrow">Private DNA Explorer</p>
          <h1>Trustworthy genetics, without sending your raw DNA anywhere.</h1>
          <p className="hero-copy">
            DeaNA turns consumer DNA exports into a medical-first explorer with evidence-backed summaries,
            filterable findings, and local profile storage that stays in your browser.
          </p>

          <div className="hero-cta-row">
            <button className="primary-button" onClick={() => inputRef.current?.click()}>
              Upload a DNA export
            </button>
            {profiles[0] ? (
              <button
                className="secondary-button"
                onClick={() => navigate(`/explorer/${profiles[0].id}`)}
              >
                Open latest report
              </button>
            ) : null}
          </div>

          <div className="hero-feature-grid">
            <article className="spotlight-card">
              <strong>Evidence-first</strong>
              <p>ClinVar, CPIC, GWAS, and gnomAD context drive the seed pack. SNPedia stays supplementary.</p>
            </article>
            <article className="spotlight-card">
              <strong>Promethease-inspired Explorer</strong>
              <p>Tabs, filters, and an inspector make it easier to search, compare, and drill into findings.</p>
            </article>
            <article className="spotlight-card">
              <strong>Multi-profile library</strong>
              <p>Keep local reports for family members or reprocessed kits without building a shared DNA database.</p>
            </article>
          </div>
        </section>

        <section className="home-stack">
          <section className="panel upload-flow-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">New report</p>
                <h2>Create a profile</h2>
              </div>
              <span className={`upload-status ${isParsing || isSaving ? "is-loading" : ""}`}>{status}</span>
            </div>

            <div className="step-row">
              <div className={`step-pill ${step === 1 ? "is-active" : step > 1 ? "is-complete" : ""}`}>
                <span>1</span>
                <div>
                  <strong>Upload file</strong>
                  <p>Select `.zip`, `.txt`, `.csv`, or `.gz` from a supported provider.</p>
                </div>
              </div>
              <div className={`step-pill ${step === 2 ? "is-active" : ""}`}>
                <span>2</span>
                <div>
                  <strong>Name profile</strong>
                  <p>Review the parsed kit details and save it locally before opening Explorer.</p>
                </div>
              </div>
              <div className={`step-pill ${step === 3 ? "is-active" : ""}`}>
                <span>3</span>
                <div>
                  <strong>Process SNPedia</strong>
                  <p>Look up uploaded rsIDs from your browser, then save the finished report locally.</p>
                </div>
              </div>
            </div>

            {step === 1 ? (
              <div className="upload-step">
                <button className="dropzone" onClick={() => inputRef.current?.click()}>
                  <span className="dropzone-icon">+</span>
                  <span>
                    Supports AncestryDNA, 23andMe, MyHeritage, and FamilyTreeDNA exports. Parsing happens locally in a worker.
                  </span>
                </button>
                <input
                  ref={inputRef}
                  hidden
                  type="file"
                  accept=".zip,.txt,.csv,.gz"
                  onChange={onFileChange}
                />
              </div>
            ) : step === 2 ? (
              <div className="confirm-step">
                <div className="confirm-grid">
                  <article className="confirm-card">
                    <p className="eyebrow">Provider</p>
                    <strong>{parsed?.provider}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Reference build</p>
                    <strong>{parsed?.build}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Markers parsed</p>
                    <strong>{parsed?.markerCount.toLocaleString()}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Imported file</p>
                    <strong>{parsed?.fileName}</strong>
                  </article>
                </div>

                <label className="form-row" htmlFor="profile-name">
                  <span>Profile name</span>
                  <input
                    id="profile-name"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="Stephen"
                  />
                </label>

                <article className="processing-note">
                  <p className="eyebrow">SNPedia disclosure</p>
                  <p>
                    DeaNA will keep your raw DNA local, but your browser will contact SNPedia directly to look up uploaded rsIDs. SNPedia may see requested markers and your IP address.
                  </p>
                </article>

                <div className="hero-cta-row">
                  <button className="primary-button" onClick={() => void confirmProfile()} disabled={isSaving}>
                    {isSaving ? "Processing SNPedia..." : "Save, enrich, and open Explorer"}
                  </button>
                  <button className="secondary-button" onClick={resetImport} disabled={isSaving}>
                    Start over
                  </button>
                </div>
              </div>
            ) : (
              <div className="processing-step">
                <div className="processing-hero">
                  <p className="eyebrow">Processing</p>
                  <h3>Building a SNPedia-backed local report</h3>
                  <p>
                    DeaNA first downloads SNPedia's documented rsID snapshot, intersects it with your uploaded DNA locally, then fetches details only for matching markers before saving the report to IndexedDB.
                  </p>
                </div>

                <div className="progress-track" aria-hidden="true">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${progress && progress.totalRsids > 0 ? (progress.processedRsids / progress.totalRsids) * 100 : 0}%`,
                    }}
                  />
                </div>

                <div className="confirm-grid">
                  <article className="confirm-card">
                    <p className="eyebrow">Uploaded rsIDs</p>
                    <strong>{progress?.totalRsids.toLocaleString() ?? parsed?.markerCount.toLocaleString()}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Processed</p>
                    <strong>{progress?.processedRsids.toLocaleString() ?? "0"}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Matched findings</p>
                    <strong>{progress?.matchedFindings.toLocaleString() ?? "0"}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Unmatched</p>
                    <strong>{progress?.unmatchedRsids.toLocaleString() ?? "0"}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Failed</p>
                    <strong>{progress?.failedRsids.toLocaleString() ?? "0"}</strong>
                  </article>
                  <article className="confirm-card">
                    <p className="eyebrow">Retries</p>
                    <strong>{progress?.retries.toLocaleString() ?? "0"}</strong>
                  </article>
                </div>

                <p className="processing-current">
                  Current marker: <strong>{progress?.currentRsid ?? "Starting..."}</strong>
                </p>
              </div>
            )}

            {error ? <p className="error-text">{error}</p> : null}
          </section>

          <section className="panel library-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Saved locally</p>
                <h2>Recent reports</h2>
              </div>
              <span className="library-meta">
                {isLibraryReady ? `${profiles.length} profile${profiles.length === 1 ? "" : "s"}` : "Loading..."}
              </span>
            </div>

            {profiles.length === 0 ? (
              <div className="empty-state">
                <h3>No local reports yet</h3>
                <p>
                  Import a DNA export to create the first profile. DeaNA stores it in your browser so it can be reopened later without re-uploading.
                </p>
              </div>
            ) : (
              <div className="profile-card-list">
                {profiles.map((profile) => (
                  <article key={profile.id} className="profile-card">
                    <div>
                      <p className="profile-title">{profile.name}</p>
                      <p className="profile-subtitle">
                        {profile.dna.provider} • {profile.dna.markerCount.toLocaleString()} markers
                      </p>
                      <p className="profile-meta">
                        Saved {formatDate(profile.createdAt)} • {profile.report.overview.coverageScore}% tracked coverage
                      </p>
                    </div>
                    <div className="profile-actions">
                      <button
                        className="secondary-button"
                        onClick={() => navigate(`/explorer/${profile.id}`)}
                      >
                        Open
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => void removeProfile(profile.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  );
}
