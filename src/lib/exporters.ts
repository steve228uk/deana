import { ProfileMeta, ReportEntry } from "../types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function exportReportHtml(profile: ProfileMeta, entries: ReportEntry[]): void {
  const groupedEntries: Array<[string, ReportEntry[]]> = [];
  const localEvidenceEntryMatches =
    profile.report.overview.localEvidenceEntryMatches ?? profile.report.overview.evidenceMatchedFindings ?? 0;

  for (const [label, grouped] of [
    ["Medical", entries.filter((entry) => entry.category === "medical")],
    ["Traits", entries.filter((entry) => entry.category === "traits")],
    ["Drug Response", entries.filter((entry) => entry.category === "drug")],
  ] as Array<[string, ReportEntry[]]>) {
    if (grouped.length > 0) {
      groupedEntries.push([label, grouped]);
    }
  }

  const sectionsHtml = groupedEntries
    .map(([label, entries]) => {
      const cardsHtml = entries
        .map(
          (entry) => `
            <article class="entry entry-${entry.tone}">
              <div class="entry-topline">
                <span>${escapeHtml(entry.subcategory)}</span>
                <span>${escapeHtml(entry.evidenceTier)}</span>
              </div>
              <h3>${escapeHtml(entry.title)}</h3>
              <p class="summary">${escapeHtml(entry.summary)}</p>
              <p>${escapeHtml(entry.detail)}</p>
              <p><strong>Why it matters:</strong> ${escapeHtml(entry.whyItMatters)}</p>
              <p><strong>Genotype:</strong> ${escapeHtml(entry.genotypeSummary)}</p>
              <p><strong>Coverage:</strong> ${escapeHtml(entry.coverage)}</p>
              <p class="small"><strong>Genes:</strong> ${escapeHtml(entry.genes.join(", ") || "Not linked")}</p>
              <p class="small"><strong>Topics:</strong> ${escapeHtml(entry.topics.join(", ") || "None")}</p>
              <p class="small"><strong>Conditions:</strong> ${escapeHtml(entry.conditions.join(", ") || "None")}</p>
              <p class="small"><strong>Sources:</strong> ${escapeHtml(entry.sources.map((source) => source.name).join(", "))}</p>
              <p class="small"><strong>Confidence:</strong> ${escapeHtml(entry.confidenceNote)}</p>
              <p class="small">${escapeHtml(entry.disclaimer)}</p>
            </article>
          `,
        )
        .join("");

      return `
        <section class="section">
          <p class="eyebrow">Deana Explorer export</p>
          <h2>${escapeHtml(label)}</h2>
          <div class="cards">${cardsHtml}</div>
        </section>
      `;
    })
    .join("");

  const sourceMix = profile.report.overview.sourceMix
    .map((source) => `<li>${escapeHtml(source.source)}: ${source.count}</li>`)
    .join("");

  const warnings = profile.report.overview.warnings
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");

  const evidenceMeta =
    profile.supplements?.evidence
      ? `<div class="overview-card">
          <p class="eyebrow">Evidence pack</p>
          <h2>${localEvidenceEntryMatches.toLocaleString()}</h2>
          <p class="small">${escapeHtml(profile.report.overview.evidenceStatus)} • ${profile.report.overview.evidenceProcessedRsids.toLocaleString()} processed • ${profile.report.overview.evidenceFailedItems.toLocaleString()} failed</p>
          <p class="small">Local evidence entries are grouped into report categories and also available from Other.</p>
          <p class="small">${escapeHtml(profile.supplements.evidence.attribution)}</p>
        </div>`
      : "";

  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Deana report - ${escapeHtml(profile.name)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #f4efe8;
          --paper: #fffdf8;
          --line: #e8ddcf;
          --ink: #201b16;
          --muted: #655d55;
          --accent: #d7683b;
          --good: #1d8c62;
          --warn: #c15a3a;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: radial-gradient(circle at top, rgba(255,255,255,0.85), transparent 35%), var(--bg);
          color: var(--ink);
          font-family: "Avenir Next", "Segoe UI", sans-serif;
        }
        main {
          max-width: 1140px;
          margin: 0 auto;
          padding: 40px 20px 56px;
        }
        .hero, .section, .overview-card, .entry {
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 24px;
        }
        .hero, .section {
          padding: 28px;
          margin-bottom: 24px;
        }
        h1, h2 {
          font-family: "Iowan Old Style", "Palatino Linotype", serif;
          margin: 0 0 10px;
        }
        .meta, .eyebrow, .small, .summary {
          color: var(--muted);
        }
        .eyebrow {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .overview {
          display: grid;
          gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          margin: 20px 0;
        }
        .overview-card {
          padding: 18px;
        }
        .cards {
          display: grid;
          gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          margin-top: 20px;
        }
        .entry {
          padding: 20px;
        }
        .entry-good { border-color: rgba(29, 140, 98, 0.32); }
        .entry-caution { border-color: rgba(193, 90, 58, 0.32); }
        .entry-topline {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 12px;
          color: var(--muted);
        }
        ul {
          margin: 0;
          padding-left: 18px;
        }
      </style>
    </head>
    <body>
      <main>
        <section class="hero">
          <p class="eyebrow">Deana offline export</p>
          <h1>${escapeHtml(profile.name)}</h1>
          <p class="meta">${escapeHtml(profile.dna.provider)} • ${escapeHtml(profile.fileName)} • ${profile.dna.markerCount.toLocaleString()} markers • ${escapeHtml(profile.dna.build)}</p>
          <div class="overview">
            <div class="overview-card">
              <p class="eyebrow">Coverage</p>
              <h2>${profile.report.overview.coverageScore}%</h2>
              <p class="small">${profile.report.overview.curatedMarkerMatches} tracked markers were found in the uploaded file.</p>
            </div>
            <div class="overview-card">
              <p class="eyebrow">Source mix</p>
              <ul>${sourceMix}</ul>
            </div>
            <div class="overview-card">
              <p class="eyebrow">Warnings</p>
              <ul>${warnings}</ul>
            </div>
            ${evidenceMeta}
          </div>
        </section>
        ${sectionsHtml}
      </main>
    </body>
  </html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${profile.name.replaceAll(/\s+/g, "-").toLowerCase()}-deana-explorer.html`;
  link.click();
  URL.revokeObjectURL(url);
}
