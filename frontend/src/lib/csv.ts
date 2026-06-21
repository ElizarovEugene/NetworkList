// Quote any field containing a comma/quote/newline, doubling embedded quotes
// per RFC 4180 — Excel and friends expect exactly this, nothing fancier.
function escapeCsvField(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const UTF8_BOM = '﻿'

export function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(escapeCsvField).join(',')).join('\r\n')
  // Leading BOM so Excel detects UTF-8 instead of mangling Cyrillic text.
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
