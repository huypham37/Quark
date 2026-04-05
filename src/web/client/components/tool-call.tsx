import { useState } from 'react'
import { T } from '../tokens'
import { toolLabel, toolDesc } from '../api'
import { CheckIcon, ErrIcon, BrailleSpinner } from '../icons'
import { SubAgentTree } from './sub-agent-tree'
import type { ToolPart } from '../state'

export function ToolCallPart({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const isRunning = part.status === 'running'
  const isDone = part.status === 'completed'
  const hasSubAgent = !!part.subAgent

  return (
    <div style={{ margin: '8px 0', border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: 'hidden', background: T.surface }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', cursor: 'pointer', transition: 'background 0.1s', overflow: 'hidden' }}>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {isRunning ? <BrailleSpinner size={13} /> : isDone ? <CheckIcon /> : <ErrIcon />}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: T.text, flexShrink: 0 }}>{toolLabel(part.tool)}</span>
        <span style={{ fontSize: 11, color: T.text3, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: T.mono, textAlign: 'right' }}>
          {toolDesc(part.tool, part.input)}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, color: isRunning ? T.yellow : isDone ? T.green : T.red }}>
          {isRunning ? 'running' : isDone ? 'done' : 'error'}
        </span>
      </div>
      {/* Sub-agent tree — always visible when sub-agent data exists */}
      {hasSubAgent && (
        <div style={{ padding: '0 10px 8px', borderTop: `1px solid ${T.border}` }}>
          <SubAgentTree subAgent={part.subAgent!} />
        </div>
      )}
      {open && (
        <div style={{ padding: '0 10px 10px', fontSize: 12, overflow: 'hidden' }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.text3, margin: '4px 0' }}>Input</div>
          <pre style={{ background: T.surface2, borderRadius: 8, padding: '8px 10px', fontFamily: T.mono, fontSize: 11, lineHeight: 1.45, color: T.text2, overflow: 'auto', maxHeight: 260, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {part.input ? JSON.stringify(part.input, null, 2) : '…'}
          </pre>
          {(part.output || part.error) && (
            <>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.text3, margin: '10px 0 4px' }}>
                {part.error ? 'Error' : 'Output'}
              </div>
              <pre style={{ background: T.surface2, borderRadius: 8, padding: '8px 10px', fontFamily: T.mono, fontSize: 11, lineHeight: 1.45, color: part.error ? T.red : T.text2, overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {(part.error || part.output || '').slice(0, 5000)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
