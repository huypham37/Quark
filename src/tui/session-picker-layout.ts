const MIN_PREVIEW_ROWS = 5

export function sessionPickerBodyHeight(
  width: number,
  rowHeight: number,
  maxHeight: number,
): number {
  if (width < 120) return rowHeight
  return Math.min(maxHeight, Math.max(MIN_PREVIEW_ROWS, rowHeight))
}
