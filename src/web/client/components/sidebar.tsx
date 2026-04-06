import { T } from '../tokens'
import { XIcon } from '../icons'

interface SidebarProps {
  open: boolean
  sessions: { id: string; title?: string }[]
  activeId: string | null
  onClose: () => void
  onNewSession: () => void
  onSwitchSession: (id: string) => void
}

export function Sidebar({ open, sessions, activeId, onClose, onNewSession, onSwitchSession }: SidebarProps) {
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className="sidebar" style={{ left: open ? 0 : -280 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 4px' }}>
          <span style={{ fontFamily: T.fontBrand, fontWeight: 500, fontSize: 15, letterSpacing: '0.18em', color: T.text }}>QUARK</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.text3, cursor: 'pointer', padding: 4 }}>
            <XIcon />
          </button>
        </div>
        <button onClick={onNewSession} className="new-session-btn">+ New Session</button>
        <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.text3, padding: '4px 8px 6px' }}>
          Sessions
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map(ss => (
            <div
              key={ss.id}
              onClick={() => onSwitchSession(ss.id)}
              style={{
                padding: '8px 12px',
                borderRadius: T.radius,
                fontSize: 13,
                color: ss.id === activeId ? T.text : T.text2,
                background: ss.id === activeId ? T.accentDim : 'transparent',
                cursor: 'pointer',
                marginBottom: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                transition: 'background 0.1s',
              }}
            >
              {ss.title || ss.id.slice(0, 8) + '…'}
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}
