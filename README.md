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
│   │   ├── main.py              # application assembly, CORS, error handlers
│   │   ├── dependencies.py      # the only place a concrete parser is bound
│   │   ├── version.py
│   │   ├── api/
│   │   │   ├── router.py        # aggregates routers
│   │   │   ├── system.py        # GET /api/health
│   │   │   ├── quotations.py    # POST /api/quotations/parse
│   │   │   └── errors.py        # structured error envelope
│   │   ├── models/
│   │   │   ├── quotation.py     # Quotation, QuotationItem
│   │   │   ├── review.py        # ReviewFlag, ReviewReason, ParseResult
│   │   │   └── preview.py       # QuotationPreview, SourceInfo
│   │   ├── parser/
│   │   │   ├── base.py          # Word/Rule/ExtractedPage + the two protocols
│   │   │   ├── pdfplumber_extractor.py
│   │   │   └── deterministic.py
│   │   ├── services/
│   │   │   ├── quotation_service.py
│   │   │   └── errors.py        # domain errors
│   │   └── excel/
│   │       └── base.py          # WorkbookGenerator protocol (not implemented yet)
│   ├── tests/                   # unit, parser, service and API tests
│   ├── requirements.txt          # runtime dependencies (pinned)
│   ├── requirements-dev.txt      # dev/test dependencies
│   ├── pyproject.toml            # ruff + pytest configuration
│   └── .env.example
└── frontend/                    # React + Vite + TypeScript
    ├── src/
    │   ├── App.tsx               # composition root
    │   ├── api/
    │   │   ├── client.ts         # fetch, base URL, ApiError
    │   │   └── quotations.ts     # one function per endpoint
    │   ├── state/
    │   │   ├── quotationDraft.ts     # pure reducer for preview/edit state
    │   │   └── useQuotationDraft.ts  # React binding
    │   ├── types/quotation.ts    # mirrors the backend contract
    │   └── test/setup.ts
    ├── .env.example
    └── package.json
```

## Boundaries

```text
React components  →  state/quotationDraft (pure reducer)  →  api/quotations
                                                                  ↓ HTTP
                                              api/quotations → app/api routes
                                                                  ↓
                                              services/quotation_service
                                                        ↓              ↓
                                         parser/PdfTextExtractor   parser/QuotationParser
                                        (PDF → words + ruled lines)  (geometry → models)
                                                        ↓
                                              models/quotation + review
```

- The **API layer** never imports a PDF library or a parsing rule.
- `services/quotation_service.py` depends on the two protocols, not on their
  implementations, so the parser can be replaced without touching routes, the
  service or the data model.
- The **frontend** keeps UI, API access and edit state in separate modules. The
  edit rules are a plain reducer with no React, so they are tested directly.
- **`models/`** is the shared contract between backend and frontend.
  `frontend/src/types/quotation.ts` mirrors it one to one.

## Data contract

`Quotation` carries `quotation_number`, `client_name`, `project_name` and
`items`. `QuotationItem` carries `sr`, `description`, `quantity` and `unit`.
Every field is optional: a value the parser could not read stays empty and is
listed in `review` with a plain-language message, rather than being guessed.

A `ReviewFlag.reason` is `missing` (not found), `unconfident` (found but the
layout made it ambiguous) or `inconsistent` (read, but the row's own figures do
not agree with each other).

Sequence number, installation schedule, start date and status are **absent from
the contract on purpose**. They are never extracted and never inferred
(AGENTS.md section 6). A test guards this.

`POST /api/quotations/parse` takes a PDF and returns:

```json
{
  "quotation": { "quotation_number": "...", "client_name": "...", "project_name": "...", "items": [] },
  "review": [{ "field": "items[2].quantity", "reason": "missing", "message": "Line 3: the quantity was not readable. Please type it in." }],
  "source": { "filename": "quote.pdf", "page_count": 2, "warnings": [] }
}
```

Failures use the same envelope: `{"error": {"code", "message", "detail"}}`, where
`message` is written to be shown to a non-technical user.

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

Architecture and data contracts are in place, plus a first working parser and
the four screens that let a person check what it read. The Excel generator is
not built yet.

Backend

- `GET /api/health`
- `POST /api/quotations/parse` — PDF in, `QuotationPreview` out
- `WorkbookGenerator` is an interface only; the endpoint is added with the
  implementation

Frontend

- Upload → read → review/correct → confirm, on one page
- API client, typed endpoints, and a tested reducer for preview/edit state
- Every field the parser was unsure of is marked on the review screen and
  editable
- Confirming is a placeholder: it does not generate Excel yet

### Parser status

The parser reads values out of the **ruled cells** the ERP draws, not out of the
flattened text stream. That distinction decides whether the parser is usable: in
the reference quotation the text layer interleaves the columns so that the
`DISCOUNT` value appears where the quantity belongs, and a text-based parser
reports `30` and `55` for quantities that are really `34` and `88` — without
flagging either. Reading each value from the cell it is written in gives the
correct answer.

`pdfplumber` supplies the text positions and the drawn lines; `deterministic.py`
does all interpretation. The extractor does none, so every parsing decision is
testable without a PDF library.

Each row's own figures are checked against each other — `PRICE/UNIT - DISCOUNT =
NET PRICE` and `QTY x NET PRICE = TOTAL/AED`. A row that fails is flagged
`inconsistent`. The value read is never adjusted to make the arithmetic work:
the flag asks a person to check the source, which is the behaviour AGENTS.md
section 9 requires.

Verified against **four** real quotations, which between them use four different
column layouts and two page shapes:

| Quotation | Layout | Result |
|-----------|--------|--------|
| reference | 8 columns, `QTY`/`UNIT` sharing one cell, `TOTAL/AED` | 3 items, 34 / 88 / 122 m2, no flags |
| TEE VEE | 6 columns, `QTY` and `UNIT` in cells of their own, no net price | 1 item, 46 m2, no flags |
| ALPAGO | 6 columns, one `QTY/UNIT` cell, `PRICE/AED`, no total column | 2 items, 200 m2 each, one flag |
| ELEV8 | 8 columns, grid continuing over a page break | 4 items, no flags |

Only one review flag is raised across all four, and it is correct: the ALPAGO
document has no project field, so it is left empty and flagged rather than
invented. The parser was originally built against the first quotation alone and
failed on two of the next three; the layouts and page shapes it now handles are
each pinned by a generated fixture
(`tests/parser/test_layout_variants.py`), so no confidential file is committed.

A quotation drawn differently again produces no line items and a review flag
rather than a guess — and a ruled grid that is found but cannot be read is
reported as needing review, rather than returning an empty result that looks like
success. Another vendor's quotation is still untested (AGENTS.md section 13).

The development order is defined in AGENTS.md section 16.

## Deliberate exclusions

Not present, and not to be added without an explicit request: database, authentication,
AI/LLM calls, OneDrive API integration, coworker dashboards, project-management features,
n8n, cloud storage abstractions. The Excel workbook is the operational system of record.

## Privacy rules

- Real ERP quotation PDFs are excluded by `.gitignore` (`*.pdf`) and must never be committed.
- Parser tests generate a synthetic ruled PDF whose geometry matches the reference
  layout but whose client, project and product names are invented. The real
  quotation is used only by tests that skip when it is absent.
- No `.env` file, API key or credential is committed; `.env.example` files document the variables.
- Uploaded PDFs are treated as temporary. Nothing is persisted to disk yet.
