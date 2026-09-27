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

## What exists so far

Only the application shell and a backend connectivity check. The four screens
described in AGENTS.md section 8 (Upload, Processing, Review/Edit, Completed)
are implemented in later phases.
