/**
 * Screen 3 — Review and correct.
 *
 * The one step the whole application exists for. AGENTS.md section 8: nothing
 * reaches Excel without a person reading it, and section 9: an uncertain value
 * is shown as uncertain rather than dressed up as trustworthy.
 *
 * This screen owns no editing rules. `useQuotationDraft` holds the data and
 * decides what an edit means; every flag the backend reported is rendered where
 * the person can act on it, and disappears when they do.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { itemPath } from '../state/quotationDraft'
import { useQuotationDraft } from '../state/useQuotationDraft'
import type {
  HeaderField,
  ItemField,
  Quotation,
  QuotationItem,
  QuotationPreview,
  ReviewFlag,
} from '../types/quotation'

type Props = {
  initialPreview: QuotationPreview
  onConfirm?: (quotation: Quotation) => void
  onSequenceConfirm?: (quotation: Quotation) => void
  onBackToReview?: () => void
  onCancel?: () => void
  onClose?: () => void
  pending?: boolean
  error?: string | null
  showSequenceInput?: boolean
  /** Read-only session preview: shows a stored quotation without editing it. */
  readOnly?: boolean
  /** Sequence numbers already assigned in this session, so they can be avoided. */
  usedSequenceNumbers?: string[]
  /**
   * The number shown read-only: the one this quotation will be given on the
   * sequence step, or the one it already has in the read-only preview.
   */
  sequenceNumber?: string
}

const HEADER_FIELDS: { field: HeaderField; label: string }[] = [
  { field: 'quotation_number', label: 'Quotation number' },
  { field: 'client_name', label: 'Client name' },
  { field: 'project_name', label: 'Project name' },
]

/**
 * Column order mirrors the quotation table itself. `label` titles the column;
 * `name` is how the input is announced, which reads better in a sentence.
 *
 * `align` states where each column's data belongs, so numbers line up on the
 * decimal and short codes sit under their headings instead of drifting left.
 */
const ITEM_FIELDS: {
  field: ItemField
  label: string
  name: string
  numeric: boolean
  align?: 'align-center' | 'align-right'
}[] = [
  // The SR# is an identifier, not a measurement, so its box takes text: a
  // number input would let the browser rewrite what was typed, and "007" or
  // "1.130" would come back altered.
  { field: 'sr', label: 'SR#', name: 'SR#', numeric: false, align: 'align-center' },
  { field: 'description', label: 'Description', name: 'description', numeric: false },
  { field: 'quantity', label: 'Quantity', name: 'quantity', numeric: true, align: 'align-right' },
  { field: 'unit', label: 'Unit', name: 'unit', numeric: false, align: 'align-center' },
]

function fieldId(path: string): string {
  return `field-${path}`
}

function flagId(path: string): string {
  return `flag-${path}`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * The review summary, in the words the person reads.
 *
 * Header fields and line items are counted apart, because that is what the
 * flags actually describe: nothing here decides which fields matter, it only
 * reports what the backend asked a person to check.
 */
function reviewSummary(review: ReviewFlag[]): {
  title: string
  detail: string
  short: string
} {
  if (review.length === 0) {
    return {
      title: 'Ready for review',
      detail: 'All extracted fields passed the current validation checks.',
      short: 'No fields need attention',
    }
  }

  const itemFlags = review.filter((flag) => flag.field.startsWith('items['))
  const lines = new Set(
    itemFlags
      .map((flag) => /^items\[(\d+)\]/.exec(flag.field)?.[1])
      .filter((index) => index !== undefined),
  )
  const headerCount = review.length - itemFlags.length
  const verb = review.length === 1 ? 'needs' : 'need'

  const parts: string[] = []
  if (headerCount > 0) parts.push(plural(headerCount, 'quotation field'))
  if (lines.size > 0) parts.push(plural(lines.size, 'line item'))
  const subject = parts.join(' and ')

  return {
    title: 'Review required',
    detail: `${subject} ${verb} attention before this quotation can be added.`,
    short: `${subject} ${verb} attention`,
  }
}

/**
 * The marker for a field the parser asked a person to check.
 *
 * The tag is deliberately outside the message: the tag is read by sighted users
 * and the message is what screen readers get as the field's description, so they
 * must not be concatenated. Colour is never the only signal.
 */
function ReviewNote({ path, flag }: { path: string; flag: ReviewFlag | undefined }) {
  if (!flag) return null
  return (
    <p className="note">
      <span className="note-tag note-tag--danger">Needs review</span>
      <span className="note-message" id={flagId(path)}>
        {flag.message}
      </span>
    </p>
  )
}

/**
 * Delete is two steps, because a mis-click here silently loses a line of a
 * quotation and there is no undo.
 */
function DeleteItemButton({ line, onDelete }: { line: number; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        className="link-button link-button--danger"
        aria-label={`Delete line ${line}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </button>
    )
  }

  return (
    <span className="delete-confirm">
      <button
        type="button"
        className="link-button"
        aria-label={`Confirm delete line ${line}`}
        onClick={() => {
          setConfirming(false)
          onDelete()
        }}
      >
        Yes, delete
      </button>
      <button
        type="button"
        className="link-button"
        aria-label={`Keep line ${line}`}
        onClick={() => setConfirming(false)}
      >
        Keep
      </button>
    </span>
  )
}

function ItemRow({
  item,
  index,
  flags,
  readOnly,
  onEdit,
  onDelete,
}: {
  item: QuotationItem
  index: number
  flags: Map<string, ReviewFlag>
  readOnly: boolean
  onEdit: (index: number, field: ItemField, value: string) => void
  onDelete: (index: number) => void
}) {
  const line = index + 1

  return (
    <tr>
      {ITEM_FIELDS.map(({ field, name, numeric, align }) => {
        const path = itemPath(index, field)
        const flag = flags.get(path)
        const described = flag ? flagId(path) : undefined
        const announced = `Line ${line} ${name}`

        if (field === 'description') {
          return (
            <td key={path}>
              <textarea
                aria-label={announced}
                aria-describedby={described}
                aria-invalid={flag ? true : undefined}
                rows={3}
                value={item.description}
                disabled={readOnly}
                onChange={(event) => onEdit(index, field, event.target.value)}
              />
              <ReviewNote path={path} flag={flag} />
            </td>
          )
        }

        return (
          <td key={path} className={align}>
            <input
              type={numeric ? 'number' : 'text'}
              step={field === 'quantity' ? 'any' : undefined}
              aria-label={announced}
              aria-describedby={described}
              aria-invalid={flag ? true : undefined}
              value={item[field] ?? ''}
              disabled={readOnly}
              onChange={(event) => onEdit(index, field, event.target.value)}
            />
            <ReviewNote path={path} flag={flag} />
          </td>
        )
      })}
      {!readOnly && (
        <td className="align-center">
          <DeleteItemButton line={line} onDelete={() => onDelete(index)} />
        </td>
      )}
    </tr>
  )
}

export default function ReviewScreen({ 
  initialPreview, 
  onConfirm, 
  onSequenceConfirm,
  onBackToReview,
  onCancel,
  onClose,
  pending = false, 
  error = null,
  showSequenceInput = false,
  readOnly = false,
  usedSequenceNumbers = [],
  sequenceNumber = '',
}: Props) {
  const { preview, dispatch } = useQuotationDraft(initialPreview)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The upload has just finished, so move the person to the thing they must do.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const { quotation, review, source } = preview
  const flags = useMemo(() => new Map(review.map((flag) => [flag.field, flag])), [review])
  const summary = useMemo(() => reviewSummary(review), [review])

  return (
    <>
      <h2 ref={headingRef} tabIndex={-1}>
        {readOnly
          ? 'Quotation preview'
          : showSequenceInput
            ? 'Assign sequence number'
            : 'Check the quotation details'}
      </h2>

      {readOnly && (
        <div className="notice notice--info" role="status">
          <strong>Viewing saved quotation</strong>
          <p className="notice-detail">
            Sequence {sequenceNumber}
            {quotation.quotation_number ? ` · Quotation ${quotation.quotation_number}` : ''}
            {quotation.client_name ? ` · Client ${quotation.client_name}` : ''}
          </p>
          <p className="notice-detail">
            This quotation is already in the current session and cannot be edited here. Closing the
            preview returns you to Upload; the quotation stays in the session.
          </p>
        </div>
      )}

      <p className="muted">
        Read: {source.filename} · {source.page_count}{' '}
        {source.page_count === 1 ? 'page' : 'pages'}
      </p>

      {source.warnings.length > 0 && (
        <ul className="warning-list">
          {source.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div
          className={`notice notice--${summary.title === 'Review required' ? 'warning' : 'success'}`}
          role="status"
        >
          <strong>{summary.title}</strong>
          <p className="notice-detail">{summary.detail}</p>
        </div>
      )}

      <section className="card">
        <h3>Quotation details</h3>
        {HEADER_FIELDS.map(({ field, label }) => {
          const flag = flags.get(field)
          return (
            <div className="field" key={field}>
              <label htmlFor={fieldId(field)}>{label}</label>
              <input
                id={fieldId(field)}
                type="text"
                aria-describedby={flag ? flagId(field) : undefined}
                aria-invalid={flag ? true : undefined}
                value={quotation[field] ?? ''}
                disabled={readOnly}
                onChange={(event) =>
                  dispatch({ type: 'header/set', field, value: event.target.value })
                }
              />
              <ReviewNote path={field} flag={flag} />
            </div>
          )
        })}
      </section>

      <section className="card">
        <div className="section-heading">
          <h3>Line items</h3>
          <p className="muted">{plural(quotation.items.length, 'item')}</p>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">
              Line items read from the quotation. Each is shown on its own row.
            </caption>
            <thead>
              <tr>
                {ITEM_FIELDS.map(({ field, label, align }) => (
                  <th key={field} scope="col" className={align}>
                    {label}
                  </th>
                ))}
                {!readOnly && (
                  <th scope="col" className="align-center">
                    Action
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {quotation.items.map((item, index) => (
                <ItemRow
                  key={index}
                  item={item}
                  index={index}
                  flags={flags}
                  readOnly={readOnly}
                  onEdit={(target, field, value) =>
                    dispatch({ type: 'item/set', index: target, field, value })
                  }
                  onDelete={(target) => dispatch({ type: 'item/remove', index: target })}
                />
              ))}
            </tbody>
          </table>
        </div>

        {quotation.items.length === 0 && (
          <p className="empty-state">
            No line items were read from this PDF. Add them below, or go back and upload the
            original file.
          </p>
        )}

        {!readOnly && (
          <button type="button" onClick={() => dispatch({ type: 'item/add' })}>
            Add line item
          </button>
        )}
      </section>

      {readOnly ? (
        <section className="card">
          <button type="button" className="primary" onClick={() => onClose?.()}>
            Close preview
          </button>
        </section>
      ) : showSequenceInput ? (
        <section className="card">
          <h3>Assign sequence number</h3>
          <p className="muted">
            This quotation will be added as number <strong>{sequenceNumber}</strong>, and all of
            its line items will share it in the Excel workbook.
          </p>
          {usedSequenceNumbers.length > 0 && (
            <p className="muted">Already used: {usedSequenceNumbers.join(', ')}</p>
          )}
          <div className="field">
            <span id="sequence-number-label" className="field-label">
              Sequence Number
            </span>
            <output className="sequence-value" aria-labelledby="sequence-number-label">
              {sequenceNumber}
            </output>
          </div>
          {error && (
            <div className="alert" role="alert">
              <p className="alert-message">{error}</p>
            </div>
          )}
          <div className="review-actions">
            <p className="review-actions-status">
              <strong className="review-actions-sequence">Sequence {sequenceNumber}</strong>
              {' · '}
              {summary.short}
            </p>
            <div className="button-group">
              <button
                type="button"
                className="primary"
                onClick={() => onSequenceConfirm?.(quotation)}
                disabled={pending || sequenceNumber === ''}
              >
                {pending ? 'Adding to workbook…' : 'Add to Workbook'}
              </button>
              <button type="button" className="secondary" onClick={() => onBackToReview?.()}>
                Back to Review
              </button>
              <button type="button" className="secondary" onClick={() => onCancel?.()}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="card">
          <h3>Finished checking?</h3>
          <p className="muted">
            {review.length > 0
              ? 'You can confirm with fields still marked. Please check them first.'
              : 'Confirm when the details match the quotation.'}
          </p>
          {error && (
            <div className="alert" role="alert">
              <p className="alert-message">{error}</p>
            </div>
          )}
          <div className="review-actions">
            <p className="review-actions-status">{summary.short}</p>
            <div className="button-group">
              <button
                type="button"
                className="primary"
                onClick={() => onConfirm?.(quotation)}
                disabled={pending}
              >
                {pending ? 'Confirming…' : 'Confirm quotation'}
              </button>
              <button type="button" className="secondary" onClick={() => onCancel?.()}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  )
}