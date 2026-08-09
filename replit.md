# Noesis

Noesis helps users understand complex visuals by teaching them how to read the visual itself, step by step: upload an image, get an analysis, then follow a guided walkthrough across highlighted regions to the big takeaway.

## Run & Operate

- `pnpm --filter @workspace/noesis run dev` — run the Noesis web app (served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind + shadcn (`artifacts/noesis`)
- API: Express 5 with a server-side OpenAI image-analysis endpoint
- Validation: Zod (`zod/v4`); API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/noesis/src/App.tsx` — top-level screen state machine (upload → loading → result) and object-URL lifecycle
- `artifacts/noesis/src/components/` — UploadScreen, LoadingScreen, ResultScreen, VisualCanvas, Hotspot, WalkthroughPanel, ProgressControls
- `artifacts/noesis/src/lib/types.ts` — `NoesisAnalysis` / `NoesisRegion` data contract (normalized 0–1 region coordinates)
- `artifacts/noesis/src/lib/mockAnalysis.ts` — mocked analysis payload (Sankey diagram example)

## Architecture decisions

- Analysis is real: `POST /api/analyze` (`artifacts/api-server/src/routes/analysis.ts`) sends the uploaded image to OpenAI `gpt-5.6-sol` with low reasoning effort and validates the model output server-side. The key stays server-side (`OPENAI_API_KEY` secret). `mockAnalysis.ts` is retained for dev but never used as a silent fallback.
- Contract seam: `src/lib/types.ts` (`NoesisAnalysis`) is the stable frontend contract; `lib/api-spec/openapi.yaml` mirrors it (Orval codegen for hooks + Zod).
- Hotspots render with pure percentage positioning inside an image-sized `inline-block` relative wrapper so they stay aligned on any resize — never pixel-measured.
- The uploaded image object URL is owned by `App.tsx` and revoked via effect cleanup on replacement/reset/unmount; analysis requests carry a monotonic sequence ID so stale completions can't clobber newer state.

## Product

Upload a PNG/JPG/WebP → "reading the visual" loading sequence → result screen with the image and real analysis (title, image type, central question, summary, Big Takeaway) → guided 4–6-step walkthrough with numbered hotspots, related-region highlighting, Previous/Next controls, and a Big Takeaway conclusion.

## User preferences

- Serious, clean, visually sophisticated design — not gamified, no chatbot aesthetic, restrained palette, subtle transitions only.
- Keep scope tight: no auth, history, export, PDF, voice, or collaboration unless explicitly requested.

## Gotchas

- App is served under `BASE_PATH`; don't hardcode absolute asset paths.
- Region coordinates are normalized 0–1; always render as `value * 100%`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
