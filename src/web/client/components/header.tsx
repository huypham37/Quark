import { T } from '../tokens'
import { MenuIcon, ChevronDown, Spinner, ThinkingIcon } from '../icons'
import { StopIcon } from '../icons'
import { fmtTokens } from '../hooks'
import type { AppState, Action } from '../state'

interface HeaderProps {
  state: AppState
  dispatch: React.Dispatch<Action>
  onCancel: () => void
  onSwitchModel: (model: string) => void
}

export function Header({ state, dispatch, onCancel, onSwitchModel }: HeaderProps) {
  const set = (p: Partial<AppState>) => dispatch({ type: 'SET', payload: p })

  return (
    <header className="app-header">
      <button className="icon-btn" onClick={() => set({ sidebarOpen: true })}>
        <MenuIcon />
      </button>
      <span className="brand-text">QUARK</span>
      <div style={{ flex: 1, minWidth: 0 }} />
      <button
        title={state.showThinking ? 'Hide all thinking' : 'Show all thinking'}
        className="icon-btn"
        onClick={() => set({ showThinking: !state.showThinking })}
        style={{ color: state.showThinking ? T.purple : T.text3, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <ThinkingIcon />
      </button>
      <span
        title={state.connected ? 'Connected' : 'Disconnected'}
        className="connection-dot"
        style={{ background: state.connected ? T.green : T.red }}
      />
      <span className="token-display">
        {fmtTokens(state.tokensUsed)}/{fmtTokens(state.tokenLimit)}
      </span>
      <ModelPicker
        models={state.models}
        current={state.modelName}
        open={state.modelPickerOpen}
        onToggle={() => set({ modelPickerOpen: !state.modelPickerOpen })}
        onClose={() => set({ modelPickerOpen: false })}
        onSelect={onSwitchModel}
      />
    </header>
  )
}

export function RunningBar({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="running-bar">
      <Spinner size={13} />
      <span>Agent is working…</span>
      <div style={{ flex: 1 }} />
      <button onClick={onCancel} className="cancel-btn">
        <StopIcon /> Cancel
      </button>
    </div>
  )
}

interface ModelPickerProps {
  models: string[]
  current: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (model: string) => void
}

function ModelPicker({ models, current, open, onToggle, onClose, onSelect }: ModelPickerProps) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={onToggle} className="model-btn">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current}</span>
        <ChevronDown />
      </button>
      {open && (
        <>
          <div onClick={onClose} className="backdrop" />
          <div className="model-dropdown">
            {models.map(m => (
              <button
                key={m}
                onClick={() => onSelect(m)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: 8,
                  background: m === current ? T.accentDim : 'transparent',
                  color: m === current ? T.accent : T.text2,
                  font: 'inherit',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
