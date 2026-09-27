# Quotation-to-Excel Automation System

A small private web application that turns an ERP quotation PDF into the company Excel
monitoring workbook, with a mandatory human review step in between.

```text
ERP quotation PDF
      ↓
React web app (upload)
      ↓
FastAPI backend (deterministic PDF extraction + parsing)
      ↓
Structured quotation data
      ↓
Editable preview  ← human verification happens here
      ↓
Confirm
      ↓
Excel monitoring workbook (.xlsx)
      ↓
Saved to OneDrive and shared with coworkers as viewers
```

The guiding rule: **PDF → Extract → Preview/Edit → Confirm → Excel**. The system removes
repetitive typing; it never invents business values. Sequence number, installation schedule,
start date and status stay under human control.

## Repository layout

```text
.
├── AGENTS.md                    # authoritative project context and constraints
├── README.md
├── .gitignore
├── .github/workflows/
│   ├── backend-ci.yml           # ruff lint/format + pytest
│   └── frontend-ci.yml          # oxlint + tsc + vitest + production build
├── backend/                     # Python + FastAPI
│   ├── app/
│   │   ├── main.py              # application entrypoint, CORS
│   │   ├── version.py
│   │   └── api/routes.py        # /api/health
│   ├── tests/
│   ├── requirements.txt         # runtime dependencies (pinned)
│   ├── requirements-dev.txt     # dev/test dependencies
│   ├── pyproject.toml           # ruff + pytest configuration
│   └── .env.example
└── frontend/                    # React + Vite + TypeScript
    ├── src/
    │   ├── App.tsx
    │   ├── lib/api.ts           # backend base URL + connectivity probe
    │   └── test/setup.ts
    ├── .env.example
    └── package.json
```

## Prerequisites

- Python 3.11 or newer (developed on 3.14)
- Node.js 24 or newer (developed on 24.21)

## Run locally

Backend:

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt   # Windows
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

Frontend (second terminal):

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The frontend reads `VITE_API_BASE_URL` (see `frontend/.env.example`, default
`http://localhost:8000`). The backend allows browser origins listed in `CORS_ORIGINS`
(see `backend/.env.example`). The home page has a "Check backend" button that calls
`GET /api/health` to confirm the two halves are talking to each other.

## Checks

```bash
# Backend
cd backend
.venv/Scripts/python.exe -m ruff check .
.venv/Scripts/python.exe -m ruff format --check .
.venv/Scripts/python.exe -m pytest

# Frontend
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs the same commands on every push and pull request.

## Current state

Initialization only. No quotation parsing, no Excel generation, no deployment configuration.

- Backend exposes a single `GET /api/health` endpoint.
- Frontend is an application shell with a backend connectivity check.
- The four screens from AGENTS.md section 8 (Upload, Processing, Review/Edit, Completed)
  are not built yet.

The development order is defined in AGENTS.md section 16. The current milestone is
deterministic PDF parsing verified against a real ERP quotation, and that comes before any UI work.

## Deliberate exclusions

Not present, and not to be added without an explicit request: database, authentication,
AI/LLM calls, OneDrive API integration, coworker dashboards, project-management features,
n8n, cloud storage abstractions. The Excel workbook is the operational system of record.

## Privacy rules

- Real ERP quotation PDFs are excluded by `.gitignore` (`*.pdf`) and must never be committed.
- No `.env` file, API key or credential is committed; `.env.example` files document the variables.
- Uploaded PDFs are treated as temporary. Nothing is persisted to disk yet.
- Parser tests use text or sanitised fixtures, not confidential documents.
