/**
 * Session-level helpers for the quotation workflow.
 *
 * These cover the checks the mother can make herself (is this sequence number
 * already taken?) and the two duplicate guards the app enforces for her: the
 * exact same file, and the same ERP quotation number. Nothing here assigns or
 * changes a value; it only reports what is already in the session.
 */

import type { ConfirmedQuotation } from '../types/quotation'

/** Sequence numbers compare by trimmed text; the entered value is stored as typed. */
export function normalizeSequence(value: string): string {
  return value.trim()
}

/** The confirmed quotation already using this sequence number, if any. */
export function findDuplicateSequence(
  quotations: ConfirmedQuotation[],
  value: string,
): ConfirmedQuotation | undefined {
  const needle = normalizeSequence(value)
  if (needle === '') return undefined
  return quotations.find((cq) => normalizeSequence(cq.sequence_number) === needle)
}

/**
 * The highest Sequence Number an imported monitoring workbook already holds.
 *
 * Only the one value, never its rows. A monitoring workbook is read back
 * exactly as its owner left it, so the rows are content the user may be editing
 * and the highest is identity: it answers which numbers are taken, and nothing
 * else. Keeping the rest of the workbook out of this type is what stops an edit
 * to a client name or a status from reaching the numbering.
 */
export type SequenceBaseline = {
  /** e.g. `'007'`, or null when the workbook holds no rows. */
  highestSequence: string | null
}

/**
 * The sequence number the next quotation should receive.
 *
 * Derived from the highest number already confirmed in the session, never from
 * how many quotations there are: removing one must not let its number be reused.
 * The value is deterministic from the confirmed session, so a draft that is
 * cancelled without being added never consumes a number. Always three digits.
 *
 * When the user has opened an existing monitoring workbook, its highest Sequence
 * Number is folded into the same maximum, so a new quotation carries on from the
 * file rather than restarting at 001. Taking a maximum over both is also why a
 * gap the workbook left behind is never filled: 002 to 006 are not visible here,
 * and a maximum cannot reach past the largest number to find one.
 */
export function nextSequenceNumber(
  quotations: ConfirmedQuotation[],
  baseline: SequenceBaseline | null = null,
): string {
  let highest = 0

  if (baseline?.highestSequence != null) {
    const fromMonitor = Number.parseInt(normalizeSequence(baseline.highestSequence), 10)
    // A value that is not a number is skipped, exactly as a confirmed sequence
    // that is not a number is, rather than being allowed to end the calculation.
    if (Number.isFinite(fromMonitor) && fromMonitor > highest) highest = fromMonitor
  }

  for (const confirmed of quotations) {
    const value = Number.parseInt(normalizeSequence(confirmed.sequence_number), 10)
    if (Number.isFinite(value) && value > highest) highest = value
  }
  return String(highest + 1).padStart(3, '0')
}

/** Quotation numbers compare case-insensitively, ignoring surrounding spaces. */
export function normalizeQuotationNumber(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * The confirmed quotation already using this ERP quotation number, if any.
 * A missing number cannot be a duplicate: we never invent one to compare.
 */
export function findDuplicateQuotationNumber(
  quotations: ConfirmedQuotation[],
  quotationNumber: string | null,
): ConfirmedQuotation | undefined {
  if (quotationNumber === null || quotationNumber.trim() === '') return undefined
  const needle = normalizeQuotationNumber(quotationNumber)
  return quotations.find(
    (cq) =>
      cq.quotation.quotation_number !== null &&
      normalizeQuotationNumber(cq.quotation.quotation_number) === needle,
  )
}

/** The confirmed quotation already using this file fingerprint, if any. */
export function findDuplicateFingerprint(
  quotations: ConfirmedQuotation[],
  fingerprint: string,
): ConfirmedQuotation | undefined {
  return quotations.find((cq) => cq.fingerprint === fingerprint)
}

/**
 * A stable content fingerprint of the chosen file, so re-uploading exactly the
 * same PDF can be recognised before the parser runs.
 *
 * Prefers SHA-256. Where SubtleCrypto is unavailable (some test environments)
 * it falls back to a byte-level FNV-1a hash, which is plenty to tell two
 * documents apart for this purpose.
 */
export async function fingerprintFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await readArrayBuffer(file))
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes)
    return toHex(new Uint8Array(digest))
  }
  return fnv1aHex(bytes)
}

/**
 * Reads the whole file into an ArrayBuffer. `Blob.arrayBuffer` is the modern
 * path; FileReader is the fallback where it is missing (some test runtimes).
 */
async function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsArrayBuffer(file)
  })
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function fnv1aHex(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}-${bytes.length.toString(16)}`
}
