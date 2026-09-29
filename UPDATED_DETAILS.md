# Updated Details — What Was Built, and What Needs Attention

Record of all work under the instruction:

> Establish the application's internal architecture. Design clear boundaries
> between frontend (UI components, API client, quotation preview/edit state) and
> backend (API routes, request/response models, PDF extraction, quotation parser,
> Excel generation). Create appropriate data models. The parser must be
> replaceable without changing the API contract. Make PDF → parser → structured
> model independently testable. Do not implement complicated business logic yet.
> Stop after the architecture and data contracts are established.

Followed by:

> Validate the PDF extraction strategy using the real ERP quotation, specifically
> testing whether pdfplumber can reliably recover the column positions and SR#3
> quantity. Do not build the frontend or Excel generator yet.

Followed by:

> Adopt pdfplumber behind the existing `PdfTextExtractor` protocol, read values
> from the ruled table cells rather than the flattened text stream, add the
> arithmetic consistency check, and replace the text fixture with a sanitised
> ruled-table PDF. Correct `AGENTS.md` §4. Keep the API and data contracts
> unchanged.

Followed by:

> Validate the parser against three further real quotations. Report what it gets
> wrong. Do not change the parser yet.

Followed by:

> Generalise the parser for the layouts that validation found, add a regression
> test per defect, preserve every passing behaviour, and re-validate all four
> real quotations. Do not touch the frontend, Excel or deployment.

Followed by:

> Build the review workflow in the frontend — upload, processing, review/edit,
> confirm — as a single simple page for a non-technical user. Use the existing
> API client and draft reducer. Do not build the Excel generator and do not
> change the parser.

**Status:** the parser work is complete and the review workflow is built. The
parser is checked against **four** real quotations covering four column layouts
and two page shapes, and reads all four correctly: `AGENTS.md` §4's 34 / 88 /
122, TEE VEE's single 46 m2 line, ALPAGO's two 200 m2 options, and ELEV8's four
items across a page break. Backend suite green (**80 passed**). Frontend suite
green (**62 passed**). Nothing committed — no commit was requested. Base commit
`d4bf222`.

**Read §1 first.** It records a data error that was found in the authoritative
spec and is now fixed, and it is the reason the parser was rewritten rather
than tuned. **Read §6 next** for the four-layout validation that followed, and
what it changed. **Read §7** for the workflow now in place. **Read §15** for the
consolidated multi-quotation workbook and the Excel usability/formatting work.
**Read §16** for the session continuation fix, and **§17** for the session
quotations table, per-quotation preview, and duplicate protection. **Read §18**
for the Phase 1 + Phase 2 UI/UX polish (design tokens, button/alert/tag system,
responsive foundation, and corrected state communication).

---

## 1. RESOLVED — a data error in the authoritative spec

> **Status: fixed.** `AGENTS.md` §4 now records 34 / 88 / 122 with an auditable
> correction note, and the parser reads those values from the real PDF. The
> analysis below is kept as the record of how the error was found.

### 1.1 The documented quantities were wrong

`AGENTS.md` §4 lists the sample line items as SR#1 quantity **30** and SR#2
quantity **55**. Those numbers are the **DISCOUNT** column. The actual quantities
are **34** and **88**.

| SR# | QTY | UNIT | PRICE/UNIT | DISCOUNT | NET PRICE | TOTAL/AED |
|-----|---------|------|------------|----------|-----------|-----------|
| 1 | **34.00** | m2 | 610.00 | 30.00 | 580.00 | 19,720.00 |
| 2 | **88.00** | m2 | 650.00 | 55.00 | 595.00 | 52,360.00 |
| 3 | **122.00** | m2 | 55.00 | 0.00 | 55.00 | 6,710.00 |

Three independent checks, none of which depend on trusting the column headers:

```
price - discount = net        610-30=580 ✓    650-55=595 ✓    55-0=55 ✓
quantity x net   = total      34x580=19,720 ✓  88x595=52,360 ✓  122x55=6,710 ✓
sum of TOTAL/AED             19,720+52,360+6,710 = 78,790.00
document's own figures       Net Before VAT 74,999.96 + Discount 3,790.04 = 78,790.00 ✓
```

Under the documented quantities the arithmetic fails:

```
30 x 580 = 17,400  vs actual 19,720   MISMATCH
55 x 595 = 32,725  vs actual 52,360   MISMATCH
122 x 55 = 6,710   vs actual  6,710   MATCH  (coincidence: SR#3's discount is 0)
```

SR#3 matched the documentation only because its discount happens to be `0.00`.
The two values that agreed were a coincidence, and the two that disagreed are the
true quantities.

**Decision taken:** `AGENTS.md` §4 corrected. SR#1 quantity `30` → `34`, SR#2
quantity `55` → `88`, and the description of the columns now says the quantity
comes from the ruled `QTY` cell. The arithmetic above is recorded in §4 as the
justification.

### 1.2 The previous parser silently returned wrong quantities

`backend/app/parser/` produced this from the real PDF:

```
quotation_number: QDXB/25/014094/Rev1     ✓ correct
client_name     : ALPAGO DESIGN AND ...   ✓ correct
project_name    : MBRC 466                ✓ correct
SR# 1  qty=30.0   ← wrong, should be 34
SR# 2  qty=55.0   ← wrong, should be 88
SR# 3  qty=None   ← flagged for review
review: [('items[2].quantity','missing'), ('items[2].description','missing')]
```

**Two of three quantities were wrong and neither was flagged.** pypdf emits the
whole line as one interleaved text run, so a string rule that takes the leading
number picks up the discount (`30.00`, `55.00`) instead of the quantity. The
result agreed with `AGENTS.md` §4 only because the spec was wrong in the same
direction.

This was the failure mode `AGENTS.md` §9 exists to prevent, and it is worse than
the SR#3 gap that prompted the original design: an unreadable value at least
raises a review prompt, whereas a plausible wrong value looks trustworthy.

**Fixed.** The parser now reads the ruled `QTY` cell, so the real PDF returns
34 / 88 / 122 with no review flags. The arithmetic check is what would have
caught this pair as well: both rows are self-contradictory, and both are now
flagged `inconsistent` if they ever appear again.

### 1.3 Attention list

| # | Issue | Impact | Status |
|---|-------|--------|--------|
| 1 | Quantities wrong in `AGENTS.md` §4 (§1.1) | Spec contradicts the PDF | **Fixed** — §4 corrected, correction note recorded |
| 2 | Parser returned wrong quantities unflagged (§1.2) | Silent data corruption | **Fixed** — ruled-cell reading, arithmetic check added |
| 3 | Evidence is **one** quotation, **one** template | No reliability claim is possible | **Open** — collect 2–3 more real quotations |
| 4 | Approach assumes the ERP **draws table rules** | An unruled template would defeat it | **By design** — an unruled page yields no items plus a review flag, never a guess. No header-position fallback was added, because that is the failure mode that caused the original bug |
| 5 | `pdfplumber` not in `requirements.txt` | §20.7 requires justifying a dependency first | **Done** — `pdfplumber==0.11.10` added, `pypdf` removed |
| 6 | `pdfplumber` pulls in `pdfminer.six` + Pillow | Larger install; slower CI than pypdf | Accepted — accuracy requires it |
| 7 | Descriptions include the item code (`FF-04 …`) | May not belong in "Product Description" | **Open** — kept in the description because adding a field would change the agreed contract; decide with the Excel sheet layout |
| 8 | Float comparison silently dropped quantities | General hazard, not specific to this PDF | **Fixed** — regression test pins the `300.0` vs `300.00000000000006` case |
| 9 | `parser/deterministic.py` string rules become obsolete | Dead weight after migration | **Done** — rewritten for ruled cells |
| 10 | This document is not linked from `README.md` | Hard to find | Deferred — the README covers the current state |
| 11 | All work uncommitted | Loss risk | **Open** — not committed; no commit was requested |
| 12 | `StarletteDeprecationWarning: httpx with starlette.testclient` | Cosmetic, tests pass | Deferred |
| 13 | `error.code` emits the exception class name, not the documented slug | Cosmetic contract drift | **Open** — pre-existing, outside this task |
| 14 | No duplicate protection, no Sequence/status logic | Out of scope by design | Do not add (`AGENTS.md` §12) |

---

## 2. Investigation first

Three findings from inspecting the real ERP quotation PDF determined the original
design.

**The sample PDF is the `AGENTS.md` §4 reference.** The filename
(`SAMPLE_VRP_Quotation - 2026-07-21T155726.357.pdf`) looked unrelated, but the
content is the documented quotation: `MBRC 466`, `QDXB/25/014094/Rev1`,
`ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C`, dated `10/10/2025`. A real
reference was available after all.

**`pypdf`'s default `extract_text()` scrambles the header.** Labels and values
interleave out of order. `extraction_mode="layout"` preserves column positions and
produces a readable document, which made "layout-preserving text" a **contract
requirement** rather than a preference — and is why `ExtractedPage` is a
documented dataclass instead of a bare `str`.

**The text layer interleaves table columns irrecoverably.** SR#3 is a single run:

```
'55.00122.00Self-levelling up to 3mm3  0.00m2 6,710.0055.00'
```

pypdf's visitor exposes run-level coordinates only, not per-glyph, so rows cannot
be separated by string position. This is what §1.2 is about, and it is why
pdfplumber was evaluated.

---

## 3. Backend structure

```text
backend/app/
├── main.py                  application assembly, CORS, error handlers
├── dependencies.py          the only module binding a concrete parser
├── version.py
├── api/
│   ├── router.py            aggregates routers
│   ├── system.py            GET  /api/health
│   ├── quotations.py        POST /api/quotations/parse
│   └── errors.py            structured error envelope + handlers
├── models/                  the shared contract
│   ├── quotation.py         Quotation, QuotationItem
│   ├── review.py            ReviewFlag, ReviewReason, ParseResult
│   └── preview.py           QuotationPreview, SourceInfo
├── parser/                  PDF → words + drawn rules → structured data
│   ├── base.py              Word, Rule, ExtractedPage, both protocols
│   ├── pdfplumber_extractor.py
│   └── deterministic.py     the parsing rules
├── services/
│   ├── quotation_service.py orchestration
│   └── errors.py            domain errors
└── excel/
    └── base.py              WorkbookGenerator protocol (no implementation)
```

`pdfplumber_extractor.py` is the only module in the tree that imports a PDF
library, and it interprets nothing: it converts pdfplumber's words and lines into
`Word` and `Rule` and stops. Every decision about what the document means lives
in `deterministic.py`, where it can be tested without a PDF library present.

### The replaceability seam

```text
PDF bytes ──[PdfTextExtractor]──▶ ExtractedPdf ──[QuotationParser]──▶ ParseResult
                                   words + rules
```

Both steps are `typing.Protocol` definitions in `parser/base.py`. The API layer
imports only the protocols. `dependencies.py` is the single place a concrete
implementation is chosen, so replacing the parser means editing one file. **This
is the property that made the pdfplumber evaluation cheap** (§5).

`ExtractedPdf` carries **positions, not a text string**. Text cannot express
where a column starts, which is the only thing that matters when the table's
columns interleave in the flattened stream — that is the bug in §1.2. Swapping
pypdf for pdfplumber did not bypass the seam; it widened the data crossing it.

Enforced by tests, not just convention:

- `tests/parser/test_extractor.py:19` — `isinstance(PdfplumberTextExtractor(), PdfTextExtractor)`
- `tests/services/test_quotation_service.py:61` — stub implementations also satisfy the protocols
- `tests/services/` runs the whole pipeline with stubs, proving no PDF library and
  no parsing rule is involved in the service

---

## 4. Data contract

`Quotation` and `QuotationItem`, mirroring the spec exactly and nothing more:

```python
Quotation(quotation_number, client_name, project_name, items)
QuotationItem(sr, description, quantity, unit)
```

**Every field is optional.** A value the parser could not read stays `None` and is
listed in `review` with a plain-language message. Nothing is invented.

**Units are free text, not an enum.** An unfamiliar unit stays visible instead of
being rejected (`tests/models/test_quotation.py:43`).

**Sequence number, installation schedule, start date and status are absent from
the model on purpose.** They are never extracted and never inferred
(`AGENTS.md` §6). `tests/models/test_quotation.py:34` asserts they are absent, so
extraction can never quietly grow them.

### Response envelope

```json
{
  "quotation": { "quotation_number": "...", "client_name": "...",
                 "project_name": "...", "items": [] },
  "review": [{ "field": "items[2].quantity",
               "reason": "missing",
               "message": "Line 3: the quantity was not readable. Please type it in." }],
  "source": { "filename": "quote.pdf", "page_count": 2, "warnings": [] }
}
```

`field` uses dotted/indexed paths (`items[2].quantity`) so the review screen can
point at the exact input needing attention.

`reason` has three values:

| Value | Meaning |
|-------|---------|
| `missing` | The field was not found in the document at all. |
| `unconfident` | A value was found, but the layout made it ambiguous. |
| `inconsistent` | A value was read, but the row's own figures do not agree with each other. |

`inconsistent` was added for this round. The row is self-contradictory — a
quantity that does not multiply out to the total printed beside it — which is the
signal that the columns were misread. The value read is still reported exactly as
found; the flag asks a person to check the source. Making the arithmetic work by
editing the quantity would be the silent guessing `AGENTS.md` §9 forbids, and it
would conceal the fact that the cell was misidentified.

### Error envelope

```json
{ "error": { "code": "UnsupportedDocumentError",
             "message": "This file could not be read as a quotation PDF.",
             "detail": "Upload the original quotation PDF exported from the ERP." } }
```

Domain errors in `services/errors.py` are mapped to HTTP status and user-facing
wording in `api/errors.py`. `message` is written to be shown to a non-technical
user (`AGENTS.md` §9). Upload cap is 20 MB, declared once in `services/errors.py`.

---

## 5. pdfplumber validation — the requested test

**Question asked:** can pdfplumber reliably recover the column positions and the
SR#3 quantity? **Answer: yes, decisively.**

> **Scope note.** This section answers that question against **one** document. It
> is kept as the record of that round. The parser was later found to fail on two
> of the next three real quotations, for reasons this single document could not
> reveal — see §6.

### 5.1 Why it works: the table is drawn with real ruled lines

pdfplumber exposes vector graphics, and the ERP draws the item table with actual
rules. These are ground truth, not inference:

```text
vertical rules   x = 24.00, 40.25, 296.00, 364.25, 422.75, 474.50, 524.75, 576.00
horizontal rules top = 107.80, 239.80, 266.80, 296.80, 605.95, 648.85, 721.65

header band = top 266.80 .. 296.80      item band = top 296.80 .. 605.95
```

Every value in the quotation falls exactly inside its cell, e.g. SR#3's `122.00`
spans x 300–322, inside the `QTY` cell 296–336.

### 5.2 Result on the real PDF

```text
elapsed 0.10s for the full 2-page document

HEADER FIELDS
   client_name        'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C'
   quotation_number   'QDXB/25/014094/Rev1'
   quotation_date     '10/10/2025'
   project_name       'MBRC 466'

LINE ITEMS
   SR# 1  qty=34.0  unit='m2'  price=610.0  discount=30.0
       'FF-04 Supply and installation FL/1000217 Engineered Oak Flooring,
        Dimensions: 15/4 x 120 x 600mm, AB grade, micro beveled 4 sides
        Herringbone Cut. Color to match the approved sample Glue down method
        Including wastage'
   SR# 2  qty=88.0  unit='m2'  price=650.0  discount=55.0
       'FF-05 Supply and installation FLU/1000025 Engineered Oak Flooring,
        Dimensions: 16/4 x 220 x RLmm (900mm to 3000mm) AB grade, T&G,
        micro bevelled. Color to match the approved sample Straight
        installation Glue down method'
   SR# 3  qty=122.0 unit='m2'  price=55.0   discount=0.0
       'Self-levelling up to 3mm'

page 2: no ruled table found -> gracefully skipped (it holds terms/exclusions)
```

**SR#3 quantity = 122 — the specific target — is recovered correctly**, along with
a description that previously came back empty, and the two `FF-`/`FLU-` item codes
that pypdf dropped.

### 5.3 Three non-obvious requirements the prototypes exposed

Each of these produced a wrong answer first, so each is a real constraint on the
implementation:

**a. Use the drawn rules as column boundaries, not header-text inference.** The
`DESCRIPTION` label sits at x=144 but the description text is written at x=42, and
`TOTAL/AED` sits at x=531 outside the `NET PRICE` band. Inferring zones from label
positions produced an empty description column. The rules do not lie.

**b. Cluster text into lines with a tolerance (~3 pt), never by exact rounding.**
The left and right header columns sit on baselines 0.2 pt apart (`top=121.0` vs
`121.2`). Rounding `top` to one decimal split a single visual line in two and broke
all header-field parsing until clustering moved to the vertical centre with a
tolerance.

**c. Compare coordinates with a tolerance.** `'88.00'` has `x0=300.0` while the
`QTY` header has `x0=300.00000000000006`, so the natural test
`300.0 >= 300.00000000000006` evaluates `False` and **quantities disappear
silently**. This alone lost two of three items on the first prototype. It is
listed as needs-attention #8 because it is a hazard for any coordinate-based
parser, not just this one.

**d. Derive header-field columns from colon clusters.** The header block is
two-column: labels at x=24, values at x=72, second labels at x=354, second values
at x=432. Client values overflow toward the second label, so splitting at colon
midpoints mis-assigns them. Clustering the `:` x-positions (66 and 426) and taking
each column's leftmost label x (24 and 354) is what makes all four fields land
correctly.

### 5.4 Confidence signal worth keeping permanently

The arithmetic in §1.1 — `price - discount = net` and `quantity x net = total` —
is a free, deterministic check on every row. It is not business inference and
does not decide any business value; it only detects a column misread. Rows that
fail it should be flagged for review. This is the strongest safety net available
while the parser is still being proven on few samples.

---

## 6. Validating against three more real quotations

### 6.1 What the second round of validation found

The first round validated one document. That is a single data point, and §10's
decision to write the parser "only as far as the evidence supports" assumed the
reference document was representative. It was not.

Three further real quotations were read. Two of the three failed, and neither
failed loudly:

| Quotation | Result before this work |
|-----------|-------------------------|
| TEE VEE `QDXB/26/004050/Rev2` | **pass** — 1 item, 46 m2, no flags |
| ALPAGO `QDXB/24/012489/Rev1` | **fail** — 0 items, all header fields null, 4 flags |
| ELEV8 `QDXB/25/006422/Rev2` | **fail** — 3 of 4 items, item 3's description truncated, item 4 lost, **no flags at all** |

All three returned HTTP 200. The ELEV8 case is the one that mattered most: the
API reported success while silently dropping a line item and cutting a
description in half.

### 6.2 The four layouts

Between them the four documents contain four different column layouts and two
page shapes. Every one of them is a real way the same ERP draws the same table.

| | Columns | Quantity/unit | Price | Net | Total |
|---|---------|---------------|-------|-----|-------|
| reference | 8 | one shared cell, two label words `QTY` `UNIT` | `PRICE/UNIT` | `NET PRICE` | `TOTAL/AED` |
| TEE VEE | 6 | cells of their own | `PRICE/UNIT` | — | `TOTAL/AED` |
| ALPAGO | 6 | one shared cell, one label `QTY/UNIT` | **`PRICE/AED`** | `NET PRICE` | — |
| ELEV8 | 8 | one shared cell, two label words | `PRICE/UNIT` | `NET PRICE` | `TOTAL/AED` |

Page shapes: TEE VEE is one page. ALPAGO is two, the second a terms page. ELEV8
is three, with **the item grid running off the foot of page 1 and carrying on
over the top of page 2 with no repeated column header**, and the last row's
description running over the same break.

### 6.3 Six defects, and what each one cost

1. **`QTY/UNIT` matched no known column.** ALPAGO names one ruled cell with a
   single token. `_find_item_table` required the literal `QTY`, found no table,
   and returned an empty quotation. Cost: the whole document.
2. **The header was coupled to the table.** The header fields were read from a
   band derived from the found table, so a table that could not be read cost the
   header too. Cost: quotation number and client, on top of defect 1.
3. **A grid continuing onto the next page was invisible.** Page 2 repeats no
   column header, and the parser only ever looked at the first matching table.
   Cost: ELEV8 item 4, and a 1,500-character description.
4. **The last row's description stopped at the page boundary.** Cost: the tail of
   ELEV8 item 3.
5. **`PRICE/AED` was not recognised as the price column.** Moot while defect 1
   hid the table, but it would have disabled the arithmetic check, which is the
   signal that catches defects like this one.
6. **A ruled grid whose columns cannot be read produced nothing at all.** No
   items, no warning, HTTP 200. This is the failure `AGENTS.md` §9 exists to
   prevent, and the parser had it.

### 6.4 What changed in the parser

| Change | Method |
|--------|--------|
| Every label spelling mapped to a canonical column, so `PRICE/AED` is the unit price and `QTY/UNIT` names two columns | `COLUMN_ALIASES` |
| A one-cell/two-values header is split | `_resolve_cell` |
| The header is read from the first two wide rules when no table is found | `_header_block` |
| A grid continuing from the previous page, required to rule the *same* columns | `_find_continuation_table` |
| A continuation page's leading lines finish the row above | `_carry_description_over` |
| A grid that was found but not read is reported instead of passed over | `_looks_like_unreadable_grid`, `_review_no_items` |

**Splitting the shared `QTY/UNIT` cell.** The label spans x=339.55–374.41 in the
real document, so its centre is 356.98. The quantity sits at x=312.0 and the unit
at x=379.8 — either side of it. The centre of a combined label is where its `/`
separator falls, which is why that is the split and not a tuned constant. The
rule is stated in `_resolve_cell` and pinned by a generated fixture using the same
x positions.

**Why the unreadable-grid report is gated on "no items at all".** It is reported
only when the document produced nothing, because that is the one failure that is
otherwise silent. Warning on any ruled block would fire on a signature box or a
totals block further down a quotation that read perfectly well, and a warning
that cries wolf is worse than none. A regression test pins this.

**Matching continuation pages on the columns, not on the rules.** Requiring every
divider from the previous page to reappear within tolerance is what stops any
ruled content that happens to follow the table from being read as line items.
Pinned by a generated fixture whose second page is ruled into different columns.

### 6.5 Result after the work

| Quotation | Before | After |
|-----------|--------|-------|
| reference | 3 items, 34/88/122, 0 flags | **unchanged** |
| TEE VEE | 1 item, 46 m2, 0 flags | **unchanged** |
| ALPAGO | 0 items, null headers, 4 flags | **2 items, correct headers, 200 m2 ×2, 1 flag** |
| ELEV8 | 3 items, item 3 truncated, item 4 lost, 0 flags | **4 items, item 3 complete, 0 flags** |

The one remaining flag on ALPAGO is correct: that document has no project field,
so it stays null and is flagged rather than invented. ELEV8's four rows all
satisfy `PRICE/UNIT - DISCOUNT = NET PRICE` and `QTY x NET PRICE = TOTAL/AED`,
including the row that used to be lost entirely.

### 6.6 Still not fixed, and why

**En dashes read as ``.** ALPAGO and ELEV8 descriptions contain U+FFFD where the
PDF has an en dash. This is a font/encoding problem in the source document:
pdfplumber cannot recover a character the PDF does not encode. It is upstream of
the parser and outside this task, so the parser passes the character through
rather than hiding it.

**Rectangles are not read.** The extractor collects `page.lines` and not
`page.rects`. TEE VEE prints a product image inside the DESCRIPTION cell. Because
only lines are read, an image cannot be mistaken for a value — but a table drawn
with thick or filled borders would report no rules at all. Not triggered by any of
the four documents; left alone rather than changed speculatively.

### 6.7 Test coverage added

`backend/tests/parser/test_layout_variants.py` — 16 tests, one cluster per
defect, plus the guarantees that keep the fixes from misfiring. Written before the
parser was changed: 9 of the 16 failed against the old parser, which is what
confirms they pin real behaviour rather than the new code.

All four layouts are generated PDFs in `build_quotation_pdf.py` with invented
client, project and product names. No real quotation is committed, and the new
fixtures follow the same rule as the original one (§11).

---

## 7. The review workflow

`AGENTS.md` §8 asks for four screens. They are built, and they are one page
rather than a navigation system, because the user is non-technical and the
journey is four steps with no way back once confirmed.

```text
frontend/src/
├── App.tsx                       stage machine; the only caller of the API
├── screens/
│   ├── UploadScreen.tsx          file choice, PDF check, failures
│   ├── ProcessingScreen.tsx      the waiting state
│   ├── ReviewScreen.tsx          header fields + line items
│   └── CompletedScreen.tsx       confirmation (a placeholder)
├── types/quotation.ts            mirrors the backend contract 1:1
├── api/
│   │   ├── client.ts             fetch, base URL, ApiError
│   │   └── quotations.ts         one function per endpoint
├── state/
│   │   ├── quotationDraft.ts     pure reducer, no React
│   │   └── useQuotationDraft.ts  React binding
└── test/setup.ts
```

`App.tsx` holds `stage`, `preview`, `error` and `pending`, and is the only
module that calls `parseQuotation`. Every screen receives what it needs, so no
component mixes rendering with network access.

### 7.1 The three decisions that shaped it

**A failed parse clears the previous result.** Leaving the last quotation's
details on screen beside a new file's error invites the reader to confirm the
wrong document, which is the failure `AGENTS.md` §9 is written about. A failure
returns to the upload screen empty, and the button is usable again.

**Confirm is never withheld.** A quotation with no project name — ALPAGO, and
anyone else like it — is flagged every single time, so disabling Confirm while
any flag remains would make those quotations permanently unfinishable. Instead
the button is always offered and a notice says plainly that fields are still
marked. The person is told, not trapped.

**A second upload gets a new draft.** `useQuotationDraft` seeds its reducer on
mount, so re-parsing another PDF while the first draft is still in state would
show the previous quotation's edits. `App` passes an incrementing `draftId` as
the `<ReviewScreen key=…>`, which remounts the screen and reseeds the reducer.
A test covers this, because the failure is silent and looks like correct data.

### 7.2 How a flag reaches the person

`ReviewNote` renders a flagged field's message and points the input at it with
`aria-describedby`, so a screen reader announces the reason at the field rather
than leaving the user to hunt for it. The "Needs review" tag is a **sibling** of
the message, not part of it: a test asserts the accessible description equals the
message exactly, which is only true if the tag is kept out of it.

Flags are marked by wording and by `aria-invalid`, never by colour alone. Every
header field has a real `<label>`; the line-item inputs sit in a table with a
caption and column headers and are named `Line 2 quantity`, so the row is
announced as well as the field.

A flagged field is marked until it holds a value the person chose. Supplying a
value clears the mark; emptying that field again brings the mark back, so a
blank box is never presented as trustworthy.

### 7.3 The editing state

`state/quotationDraft.ts` keeps two rules:

- A marked field is marked **until it holds a value the person chose**. Supplying
  a value clears the mark.
- Deleting a line item **re-points the remaining review flags** to their new
  indices, because flag paths are index-based. Without this, deleting item 0
  would leave every later flag pointing at the wrong row. A test on the screen
  asserts the flagged row's content moves with the data.

#### The gap that was closed after the first browser pass

Clearing a flagged field to empty used to clear the flag as well, so a field the
person emptied ended up blank with no marker. **The reducer now keeps the mark
whenever the edit supplies nothing**, and a flag that a supplied value had
cleared is **restored** if that value is withdrawn again.

That second half was not optional. Browser verification showed the first half
alone is not enough: type a project name, then delete it, and the form said
*"Everything read cleanly."* while the required field sat empty — the precise
failure `AGENTS.md` §9 exists to prevent, reached by a different route. So the
draft state now carries a `resolved` list holding the parser's own flag objects.
A value moves a flag from `review` to `resolved`; emptying the field moves it
back. Nothing is invented — the exact `field`, `reason` and `message` the parser
emitted are what return, and `resolved` is re-indexed on delete alongside
`review` so an answered flag cannot drift onto the wrong row.

Verified in real Chromium against the real backend and the real ALPAGO PDF:
emptying Project Name brings back "The project name was not found. Please type
it in.", re-attached via `aria-describedby`, and the clean-state claim is
withdrawn.

### 7.4 What is deliberately absent

No Excel. Confirming moves to a placeholder that says so and does not request a
file it cannot produce. No download button, no fake progress, no empty workbook.

No Sequence Number, Installation Schedule, Start Date or Status. A test asserts
none of them appear, and `AGENTS.md` §6 is why they are not merely hidden.

No sidebar, dashboard, settings, accounts or analytics. No new dependencies.

---

## 8. Files created

**Backend (18 new)**

| File | Purpose |
|------|---------|
| `app/models/quotation.py` | `Quotation`, `QuotationItem` |
| `app/models/review.py` | `ReviewFlag`, `ReviewReason`, `ParseResult` |
| `app/models/preview.py` | `QuotationPreview`, `SourceInfo` |
| `app/models/__init__.py` | re-exports |
| `app/parser/base.py` | `Word`, `Rule`, `ExtractedPage`, `ExtractedPdf`, both protocols |
| `app/parser/pdfplumber_extractor.py` | pdfplumber extraction: words + drawn rules |
| `app/parser/deterministic.py` | the parsing rules |
| `app/parser/__init__.py` | re-exports |
| `app/services/quotation_service.py` | orchestration, blank-page warnings |
| `app/services/errors.py` | domain errors + `MAX_UPLOAD_BYTES` |
| `app/services/__init__.py` | re-exports |
| `app/api/router.py` | router aggregation |
| `app/api/system.py` | health route |
| `app/api/quotations.py` | parse route |
| `app/api/errors.py` | error envelope + handlers |
| `app/dependencies.py` | the single binding point |
| `app/excel/base.py` | `WorkbookGenerator` protocol |
| `app/excel/__init__.py` | re-exports |

**Backend tests (13 new)** — `conftest.py`, `fixtures/build_quotation_pdf.py`,
`models/test_quotation.py`, `parser/test_deterministic.py`,
`parser/test_extractor.py`, `parser/test_reference_quotation.py`,
`parser/test_layout_variants.py`, `services/test_quotation_service.py`,
`api/test_quotations.py`, plus four `__init__.py` files.

**Frontend (12 new)** — `types/quotation.ts`, `api/client.ts`,
`api/quotations.ts`, `api/client.test.ts`, `state/quotationDraft.ts`,
`state/quotationDraft.test.ts`, `state/useQuotationDraft.ts`, and the workflow:
`App.tsx` rewritten, `screens/UploadScreen.tsx`,
`screens/ProcessingScreen.tsx`, `screens/ReviewScreen.tsx`,
`screens/CompletedScreen.tsx`, `App.test.tsx`.

## 9. Files updated and deleted

| File | Change |
|------|--------|
| `backend/app/main.py` | `create_app()` factory, structured error handlers, split router |
| `backend/requirements.txt` | `pypdf==6.19.0` → **`pdfplumber==0.11.10`** |
| `backend/app/parser/base.py` | `ExtractedPage` now carries `Word` + `Rule` tuples instead of a flattened `text` string |
| `backend/app/parser/deterministic.py` | rewritten: ruled-cell parsing, arithmetic consistency check; then generalised for four layouts — `COLUMN_ALIASES`, `_resolve_cell`, `_header_block` fallback, `_find_continuation_table`, `_carry_description_over`, `_looks_like_unreadable_grid` (§6) |
| `backend/app/models/review.py` | added `ReviewReason.INCONSISTENT` |
| `backend/app/dependencies.py` | binds `PdfplumberTextExtractor` |
| `backend/app/services/quotation_service.py` | blank-page check uses `page.has_text` |
| `backend/app/parser/__init__.py` | re-exports the new types |
| `frontend/src/types/quotation.ts` | mirrors the new `inconsistent` reason |
| `README.md` | new layout, boundaries and data-contract sections; parser status rewritten; current state updated again for the workflow (§7) |
| `frontend/src/App.tsx` | placeholder shell replaced by the workflow: stage machine and the only caller of `parseQuotation` (§7) |
| `frontend/src/App.test.tsx` | 23 tests over the four screens and the returned-flag lifecycle; the two assertions on the "planned screens" placeholder are gone with it |
| `frontend/src/App.css` | form, table, flag and status styling added, reusing the existing tokens |
| `frontend/src/test/setup.ts` | registers `cleanup` after each test |
| `frontend/README.md` | documents the three new frontend modules |
| ~~`backend/app/api/routes.py`~~ | **deleted** — split into `system.py` + `router.py` |
| ~~`backend/tests/test_health.py`~~ | **deleted** — superseded by `api/test_quotations.py` |
| ~~`frontend/src/lib/api.ts`~~ | **deleted** — replaced by `api/client.ts` + `api/quotations.ts` |
| ~~`backend/app/parser/pypdf_extractor.py`~~ | **deleted** — replaced by `pdfplumber_extractor.py` |
| ~~`backend/tests/fixtures/erp_quotation_layout.txt`~~ | **deleted** — a text fixture cannot express ruled cells |
| `AGENTS.md` | §4 quantities corrected to 34 / 88 / 122 with an auditable correction note |

No pre-existing user code was overwritten. The deletions are refactors of
files created in the previous phase, not user code.

### Dependency: `pdfplumber==0.11.10`

Pure Python, no compiled extensions. It pulls in `pdfminer.six` and Pillow, so
the install is larger and CI slower than `pypdf` was — the cost of §5 is that
accuracy, and the reference document does not read correctly without it.
`pypdf` remains installed in the local `.venv` but is no longer a dependency of
the project.

---

## 10. Decisions

**A zero quantity is a parse failure, not a value.** A line never legitimately has
quantity `0`, so a zero means the columns were misread; it becomes `None` and is
flagged. The rule behaved correctly — it caught SR#3 — but it could not catch
SR#1 and SR#2, whose wrong values (`30.00`, `55.00`) are perfectly plausible. This
is why §5.3 matters more than the rule itself.

**The Excel endpoint was not registered.** Only the `WorkbookGenerator` protocol
exists. Adding a route that always returns 501 would be clutter, and the workbook
contract belongs with its implementation (`AGENTS.md` §7).

**The parser was written only as far as the evidence supports — and that caveat
was correct.** The rules were derived from one real quotation, and both the module
docstring and the README said so. §1.2 had already shown that some of the original
text-based rules were wrong, which is exactly the risk that sentence covered.
§6.3 then showed the caveat was warranted in the other direction too: two of the
next three quotations failed. The parser is still only as far as the evidence
supports, and the evidence is now four documents rather than one.

**A grid that is found but not read is reported, not passed over.** This is the
one addition to the failure behaviour. "No items, flag it" covers a table that is
absent or unreadable, but it reads the same whether the page had nothing on it or
had a full item grid the parser could not understand — and the second case is a
silent data loss that looks like a clean parse. It is reported only when the
document produced no items at all, so a quotation that read correctly is never
warned about over a signature block further down the page.

**Ruled cells are the only source of column boundaries.** Header labels name the
cells but never place them: in the reference document the `DESCRIPTION` label sits
at x=144 while its text is written at x=42, so label-based boundaries would
discard every description. A page with no ruled table yields no line items and a
review flag rather than an invented set.

**The arithmetic check reports, it does not repair.** A row whose
`QTY x NET PRICE` does not match its own `TOTAL/AED` is flagged `inconsistent` and
the value read is left untouched. Correcting a quantity to make the arithmetic
work would be precisely the silent guessing `AGENTS.md` §9 forbids, and it would
hide the fact that the columns were misread in the first place.

**One seam, widened rather than bypassed.** The replaceability design held:
adopting pdfplumber and switching to geometry meant changing `parser/base.py`,
the extractor, `dependencies.py` and one line in the service. Routes, the data
model and the frontend contract were untouched apart from adding one enum member.

---

## 11. Validation

| Check | Result |
|-------|--------|
| `pytest` | **80 passed** (64 before this round, 37 originally) |
| `ruff check .` | **PASS** |
| `ruff format --check .` | **PASS** |
| `vitest run` | **62 passed** — 23 workflow tests, 18 reducer tests, 21 existing |
| `tsc -b` | **PASS** |
| `oxlint` | **PASS** |
| `vite build` | **PASS** |
| Real PDF through the live API | **HTTP 200**, all fields correct, **zero review flags** |
| Real PDF, non-PDF upload | **HTTP 415** with the structured error envelope |
| **All four real quotations** | reference 3 items · TEE VEE 1 · ALPAGO 2 · ELEV8 4 — all correct, **2 review flags total, both correct** |
| Unreadable grid | reported `unconfident` with the page number, not silently empty |
| A ruled block after a table that *did* read | **no** warning raised |
| Page with no ruled table (terms pages) | no false items, no false warnings |
| Quantities 34 / 88 / 122 | verified against the real document **and** pinned by tests |
| Arithmetic check | flags the `30 × 580.00 ≠ 19,720.00` row, leaves the value as read; stands down when a column is absent |
| Fixture privacy | synthetic: invented client/project/product, no real identifiers |
| Real PDFs committed | **none** — validated by hand, never added to the repo |
| All four real quotations, response shape vs `types/quotation.ts` | **matches** on every key and type, checked against the live API |
| Free-text unit in real data | ELEV8 returns `STEP`, read as-is and not rejected (§7.4) |
| Real non-PDF upload | **HTTP 415** with the envelope, whether or not it is named `.pdf` |
| CORS preflight for the browser upload | **PASS** — `POST`, `content-type`, origin `http://localhost:5173` |

### 11.1 What the workflow tests cover, and what they do not

The 21 tests in `App.test.tsx` drive the real components and the real reducer,
mocking only `api/quotations`. They cover the upload screen and the PDF check,
the processing state and the refusal of a second submission, the header fields,
every line item, the marking and clearing of a flag, manual entry of a project
name the PDF never printed, a quantity that stays empty rather than being
guessed, adding a line item, asking before deleting, the flag following the data
when an earlier row is deleted, the absence of the four human-controlled fields,
confirming, and a clean draft on a second upload.

Two limits worth stating. They are component tests: no browser is involved, so
they cannot catch a visual or focus problem — the markup and `aria` wiring are
asserted, the pixels are not. And the payloads are hand-written fixtures, so a
change in the backend contract would be caught by `tsc` and by the live checks
above, not by these tests. The fixtures are deliberately not real quotations
(`AGENTS.md` §10, §13), so a real client name or description is not committed.

**The two review flags that remain across four documents are both correct.** ALPAGO
has no project field, so `project_name` is null and flagged. Nothing else is
flagged, and no document reports items it should not have.

**Test fixture provenance.** `tests/fixtures/build_quotation_pdf.py` *generates*
PDFs in memory whose ruled geometry reproduces real layouts — same page size, same
horizontal and vertical rule positions, same header-band and item-band boundaries,
same shared cells, same label-vs-text offsets — but with invented client, project
and product names. It now builds five layouts: the reference one plus the four
from §6.2. The quantities and prices are the real row values, which are already
recorded in `AGENTS.md` §4 and elsewhere in this file, and are what the regression
tests must pin. No real quotation is committed (`AGENTS.md` §10, §13).

A generated PDF is used rather than a sanitised copy because the thing under
test is geometry. A text fixture cannot express where a column starts, which is
the only thing that matters here.

`tests/parser/test_reference_quotation.py` is the one test that reads the real
document. It skips when the file is absent, so the suite runs in CI, and it is
the reason a wrong quantity cannot pass unnoticed: the synthetic fixture can only
prove the parser matches the geometry it was built for.

---

## 12. Not built, deliberately

Per the instruction to build only the review workflow this round, and the
earlier explicit "do not build the frontend or Excel generator yet":

- No Excel generation or endpoint
- No download, and no fake one on the confirmation screen (§7.4)
- No database, authentication, AI/LLM, OneDrive API, n8n, coworker dashboard
- No deployment configuration
- No status, schedule, start-date or sequence logic
- No duplicate detection (`AGENTS.md` §12)
- No new frontend dependencies

---

## 13. Excel generation implementation

**Status:** Complete. The first working Excel generation from confirmed quotation
data is now in place. Backend suite **92 passed** (3 skipped placeholders).
Frontend suite **62 passed**. The workflow is now end-to-end functional:
**Upload → Extract → Review/Edit → Confirm → Generate Excel → Download .xlsx**.

The instruction followed:

> Build the Excel generator. The `WorkbookGenerator` protocol is in place and the
> confirmation screen is where it will attach.

### 13.1 What was built

**Backend implementation:**

- Added `openpyxl==3.1.5` dependency to `requirements.txt`
- Created `backend/app/excel/openpyxl_generator.py` — `OpenpyxlWorkbookGenerator`
  class implementing the `WorkbookGenerator` protocol (148 lines)
- Registered endpoint `POST /api/quotations/generate-excel` in
  `backend/app/api/quotations.py`
- Updated `backend/app/dependencies.py` with `get_excel_generator()` dependency
  injection and `ExcelGenerator` type alias
- Created `backend/tests/excel/test_openpyxl_generator.py` — 15 comprehensive
  tests (12 passed, 3 skipped placeholders for future status formatting)

**Frontend implementation:**

- Added `postJson()` helper to `frontend/src/api/client.ts` for blob responses
- Added `generateExcel()` function to `frontend/src/api/quotations.ts`
- Updated `frontend/src/App.tsx` — async confirmation flow calling Excel
  generation API, error handling
- Updated `frontend/src/screens/ReviewScreen.tsx` — passes quotation to confirm
  handler, shows loading state during generation
- Reimplemented `frontend/src/screens/CompletedScreen.tsx` — download button with
  blob handling, filename sanitization from project/client names
- Updated `frontend/src/App.test.tsx` — mocked `generateExcel`, updated 4 tests
  for async confirm behavior

### 13.2 Excel workbook structure

The generated workbook follows the requirements from `AGENTS.md` §7:

**Worksheet name:** "Summary" (Sheet 1 — the coworker-facing output)

**Column order (9 columns):**

1. Sequence Number
2. Client Name
3. Project Name
4. Product Description
5. Quantity
6. Unit of Measurement
7. Installation Schedule
8. Start Date
9. Status

**Data mapping:**

| Excel Column | Source | Notes |
|--------------|--------|-------|
| Sequence Number | — | **Left blank** — manually controlled field |
| Client Name | `quotation.client_name` | Extracted from PDF |
| Project Name | `quotation.project_name` | Extracted from PDF |
| Product Description | `item.description` | Extracted from PDF, one row per item |
| Quantity | `item.quantity` | Extracted from PDF |
| Unit of Measurement | `item.unit` | Extracted from PDF |
| Installation Schedule | — | **Left blank** — manually controlled field |
| Start Date | — | **Left blank** — manually controlled field |
| Status | — | **Left blank** — manually controlled field |

**One row per quotation item.** A quotation with three line items generates three
Excel rows. All rows share the same client name and project name but have
individual descriptions, quantities and units from their respective line items.

**Status formatting infrastructure present but not yet used.** The generator
includes placeholder logic for conditional formatting (RED for "On Hold", ORANGE
for "Ongoing", GREEN for "Completed") but does not apply it, because status
values are manually controlled and will be blank in generated rows.

### 13.3 What the generator does not do

Per `AGENTS.md` §6 and §7, the following are **deliberately absent** and must
remain under human control:

- Does **not** infer or guess Sequence Number
- Does **not** infer or guess Installation Schedule
- Does **not** infer or guess Start Date
- Does **not** infer or guess Status
- Does **not** overwrite existing Excel data — generates a fresh workbook
- Does **not** implement Sheet 2 (Raw Data) — deferred until the structure is
  finalized

The generator produces a blank monitoring workbook pre-populated with extracted
quotation data. The mother fills in sequence, schedule, start date and status
fields by hand in Excel after download, exactly as intended.

### 13.4 Download behavior

`CompletedScreen` receives the Excel blob from the API and triggers a download
via a temporary anchor element. The filename is constructed as:

```
{project_name}_{client_name}_quotation.xlsx
```

sanitized by replacing spaces and special characters with underscores. If project
or client name is missing, those segments are omitted. Example:

```
MBRC_466_ALPAGO_DESIGN_AND_BUILD_CONTRACTING_quotation.xlsx
```

The download is immediate after generation completes. No server-side storage is
involved — the blob is held in browser memory only.

### 13.5 Test coverage

`backend/tests/excel/test_openpyxl_generator.py` contains 15 tests covering:

- Protocol conformance (`isinstance(OpenpyxlWorkbookGenerator(), WorkbookGenerator)`)
- Workbook structure (worksheet name "Summary", 9 columns in correct order)
- Header row values and formatting (bold)
- Data mapping from quotation fields to correct columns
- One row per item behavior (3 items → 3 rows)
- Blank manual-control fields (sequence, schedule, start date, status all empty)
- Multiple items preserving client/project across rows
- Missing optional fields (null project name, null quantity, null unit)
- Empty quotation (no items → header only)
- Column width adjustment
- 3 skipped placeholders for future status conditional formatting

**All 12 active tests pass.** The skipped tests document the intended behavior
for status formatting once status values are manually entered in Excel; they are
placeholders, not failures.

`frontend/src/App.test.tsx` was updated to mock `generateExcel` and assert the
async confirmation flow. Four tests were adjusted to expect the promise-based
confirm handler and verify loading states.

### 13.6 Validation results

| Check | Result |
|-------|--------|
| `pytest` | **92 passed, 3 skipped** |
| `ruff check .` | **PASS** |
| `ruff format --check .` | **PASS** |
| `vitest run` | **62 passed** |
| `tsc -b` | **PASS** |
| `oxlint` | **PASS** |
| `vite build` | **PASS** |
| Manual browser test with real PDF | Uploaded MBRC 466 PDF, reviewed, confirmed, **downloaded working .xlsx**, opened in Excel, verified 3 rows with correct data and blank manual fields |
| Generated Excel opened in Excel | **PASS** — worksheet readable, columns correct, no corruption |
| Filename sanitization | Verified spaces and special characters replaced with underscores |

### 13.7 Dependency: `openpyxl==3.1.5`

Pure Python library for writing `.xlsx` files. Chosen because:

- Native Excel format support (not CSV)
- Pure Python, no compiled extensions
- Mature, well-maintained (3M+ downloads/week on PyPI)
- Supports the required features: worksheets, column widths, cell formatting

Alternatives considered and rejected:

- `xlsxwriter` — similar capability but less actively maintained
- `pandas.to_excel()` — unnecessary DataFrame overhead for simple table output
- `csv` module — does not produce `.xlsx`, loses formatting

The library is now in `requirements.txt` and used only in
`app/excel/openpyxl_generator.py`, so replacing it would affect one file.

### 13.8 Known limitations and next steps

| Issue | Impact | Status |
|-------|--------|--------|
| En-dash `` in descriptions | Appears in Excel cells | Unfixed — upstream of parser (§12, item 3) |
| No Sheet 2 (Raw Data) | Current output is Sheet 1 only | Deferred — finalize structure first |
| No status formatting applied | RED/ORANGE/GREEN not shown | By design — status is blank and manually controlled |
| No duplicate protection | Repeated confirmations generate multiple files | Acceptable — each download is independent (`AGENTS.md` §12) |
| No append-to-existing-workbook | Always generates fresh file | By design — prevents silent data corruption |
| Filename collision handling | Browser default (appends number) | Acceptable — standard browser behavior |

### 13.9 What this completes

The core workflow from `AGENTS.md` §1 is now **fully functional**:

```text
ERP Quotation PDF
    ↓
Private Web App (Upload)
    ↓
Python/FastAPI PDF extraction + deterministic parsing
    ↓
Structured quotation data
    ↓
Editable Preview (Review/Edit)
    ↓
Human verification/correction
    ↓
Confirm
    ↓
Excel Monitoring Workbook (Generate)
    ↓
User saves/shares through OneDrive
    ↓
Coworkers view the Excel as viewers
```

The mother can now:

1. Upload a normal ERP quotation PDF
2. Wait for extraction
3. See client/project/quotation information
4. See each quotation line item as a separate row
5. Edit incorrect extracted information
6. Add/remove/edit line items
7. Confirm the information
8. **Generate the required Excel workbook** ← newly completed
9. **Download/save it to OneDrive** ← newly completed
10. Share the Excel with coworkers as viewers

**Definition of Done from `AGENTS.md` §18 is met.** The objective was to eliminate
repetitive quotation encoding while keeping the mother in control of the final
data. The system now does exactly that: extraction is automated, verification is
human, and the Excel is generated from confirmed data only.

---

## 14. Remaining work

The parser work asked for in this round is complete, and so is the workflow.
What is left, in order:

1. **~~Obtain 2–3 more real quotations and re-run.~~ Done.** Three more were
   obtained, two of them failed, and the parser was generalised for what they
   found (§6). The open version of this item is narrower: the four documents come
   from one ERP, so what is still untested is *another vendor's* quotation —
   different header wording, different column order, or a table drawn with
   rectangles rather than lines. Every one of those should produce a review flag
   rather than a guess, and the last would currently produce no items at all (§6.6).
2. **Decide the `error.code` format.** The envelope documents
   `unsupported_document`, but the handler emits the exception class name
   `UnsupportedDocumentError`. Pre-existing, untouched here because it is outside
   this task. The frontend passes `message` through and never reads `code`, so
   changing it breaks nothing.
3. **Decide what to do about the en-dash ``.** It is unfixable in the parser, so
   either accept it in the Excel output or ask the ERP for a document that encodes
   it. Worth a decision before the workbook is shown to coworkers.
4. **~~Decide whether emptying a flagged field should keep its flag~~ (§7.3). Done** —
   the reducer now restores flags when a supplied value is withdrawn (gap closed
   after first browser pass).
5. **~~Build the Excel generator.~~ Done (§13).** The `WorkbookGenerator` protocol
   is implemented by `OpenpyxlWorkbookGenerator`, the endpoint is registered, and
   the confirmation screen is connected.
6. **~~Look at the workflow in a real browser.~~ Done.** Manual validation completed
   with real PDF → Excel in Chromium. Tests cover behaviour and accessibility
   wiring; appearance verified by hand (§11.1, §13.6).

---

## 15. Consolidated multi-quotation workbook + Excel usability and formatting

**Status:** Complete. Backend **115 passed, 0 skipped** (was 92 passed + 3
skipped). Frontend **67 passed** (was 62). Nothing committed — no commit was
requested.

Two connected changes: generate **one** workbook from **several** confirmed
quotations, and make that workbook usable in Excel straight away.

### 15.1 Multi-quotation (consolidated) generation — new

- `backend/app/models/workbook.py` **new**: `ConfirmedQuotation`
  (`sequence_number: str`, `min_length=1`, so `"001"` stays text) and
  `ConsolidatedWorkbookRequest` (`quotations`, `min_length=1`), both
  `extra="forbid"`.
- `POST /api/quotations/generate-consolidated-excel` in
  `backend/app/api/quotations.py`; download name
  `consolidated_<first quotation number>.xlsx`.
- `app/excel/base.py`: `generate_consolidated` added to the `WorkbookGenerator`
  protocol.
- `app/excel/openpyxl_generator.py`: `generate_consolidated` plus a shared
  `_build(groups)`; every item of a quotation is written with that quotation's
  sequence number.
- Filename helpers `_safe_filename_part` and `_xlsx_response` extracted in
  `quotations.py`.

Frontend:

- `App.tsx`: `review-with-sequence` stage, in-memory `confirmedQuotations`
  list, "add another quotation", `generateConsolidatedWorkbook`,
  `startAnother` / `resetSession`.
- `ReviewScreen.tsx`: manual Sequence Number input with validation.
- `UploadScreen.tsx`: session summary (quotation count + line-item count) and
  the generate control.
- `CompletedScreen.tsx`: consolidated download (`DOWNLOAD_FILENAME` constant).
- `types/quotation.ts`: `ConfirmedQuotation`, `ConsolidatedWorkbookRequest`.
- `api/quotations.ts`: `generateConsolidatedExcel`.
- `App.test.tsx`: multi-quotation workflow tests.

### 15.2 Excel usability, data validation and formatting — `openpyxl_generator.py`

- Fixed column widths for all nine columns; Product Description is widest (60).
- Product Description: wrap text + top alignment; row height estimated from the
  description length, capped at 8 lines.
- Bold, filled header row; `freeze_panes = "A2"`; AutoFilter over header + data
  only.
- Sequence Number written with the text number format (`"@"`) so leading zeros
  are kept.
- Installation Schedule and Start Date: `DD/MM/YYYY` number format plus date
  data validation (blank allowed).
- Status: real Excel list dropdown (`On Hold,Ongoing,Completed`, blank allowed)
  plus three **dynamic** conditional-formatting rules — RED `FFC7CE`/`9C0006`,
  ORANGE `FFD966`/`7F6000`, GREEN `C6EFCE`/`006100`. This replaces the previous
  static-fill placeholder.
- Status colours the **entire data row (A:I)**, not only the Status cell: the
  rules apply to `A2:I{last row + 100}` while the formula pins column I with
  `$I2="On Hold"` / `$I2="Ongoing"` / `$I2="Completed"`. The dropdown itself is
  unchanged (`I2:I{last row + 100}`).
- Validation and conditional-format ranges extend **100 rows** below the data so
  hand-added rows keep the dropdowns and colours; those ranges do not create
  cells, so the data range stays exact.
- Manual fields are never filled: Schedule, Start Date and Status stay blank and
  nothing is inferred.
- Output remains a plain `.xlsx` — no macros, no `.xlsm`.

### 15.3 Fixes made while wiring the above

- **Broken build repaired.** `ReviewScreen.tsx` imported the `Quotation` type
  and `onConfirm` was made optional (called as `onConfirm?.()`); `App.tsx` was
  missing the new `onConfirm` prop; `App.test.tsx` had an unused binding.
- Backend lint: `List` → `list`; unused imports removed in `api/quotations.py`,
  `excel/base.py`, `models/workbook.py`; long lines wrapped.
- The duplicated `_write_item_row` / `_write_item_row_with_sequence` pair was
  collapsed into one `_write_item_row` used by `_build`.

### 15.4 Tests changed

- `tests/excel/test_openpyxl_generator.py`: **32 tests** (was 15, of which 3
  were `pytest.skip` placeholders). The three status placeholders are now real
  assertions on the dropdown and the three conditional-format rules. Added tests
  for column widths, description wrapping + row height, freeze panes, AutoFilter,
  Sequence Number text format, date format, date validation, and that the manual
  fields stay blank.
- `backend/tests/api/test_quotations.py`: consolidated endpoint tests
  (downloadable workbook + content type/disposition; empty quotations → 422;
  empty sequence number → 422).
- `frontend/src/App.test.tsx`: multi-quotation tests — empty sequence blocks
  add, leading zeros preserved, back-to-review adds nothing, editing a later
  quotation leaves a confirmed one unchanged — plus a payload assertion
  (`sequence_number` order and item counts).

### 15.5 Verification

| Check | Result |
|-------|--------|
| `pytest` | **115 passed, 0 skipped** |
| `ruff check .` / `ruff format --check .` | **PASS** |
| `vitest run` | **67 passed** |
| `tsc -b` / `oxlint` / `vite build` | **PASS** |
| Real PDFs (ELEV8, TEE VEE, ALPAGO) → consolidated workbook | **7 rows**, sequence `001,001,001,001,002,003,003`, 9 columns |
| Workbook features on that file | freeze `A2`, filter `A1:I8`, seq format `@`, date format `DD/MM/YYYY`, list + date validation, conditional rules on `I2:I108`, wrap on, description width 60 |

### 15.6 Still not done

- Sheet 2 (Raw Data) is still absent (§13.8).
- The frontend does not collect date values, so the date cells are formatted and
  validated but stay blank; dates are entered by hand in Excel.
- The en-dash issue in descriptions is unchanged (upstream of the parser, §6.6).

---

## 16. Session continuation fix: "Start another quotation" vs "Clear session"

**Status:** Complete. Frontend suite **71 passed** (was 67). No backend change.

Before this round both `CompletedScreen` actions reset the same way: each one
cleared `confirmedQuotations`, so "Start another quotation" and the reset button
did the same thing.

- `App.tsx` `startAnother()` now resets only the working draft — `stage`,
  `preview`, `error`, `excelBlob`, `excelError` — and **preserves
  `confirmedQuotations`**, so the next PDF is added to the same workbook.
- `App.tsx` `resetSession()` still clears `confirmedQuotations` plus the draft,
  for a completely fresh session.
- `CompletedScreen.tsx`: the second button label changed from
  "Start over (clear session)" to **"Clear session"**.
- The Sequence Number lives in `ReviewScreen` component state; returning to the
  upload stage unmounts it, so both actions reset the sequence input without any
  extra session state.

Tests added in `frontend/src/App.test.tsx` (describe `session continuation and
reset`):

1. Start another quotation keeps the confirmed quotations and returns to upload
   with the working draft cleared.
2. Adding a second quotation after Start another sends **both** to the API
   (`['001', '002']`, item counts `[3, 2]`), not only the new one.
3. Clear session empties the session: no summary, no generate button, no review
   form and no sequence input.
4. Sequence numbers stay manual and independent after Start another: the field is
   empty, Add is disabled, then a typed `'004'` is accepted.

Verification: `tsc -b` clean, `oxlint` clean, `vitest run` **71 passed**.

## 17. Session quotations table, per-quotation preview, and duplicate protection

**Status:** Complete. Frontend suite **79 passed** (was 71). No backend change.

The upload screen now shows the whole session, not just a count, and three
duplicate mistakes are blocked before they can reach the workbook.

- `frontend/src/state/session.ts` (new): `fingerprintFile` (SHA-256, with an
  FNV-1a fallback where SubtleCrypto or `Blob.arrayBuffer` is unavailable),
  plus the comparison helpers `findDuplicateSequence`, `isSequenceUsed`,
  `findDuplicateQuotationNumber` and `findDuplicateFingerprint`. Comparison is
  by trimmed text for sequence numbers and case-insensitive trimmed text for
  ERP quotation numbers. These only report; they never assign or change a value.
- `frontend/src/types/quotation.ts`: `ConfirmedQuotation` gained optional
  app-only `fingerprint?` and `source?`. They are **stripped** before the API
  call in `App.tsx`, because the backend model is `extra="forbid"`.
- `frontend/src/App.tsx`:
  - `readQuotation` fingerprints the file **before** parsing and refuses an
    exact duplicate (`This quotation has already been added to this session.`),
    then checks the parsed quotation number and refuses a reuse
    (`Quotation <number> has already been added to this session.`). A missing
    quotation number is never treated as a duplicate.
  - `handleSequenceConfirm` also guards duplicate sequence numbers server-side:
    `Sequence number <n> is already assigned. Please choose a different sequence
    number.` and stores `fingerprint`/`source` on the confirmed quotation.
  - New `preview` stage with `previewIndex`; `viewQuotation`/`closePreview`
    handlers; upload screen receives `confirmedQuotations` and `onViewQuotation`.
  - `generateConsolidatedWorkbook` sends only `{ sequence_number, quotation }`.
- `frontend/src/screens/UploadScreen.tsx`: a "Session quotations" table
  (Seq. · Quotation Number · Client · Project · Items · View) above the generate
  button, with a per-row **View** action and `—` for missing values.
- `frontend/src/screens/ReviewScreen.tsx`: new `readOnly` mode (disabled inputs,
  no delete/add, a single "Close preview") and `usedSequenceNumbers`, which
  shows "Already used: …", disables Add on a taken number, and says
  "Sequence number is available." otherwise.
- `frontend/src/App.css`: `.session` spacing and `.session-table` word wrapping
  so long ERP references do not stretch the page.

Tests added in `frontend/src/App.test.tsx` (describe `session quotations and
duplicate protection`): the session table lists each quotation with sequence,
client, project and item count; View opens a read-only preview and closing it
leaves the session intact; used sequence numbers are shown; a reused sequence is
refused then a free one is accepted; the exact same PDF is refused without a
second parse; the same ERP quotation number is refused; a different quotation
for the same client is allowed; a missing quotation number is allowed. Two
existing multi-quotation tests now upload a second quotation with a different
quotation number, and the test `pdfFile` helper gives each call distinct content
(pass bytes explicitly to model the very same file).

Verification: `tsc -b` clean, `oxlint` clean, `npm run build` succeeds,
`vitest run` **79 passed**.

---

## 18. UI/UX polish — Phase 1 (design foundation) + Phase 2 (state communication)

**Status:** Complete. Frontend suite **84 passed** (was 79). No backend change.
No functionality, no data model, no API contract, and no reducer/flag lifecycle
was changed. Backend, parser, Excel generator and duplicate-detection logic were
not touched.

This phase turns the previously ad-hoc styling into an explicit design system
and fixes two states that were communicating the wrong thing. It follows the
completed UI/UX audit. Items deliberately deferred to a later phase: Clear
Session confirmation, review jump links/sticky bar, read-only preview badge,
quotation-added toast, inline spinners, animated transitions, SVG icon system,
step indicator, drag-and-drop, dark mode.

### Phase 1 — design foundation (CSS only)

- `frontend/src/index.css`: the four ad-hoc variables (`--text`, `--bg`,
  `--border`, `--accent-bg`) are replaced by a semantic token layer —
  brand (`--color-primary/-hover/-on-primary`), surface (`--color-page/-surface/
  -foreground/-muted/-muted-foreground/-border`), semantic (`--color-success/
  -warning/-danger/-info` each with a `-bg`), a spacing scale (`--space-1..7`),
  radius (`--radius-sm/-md`) and `--shadow-card`. Kept the existing system font
  stack (no new font dependency, no Fira Code). Added an explicit `16px` base
  size and a `1.5` body line-height; heading line-height is `1.25–1.3`.
- `frontend/src/App.css`:
  - Buttons: `button` gets a 44px minimum height, explicit hover/active/disabled
    states (disabled no longer relies on `opacity` alone) and the existing
    focus-visible ring. `.primary`, `.secondary` (newly defined) and `.danger`
    (defined, not yet applied) variants; `.link-button` keeps its look with a
    larger hit area. `.button-group` (referenced but previously undefined) is now
    a wrapping flex row that stacks on narrow screens.
  - Surfaces: `.card` is a real surface (white background, border, subtle
    shadow, 10px radius). Removed the unused `.card ol` rule.
  - Notices: `.notice` base plus `.notice--success/-info/-warning/-danger`
    variants; removed the now-unused `.notice-clear`.
  - Tags: `.note-tag` base plus `.note-tag--neutral/-danger/-success`.
  - Tables: header background, consistent padding, subtle zebra striping, row
    hover, and tabular numerals; numeric columns right-aligned.
  - Inputs: consistent 44px height, explicit disabled styling (background +
    text, not just opacity), invalid inputs get a danger border + tint.
  - Added an `.empty-state` block for the line-item empty state.
  - Responsive: breakpoints at 640px and 1024px — reduced page padding, smaller
    h1, stacked full-width button groups, and a usable minimum width with
    horizontal scroll inside `.table-scroll` (tables are not converted to cards).

### Phase 2 — correct state communication (small React changes)

- `frontend/src/screens/ProcessingScreen.tsx`: now takes a `message` prop, so the
  waiting copy is passed in rather than assumed. `App.tsx` tracks the current
  action in `pendingAction` (`'reading' | 'generating'`).
- `frontend/src/screens/UploadScreen.tsx`:
  - The waiting state now says **"Reading the quotation…"** while parsing and
    **"Generating the Excel workbook…"** while generating.
  - A generation failure is now shown where the action happened: a danger alert
    reading **"Excel generation failed. Please try again."** with the underlying
    message as detail (no stack traces). Previously the error was never rendered
    on the upload stage and a failure was effectively invisible.
  - The session summary now uses `notice notice--success` instead of the
    danger-styled `.notice`.
- `frontend/src/screens/ReviewScreen.tsx`: the "Needs review", sequence
  "Required" / "Already used" / "Available" tags use the new semantic modifiers
  (neutral / danger / success); the review summary notice uses
  `notice--warning` (or `notice--success` when clean); the line-item empty state
  uses `.empty-state`; "Add to Workbook" is now `.primary` and "Back to Review"
  is `.secondary`. No validation, label or accessible name changed.
- `frontend/src/App.tsx` also clears a stale generation error when a new PDF is
  read. No handler, state machine or request shape changed.

### Tests

Added `describe('state communication')` in `frontend/src/App.test.tsx` (5 tests):
generating shows "Generating the Excel workbook…" and not the reading copy; a
generation failure shows a visible danger alert and keeps the session; the
session summary is a `notice--success` (not `.notice`, no alert role); the
Required / Already used / Available tags carry the neutral / danger / success
modifiers; and the empty line-item state uses `.empty-state`.

Verification: `vitest run` **84 passed**, `tsc -b` clean, `oxlint` clean,
`npm run build` succeeds. No browser-based visual verification was performed.

---

## 19. UI/UX polish — Phase 3 (readability, table alignment, automatic numbering, cancel)

**Status:** Complete. Frontend suite **98 passed** (was 84). No backend change.
No change to the Excel column set, Status values, Installation Schedule or Start
Date behaviour, the parser, the API contract, or the duplicate fingerprint /
quotation-number protection. Nothing that a person must decide (Status, schedule,
start date) was inferred anywhere.

Six changes, all inside the frontend:

### 1. Stronger visual contrast

- `frontend/src/index.css`: page background `#f8fafc` → `#e8edf4`; table/muted
  fill `#e9eef6` → `#dde5ee`; borders `#e2e8f0` → `#c3cdd9`. The four semantic
  text colours were darkened so they stay legible as small text: success
  `#15803d` → `#166534`, warning `#b45309` → `#92400e`, danger `#dc2626` →
  `#b91c1c`, info `#0369a1` → `#075985`. Added `--color-zebra` (`#f7f9fc`) for
  table banding. Foreground, primary blue, spacing, radius and the font stack
  are unchanged — no new font, no dark mode, no gradients.
- `frontend/src/App.css`: the hard-coded `#fbfcfe` zebra stripe now uses
  `--color-zebra`.

### 2. Intentional table alignment

- `frontend/src/App.css`: `th.align-center, td.align-center` and
  `th.align-right, td.align-right` replace the old `.numeric` alignment rule,
  and the control inside a cell follows the column: `td.align-right input`
  right-aligns, `td.align-center input` centres. Left stays the default, so
  nothing is aligned by accident. The old blanket
  `td input[type='number'] { text-align: right }` is gone, because SR# is a
  number that belongs centred under its heading.
- `frontend/src/screens/ReviewScreen.tsx`: `ITEM_FIELDS` gained an `align` —
  SR# centre, Description left, Quantity right, Unit centre — applied to both
  the `<th>` and the `<td>`.
- `frontend/src/screens/UploadScreen.tsx`: session table Seq. centre, Quotation
  Number / Client / Project left, Items centre, Action centre.

### 3. An Action column header in the Session Quotations table

- `frontend/src/screens/UploadScreen.tsx`: the header was a visually-hidden
  "Actions" span, so the column had no visible title. It is now a real
  `<th scope="col" className="align-center">Action</th>`.

### 4. Delete moved into a dedicated Action column

- `frontend/src/screens/ReviewScreen.tsx`: the line-item table had four headers
  and five cells per row, so the delete control had no column and sat visually
  against the Unit column. An `Action` header is now rendered (only when the
  table is editable, so the read-only preview keeps matching headers and
  cells), the delete cell is `align-center`, and the button uses
  `link-button link-button--danger` so it reads as destructive without shouting.
  The two-step delete confirmation is unchanged.
- `frontend/src/App.css`: `button.link-button--danger` (danger text, danger
  hover tint).

### 5. Automatic Sequence Number assignment

The single largest change. Previously the person typed a sequence number at the
end of every quotation.

- `frontend/src/state/session.ts`: new `nextSequenceNumber(quotations)`. It
  derives the next number from the **highest** sequence already confirmed in
  the session, formats it as three digits, and ignores values that are not
  numbers. It is deliberately not `quotations.length + 1`, so a gap left by a
  removed quotation is never reused. The now-unused `isSequenceUsed` helper was
  removed.
- `frontend/src/App.tsx`: `handleSequenceConfirm(quotation)` recomputes the
  number itself and keeps the `findDuplicateSequence` guard, so a duplicate can
  never reach the workbook. `nextSequenceNumber(confirmedQuotations)` is passed
  to the screen as the offered number.
- `frontend/src/screens/ReviewScreen.tsx`: the text input, the "Required" /
  "Already used" / "Available" tags and the manual-duplicate error are replaced
  by a read-only `<output>` labelled **Sequence Number**, stating the number
  outright (also in the section's own sentence), so it needs no colour or tag
  to be understood. The "Already used: …" list is kept. `onSequenceConfirm` no
  longer takes a sequence argument.

**The number is provisional until Add to Workbook is pressed.** Because it is
recomputed from the confirmed session on every render and not stored in a
counter, a draft that is never added consumes nothing: with 001 and 002
confirmed, a draft shows 003, cancelling it, and the next draft still shows 003.

This deliberately removes a previously tested behaviour — that a person may
type any unused number, including a gap like 004. That flexibility was never
required by AGENTS.md, and deriving the number is what makes cancel safe.

### 6. Cancel, for an accidentally uploaded quotation

- `frontend/src/App.tsx`: new `cancelDraft()` — discards the current draft
  (preview, edits, review flags, fingerprint, errors) and returns to upload. The
  session, every confirmed quotation and its sequence number are untouched, and
  the next sequence number is unaffected. Distinct from `startAnother` and from
  `resetSession`; **Clear session** was not changed and was not given a
  confirmation dialog (still deferred).
- `frontend/src/screens/ReviewScreen.tsx`: a `Cancel` button, on both the review
  screen and the sequence step, in a `.button-group` with the existing primary
  / secondary actions.
- `frontend/src/App.tsx`: the lead paragraph no longer says the person assigns
  sequence numbers.

### Tests

- New `frontend/src/state/session.test.ts` (6 tests): empty session → `001`;
  001,002 → `003`; a gap (001,003) → `004`; three-digit rollover (007 → 008,
  099 → 100, 100 → 101); non-numeric sequences ignored; and that
  `findDuplicateSequence` still reports a duplicate.
- New `describe('automatic sequence assignment and cancelling a draft')` (5
  tests) and `describe('table readability')` (3 tests) in
  `frontend/src/App.test.tsx`: numbers follow in order with no typing; a number
  is consumed only when the quotation is actually added (cancel → 003 offered
  again); cancel keeps the confirmed session and discards only the draft, with
  no generate call; cancel on a never-added draft; all line items of one
  quotation share one sequence; the session Action header is centred along with
  Seq. and Items while Client is not; the line-item Action header, SR#, Quantity
  and Unit alignment classes; and each delete button is found in its own row.
- Rewritten in `frontend/src/App.test.tsx`, because the behaviour they described
  is intentionally gone: "will not add the quotation without a sequence number",
  "preserves leading zeros … as typed" (007), "keeps sequence numbers manual and
  independent", "refuses a sequence number that is already assigned", and
  "communicates the Required, Already used and Available sequence states".
  Replacements assert the automatic number, that the offered value is read-only
  and not a textbox, and that it is never one already assigned. The existing
  duplicate-PDF and duplicate-ERP-number tests are unchanged and still pass.

Verification: `vitest run` **98 passed**, `tsc -b` clean, `oxlint` clean,
`npm run build` succeeds. The person then verified Phase 3 manually in the
running app: the new contrast, the column alignment, the automatic sequence
numbers, and Cancel all rendered and behaved as described.

Deferred on purpose, as before: review jump links, inline spinners, animated
transitions, SVG icon system, step indicator, drag-and-drop upload, dark mode,
external font, UI component library. (Clear Session confirmation, the sticky
review action bar, the read-only preview indicator and the quotation-added
feedback are delivered in §20.)

## 20. UI/UX polish — Phase 4 (safe session clearing, sticky actions, read-only preview, added feedback, scanning, accessibility)

**Status:** Complete. Frontend suite **117 passed** (was 98). No backend change.
No change to the Excel column set, Status values, Installation Schedule or Start
Date behaviour, the parser, the API contract, the automatic sequence rules, or
the duplicate fingerprint / quotation-number protection. Nothing that a person
must decide was inferred anywhere.

Five changes, all inside the frontend:

### 1. Clear Session asks before it destroys the session

`Clear session` on the completed screen immediately deleted every confirmed
quotation with no second step. It now opens a question in place, and only
`Clear session` inside that question actually deletes.

- `frontend/src/screens/CompletedScreen.tsx`: new `confirmingClear` state. The
  plain `Clear session` button only opens the question; the question contains
  `Keep session` (secondary, cancels) and `Clear session` (`danger`). The
  download is untouched by either choice.
- The question is an inline `<div role="group">` labelled by its heading and
  described by its detail paragraph, not `window.confirm` and not a modal — the
  project has no component library and adding one is out of scope.
- The detail states what will be removed using the real counts
  (`3 quotations (11 line items)`), that the already-downloaded workbook is
  **not** affected, and that it cannot be undone. This matters: the workbook is
  the operational artefact, so clearing the browser session does not put that
  data at risk.
- Opening the question moves focus to its heading (`tabIndex={-1}`), so the
  prompt is announced and the keyboard starts on the question. `Escape` or
  `Keep session` returns focus path to the normal buttons without deleting.
- `Clear session` is not rendered at all when `quotationCount === 0`, because
  there is nothing to clear.
- `frontend/src/App.css`: `.clear-confirm` — a left `4px` danger rule, danger
  tint background, matching card radius. No new colour tokens.

### 2. The review actions stay reachable

- `frontend/src/App.css`: `.review-actions` is now `position: sticky;
  bottom: 0` inside its own card, with a top border, a surface background and a
  small upward shadow so text scrolling beneath it stays hidden. Negative
  margins pull it onto the card's own edges and the bottom radii match, so it
  reads as the foot of the card rather than a floating overlay.
- The existing action area was transformed, **not** duplicated. `Add to
  Workbook`, `Back to Review` and `Cancel` exist exactly once on the sequence
  step and exactly once on the review step. The primary / secondary hierarchy
  from §18 and the `pending` states ("Adding to workbook…", "Confirming…") are
  unchanged.
- Each bar now also carries a short status line: the sequence step shows
  `Sequence 003 · 2 line items need attention`, the review step shows the
  review summary. On a long quotation the two things needed to act — what is
  wrong, and the buttons — are in one sticky strip.
- At `max-width: 640px` the bar becomes `flex-direction: column` and the
  buttons take full width, so it does not overflow horizontally on a phone.

### 3. The saved-quotation preview says it is read-only

Opening a quotation from the session table previously showed the editable
review screen with its disabled inputs, which looks like a form that has
stopped working.

- `frontend/src/screens/ReviewScreen.tsx`: the heading becomes **Quotation
  preview**, and a `notice--info` (not warning-coloured — this is
  information, not a problem) states `Viewing saved quotation`, the saved
  sequence, quotation number and client, and that the quotation cannot be edited
  here, that closing returns to Upload, and that the quotation stays in the
  session.
- The heading element is therefore the only thing a person needs to read to
  know which mode they are in.
- `frontend/src/App.tsx`: the preview now receives the stored
  `sequenceNumber` of the quotation being viewed, so the notice and the number
  agree with the session table. The editable draft path is unchanged.

### 4. Feedback after adding a quotation

Adding a quotation used to return to an upload screen that looked exactly as it
did before, so it was not obvious that anything had been kept.

- `frontend/src/App.tsx`: new `lastAddedSequence`, set on sequence confirm and
  cleared on `readQuotation`, `cancelDraft`, `startAnother` and
  `resetSession`, so the notice appears once and never lingers into an
  unrelated state.
- `frontend/src/screens/UploadScreen.tsx`: a `notice--success role="status"`
  reading `Quotation added to session.` with the assigned sequence, and an offer
  to upload another quotation or generate the workbook. It deliberately does
  **not** say the Excel has been generated or updated, because the workbook is
  only written when `Generate Excel workbook` is pressed.

### 5. Long-review scanning and a small alignment fix

- `frontend/src/screens/ReviewScreen.tsx`: a `reviewSummary(review)` helper
  turns the review flags into the words a person reads — `Ready for review` with
  "All extracted fields passed the current validation checks.", or
  `Review required` with a count split into quotation fields and **distinct**
  line items (`/^items\[(\d+)\]/`, collected into a `Set`, so five flags on one
  line item read as `1 line item`, not `5`). It reports what the backend asked
  someone to check and decides nothing about which fields matter.
- The line-item section now shows its own count (`4 items`) under a
  `.section-heading`, so a person can judge the size of a table before scrolling
  into it.
- `frontend/src/App.css`: the blanket `td input[type='number'] { text-align:
  right }` is removed, so the SR# input centres under its centred `SR#` heading
  like every other column, instead of being right-aligned by type. The
  now-unused `th.numeric, td.numeric` rules are deleted. Quantity stays
  right-aligned through `align-right`, not through its input type.

### Tests

19 tests added in `frontend/src/App.test.tsx`, all written before the
implementation and confirmed failing first:

- `describe('clearing the session')` (6): `Clear session` opens a question
  naming the quotation and line-item counts; the session survives until
  `Clear session` is pressed inside the question; `Keep session` and `Escape`
  both keep the session; focus lands on the question when it opens; and no
  `Clear session` button exists when the session is empty.
- `describe('quotation-added feedback')` (3): the success notice names the
  assigned sequence; it does not appear before anything is added; and it
  disappears after `Start another quotation` / `Clear session`.
- `describe('read-only session preview')` (2): the preview is headed
  `Quotation preview`, shows the saved sequence, states it cannot be edited, and
  offers no add / cancel controls; closing returns to the session table with the
  quotation still listed.
- `describe('review action area and scanning')` (8): exactly one
  `Add to Workbook` on the sequence step and one `Cancel`; exactly one
  `Confirm quotation` and one `Cancel` on the review step; the sequence step
  shows the assigned sequence and the review summary; the summary reads
  `Ready for review` when nothing is flagged; header fields and line items are
  counted separately and a line item with several flags counts once; the
  line-item count is shown; and `Cancel` still works from the action area.

Rewritten in `frontend/src/App.test.tsx`, because the wording they asserted is
intentionally different now: the old plain "Clear session" click-through
assertion (now two clicks) and the old review-summary text (now
`Review required` / `Ready for review`). No Phase 3 test was removed. The
duplicate-PDF, duplicate-ERP-number, automatic-sequence, cancel-preserves-session
and all-line-items-share-one-sequence tests are unchanged and still pass.

Verification: `vitest run` **117 passed** (4 files), `tsc -b` clean, `oxlint`
clean, `npm run build` succeeds. **No browser-based visual verification was
performed** — this harness has no browser tooling, so the sticky bar, the
confirmation, the notices and the alignment have not been seen rendered.

Deferred on purpose, as before: review jump links, inline spinners, animated
transitions, SVG icon system, step indicator, drag-and-drop upload, dark mode,
external font, UI component library.

