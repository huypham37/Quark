import { useEffect, useRef, useCallback } from "react"
import { EditorView, keymap } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { html } from "@codemirror/lang-html"
import { css } from "@codemirror/lang-css"
import { markdown } from "@codemirror/lang-markdown"
import { oneDark } from "@codemirror/theme-one-dark"

function languageForPath(filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "ts": case "tsx": case "js": case "jsx": return javascript()
    case "json": return json()
    case "html": case "htm": return html()
    case "css": return css()
    case "md": case "markdown": return markdown()
    default: return []
  }
}

interface SourceEditorProps {
  filePath: string | null
  backendUrl: string
  refreshKey?: number
  onDraftChange?: (content: string, path: string) => void
}

export function SourceEditor({ filePath, backendUrl, refreshKey, onDraftChange }: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const currentPathRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const saveCallbackRef = useRef<() => void>(() => {})

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const handleChange = useCallback((content: string) => {
    if (onDraftChange && currentPathRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onDraftChange(content, currentPathRef.current!)
      }, 300)
    }
  }, [onDraftChange])

  // Load file content and create/recreate editor
  useEffect(() => {
    if (!filePath || !containerRef.current) {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
      return
    }

    let cancelled = false

    async function load() {
      const res = await fetch(`${backendUrl}/api/workspace/file?path=${encodeURIComponent(filePath!)}`)
      if (cancelled || !res.ok) return
      const { content } = await res.json()
      if (cancelled) return

      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }

      currentPathRef.current = filePath
      dirtyRef.current = false

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          dirtyRef.current = true
          handleChange(update.state.doc.toString())
        }
      })

      const state = EditorState.create({
        doc: content,
        extensions: [
          oneDark,
          updateListener,
          keymap.of(defaultKeymap),
          EditorView.lineWrapping,
          ...(Array.isArray(languageForPath(filePath!)) ? languageForPath(filePath!) : [languageForPath(filePath!)] as any),
        ].flat(),
      })

      viewRef.current = new EditorView({
        state,
        parent: containerRef.current!,
      })
    }

    load()
    return () => { cancelled = true }
  }, [filePath, refreshKey, backendUrl])

  const handleSave = useCallback(async () => {
    if (!viewRef.current || !currentPathRef.current) return
    const content = viewRef.current.state.doc.toString()
    await fetch(`${backendUrl}/api/workspace/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentPathRef.current, content }),
    })
    dirtyRef.current = false
  }, [backendUrl])

  saveCallbackRef.current = handleSave

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        saveCallbackRef.current()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  if (!filePath) {
    return (
      <div className="empty-state">
        Select a file to edit
      </div>
    )
  }

  return (
    <div className="code-editor">
      {/* Code path header — matches prototype */}
      <header className="code-path">
        <span>{filePath}</span>
        <div>
          <button onClick={handleSave} title="Save (Cmd+S)" style={{
            display: "flex", alignItems: "center", gap: 4,
            color: "var(--muted)", fontSize: "12px", fontWeight: 500, cursor: "pointer",
          }}>
            <svg className="codex-icon" style={{ width: 14, height: 14 }}><use href="#icon-globe" /></svg>
            Save
          </button>
          <svg className="codex-icon"><use href="#icon-more-h" /></svg>
        </div>
      </header>
      {/* Editor body */}
      <div ref={containerRef} style={{ flex: 1, overflow: "auto" }} />
    </div>
  )
}
