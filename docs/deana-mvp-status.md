# Deana MVP Status

Updated: 2026-04-24

## Implemented in this scaffold

- `React + TypeScript + Vite` app structure for Bun workflows
- Responsive two-column layout that collapses cleanly for mobile
- Brand styling for `Deana` with a Jack & Jill-inspired editorial serif + soft-card UI direction
- Local file upload flow for:
  - `.zip`
  - `.txt`
  - `.csv`
  - `.gz`
- Browser-side parsing in a Web Worker
- IndexedDB-backed local profile saving
- Offline HTML export
- Browser print / PDF flow
- First-pass report sections for:
  - medical findings
  - traits
  - drug response
  - origin methodology

## Verified

- Production build succeeds with `bun run build`.
- The parser design is grounded in the Ancestry export you shared and supports the common raw layouts used by AncestryDNA, 23andMe, MyHeritage, and FamilyTreeDNA.

## Important caveats

- The current medical and pharmacogenomic cards are a conservative starter knowledge base, not a complete evidence pack.
- The current origin section is intentionally a methodology placeholder until a proper local reference-population pack is bundled.
- Provider detection beyond Ancestry is format-aware but still needs real fixture files from each vendor before calling support battle-tested.
- Storing full marker arrays in IndexedDB is fine for an MVP, but long term Deana should move to chunked storage or a lighter normalized index.

## Best next steps

1. Add real fixture files for 23andMe, MyHeritage, and FamilyTreeDNA.
2. Expand the evidence layer around ClinVar, CPIC, GWAS Catalog, and PGS Catalog.
3. Add a proper local ancestry reference panel.
4. Improve the raw marker explorer and search tools.
5. Add stronger export branding and print styling.
