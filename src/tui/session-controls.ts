export type SessionAction = "browse" | "rename"

export function sessionControls(width: number, action: SessionAction): string {
  if (action === "rename") return "Enter save  Esc cancel"
  if (width >= 100) return "↑↓ move  Enter open  F2 rename  F3 pin  Esc close"
  if (width >= 64) return "↑↓ move  Enter open  F2 rename  Esc close"
  return "↑↓  Enter open  Esc close"
}
