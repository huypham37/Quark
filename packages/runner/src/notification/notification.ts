// Notification system — backend for transient notifications
//
// Notifications are ephemeral messages shown to the user for a short time.
// Used for: tool load errors, warnings, info messages.

export type NotificationType = "error" | "warn" | "info"

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  createdAt: number
  duration: number // ms before auto-dismiss (0 = manual dismiss)
}

// Simple event emitter for notifications
type Listener = (notification: Notification) => void
type DismissListener = (id: string) => void

const listeners: Listener[] = []
const dismissListeners: DismissListener[] = []
const active: Map<string, Notification> = new Map()

let idCounter = 0

function genId(): string {
  return `notif-${Date.now()}-${++idCounter}`
}

/**
 * Push a notification to the UI
 */
export function notify(opts: {
  type: NotificationType
  title: string
  message: string
  duration?: number // default 3000ms
}): string {
  // Deduplicate identical notifications (same title + message). If an
  // identical notification is already active, return its id instead of
  // creating a new one. This prevents duplicate error toasts when the same
  // underlying error is emitted multiple times.
  for (const [existingId, n] of active.entries()) {
    if (n.title === opts.title && n.message === opts.message) {
      return existingId
    }
  }

  const id = genId()
  const notification: Notification = {
    id,
    type: opts.type,
    title: opts.title,
    message: opts.message,
    createdAt: Date.now(),
    duration: opts.duration ?? 3000,
  }

  active.set(id, notification)

  // Notify all listeners
  for (const fn of listeners) {
    fn(notification)
  }

  // Auto-dismiss after duration
  if (notification.duration > 0) {
    setTimeout(() => dismiss(id), notification.duration)
  }

  return id
}

/**
 * Dismiss a notification
 */
export function dismiss(id: string): void {
  if (!active.has(id)) return
  active.delete(id)

  for (const fn of dismissListeners) {
    fn(id)
  }
}

/**
 * Subscribe to new notifications
 */
export function onNotify(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const idx = listeners.indexOf(fn)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

/**
 * Subscribe to dismissals
 */
export function onDismiss(fn: DismissListener): () => void {
  dismissListeners.push(fn)
  return () => {
    const idx = dismissListeners.indexOf(fn)
    if (idx >= 0) dismissListeners.splice(idx, 1)
  }
}

/**
 * Get all active notifications
 */
export function getActive(): Notification[] {
  return Array.from(active.values())
}

// Convenience functions
export function error(title: string, message: string, duration?: number): string {
  return notify({ type: "error", title, message, duration })
}

export function warn(title: string, message: string, duration?: number): string {
  return notify({ type: "warn", title, message, duration })
}

export function info(title: string, message: string, duration?: number): string {
  return notify({ type: "info", title, message, duration })
}
