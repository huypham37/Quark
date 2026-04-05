import { useState, useRef, useEffect } from 'react'
import { api } from '../api'
import { T } from '../tokens'

interface MentionPickerProps {
  query: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function MentionPicker({ query, onSelect, onClose }: MentionPickerProps) {
  const [items, setItems] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fetch files when query changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<string[]>('GET', `/api/files?q=${encodeURIComponent(query)}`)
      .then((files) => {
        if (!cancelled) {
          setItems(files)
          setSelectedIndex(0)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
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
        setSelectedIndex(i => (i + 1) % (items.length || 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + (items.length || 1)) % (items.length || 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[selectedIndex]) onSelect(items[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [items, selectedIndex, onSelect, onClose])

  if (!loading && items.length === 0) return null

  return (
    <div ref={ref} className="mention-picker">
      {loading && items.length === 0 ? (
        <div className="mention-picker-empty">Searching…</div>
      ) : (
        items.map((item, i) => {
          const isDir = item.endsWith('/')
          return (
            <div
              key={item}
              className={`mention-picker-item${i === selectedIndex ? ' mention-picker-item--selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => onSelect(item)}
            >
              <span className="mention-picker-icon">{isDir ? '📁' : '📄'}</span>
              <span className="mention-picker-path">{item}</span>
            </div>
          )
        })
      )}
    </div>
  )
}
