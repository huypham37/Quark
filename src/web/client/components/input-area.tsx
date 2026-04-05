import { useState, useRef, useEffect } from 'react'
import { T } from '../tokens'
import { SendIcon, StopIcon, PaperclipIcon, CommandIcon, AtIcon, XSmallIcon } from '../icons'
import { CommandPalette } from './command-palette'
import { MentionPicker } from './mention-picker'
import type { SlashCommand } from '../../../tui/commands'

export interface Attachment {
  mime: string
  data: string
  previewUrl: string
}

interface InputAreaProps {
  onSend: (text: string, images: Attachment[]) => void
  running: boolean
  onCancel: () => void
  onToast?: (title: string, body: string, kind: 'error' | 'warn') => void
}

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export function InputArea({ onSend, running, onCancel, onToast }: InputAreaProps) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<Attachment[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionAtIndex, setMentionAtIndex] = useState(-1)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px'
    }
  }, [text])

  const handleKey = (e: React.KeyboardEvent) => {
    if (mentionOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) return
    if (e.key === 'Escape' && mentionOpen) { e.preventDefault(); closeMention(); return }
    if (paletteOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) return
    if (e.key === 'Escape' && paletteOpen) { e.preventDefault(); setPaletteOpen(false); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
    if (e.key === 'Escape' && running) onCancel()
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)

    // Slash command detection
    if (val === '/') {
      setPaletteOpen(true)
      setSlashQuery('')
    } else if (val.startsWith('/') && paletteOpen) {
      setSlashQuery(val.slice(1))
    } else if (!val.startsWith('/')) {
      setPaletteOpen(false)
    }

    // @ mention detection — find the last @ that is at start or preceded by space
    updateMention(val, e.target.selectionStart ?? val.length)
  }

  const updateMention = (val: string, cursorPos: number) => {
    // Look backwards from cursor for an unfinished @mention
    const before = val.slice(0, cursorPos)
    const lastAt = before.lastIndexOf('@')

    if (lastAt === -1) {
      closeMention()
      return
    }

    // @ must be at start or preceded by a space/newline
    if (lastAt > 0 && before[lastAt - 1] !== ' ' && before[lastAt - 1] !== '\n') {
      closeMention()
      return
    }

    const query = before.slice(lastAt + 1)

    // If there's a space in the query, mention is done
    if (query.includes(' ')) {
      closeMention()
      return
    }

    setMentionOpen(true)
    setMentionQuery(query)
    setMentionAtIndex(lastAt)
  }

  const closeMention = () => {
    setMentionOpen(false)
    setMentionQuery('')
    setMentionAtIndex(-1)
  }

  const handleMentionSelect = (path: string) => {
    // Replace @query with @path
    const before = text.slice(0, mentionAtIndex)
    const after = text.slice(mentionAtIndex + 1 + mentionQuery.length)
    const newText = before + '@' + path + ' ' + after
    setText(newText)
    closeMention()
    // Refocus textarea
    setTimeout(() => {
      if (ref.current) {
        const pos = mentionAtIndex + 1 + path.length + 1
        ref.current.focus()
        ref.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }

  const openMentionFromButton = () => {
    // Always insert @ at cursor and (re)open the picker
    const ta = ref.current
    if (!ta) return
    const pos = ta.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    setText(before + '@' + after)
    setMentionOpen(true)
    setMentionQuery('')
    setMentionAtIndex(pos)
  }

  const handleSlashSelect = (cmd: SlashCommand) => {
    setPaletteOpen(false)
    onSend(`/${cmd.id}`, [])
  }

  const handleSlashClose = () => {
    setPaletteOpen(false)
  }

  const togglePalette = () => {
    if (paletteOpen) {
      setPaletteOpen(false)
    } else {
      setSlashQuery('')
      setPaletteOpen(true)
      ref.current?.focus()
    }
  }

  const doSend = () => {
    if ((!text.trim() && images.length === 0) || running) return
    onSend(text, images)
    setText('')
    setImages([])
    setPaletteOpen(false)
    closeMention()
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        onToast?.('File too large', `${file.name} exceeds 5 MB limit`, 'error')
        continue
      }
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1] || ''
        setImages(prev => [...prev, { mime: file.type, data: base64, previewUrl: dataUrl }])
      }
      reader.readAsDataURL(file)
    }
  }

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  const hasContent = text.trim().length > 0 || images.length > 0

  return (
    <div className="input-area">
      <div style={{ maxWidth: 780, margin: '0 auto', position: 'relative' }}>
        {images.length > 0 && (
          <div className="image-preview-bar">
            {images.map((img, i) => (
              <div key={i} className="image-thumb-wrap">
                <img src={img.previewUrl} alt={`Attachment ${i + 1}`} className="image-thumb" />
                <button className="image-thumb-remove" onClick={() => removeImage(i)}>
                  <XSmallIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        {paletteOpen && (
          <CommandPalette query={slashQuery} onSelect={handleSlashSelect} onClose={handleSlashClose} />
        )}
        {mentionOpen && (
          <MentionPicker query={mentionQuery} onSelect={handleMentionSelect} onClose={closeMention} />
        )}
        <div className="input-container">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={running}
            className="input-btn input-btn--attach"
            style={{ color: T.text3, cursor: running ? 'default' : 'pointer' }}
          >
            <PaperclipIcon />
          </button>
          <button
            onClick={openMentionFromButton}
            disabled={running}
            className="input-btn input-btn--mention"
            style={{ color: T.text3, cursor: running ? 'default' : 'pointer' }}
          >
            <AtIcon />
          </button>
          <button
            onClick={togglePalette}
            disabled={running}
            className="input-btn input-btn--slash"
            style={{ color: T.text3, cursor: running ? 'default' : 'pointer' }}
          >
            <CommandIcon />
          </button>
          <textarea
            ref={ref}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKey}
            placeholder="Chat with Quark"
            disabled={running}
            rows={1}
            className="input-textarea"
          />
          {running ? (
            <button onClick={onCancel} className="input-btn input-btn--cancel">
              <StopIcon />
            </button>
          ) : (
            <button
              onClick={doSend}
              disabled={!hasContent}
              className="input-btn"
              style={{
                background: hasContent ? T.accent : T.surface,
                color: hasContent ? '#fff' : T.text3,
                cursor: hasContent ? 'pointer' : 'default',
              }}
            >
              <SendIcon />
            </button>
          )}
        </div>
        <div className="input-hint">Enter to send · Shift+Enter for newline</div>
      </div>
    </div>
  )
}
