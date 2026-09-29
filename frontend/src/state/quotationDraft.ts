/**
 * Quotation preview and edit state.
 *
 * A plain reducer, with no React and no API calls, so the editing rules can be
 * tested on their own. The review screen renders this state; it does not own it.
 *
 * Two rules from AGENTS.md shape this module:
 *
 * - A field the parser could not read is marked, never quietly filled in.
 * - A field stops being marked only while it holds a value the person chose.
 *   Editing a marked field clears its mark; emptying that field brings the
 *   mark back, so a blank box is never presented as trustworthy.
 */

import type {
  HeaderField,
  ItemField,
  QuotationItem,
  QuotationPreview,
} from '../types/quotation'

export type QuotationDraftState = {
  preview: QuotationPreview
  /**
   * Flags the person has answered, kept whole so they can come back.
   *
   * A flag leaves `review` the moment a value is supplied, but emptying that
   * field again has to put the parser's own warning back. Nothing is invented
   * here: these are the exact flag objects the parser emitted.
   */
  resolved: QuotationPreview['review']
}

export type QuotationDraftAction =
  | { type: 'header/set'; field: HeaderField; value: string }
  | { type: 'item/set'; index: number; field: ItemField; value: string | number | null }
  | { type: 'item/add' }
  | { type: 'item/remove'; index: number }

export function createDraft(preview: QuotationPreview): QuotationDraftState {
  return { preview, resolved: [] }
}

export function itemPath(index: number, field: ItemField): string {
  return `items[${index}].${field}`
}

/** Field paths the parser asked a person to check. */
export function flaggedFields(preview: QuotationPreview): Set<string> {
  return new Set(preview.review.map((flag) => flag.field))
}

export function pendingReviewCount(preview: QuotationPreview): number {
  return preview.review.length
}

function toQuantity(value: string | number | null): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function setItemField(item: QuotationItem, field: ItemField, value: string | number | null): QuotationItem {
  switch (field) {
    case 'description':
      return { ...item, description: value === null ? '' : String(value) }
    case 'unit':
      return { ...item, unit: value === null || value === '' ? null : String(value) }
    case 'sr':
      return { ...item, sr: toQuantity(value) }
    case 'quantity':
      return { ...item, quantity: toQuantity(value) }
  }
}

function withoutFlag(review: QuotationPreview['review'], field: string): QuotationPreview['review'] {
  return review.filter((flag) => flag.field !== field)
}

/**
 * A field still has no value the person has vouched for.
 *
 * Editing a marked field settles the parser's doubt, but only when the edit
 * actually supplies a value. Emptying the box adds nothing, so AGENTS.md §9's
 * "do not present an unreadable field as trustworthy" still applies and the
 * mark stays. `0` is a value, not an absence.
 */
function isFilled(value: string | number | null): boolean {
  if (value === null) return false
  if (typeof value === 'number') return Number.isFinite(value)
  return value.trim() !== ''
}

/**
 * Apply one edit's effect on the two flag lists.
 *
 * A value settles the warning: the flag moves to `resolved` so it is out of the
 * way but not lost. An empty edit settles nothing, so a flag that was already
 * answered is handed back untouched. `null` means "no list changed".
 */
function reconcile(
  state: QuotationDraftState,
  field: string,
  filled: boolean,
): Pick<QuotationDraftState, 'preview' | 'resolved'> | null {
  const { review } = state.preview
  const open = review.filter((flag) => flag.field === field)
  const answered = state.resolved.filter((flag) => flag.field === field)

  if (filled) {
    if (open.length === 0) return null
    return {
      preview: { ...state.preview, review: withoutFlag(review, field) },
      resolved: [...state.resolved, ...open],
    }
  }

  if (answered.length === 0) return null
  return {
    preview: { ...state.preview, review: [...review, ...answered] },
    resolved: withoutFlag(state.resolved, field),
  }
}

/** Re-point review flags after a line item is deleted, since paths are indexed. */
function reindexReview(
  review: QuotationPreview['review'],
  removedIndex: number,
): QuotationPreview['review'] {
  return review.flatMap((flag) => {
    const match = /^items\[(\d+)\](\..+)?$/.exec(flag.field)
    if (!match) return [flag]

    const index = Number(match[1])
    if (index === removedIndex) return []
    if (index < removedIndex) return [flag]
    return [{ ...flag, field: `items[${index - 1}]${match[2] ?? ''}` }]
  })
}

export function quotationDraftReducer(
  state: QuotationDraftState,
  action: QuotationDraftAction,
): QuotationDraftState {
  const { preview } = state

  switch (action.type) {
    case 'header/set': {
      const { field, value } = action
      const entered = value.trim()
      const stored = entered === '' ? null : entered
      const flags = reconcile(state, field, isFilled(stored))
      return {
        preview: {
          ...(flags ? flags.preview : preview),
          quotation: { ...preview.quotation, [field]: stored },
        },
        resolved: flags ? flags.resolved : state.resolved,
      }
    }

    case 'item/set': {
      const { index, field, value } = action
      if (index < 0 || index >= preview.quotation.items.length) return state

      const edited = setItemField(preview.quotation.items[index], field, value)
      const flags = reconcile(state, itemPath(index, field), isFilled(edited[field]))
      return {
        preview: {
          ...(flags ? flags.preview : preview),
          quotation: {
            ...preview.quotation,
            items: preview.quotation.items.map((item, position) =>
              position === index ? edited : item,
            ),
          },
        },
        resolved: flags ? flags.resolved : state.resolved,
      }
    }

    case 'item/add': {
      const nextSr = preview.quotation.items.length + 1
      const blank: QuotationItem = { sr: nextSr, description: '', quantity: null, unit: null }
      return {
        preview: {
          ...preview,
          quotation: { ...preview.quotation, items: [...preview.quotation.items, blank] },
        },
        // A new row has no flags, answered or otherwise.
        resolved: state.resolved,
      }
    }

    case 'item/remove': {
      const { index } = action
      if (index < 0 || index >= preview.quotation.items.length) return state

      return {
        preview: {
          ...preview,
          quotation: {
            ...preview.quotation,
            items: preview.quotation.items.filter((_, position) => position !== index),
          },
          // Answered flags are indexed too, so they must follow their rows.
          review: reindexReview(preview.review, index),
        },
        resolved: reindexReview(state.resolved, index),
      }
    }
  }
}
