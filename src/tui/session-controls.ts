export type SessionAction = "browse" | "rename" | "delete"

export function sessionControls(width: number, action: SessionAction): string {
  if (action === "rename") return "Enter save  Esc cancel"
  if (action === "delete") return "Enter delete  Esc cancel"
  if (width >= 130) {
    return "↑↓ move  Enter open  Alt+1…9 quick  F2 rename  F3 pin  F4 scope  Del delete  Esc close"
  }
  if (width >= 74) return "↑↓ move  Enter open  F2 rename  F4 scope  Esc close"
  return "↑↓  Enter open  F4 scope  Esc close"
}
