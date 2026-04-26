# Repository Guidelines

## Product And Privacy Context

Deana is a browser-first React + TypeScript app for local exploration of consumer raw DNA exports. Raw genotype files are parsed in the browser, profile data is stored in browser IndexedDB, and evidence matching runs locally against static evidence-pack JSON. Do not add server uploads or third-party runtime calls that send raw DNA, profile names, genotype metadata, report content, or local evidence matches. The only exception is the existing explicitly consented AI chat flow, which may send capped, compact, redacted report context through Vercel AI Gateway.

Vercel Analytics is currently enabled for page-level product analytics only. If analytics code changes, keep payloads generic and document the privacy impact in the PR.

## Project Structure & Architecture

Application code lives in `src/`:

- `src/screens`: route-level views for home, processing, and explorer routes.
- `src/components`: shared presentation components, including Deana-specific marketing, explorer UI, and opt-in AI chat UI.
- `src/lib`: report generation, local evidence matching, normalization, storage, exporters, and profile construction.
- `src/workers`: `dnaParser.worker.ts` parses uploaded raw files; `evidenceEnrichment.worker.ts` loads local evidence shards and matches markers.
- `src/types.ts`: shared app, report, storage, and evidence-pack types.
- `src/test`: Vitest and React Testing Library setup and reusable DNA/profile fixtures.

Static evidence packs live in `public/evidence-packs`. The app reads `src/lib/evidencePackData.ts` for the current local pack version, loads that pack's manifest, and fetches only the shard buckets needed for uploaded rsIDs.

Project notes and research live in `docs/`. Generated evidence candidates under `docs/evidence-candidates` are scratch artifacts and should stay untracked.

## Build, Test, And Development Commands

- `bun install`: install dependencies.
- `bun run dev`: start the Vite development server.
- `bun run dev:vercel`: start Vercel local development for Edge Functions and AI chat testing.
- `bun run build`: run `tsc -b` and produce a production Vite build.
- `bun run preview`: serve the production build locally.
- `bun run test`: run the Vitest suite once.
- `bun run vercel:login`: authenticate the Vercel CLI for local AI Gateway setup.
- `bun run vercel:link`: link the local checkout to the Vercel project.
- `bun run vercel:env`: pull Vercel environment variables, including local OIDC values, into `.env.local`.
- `bun run evidence:update`: sync source caches, sync SNPedia, and rebuild the sharded evidence pack.
- `bun run evidence:check`: validate the checked-in evidence pack without rewriting files.

Use Bun for package scripts to match the README, lockfile, and GitHub Actions workflow.

## AI Chat And Vercel Gateway

AI chat is optional, explicitly consent-gated, and is the only product feature that sends compact report context to a third-party model route. The current implementation uses the Vercel AI SDK v6 package set:

- Client chat lives in `src/components/deana/aiChat.tsx` and uses `@ai-sdk/react` `useChat`, `DefaultChatTransport`, `UIMessage.parts`, `sendMessage`, `addToolOutput`, and local tool execution.
- Chat context shaping and redaction live in `src/lib/aiChat.ts`; keep profile names, uploaded file names, raw DNA files, full marker lists, and uncapped evidence matches out of chat payloads.
- `api/chat.ts` is an Edge Function that validates consent/context/messages, calls AI SDK `streamText`, uses `convertToModelMessages`, and returns `toUIMessageStreamResponse`.
- `api/chat-title.ts` is an Edge Function that uses `generateText` for short thread titles.

Production should authenticate AI Gateway with Vercel OIDC. Local chat testing needs `bun run vercel:link`, `bun run vercel:env`, and `bun run dev:vercel`; OIDC values expire, so refresh `.env.local` when Gateway auth fails. `AI_GATEWAY_API_KEY` is only for local/self-hosted fallback and must never use a `VITE_` prefix or be committed.

Keep Gateway privacy behavior fail-closed. Chat and title calls should keep `providerOptions.gateway.zeroDataRetention: true`; Gemini Gateway routes should stay constrained to Vertex when the code requires that route; failures should use generic user-facing errors. When changing model IDs, reasoning settings, or provider options, verify the current AI SDK and AI Gateway docs because provider option shapes and model capabilities change.

Do not add non-local AI tools. The `searchReportFindings` tool is a planner only: the model proposes search terms, the browser searches IndexedDB/local report data, and only capped compact findings are returned to the stream.

## Evidence Pack Workflow

`scripts/buildEvidencePack.ts` is the canonical pack builder for the current sharded static pack. It writes `public/evidence-packs/<YYYY-MM-core>/manifest.json`, shard files, and the pack-version constants in `src/lib/evidencePack.ts` and `src/lib/evidencePackData.ts`.

`scripts/syncEvidenceSources.ts` downloads public ClinVar data and optionally GWAS data into `.evidence-cache`. GWAS is skipped unless `GWAS_ASSOCIATIONS_URL` or `--gwas-url=...` is provided; the current GWAS Catalog association export is published as a ZIP, and the script extracts the associations TSV into `.evidence-cache/gwas/associations.tsv`. `scripts/syncSnpedia.ts` caches SNPedia pages under `.evidence-cache/snpedia`.

Keep `.evidence-cache`, generated seed/bulk candidate JSON, and local DNA files out of git. Keep `public/evidence-packs` tracked because the deployed static app serves those files directly.

## Coding Style & Naming Conventions

Write strict TypeScript and React function components. Use 2-space indentation, double quotes, semicolons, and named exports for reusable modules, matching the existing code. Components and screens use `PascalCase` file names, for example `HomeScreen.tsx`; library modules use lower camel case, for example `reportEngine.ts`; workers use the `.worker.ts` suffix.

Keep browser-only storage, parsing, normalization, and evidence behavior inside `src/lib` or `src/workers`, not directly in presentation components. Prefer existing domain helpers and shared types over ad hoc parsing or storage logic in UI code.

## Testing Guidelines

Tests use Vitest, React Testing Library, `@testing-library/jest-dom`, and the jsdom environment configured in `vite.config.ts`. Add focused tests next to the relevant source with `*.test.ts` or `*.test.tsx` naming.

Use `src/test/fixtures.ts` for reusable DNA/profile fixtures. Mock IndexedDB and worker boundaries rather than relying on real browser state. When changing evidence matching, report generation, storage migrations, URL/filter state, AI chat payloads, AI consent, local chat storage, tool-call handling, or exporters, add regression coverage for the changed behavior.

Run `bun run test` before submitting changes. Run `bun run build` when touching types, routes, workers, report/export logic, or Vite configuration. Run `bun run evidence:check` when touching evidence scripts, evidence schemas, evidence-pack assets, or pack-version constants.

## Security & Sensitive Data Review

DNA data is intended to remain local to the browser except for explicitly consented AI chat context. Before merging changes that touch parsing, storage, exports, analytics, networking, workers, evidence matching, AI chat, or Vercel Gateway routes, search for accidental sensitive data paths:

```bash
rg -n --glob '!node_modules/**' --glob '!public/evidence-packs/**' --glob '!docs/evidence-candidates/**' "fetch\\(|sendBeacon|analytics|localStorage|indexedDB|token|secret|password|apiKey|upload|POST" .
```

Expected runtime network surfaces are limited to static evidence-pack files served by the app, page-level Vercel Analytics, and consented AI Gateway calls through `api/chat.ts` and `api/chat-title.ts`. Evidence-source downloads belong only in maintainer scripts or CI. Do not commit raw DNA exports, `.env` files, source caches, or generated candidate dumps.

## Commit & Pull Request Guidelines

Recent commits use short, imperative or descriptive subjects such as `Tweak the homepage` and `Homepage styles`. Keep subjects concise and focused on one change.

Pull requests should include a brief summary, test results, and screenshots or screen recordings for UI changes. Link related issues or docs where relevant. Call out any privacy, local-storage, export, DNA parsing, evidence-source, license, analytics, AI chat, model routing, or Gateway provider-option behavior changes explicitly.

## Licensing Notes

The repository is public and source-available, but the current license is non-commercial and not OSI open source. Application code is covered by the Deana Source Available Non-Commercial License v1.0. Evidence packs, generated evidence records, documentation, and notes that include or derive from SNPedia are covered by CC BY-NC-SA 3.0. Preserve attribution in `LICENSE.md`, `NOTICE`, README, and evidence-pack metadata when changing evidence sources.
