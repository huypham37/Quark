import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../api'

interface MentionPickerProps {
  query: string
  onSelect: (path: string) => void
  onClose: () => void
}

export function MentionPicker({ query, onSelect, onClose }: MentionPickerProps) {
  const [items, setItems] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  // Guard: skip the first click-outside event to avoid immediate close from the
  // same tap/click that opened the picker (mobile touch → mousedown propagation)
  const mountedRef = useRef(false)

  // Fetch files when query changes (debounced slightly for typing)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api<string[]>('GET', `/api/files?q=${encodeURIComponent(query)}`)
        .then((files) => {
          if (!cancelled) {
            setItems(Array.isArray(files) ? files : [])
            setSelectedIndex(0)
            setLoading(false)
          }
        })
        .catch(() => {
          if (!cancelled) { setItems([]); setLoading(false) }
        })
    }, 50)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  // Mark as mounted after a frame so click-outside skips the opening tap
  useEffect(() => {
    const id = requestAnimationFrame(() => { mountedRef.current = true })
    return () => { cancelAnimationFrame(id); mountedRef.current = false }
  }, [])

  // Click-outside to close — stable ref via useCallback
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (!mountedRef.current) return
      const target = e.target as Node
      // Close only if tap is outside both the picker AND the input container
      if (ref.current && !ref.current.contains(target)) {
        const inputContainer = ref.current.closest('.input-area')
        if (!inputContainer || !inputContainer.contains(target)) {
          onCloseRef.current()
        }
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [])

  // Keyboard navigation — stable refs to avoid effect churn
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedRef = useRef(selectedIndex)
  selectedRef.current = selectedIndex

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const len = itemsRef.current.length
      if (!len) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % len)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + len) % len)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = itemsRef.current[selectedRef.current]
        if (item) onSelectRef.current(item)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

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
