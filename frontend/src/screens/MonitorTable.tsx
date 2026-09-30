/**
 * The nine-column monitoring table, in the two states it can be in.
 *
 * One table serves both, so the columns a person reads in the preview are
 * literally the columns they then edit, and neither version can drift from the
 * other. The only difference is what a cell holds.
 *
 * In `preview` a cell is text, and blanks read as a dash rather than being
 * filled in. In `edit` the eight data fields become inputs and the Sequence
 * Number stays text, because it is the identifier the row is filed under and
 * Phase 5B does not renumber anything.
 */

import type { ChangeEvent } from 'react'
import type { ImportedMonitorRow, MonitorStatus } from '../types/monitor'
import type { EditableMonitorField } from '../state/monitorDraft'

/** The workbook's columns, in the order the Summary sheet uses. */
const COLUMNS = [
  'Sequence Number',
  'Client Name',
  'Project Name',
  'Product Description',
  'Quantity',
  'Unit of Measurement',
  'Installation Schedule',
  'Start Date',
  'Status',
] as const

/** The statuses the generated workbook's dropdown offers. */
const STATUSES: readonly MonitorStatus[] = ['On Hold', 'Ongoing', 'Completed']

export type MonitorTableProps = {
  rows: ImportedMonitorRow[]
  mode: 'preview' | 'edit'
  onFieldChange?: (index: number, field: EditableMonitorField, value: string) => void
}

/**
 * What a cell says when the workbook has nothing there. A dash makes the gap
 * visible instead of leaving a column that looks accidentally blank.
 */
function display(value: string | number | null): string {
  if (value === null || value === '') return '—'
  return String(value)
}

function TextCell({ value, className }: { value: string | number | null; className?: string }) {
  return <span className={className}>{display(value)}</span>
}

export function MonitorTable({ rows, mode, onFieldChange }: MonitorTableProps) {
  const editing = mode === 'edit'

  const change = (index: number, field: EditableMonitorField) => (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    onFieldChange?.(index, field, event.target.value)
  }

  return (
    <table
      className="session-table monitor-table"
      aria-label="Rows found in the uploaded monitoring workbook"
    >
      <thead>
        <tr>
          {COLUMNS.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.sequence_number}-${index}`}>
            {/* An identifier, not a value to correct. Not editable in Phase 5B. */}
            <th scope="row" className="monitor-table__sequence">
              {row.sequence_number}
            </th>

            {editing ? (
              <>
                <td>
                  <input
                    type="text"
                    aria-label={`Client Name, row ${index + 1}`}
                    value={row.client_name}
                    onChange={change(index, 'client_name')}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    aria-label={`Project Name, row ${index + 1}`}
                    value={row.project_name ?? ''}
                    onChange={change(index, 'project_name')}
                  />
                </td>
                <td>
                  <textarea
                    aria-label={`Product Description, row ${index + 1}`}
                    rows={2}
                    value={row.product_description}
                    onChange={change(index, 'product_description')}
                  />
                </td>
                <td className="align-right">
                  <input
                    type="number"
                    step="any"
                    aria-label={`Quantity, row ${index + 1}`}
                    value={row.quantity ?? ''}
                    onChange={change(index, 'quantity')}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    aria-label={`Unit of Measurement, row ${index + 1}`}
                    value={row.unit_of_measurement}
                    onChange={change(index, 'unit_of_measurement')}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    aria-label={`Installation Schedule, row ${index + 1}`}
                    value={row.installation_schedule}
                    onChange={change(index, 'installation_schedule')}
                  />
                </td>
                <td>
                  {/* Text, not a date input: a date widget would reformat the value
                      it was given and would reject a date agreed as a phrase. */}
                  <input
                    type="text"
                    aria-label={`Start Date, row ${index + 1}`}
                    value={row.start_date ?? ''}
                    onChange={change(index, 'start_date')}
                  />
                </td>
                <td>
                  <select
                    aria-label={`Status, row ${index + 1}`}
                    value={row.status}
                    onChange={change(index, 'status')}
                  >
                    {/* Blank stays available, so a status can be cleared. */}
                    <option value="">Not set</option>
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </td>
              </>
            ) : (
              <>
                <td>
                  <TextCell value={row.client_name} />
                </td>
                <td>
                  <TextCell value={row.project_name} />
                </td>
                <td>
                  <TextCell value={row.product_description} />
                </td>
                <td className="align-right">
                  <TextCell value={row.quantity} />
                </td>
                <td>
                  <TextCell value={row.unit_of_measurement} />
                </td>
                <td>
                  <TextCell value={row.installation_schedule} />
                </td>
                <td>
                  <TextCell value={row.start_date} />
                </td>
                <td>
                  <TextCell value={row.status} />
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
