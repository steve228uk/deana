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

## Notes

- DNA stays in the browser in the current architecture.
- The medical and pharmacogenomic cards are intentionally conservative starter cards.
- A proper ancestry-reference panel and deeper evidence packs should be added before calling this production-ready.
