# Repository Guidelines

## Project Structure & Module Organization

Deana is a browser-first React + TypeScript app built with Vite. Application code lives in `src/`: route-level views are in `src/screens`, shared UI in `src/components`, domain logic and persistence in `src/lib`, web workers in `src/workers`, and shared types in `src/types.ts`. Test helpers live in `src/test`, with tests colocated near the code they cover, such as `src/App.test.tsx` and `src/lib/reportEngine.test.ts`. Project notes and research live in `docs/`.

## Build, Test, and Development Commands

- `bun install`: install dependencies.
- `bun run dev`: start the Vite development server.
- `bun run build`: run `tsc -b` and produce a production Vite build.
- `bun run preview`: serve the production build locally.
- `bun run test`: run the Vitest suite once.

Use Bun for package scripts to match the existing README and lock workflow.

## Coding Style & Naming Conventions

Write strict TypeScript and React function components. Use 2-space indentation, double quotes, semicolons, and named exports for reusable modules, matching the existing code. Components and screens use `PascalCase` file names, for example `HomeScreen.tsx`; library modules use lower camel case, for example `reportEngine.ts`; workers use the `.worker.ts` suffix. Keep browser-only storage and parsing behavior inside `src/lib` or `src/workers`, not directly in presentation components.

## Testing Guidelines

Tests use Vitest, React Testing Library, `@testing-library/jest-dom`, and the jsdom environment configured in `vite.config.ts`. Add focused tests next to the relevant source with `*.test.ts` or `*.test.tsx` naming. Use `src/test/fixtures.ts` for reusable DNA/profile fixtures and mock IndexedDB or worker boundaries rather than relying on real browser state. Run `bun run test` before submitting changes; run `bun run build` when touching types, routes, workers, or export logic.

## Commit & Pull Request Guidelines

Recent commits use short, imperative or descriptive subjects such as `Tweak the homepage` and `Homepage styles`. Keep subjects concise and focused on one change. Pull requests should include a brief summary, test results, and screenshots or screen recordings for UI changes. Link related issues or docs where relevant, and call out any privacy, local-storage, export, or DNA parsing behavior changes explicitly.

## Security & Configuration Tips

DNA data is intended to remain in the browser. Avoid adding server uploads, analytics payloads, or third-party calls that include raw genotype data or profile metadata. Document any new external data source, cache, or persistence behavior in `README.md` or `docs/` before merging.
