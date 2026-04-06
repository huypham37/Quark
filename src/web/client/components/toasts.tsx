import { T } from '../tokens'
import type { Toast } from '../state'

interface ToastsProps {
  toasts: Toast[]
}

export function Toasts({ toasts }: ToastsProps) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className="toast">
          <div style={{ fontWeight: 600, marginBottom: 2, color: t.kind === 'warn' ? T.yellow : T.red }}>{t.title}</div>
          <div style={{ color: T.text2, fontSize: 12 }}>{t.body}</div>
        </div>
      ))}
    </div>
  )
}
