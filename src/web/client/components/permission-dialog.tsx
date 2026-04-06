import { useEffect } from 'react'
import { T } from '../tokens'
import { WarningIcon } from '../icons'
import type { PermissionRequest } from '../state'

interface PermissionDialogProps {
  perm: PermissionRequest
  onRespond: (action: 'once' | 'always' | 'reject') => void
}

export function PermissionDialog({ perm, onRespond }: PermissionDialogProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A') onRespond('always')
      else if (e.key === 'o' || e.key === 'O') onRespond('once')
      else if (e.key === 'r' || e.key === 'R') onRespond('reject')
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onRespond])

  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <WarningIcon />
          Permission Required
        </div>
        <div style={{ fontSize: 13, color: T.text2, marginBottom: 12 }}>
          Allow <strong style={{ color: T.text }}>{perm.tool}</strong>?
        </div>
        <pre style={{ background: T.bg, borderRadius: 8, padding: 10, fontFamily: T.mono, fontSize: 12, color: T.text2, maxHeight: 200, overflow: 'auto', marginBottom: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(perm.input, null, 2).slice(0, 500)}
        </pre>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onRespond('once')} className="perm-btn perm-btn--allow">Allow Once</button>
          <button onClick={() => onRespond('always')} className="perm-btn perm-btn--always">Always</button>
          <button onClick={() => onRespond('reject')} className="perm-btn perm-btn--reject">Reject</button>
        </div>
      </div>
    </div>
  )
}
