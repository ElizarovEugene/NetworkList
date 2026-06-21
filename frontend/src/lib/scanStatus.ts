// Shared scan-job status styling — used by the Scan Jobs list and the
// Dashboard's recent-scans list so a given status always looks the same.
export const SCAN_STATUS_BADGE: Record<string, string> = {
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-gray-100 text-gray-600 border-gray-200',
}

export function scanStatusBadgeClass(status: string): string {
  return SCAN_STATUS_BADGE[status] || SCAN_STATUS_BADGE.pending
}
