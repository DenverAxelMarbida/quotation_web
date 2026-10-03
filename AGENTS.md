# AGENTS.md
# Quotation-to-Excel Automation System

## 1. Project Identity

Project name: **Quotation-to-Excel Automation System**

Purpose:

Build a private web application that helps a non-technical user upload an ERP quotation PDF, extract structured quotation information, review/correct it, and generate the company's Excel monitoring output.

Core workflow:

```text
ERP
  ↓
Quotation PDF
  ↓
Private Web App
  ↓
Python/FastAPI PDF extraction + deterministic parsing
  ↓
Structured quotation data
  ↓
Editable Preview
  ↓
Human verification/correction
  ↓
Confirm
  ↓
Excel Monitoring Workbook
  ↓
User saves/shares through OneDrive
  ↓
Coworkers view the Excel as viewers
```

The core principle is:

**PDF → Extract → Preview/Edit → Confirm → Excel**

Never redesign this into:

**PDF → Blind automatic Excel update**

Human review is a required quality-control step.

---

## 2. Scope Boundary

This is a small private business utility, not a project-management platform.

The website exists primarily for the user's mother to:

1. Upload an ERP quotation PDF.
2. Process/extract quotation information.
3. Review extracted information.
4. Correct/edit extracted information.
5. Confirm the information.
6. Generate/download the Excel output.

Do NOT expand the scope without explicit user instruction.

Do NOT build unless explicitly requested:

- Coworker accounts
- Coworker dashboard
- Project dashboard
- Real-time collaboration
- Chat
- Notifications
- Mobile application
- Full ERP replacement
- Project-management functionality
- Automatic project status prediction
- Automatic installation scheduling
- Automatic start-date prediction
- Complex employee roles
- Custom cloud storage
- Unnecessary database
- AI-based business decisions
- n8n as the core architecture

The Excel workbook remains the actual operational monitoring system.

---

## 3. Technology Stack

### Frontend

- React
- Modern component-based UI
- Simple private web interface
- Planned hosting: Vercel during testing/development

### Backend

- Python
- FastAPI
- REST-style API between frontend and backend
- Planned hosting: Render during testing/development

### PDF Processing

Use deterministic Python PDF/text extraction and structured parsing first.

The parser should handle:

- PDF text extraction
- Header detection
- Quotation number detection
- Client/project detection
- SR#/line-item detection
- Multi-line descriptions
- Quantity detection
- Unit detection

Do NOT introduce an LLM/API as the first solution.

Only consider AI/LLM assistance after real ERP quotation PDFs demonstrate deterministic parsing cannot reliably solve a case.

If AI is eventually added, it may assist extraction only. It must never independently determine business decisions such as Status, Installation Schedule, or Start Date.

### Excel

Generate normal `.xlsx` output using a suitable Python Excel library.

The generated workbook must remain usable in normal Microsoft Excel without the web application.

### Storage / Sharing

- OneDrive remains the intended location for final Excel storage/sharing.
- Initial implementation may generate the Excel and let the user download/save it manually to OneDrive.
- Automatic OneDrive integration is a later optional enhancement.
- Do not use Render's local filesystem as permanent business storage.
- Do not add a database unless a real requirement appears.

### Deployment

Planned:

```text
React frontend → Vercel
FastAPI backend → Render
```

Development must happen locally first.

Keep the application portable so the hosting provider can be changed later.

---

## 4. Actual ERP Quotation Reference

The project has an actual ERP quotation PDF as the primary development/test reference.

Known sample values:

- Project: `MBRC 466`
- Quotation Number: `QDXB/25/014094/Rev1`
- Date: `10/10/2025`
- Client: `ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C`

Quotation table contains:

```text
SR#
DESCRIPTION
QTY
UNIT
PRICE/UNIT
DISCOUNT
NET PRICE
TOTAL/AED
```

The table is drawn with real ruled cell borders. Values must be read from their
own ruled cell, never from the flattened text stream: in the flattened stream the
table columns interleave, and the `DISCOUNT` column value is easily mistaken for
the quantity. Specifically, each quantity below is the value inside the ruled
`QTY` cell of that row.

Known sample line items:

### SR# 1 / FF-04

- Supply and installation
- FL/1000217
- Engineered Oak Flooring
- Dimensions: 15/4 x 120 x 600mm
- AB grade
- Micro beveled 4 sides
- Herringbone Cut
- Color to match the approved sample
- Glue down method
- Including wastage
- Quantity: 34
- Unit: m2

### SR# 2 / FF-05

- Supply and installation
- FLU/1000025
- Engineered Oak Flooring
- Dimensions: 16/4 x 220 x RLmm
- 900mm to 3000mm
- AB grade
- T&G
- Micro bevelled
- Color to match the approved sample
- Straight installation
- Glue down method
- Quantity: 88
- Unit: m2

### SR# 3

- Self-levelling up to 3mm
- Quantity: 122
- Unit: m2

### Quantity correction (verified against the PDF)

The SR#1 and SR#2 quantities above were previously recorded as `30` and `55`.
Those are the values in the ruled `DISCOUNT` cells. The correct `QTY` cell values
are `34` and `88`. The corrected figures are confirmed by the quotation's own
arithmetic, which holds exactly for every row:

- `PRICE/UNIT - DISCOUNT = NET PRICE` — 610.00-30.00=580.00, 650.00-55.00=595.00, 55.00-0.00=55.00
- `QTY x NET PRICE = TOTAL/AED` — 34x580.00=19,720.00, 88x595.00=52,360.00, 122x55.00=6,710.00
- the three `TOTAL/AED` values sum to 78,790.00, which equals the document's own
  `Net Before VAT` 74,999.96 plus `Discount` 3,790.04

The old figures satisfy none of these for SR#1 and SR#2. SR#3's `122` was always
correct; it agreed with the old figures only because its `DISCOUNT` cell is 0.00.

The PDF may also contain financial/administrative information such as discounts, VAT, totals, validity, payment terms, exclusions, and remarks. These are not currently required for the coworker-facing monitoring output unless explicitly requested.

Do not discard useful source information internally if it helps parsing, but do not unnecessarily expose financial fields in the user-facing monitoring workflow.

---

## 5. Data Model Rules

The parser should produce a structured representation similar to:

```python
{
    "quotation_number": "QDXB/25/014094/Rev1",
    "client_name": "ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C",
    "project_name": "MBRC 466",
    "items": [
        {
            "sr": 1,
            "description": "...",
            "quantity": 30,
            "unit": "m2"
        },
        {
            "sr": 2,
            "description": "...",
            "quantity": 55,
            "unit": "m2"
        },
        {
            "sr": 3,
            "description": "Self-levelling up to 3mm",
            "quantity": 122,
            "unit": "m2"
        }
    ]
}
```

A quotation can contain multiple line items.

Each quotation item becomes its own Excel row.

Important distinction:

- `Sequence` = quotation/project group
- `quotation_number` = ERP quotation identifier
- `sr` = individual line item

All rows from one quotation must share the same Sequence/quotation reference.

Example:

```text
Sequence | Quotation | SR# | Client | Project | Product | Qty | Unit
15       | QDXB/...   | 1   | ALPAGO | MBRC 466 | Item A | 30 | m2
15       | QDXB/...   | 2   | ALPAGO | MBRC 466 | Item B | 55 | m2
15       | QDXB/...   | 3   | ALPAGO | MBRC 466 | Item C | 122 | m2
```

---

## 6. Extracted vs Manually Controlled Fields

### Python should attempt to extract

- Client Name
- Project Name
- Product Description
- Quantity
- Unit of Measurement
- Quotation Number
- SR#

### Never automatically infer

These remain under the mother's control:

- Sequence Number
- Installation Schedule
- Start Date
- Completion Date

Do not guess them.

For example:

> The existence of a quotation does NOT mean the project is Ongoing.

### Derived by the application

- Status

Status is neither extracted from the quotation nor chosen by hand. It is derived
from Installation Schedule, Start Date and Completion Date using the rule in
section 7.

---

## 7. Excel Output Requirements

The Excel workbook is the final operational output.

### Sheet 1 — Summary / Final Output

Required coworker-facing fields:

1. Sequence Number
2. Client Name
3. Project Name
4. Product Description
5. Quantity
6. Unit of Measurement
7. Installation Schedule
8. Start Date
9. Completion Date
10. Status

### Sheet 2 — Raw Data / Input

Contains underlying data/source information used to populate the Summary sheet.

The Summary sheet may use Excel formulas referencing Raw Data.

Preserve the existing workbook structure as much as practical. Do not redesign it without a reason.

### Status

- On Hold = RED
- Ongoing = ORANGE
- Completed = GREEN

Status is automatically derived from the operational fields, in this priority
order:

1. Completion Date filled → `Completed`
2. Otherwise, Installation Schedule AND Start Date both filled → `Ongoing`
3. Otherwise → `On Hold`

For this determination, `null`, `undefined`, empty or whitespace-only values,
and `"-"` are treated as empty.

Status must not be manually selected or manually overridden. It is never read
from a workbook cell as business data: a value that disagrees with its own dates
is corrected rather than kept.

Prefer Excel conditional formatting where practical.

### Excel safety

The generator must:

- Preserve required columns.
- Preserve Summary/Raw Data concept.
- Preserve formulas where applicable.
- Preserve status formatting.
- Support multiple rows per quotation.
- Keep the same Sequence for all line items belonging to one quotation.
- Preserve quotation/SR references internally where useful.
- Avoid accidentally overwriting existing projects/data.
- Keep Installation Schedule, Start Date, and Completion Date under human control.

Never silently overwrite existing monitoring data.

---

## 8. UI/UX Requirements

The target user is non-technical.

The interface should be simple and obvious.

The mother should not need to understand:

- Python
- FastAPI
- React
- APIs
- Git
- PDF parsing
- Excel programming
- Deployment

### Screen 1 — Upload

Include:

- PDF upload
- Selected filename
- Process button

### Screen 2 — Processing

Show a clear loading state such as:

`Reading quotation...`

or:

`Extracting quotation data...`

Do not leave the user wondering whether processing is working.

### Screen 3 — Review/Edit

Show:

- Client Name
- Project Name
- Quotation Number
- Line-item table
- SR#
- Product Description
- Quantity
- Unit

Allow:

- Edit header fields
- Edit line-item fields
- Add line item
- Delete line item
- Correct values

Extraction uncertainty must be visible.

For example:

`⚠ Please review`

Do not silently present low-confidence/failed extraction as trustworthy.

### Screen 4 — Completed

Show:

`Excel file generated successfully.`

Provide:

- Download Excel
- Start another quotation

Do not generate Excel before confirmation.

---

## 9. Error Handling Principle

The system must favor:

**visible review/correction over silent guessing**

If an important field cannot be confidently extracted:

- Keep the field editable.
- Mark it for review.
- Explain the problem in a user-friendly way.
- Do not invent a value.
- Do not generate silently incorrect data.

Backend errors should return structured, understandable API errors.

Frontend errors should be actionable and non-technical.

---

## 10. Security and Privacy

Quotation PDFs contain business/client information.

Treat this as a private business tool.

Requirements:

- Do not publicly expose quotation files.
- Do not permanently store uploaded PDFs unnecessarily.
- Do not log sensitive quotation contents unnecessarily.
- Do not use public demo data in production.
- Never commit real quotation PDFs containing business/client data to Git.
- Never commit secrets, API keys, credentials, or `.env` files.
- Use environment variables for configuration/secrets.
- If external AI APIs are ever considered, verify whether sending company quotation data to that service is permitted.
- Access control may be added when moving beyond local testing, but do not introduce a complex authentication system without a real requirement.

---

## 11. Temporary File Handling

Uploaded PDFs and generated files should be treated as temporary unless there is an explicit requirement for persistent storage.

Prefer:

1. Receive PDF.
2. Process PDF.
3. Extract structured data.
4. Return preview data.
5. On confirmation, generate `.xlsx`.
6. Allow download.
7. Clean up temporary files.

Do not rely on Render's ephemeral filesystem for long-term records.

---

## 12. Duplicate Protection

Duplicate detection is a later concern.

Potential identifiers:

- Quotation Number
- Project
- Client
- SR#/line item

Do not over-engineer duplicate detection before the basic workflow is reliable.

The initial priority is:

```text
PDF → Parser → Structured Data → Preview → Edit → Excel
```

---

## 13. Testing Requirements

Testing is important because the parser is the highest-risk component.

At minimum test:

- One-item quotation
- Multiple-item quotation
- Long multiline descriptions
- Different quantities
- Different units
- Different clients
- Different projects
- Different quotation numbers
- Missing/unclear fields
- Malformed or unsupported PDFs
- Duplicate SR numbers if encountered
- Empty descriptions
- Decimal quantities if encountered
- Unit variations if encountered

Parser tests should use sanitized fixtures where possible.

Do NOT commit confidential real quotation PDFs unless explicitly approved.

Prefer text fixtures or sanitized PDFs for automated CI.

---

## 14. CI/CD

GitHub is the source repository.

Use GitHub Actions for CI.

At minimum CI should eventually validate:

### Frontend

- Install dependencies
- Lint
- Test
- Production build

### Backend

- Install dependencies
- Lint/format checks where configured
- Unit tests
- Parser tests

### Deployment

Planned production flow:

```text
Feature branch
    ↓
Pull Request
    ↓
GitHub Actions CI
    ↓
Review
    ↓
Merge to main
    ↓
Vercel deploys frontend
Render deploys backend
```

Do not make production deployment depend on arbitrary local machine state.

Keep deployment configuration documented and reproducible.

---

## 15. Repository Structure

A reasonable target structure is:

```text
quotation-to-excel/
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── parser/
│   │   ├── models/
│   │   ├── services/
│   │   └── excel/
│   ├── tests/
│   ├── requirements.txt
│   └── ...
│
├── .github/
│   └── workflows/
│       ├── frontend-ci.yml
│       └── backend-ci.yml
│
├── .gitignore
├── AGENTS.md
├── README.md
└── ...
```

The exact structure may be adjusted if a better simple structure is justified.

Do not create unnecessary layers merely for architectural appearance.

---

## 16. Development Order

Follow this order unless the user explicitly changes it.

### Phase 1 — Inspect/understand actual PDF

Determine:

- How text is extracted
- Header layout
- Line-item layout
- Multiline description behavior
- Quantity/unit patterns
- Page boundaries
- Repeated headers/footers

### Phase 2 — Build deterministic Python parser

Target:

```text
Actual ERP PDF
      ↓
Python parser
      ↓
Structured JSON/data
```

Verify extraction accuracy before building the UI.

### Phase 3 — Build backend API

Expose endpoints for:

- PDF processing
- Structured preview data
- Excel generation

Keep the API small.

### Phase 4 — Build React UI

Implement:

```text
Upload
 ↓
Processing
 ↓
Review/Edit
 ↓
Confirm
 ↓
Download
```

### Phase 5 — Build Excel generator

Generate the required workbook while preserving the intended structure.

### Phase 6 — Integration testing

Test the entire local workflow.

### Phase 7 — CI/CD

Add GitHub Actions and deployment configuration.

### Phase 8 — Deployment

Deploy frontend to Vercel and backend to Render only after local testing is reliable.

---

## 17. Engineering Principles

Always prefer:

- Simple over elaborate
- Deterministic over probabilistic when possible
- Human verification over silent guessing
- Small APIs over unnecessary abstraction
- Testable parser functions
- Clear data models
- Explicit errors
- Portable deployment
- Minimal recurring cost
- Privacy by default
- Incremental implementation

Avoid:

- Premature AI
- Premature database
- Premature authentication
- Premature OneDrive API integration
- Premature duplicate-detection complexity
- Scope creep
- Silent data corruption
- Silent overwrites
- Hard-coded secrets
- Business logic hidden in UI components
- Giant monolithic files
- Over-engineering

---

## 18. Definition of Done

The core system is successful when the mother can:

1. Open the private web application.
2. Upload a normal ERP quotation PDF.
3. Wait for extraction.
4. See client/project/quotation information.
5. See each quotation line item as a separate row.
6. Edit incorrect extracted information.
7. Add/remove/edit line items.
8. Confirm the information.
9. Generate the required Excel workbook.
10. Download/save it to OneDrive.
11. Share the Excel with coworkers as viewers.
12. Avoid manually retyping quotation information.

The system does NOT need to eliminate all human involvement.

The objective is to eliminate repetitive quotation encoding while keeping the mother in control of the final data.

---

## 19. Current Priority

The current priority is NOT deployment.

The first development milestone is:

```text
Actual ERP PDF
      ↓
Python deterministic parser
      ↓
Structured JSON/data
      ↓
Verify extraction accuracy
```

Do not skip this step just to build UI quickly.

---

## 20. OpenCode Behavior Rules

When working on this repository:

1. Read this `AGENTS.md` before making changes.
2. Inspect the existing repository before creating files.
3. Do not assume a library is installed; inspect package/config files first.
4. Do not overwrite existing user code without understanding it.
5. Keep changes focused on the current requested phase.
6. Do not expand project scope without explicit instruction.
7. Before adding a dependency, explain why it is needed and prefer established lightweight libraries.
8. Never add secrets to source control.
9. Never commit real confidential quotation PDFs.
10. Run relevant tests/checks after changes.
11. Report exactly what was changed and what was verified.
12. If a requirement is ambiguous, preserve the simplest architecture consistent with this document and ask before making a major architectural decision.
13. Do not introduce AI/LLM, a database, authentication, OneDrive API integration, or n8n unless explicitly requested or a demonstrated requirement makes it necessary.
14. Do not claim extraction is reliable until it has been tested against the actual/sanitized ERP quotation format.
15. Never silently overwrite existing Excel monitoring data.
16. Preserve the human review step.
17. Treat the Excel workbook as the final operational artifact, not the website.
18. Keep the mother's workflow non-technical and simple.

---

## 21. Final Architecture Reference

```text
                    COMPANY ERP
                         │
                         ▼
                  QUOTATION PDF
                         │
                         ▼
              ┌─────────────────────┐
              │ Private React Web   │
              │ App                 │
              │                     │
              │ Mother uploads PDF  │
              └──────────┬──────────┘
                         │ HTTP
                         ▼
              ┌─────────────────────┐
              │ Python / FastAPI    │
              │                     │
              │ PDF extraction      │
              │ Deterministic parse │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Structured Data     │
              │                     │
              │ Header + line items │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Editable Preview    │
              │                     │
              │ Human verification  │
              └──────────┬──────────┘
                         │
                         ▼
                  CONFIRM & GENERATE
                         │
                         ▼
              ┌─────────────────────┐
              │ Excel Generator     │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Excel Monitoring    │
              │ Workbook            │
              └──────────┬──────────┘
                         │
                         ▼
                      OneDrive
                         │
                         ▼
                 Coworkers — View
```
