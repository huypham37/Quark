import { useState, useRef, useEffect } from 'react'
import { T } from '../tokens'
import { SendIcon, StopIcon, PaperclipIcon, XSmallIcon } from '../icons'

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
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.min(ref.current.scrollHeight, 200) + 'px'
    }
  }, [text])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
    if (e.key === 'Escape' && running) onCancel()
  }

  const doSend = () => {
    if ((!text.trim() && images.length === 0) || running) return
    onSend(text, images)
    setText('')
    setImages([])
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
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
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
          <textarea
            ref={ref}
            value={text}
            onChange={e => setText(e.target.value)}
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
