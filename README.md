# DeaNA

DeaNA is a browser-first DNA report app designed to run privately on-device.

## Current MVP

- React + TypeScript + Vite setup intended for Bun workflows
- Local parsing for `.zip`, `.txt`, `.csv`, and `.gz` consumer DNA exports
- Parsers for the common raw formats used by:
  - AncestryDNA
  - 23andMe
  - MyHeritage
  - FamilyTreeDNA
- IndexedDB-backed local profile storage
- Medical-first report layout inspired by Promethease, with clearer evidence framing
- Responsive interface shaped around the Jack & Jill visual direction
- Offline HTML export and browser-print PDF flow

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

## Evidence Packs

```bash
bun run evidence:update
```

The evidence pack is built from local caches under `.evidence-cache` and shipped as sharded static JSON in `public/evidence-packs`. ClinVar/GWAS records are converted into plain-language report entries with the original technical names preserved as source details. SNPedia is ingested through `bots.snpedia.com` into a local cache and matched locally in the browser as part of the bundled evidence pass.

## License

DeaNA uses split licensing:

- Application code is source-available for non-commercial use only under the DeaNA Source Available Non-Commercial License v1.0.
- Evidence packs, generated evidence records, documentation, and notes that include or derive from SNPedia are licensed under Creative Commons Attribution-NonCommercial-ShareAlike 3.0, consistent with SNPedia's published terms.

See [LICENSE.md](LICENSE.md) and [NOTICE](NOTICE) for details and attribution.

## Notes

- DNA stays in the browser in the current architecture.
- Vercel Analytics is enabled for page-level product analytics only; do not send raw DNA, profile names, genotype metadata, or report content as analytics events.
- The medical and pharmacogenomic cards are intentionally conservative starter cards.
- A proper ancestry-reference panel and deeper evidence packs should be added before calling this production-ready.
