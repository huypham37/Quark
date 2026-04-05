import { T } from '../tokens'
import { AgentDot } from '../icons'
import { RichText } from './rich-text'
import { ToolCallPart } from './tool-call'
import { ThinkingBlock } from './thinking'
import type { Message, TextPart } from '../state'

export function MessageItem({ msg, showHeader = true }: { msg: Message; showHeader?: boolean }) {
  if (msg.role === 'user') {
    const text = msg.parts.find((p): p is TextPart => p.type === 'text')
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 0', animation: 'fadeUp 0.2s ease-out' }}>
        <div style={{ background: T.surface2, borderRadius: '18px 18px 4px 18px', padding: '10px 14px', maxWidth: '70%', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: T.text, overflow: 'hidden' }}>
          {text ? text.text : ''}
        </div>
      </div>
    )
  }

  if (msg.parts.length === 0) return null

  return (
    <div style={{ padding: '14px 0', animation: 'fadeUp 0.25s ease-out' }}>
      {showHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <AgentDot />
          <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.text3 }}>Quark</span>
        </div>
      )}
      {msg.parts.map((part, i) => {
        if (part.type === 'text')
          return (
            <div key={i}>
              <RichText text={part.text} />
              {part.streaming && (
                <span style={{ display: 'inline-block', width: 6, height: 14, background: T.text, borderRadius: 1, marginLeft: 2, verticalAlign: 'text-bottom', animation: 'blink 1s step-end infinite' }} />
              )}
            </div>
          )
        if (part.type === 'tool') return <ToolCallPart key={part.callId || i} part={part} />
        if (part.type === 'thinking') return <ThinkingBlock key={i} part={part} />
        return null
      })}
    </div>
  )
}
