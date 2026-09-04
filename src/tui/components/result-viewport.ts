export const IDEAL_RESULT_HEIGHT = 10
export const MIN_RESULT_HEIGHT = 3
const RESERVED_TERMINAL_HEIGHT = 12

export function resultViewportCap(terminalHeight: number): number {
  return Math.max(
    MIN_RESULT_HEIGHT,
    Math.min(IDEAL_RESULT_HEIGHT, terminalHeight - RESERVED_TERMINAL_HEIGHT),
  )
}
