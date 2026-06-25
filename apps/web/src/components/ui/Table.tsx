import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface Column<Row> {
  key: string
  header: ReactNode
  /** renders a cell for the row; falls back to row[key] when omitted */
  cell?: (row: Row) => ReactNode
  className?: string
}

interface TableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string | number
  empty?: ReactNode
  className?: string
}

/**
 * Sentinel data table: monospace, sharp borders, uppercase header row, hover
 * highlight. Generic over the row type so Phase C pages pass typed records.
 */
export function Table<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  empty = 'NO DATA',
  className,
}: TableProps<Row>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-sentinel-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-2 text-left font-normal uppercase tracking-[0.12em] text-sentinel-muted',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-[11px] uppercase tracking-[0.18em] text-sentinel-muted"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className="border-b border-sentinel-border/60 hover:bg-sentinel-hover"
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-3 py-2 text-sentinel-text', col.className)}>
                    {col.cell ? col.cell(row) : ((row[col.key] as ReactNode) ?? null)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
