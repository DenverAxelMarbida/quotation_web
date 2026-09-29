# Frontend (React + Vite + TypeScript)

Private web interface for the Quotation-to-Excel Automation System.

## Local development

```bash
npm install
cp .env.example .env      # optional: adjust VITE_API_BASE_URL
npm run dev               # http://localhost:5173
```

The backend must be running on `http://localhost:8000` for the connectivity
check on the home screen to succeed. See `../README.md` for the full picture.

## Checks

```bash
npm run lint        # oxlint
npm run typecheck   # tsc -b
npm test            # vitest run
npm run build       # tsc -b && vite build
```

## What exists

The whole review workflow, on one page, in the order `AGENTS.md` section 8
describes:

- `src/App.tsx` — the stage machine, and the only place that calls the API
- `src/screens/UploadScreen.tsx` — file choice, PDF check, failures
- `src/screens/ProcessingScreen.tsx` — the waiting state
- `src/screens/ReviewScreen.tsx` — header fields and line items, with every
  uncertain field marked
- `src/screens/CompletedScreen.tsx` — confirmation (a placeholder)
- `src/types/quotation.ts` — mirrors the backend contract exactly
- `src/api/client.ts` — fetch, base URL, `ApiError` from the backend envelope
- `src/api/quotations.ts` — one function per endpoint
- `src/state/quotationDraft.ts` — pure reducer for preview/edit state, tested
  without React

Excel generation is the next step and is not built, so confirming does not
produce a file.
