# Deana

Deana is a browser-first DNA report app for exploring consumer raw DNA exports locally. It parses supported raw genotype files in the browser, stores reports in IndexedDB, and matches markers against a bundled static evidence pack without uploading the user's DNA file to Deana servers.

The project is public and contributor-friendly, but it is not OSI open source under the current license. Application code is source-available for non-commercial use, and SNPedia-derived evidence content remains under CC BY-NC-SA terms. See [License](#license) before reusing or redistributing the code or evidence data.

## Features

- Local parsing for `.zip`, `.txt`, `.csv`, `.vcf`, and `.vcf.gz` raw DNA exports.
- Provider detection for common AncestryDNA, 23andMe, MyHeritage, FamilyTreeDNA, Nebula Genomics, and generic VCF formats.
- IndexedDB-backed local report library.
- Web worker parsing and local evidence enrichment to keep the UI responsive.
- Sharded static evidence packs served from `public/evidence-packs`.
- Medical, pharmacogenomic, and trait-oriented report cards with source context and caveats.
- Explorer view with filters, sorting, marker inspection, and source links.
- Opt-in AI chat for interpreting visible report findings through Vercel AI Gateway.
- Offline HTML export and browser-print PDF flow.

## Privacy Model

Deana is designed so raw DNA data stays in the browser unless the user explicitly opts in to AI chat:

- Raw genotype files are parsed by `src/workers/dnaParser.worker.ts`.
- Profile DNA, report metadata, and report entries are stored in browser IndexedDB through `src/lib/storage.ts`.
- Evidence matching happens locally against static JSON shards loaded from `public/evidence-packs`.
- The app does not upload raw DNA, profile names, genotype metadata, evidence matches, or report content to Deana servers.
- AI chat is disabled until the user accepts an in-app warning. Consent acceptance, chat threads, chat messages, and local search traces are stored in browser IndexedDB for that report.
- When accepted, chat text plus a capped, redacted set of selected markers, genotypes, matched findings, source names, and source links is sent to Vercel AI Gateway and the routed model provider.
- The AI search planner may return synonym and related-term suggestions for local browser search; Deana uses those terms locally before sending only capped retrieved findings to the chat model.
- AI chat does not send raw DNA files, full marker lists, profile names, or uploaded file names.

Vercel Analytics is enabled for page-level product analytics only. Do not add custom analytics events or third-party runtime calls that include raw DNA, profile metadata, genotype metadata, report content, or evidence-match details.

Evidence-source downloads only happen in local scripts or GitHub Actions when maintainers rebuild evidence packs.

## Getting Started

Install dependencies:

```bash
bun install
```

Start the Vite development server:

```bash
bun run dev
```

Run the test suite:

```bash
bun run test
```

Build the production app:

```bash
bun run build
```

Preview a production build:

```bash
bun run preview
```

Use Bun for package scripts so local development matches the lockfile and CI workflow.

## AI Chat Setup

Deana uses the Vercel AI SDK v6 package set for opt-in Explorer chat:

- `src/components/deana/aiChat.tsx` uses `@ai-sdk/react` `useChat`, `DefaultChatTransport`, `UIMessage.parts`, and local browser tool output handling.
- `api/chat.ts` is an Edge Function that validates the redacted browser payload, calls `streamText`, converts `UIMessage` objects with `convertToModelMessages`, and returns a `toUIMessageStreamResponse` stream.
- `api/chat-title.ts` is an Edge Function that uses `generateText` to create local thread titles from the first user prompt.
- `src/lib/aiChat.ts` owns the chat consent version, context shape, default model, and redaction/compaction helpers.

Production deployments should use Vercel OIDC for AI Gateway so no long-lived AI secret is stored in the client or project environment.

Production setup:

1. Deploy Deana on Vercel.
2. Enable AI Gateway for the Vercel project or team.
3. Use the default Vercel OIDC authentication provided to Vercel Functions. Do not expose AI credentials with a `VITE_` prefix.
4. Optionally set the model:

```bash
DEANA_LLM_MODEL=google/gemini-3-flash
```

The default chat model is `google/gemini-3-flash`. For that model, Deana routes Gateway calls through Vertex, requests low thinking output for the visible reasoning panel, requests Zero Data Retention, and fails closed when a compliant route is unavailable. Gateway calls are stateless: Deana restores thread context from local IndexedDB and includes the needed prior messages in each request.

When changing models or provider options, keep these constraints intact:

- Use Vercel AI Gateway model IDs such as `google/gemini-3-flash` or `openai/...`; do not expose provider credentials to browser code.
- Keep `providerOptions.gateway.zeroDataRetention` enabled for chat and title calls. A request should fail rather than silently route to a non-ZDR provider.
- Keep chat responses generic on failure so server or provider details are not exposed to users.
- Preserve the AI SDK v6 message model: render and persist text from `UIMessage.parts`, send messages with `sendMessage`, and stream server responses with `toUIMessageStreamResponse`.
- Keep tool calls local. The model may plan `searchReportFindings`, but the browser executes retrieval against the saved report and sends back only capped, compact findings.

Local AI development needs Vercel Functions, so use `vercel dev` instead of plain `bun run dev` when testing chat:

```bash
bun run vercel:login
bun run vercel:link
bun run vercel:env
bun run dev:vercel
```

`bun run vercel:env` writes Vercel's local OIDC environment to `.env.local`, which is ignored by git. Vercel OIDC tokens pulled for local development expire, so refresh `.env.local` with `bun run vercel:env` when local Gateway authentication stops working. Keep `AI_GATEWAY_API_KEY` unset when testing OIDC, because the Gateway provider prefers an API key over OIDC if both are present. If you are self-hosting or developing without OIDC, set a local-only Gateway API key:

```bash
AI_GATEWAY_API_KEY=...
DEANA_LLM_MODEL=google/gemini-3-flash
```

Never commit `.env.local`, AI keys, raw DNA exports, or generated local evidence caches.

## Evidence Packs

Evidence packs are generated static JSON assets. The browser loads the manifest for the current pack version and then fetches only the rsID shard buckets needed for the uploaded markers.

The canonical full update command is:

```bash
bun run evidence:update
```

That runs:

```bash
bun run evidence:sources:sync
bun run evidence:snpedia:sync
bun run evidence:pack:build
```

Source caches are written under `.evidence-cache`, which is intentionally ignored. Generated candidate dumps under `docs/evidence-candidates` are also ignored. The shipped static pack in `public/evidence-packs` is tracked because the browser app serves it directly.

GWAS sync is optional unless a current association export URL is supplied. The sync script accepts the current GWAS Catalog ZIP release and extracts the associations TSV into `.evidence-cache/gwas/associations.tsv`:

```bash
GWAS_ASSOCIATIONS_URL="https://ftp.ebi.ac.uk/pub/databases/gwas/releases/latest/gwas-catalog-associations-full.zip" bun run evidence:sources:sync
```

Validate the checked-in evidence pack without rewriting files:

```bash
bun run evidence:check
```

The monthly GitHub Actions workflow runs the full evidence update, checks the pack, runs tests, builds the app, and opens a pull request when files changed.

## Project Structure

- `src/screens`: route-level React screens.
- `src/components`: shared UI and Deana-specific presentation components.
- `src/lib`: parsing-adjacent domain logic, report generation, evidence matching, storage, normalization, and exporters.
- `src/workers`: browser workers for DNA parsing and evidence enrichment.
- `src/test`: shared Vitest and React Testing Library setup and fixtures.
- `scripts`: maintainer scripts for evidence-source sync and evidence-pack generation.
- `public/evidence-packs`: tracked static evidence-pack assets.
- `docs`: research notes, status notes, and generated evidence-candidate scratch space.

## Contributing

Before opening a pull request:

```bash
bun run test
bun run build
```

Also run `bun run evidence:check` when touching evidence-pack generation, evidence schemas, report entries, or pack-version constants.

Pull requests should include:

- A brief summary of the change.
- Test results.
- Screenshots or screen recordings for UI changes.
- Notes about privacy, local storage, export behavior, DNA parsing, or evidence-source changes when relevant.

Avoid adding server uploads, analytics payloads, or third-party calls that include raw genotype data, profile metadata, report content, or local evidence matches.

## License

Deana uses split licensing:

- Application code is source-available for non-commercial use only under the Deana Source Available Non-Commercial License v1.0.
- Evidence packs, generated evidence records, documentation, and notes that include or derive from SNPedia are licensed under Creative Commons Attribution-NonCommercial-ShareAlike 3.0, consistent with SNPedia's published terms.

See [LICENSE.md](LICENSE.md) and [NOTICE](NOTICE) for full terms and attribution.

## Medical Disclaimer

Deana is informational software. It is not medical advice, diagnosis, or treatment. Consumer raw DNA arrays can miss clinically important variants, can include strand/build differences, and should not be used for clinical decisions without qualified review and confirmatory testing.
