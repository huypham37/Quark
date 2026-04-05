import { useState } from 'react'
import { T } from '../tokens'
import type { ThinkingPart } from '../state'

export function ThinkingBlock({ part, globalOpen }: { part: ThinkingPart; globalOpen?: boolean }) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = globalOpen || localOpen
  return (
    <div style={{ margin: '8px 0', borderLeft: `2px solid ${T.purple}`, padding: '6px 0 6px 12px' }}>
      <div onClick={() => setLocalOpen(!localOpen)} style={{ fontSize: 12, fontWeight: 500, color: T.purple, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
        💭 <span>{part.done ? 'Thought' : 'Thinking…'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 6, fontSize: 13, color: T.text3, whiteSpace: 'pre-wrap', fontStyle: 'italic', lineHeight: 1.5 }}>
          {part.text}
        </div>
      )}
    </div>
  )
}
