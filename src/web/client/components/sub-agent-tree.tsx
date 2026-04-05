import { useState, useEffect } from 'react'
import { T } from '../tokens'
import { toolLabel } from '../api'
import { CheckIcon, ErrIcon, BrailleSpinner } from '../icons'
import type { SubAgentState, SubAgentToolPart } from '../state'

function StatusIcon({ status }: { status: SubAgentToolPart['status'] }) {
  if (status === 'running' || status === 'pending') return <BrailleSpinner size={12} color={T.text2} />
  if (status === 'completed') return <CheckIcon />
  return <ErrIcon />
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(1) + 'k'
}

function getToolLabel(tool: string, input: Record<string, unknown>): string {
  const path = input.filePath ?? input.file_path ?? input.path
  if (typeof path === 'string') return path.replace(/^\/Users\/[^/]+\//, '~/')
  const cmd = input.command ?? input.cmd
  if (typeof cmd === 'string') return cmd.length > 50 ? cmd.slice(0, 47) + '...' : cmd
  const pattern = input.pattern
  if (typeof pattern === 'string') return pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern
  const query = input.query
  if (typeof query === 'string') return query.length > 50 ? query.slice(0, 47) + '...' : query
  const url = input.url
  if (typeof url === 'string') return url.length > 50 ? url.slice(0, 47) + '...' : url
  const name = input.name ?? input.skill
  if (typeof name === 'string') return name
  return ''
}

function ChildToolLine({ tool, isLast }: { tool: SubAgentToolPart; isLast: boolean }) {
  const connector = isLast ? '└' : '├'
  const label = getToolLabel(tool.tool, tool.input)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontSize: 12 }}>
      <span style={{ color: T.text3, fontFamily: T.mono, flexShrink: 0, width: 14, textAlign: 'center' }}>{connector}</span>
      <StatusIcon status={tool.status} />
      <span style={{ fontWeight: 500, color: T.text, flexShrink: 0 }}>{toolLabel(tool.tool)}</span>
      {label && <span style={{ color: T.text3, fontFamily: T.mono, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
      {tool.error && <span style={{ color: T.red, fontSize: 11 }}>({tool.error})</span>}
    </div>
  )
}

function StreamingDots() {
  const [dots, setDots] = useState('.')
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 400)
    return () => clearInterval(id)
  }, [])
  return <span style={{ color: T.text3, fontSize: 12 }}>Streaming{dots}</span>
}

export function SubAgentTree({ subAgent }: { subAgent: SubAgentState }) {
  const profileName = subAgent.profile.charAt(0).toUpperCase() + subAgent.profile.slice(1)
  const hasTokens = subAgent.tokensUsed > 0
  const tokenPct = subAgent.tokenLimit > 0 && subAgent.tokensUsed > 0
    ? ` (${Math.round((subAgent.tokensUsed / subAgent.tokenLimit) * 100)}%)`
    : ''
  const hasTextPreview = !subAgent.done && !!subAgent.textPreview
  const hasChildren = subAgent.tools.length > 0 || hasTextPreview

  return (
    <div style={{ padding: '8px 0 4px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {subAgent.done
          ? <CheckIcon />
          : <BrailleSpinner size={13} />
        }
        <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{profileName}</span>
        {hasTokens && (
          <span style={{ fontSize: 11, color: T.text3, fontFamily: T.mono }}>
            {formatTokens(subAgent.tokensUsed)}{tokenPct}
          </span>
        )}
      </div>

      {/* Child tool tree */}
      {hasChildren && (
        <div style={{ paddingLeft: 6 }}>
          {subAgent.tools.map((tool, i) => (
            <ChildToolLine
              key={tool.callId}
              tool={tool}
              isLast={!hasTextPreview && i === subAgent.tools.length - 1}
            />
          ))}
          {hasTextPreview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontSize: 12 }}>
              <span style={{ color: T.text3, fontFamily: T.mono, flexShrink: 0, width: 14, textAlign: 'center' }}>└</span>
              <StreamingDots />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
