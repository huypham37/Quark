export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(path, opts)
  return r.json() as Promise<T>
}

export const TOOL_LABELS: Record<string, string> = {
  read: 'Read', write: 'Write', edit: 'Edit', bash: 'Bash',
  skill: 'Skill', todo: 'Todo', grep: 'Search', glob: 'Glob',
  websearch: 'Web Search', webfetch: 'Fetch',
}

export function toolLabel(id: string) {
  return TOOL_LABELS[id] || id.charAt(0).toUpperCase() + id.slice(1)
}

export function toolDesc(tool: string, input: Record<string, unknown> | null) {
  if (!input) return ''
  if ((tool === 'read' || tool === 'write' || tool === 'edit') && (input.path || input.filePath))
    return (input.path || input.filePath) as string
  if (tool === 'bash' && input.command) return (input.command as string).slice(0, 70)
  if (tool === 'grep' && input.pattern) return input.pattern as string
  if (tool === 'glob' && input.pattern) return input.pattern as string
  if (tool === 'skill' && input.name) return input.name as string
  if (tool === 'websearch' && input.query) return (input.query as string).slice(0, 50)
  if (tool === 'webfetch' && input.url) return (input.url as string).slice(0, 50)
  return ''
}
