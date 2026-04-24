# Deana Research Brief

Updated: 2026-04-24

## What I verified from the files you shared

- Your sample export (`/Users/stephenradford/Downloads/dna-data-2026-04-19.zip`) contains a single `AncestryDNA.txt` file.
- The file header says it was generated on `2026-04-19 17:14:51 UTC`, uses `AncestryDNA array version V2.0`, and reports coordinates against `human reference build 37.1` on the forward `+` strand.
- The export contains `677,437` called rows after the header/comments.
- The Promethease HTML report appears to be built around:
  - SNPedia genotype pages and genotype sets
  - ClinVar significance labels
  - topic / medical condition / gene filters
  - population-frequency style ranking
  - summary sections such as ABO blood type

That means a locally run replacement is very realistic. The hard part is not file parsing. The hard part is choosing trustworthy evidence sources and presenting uncertainty honestly.

## What I recommend as Deana's source hierarchy

I would not make SNPedia the primary source of truth for Deana. It is useful, but for a privacy-first medical-facing product I think it should be secondary.

### Tier 1: Primary evidence sources

1. ClinVar
   - Use for clinically relevant variants and pathogenicity labels.
   - Official docs: <https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/>
   - Why it matters: ClinVar is the strongest foundation for rare, medically relevant variant interpretation.
   - Caveat: ClinVar itself says it is not for direct diagnostic use and is updated weekly on Mondays, with archived monthly releases.

2. CPIC / ClinPGx
   - Use for pharmacogenomics and drug-response interpretation.
   - Official site: <https://cpicpgx.org/>
   - Guidelines: <https://cpicpgx.org/guidelines/>
   - Why it matters: CPIC is specifically about how existing genotype results can inform prescribing.
   - Caveat: raw SNP-chip data is incomplete for some pharmacogenes, so Deana would need strong coverage warnings.

3. GWAS Catalog
   - Use for trait associations and evidence-backed common-variant findings.
   - Official docs: <https://www.ebi.ac.uk/gwas/docs>
   - Downloads: <https://www.ebi.ac.uk/gwas/downloads>
   - Summary stats: <https://www.ebi.ac.uk/gwas/summary-statistics>
   - Why it matters: this is the best public source for curated SNP-trait associations and supporting study metadata.
   - Caveat: association does not equal diagnosis, and many hits are ancestry-specific or effect-size tiny.

4. PGS Catalog
   - Use for polygenic traits and polygenic risk scores where licensing and score quality are acceptable.
   - Official downloads: <https://www.pgscatalog.org/downloads/>
   - Why it matters: this gives a structured way to go beyond single-marker trivia into better trait/risk models.
   - Caveat: score performance varies a lot by ancestry and by missing-marker coverage. We should surface both.

5. 1000 Genomes / IGSR
   - Use for ancestry-reference panels and population context.
   - Official site: <https://www.internationalgenome.org/>
   - About: <https://www.internationalgenome.org/about>
   - Why it matters: it is open, established, and a realistic foundation for local ancestry-similarity analysis.
   - Caveat: it is best suited to similarity / clustering / PCA-style views. Commercial-style ethnicity percentages are much harder to do well.

6. gnomAD
   - Use for population frequency context and rarity checks.
   - Official site: <https://gnomad.broadinstitute.org/>
   - Why it matters: it is useful when explaining whether a variant is common or rare in different ancestry groups.
   - Caveat: the full releases are large, so we should not try to bundle all of gnomAD into the client. We would precompute a much smaller subset.

### Tier 2: Supporting / explanatory sources

1. SNPedia
   - Useful for consumer-friendly descriptions, links, and genotype pages.
   - Official site: <https://www.snpedia.com/>
   - Recommendation: use it as an external reference and optional explanation layer, not as Deana's primary clinical engine.

2. dbSNP
   - Useful for rsID normalization and variant metadata.
   - Official site: <https://www.ncbi.nlm.nih.gov/snp>

## What I learned about provider support

### Must-support in v1

1. AncestryDNA
   - Official download article: <https://support.ancestry.com/s/article/Downloading-DNA-Data>
   - Current export is plain-text raw data and your file confirms GRCh37.1 plus-strand formatting.

2. 23andMe
   - Raw data overview: <https://customercare.23andme.com/hc/en-us/articles/115004310067-Navigating-Your-Raw-Data>
   - Technical details: <https://customercare.23andme.com/hc/en-us/articles/212883677-How-23andMe-Reports-Genotypes>
   - Reference build / strand: <https://customercare.23andme.com/hc/en-us/articles/212883767-Which-Reference-Genome-and-Strand-Does-23andMe-Use>
   - Important details:
     - 23andMe reports on the plus strand.
     - It supports GRCh37 and GRCh38 views.
     - Uncalled variants are shown as `--`.
     - Files can include some internal IDs as well as rsIDs.

3. MyHeritage
   - Download article: <https://www.myheritage.com/help/en/articles/12851869-how-do-i-download-my-raw-dna-data-file-from-myheritage>
   - Raw data interpretation: <https://www.myheritage.com/help/en/articles/12852246-how-should-i-interpret-my-raw-dna-data>
   - Important current detail:
     - MyHeritage says its raw data is a tab-delimited text file with about `700,000` data points on the forward strand.
     - MyHeritage also says that if a sample was processed in `January 2026` or later, it may come from their new WGS workflow; they are working on CRAM downloads while still offering a standard raw data file for third-party tools.
   - WGS change article: <https://www.myheritage.com/help/en/articles/12852457-what-does-the-whole-genome-sequencing-wgs-upgrade-mean-for-my-dna-results>

4. FamilyTreeDNA
   - Raw data download: <https://help.familytreedna.com/hc/en-us/articles/14860944283407-Downloading-Your-Family-Finder-Data>
   - Transfer support: <https://help.familytreedna.com/hc/en-us/articles/4415446123663-Introduction-to-Autosomal-DNA-Transfers>
   - Important details:
     - Autosomal raw data is GRCh37.
     - Downloads are CSV files compressed as GZ.
     - Transfer uploads from other vendors are accepted by FamilyTreeDNA, but transfer data is not downloadable again.

### Should support soon after v1

1. Living DNA
   - I have not yet verified the current official raw-file format from primary documentation, so I would not lock this in without a follow-up check.

2. Legacy / one-off formats
   - Some users will have older 23andMe, Geno 2.0, or vendor-transcoded files.
   - We should design the parser layer so new formats are pluggable.

## My recommendation for v1 scope

### Keep in v1

1. Fully local ingestion
   - Upload `.zip`, `.txt`, `.csv`, and `.gz`.
   - Parse everything client-side in a Web Worker.
   - Never send genotype data to a server.

2. Multiple local profiles
   - Save parsed reports in browser storage.
   - Allow user-defined names for each profile.
   - Best storage choice is IndexedDB, not `localStorage`, because the datasets are too large.

3. Report sections
   - Overview
   - Traits
   - Medical
   - Drug response
   - Ancestry / origin
   - Raw markers explorer

4. Evidence-first presentation
   - Every result should show:
     - source
     - evidence level
     - confidence / coverage
     - study-population notes
     - plain-language disclaimer

5. Export
   - Save a self-contained offline HTML report.
   - Add print CSS so the browser can generate a PDF cleanly.
   - If needed later, add a dedicated PDF generator.

### Do not force into first release

1. Online relative matching
   - This is not a good fit for a strict local-first v1.
   - Real matching requires comparing a user against a shared, opted-in database.
   - Current matching products such as MyHeritage and FamilyTreeDNA explicitly rely on uploaded raw DNA being compared against their own databases.
   - There does not appear to be a strong open public network we can responsibly plug into while keeping Deana fully local and storage-free.

2. Commercial-style ethnicity percentages
   - This is doable eventually, but not something I would fake early.
   - A better v1 is "genetic similarity to reference populations" using 1000 Genomes / IGSR with careful wording.

### Better privacy-preserving alternative to "matches"

Add a local compare mode:

- Upload two or more kits on the same device.
- Estimate overlap and rough relatedness from intersecting markers.
- Show "possible close family / likely distant relative / likely unrelated" bands.
- Keep every comparison local to the device.

That gives users something genuinely useful without creating a surveillance-style matching database.

## Product direction I would recommend

### Origin data

Best first version:

- region-level similarity map
- PCA / cluster view against 1000 Genomes reference populations
- maternal / paternal phrasing avoided unless we truly phase the data
- language like "genetic similarity" instead of "you are X% from Y" unless we have strong methods and validation

### Traits

Good early candidates:

- eye color
- hair texture tendency
- lactose tolerance
- bitter taste sensitivity
- earwax type
- caffeine metabolism
- chronotype / morning person tendency
- exercise / endurance-related tendencies
- blood group estimates where coverage is enough

Approach:

- mix high-confidence single-marker reports with carefully chosen PGS-backed traits
- always show missing-marker coverage and population limitations

### Medical

Good early candidates:

- ClinVar-backed pathogenic / likely pathogenic markers found in the uploaded array data
- carrier-style findings where chip coverage is meaningful
- pharmacogenomic summaries for a small set of high-value CPIC-backed drug-gene pairs

Guardrails:

- phrase as "found in your uploaded raw array data"
- never imply absence of risk from absence of a marker
- always recommend confirmation via clinical testing before action

## Tech stack recommendation

### Framework

Recommended:

- React + TypeScript + Vite
- Bun for local package management / scripts

Why:

- Bun works cleanly with Vite.
- Official Bun guide: <https://bun.sh/guides/ecosystem/vite>
- Cloudflare officially supports React + Vite on Workers: <https://developers.cloudflare.com/workers/framework-guides/web-apps/react/>

### Deployment

Recommended v1:

- deploy as a static SPA on Cloudflare
- optionally keep the door open for a Worker later if we want versioned metadata APIs or signed downloadable data packs

Why:

- For a strict no-upload architecture, we do not need a server to process DNA files.
- Cloudflare supports SPA routing and static assets cleanly.
- Static assets docs: <https://developers.cloudflare.com/workers/static-assets/>

### UI stack

Recommended:

- Tailwind CSS
- shadcn/ui
- Motion for a few intentional transitions

Why:

- shadcn/ui gives us accessible components without boxing us into a generic look.
- Official docs: <https://ui.shadcn.com/docs>

### Data / parsing

Recommended:

- `fflate` for browser-side `.zip` and `.gz` support
- custom parser adapters per vendor
- Web Workers for parsing and score computation
- IndexedDB for local persistence

Why I am not recommending a niche DNA parsing package:

- I have not found a modern, well-adopted TypeScript library that cleanly handles the main consumer DNA vendors, browser-only execution, and current file quirks.
- The parser surface is actually small:
  - identify vendor
  - decompress if needed
  - normalize columns
  - normalize strand / build metadata
  - store rsID + chrom + pos + genotype

This is small enough that a focused in-house parser is lower risk than depending on an old or incomplete library.

## UX ideas that fit the brief

1. Instant ingest
   - Drop a zip and land directly in the report.

2. Evidence cards
   - Every finding card shows source badges like `ClinVar`, `GWAS`, `PGS`, `CPIC`.

3. Confidence meter
   - Not for drama. For actual coverage / evidence quality / ancestry transferability.

4. Saved profiles
   - "Stephen", "Mum", "Sibling", etc. all stored on-device only.

5. Change-aware reprocessing
   - If Deana ships a new evidence pack version later, the app can offer to refresh saved reports locally.

6. Report export
   - offline HTML bundle
   - print-friendly PDF

7. Compare mode
   - compare two local profiles for shared traits / variant overlap / rough relatedness

## Biggest risks

1. Medical overclaiming
   - The app must stay informational, not diagnostic.

2. Population-transfer issues
   - Many trait and PRS models perform unevenly across ancestry groups.

3. Chip coverage limits
   - Consumer arrays miss many clinically important variants.

4. Licensing review
   - Some score files and data packs may have usage restrictions, so each source needs a packaging review before we ship it inside the client bundle.

## Recommended build order

1. Scaffold the app shell and design system.
2. Build vendor parsers for Ancestry, 23andMe, MyHeritage, and FamilyTreeDNA.
3. Add local storage and multi-profile support.
4. Ship a first report with:
   - traits
   - ancestry similarity
   - a tightly curated medical section
5. Add export.
6. Add local compare mode.
7. Expand score packs and evidence packs.

## Decisions still needed from you before I scaffold

1. For v1, do you want medical findings included from day one, or do you want to launch first with `origin + traits + raw explorer` and add medical once the evidence layer is battle-tested?
2. Are you happy with a careful "genetic similarity / ancestry reference" approach for v1, or do you specifically want percentage-style origin estimates in the first release?
3. Do you want me to scaffold the project now as `React + TypeScript + Vite + Bun + shadcn/ui` for Cloudflare, based on the direction above?
