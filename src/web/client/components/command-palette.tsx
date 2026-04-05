import { useState, useRef, useEffect } from 'react'
import { commands, filterCommands } from '../../../tui/commands'
import type { SlashCommand } from '../../../tui/commands'
import { T } from '../tokens'

/** Web-visible commands — excludes 'exit' (TUI-only) */
const webCommands = commands.filter(c => c.id !== 'exit')

interface CommandPaletteProps {
  query: string
  onSelect: (cmd: SlashCommand) => void
  onClose: () => void
}

export function CommandPalette({ query, onSelect, onClose }: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = filterCommands(query).filter(c => c.id !== 'exit')

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Click-outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % filtered.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[selectedIndex]) onSelect(filtered[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [filtered, selectedIndex, onSelect, onClose])

  if (filtered.length === 0) return null

  return (
    <div ref={ref} className="command-palette">
      {filtered.map((cmd, i) => (
        <div
          key={cmd.id}
          className={`command-palette-item${i === selectedIndex ? ' command-palette-item--selected' : ''}`}
          onMouseEnter={() => setSelectedIndex(i)}
          onClick={() => onSelect(cmd)}
        >
          <span className="command-palette-name">/{cmd.id}</span>
          {cmd.usage && <span className="command-palette-usage">{cmd.usage}</span>}
          <span className="command-palette-desc">{cmd.description}</span>
        </div>
      ))}
    </div>
  )
}
