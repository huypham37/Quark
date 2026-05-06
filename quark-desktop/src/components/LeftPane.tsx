import { useState, useEffect, useCallback } from "react"

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children: FileNode[]
  expanded: boolean
}

function buildTree(flatFiles: string[]): FileNode[] {
  const root: FileNode[] = []
  const map = new Map<string, FileNode>()

  for (const raw of flatFiles) {
    const entry = raw.endsWith("/") ? raw.slice(0, -1) : raw
    const isDir = raw.endsWith("/")
    const parts = entry.split("/")

    let currentChildren = root
    let currentPath = ""

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLast = i === parts.length - 1

      if (isLast && part === "") continue

      let node = map.get(currentPath)
      if (!node) {
        const shouldExpand = isDir && !isLast
          ? parts.length === 1 || (part !== "node_modules" && part !== ".git" && !part.startsWith("."))
          : false

        node = {
          name: part,
          path: isDir && !isLast ? currentPath + "/" : currentPath,
          isDir: isDir && !isLast,
          children: [],
          expanded: shouldExpand,
        }
        map.set(currentPath, node)
        currentChildren.push(node)
      }

      if (!isLast) {
        currentChildren = node.children
      }
    }
  }

  return root
}

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ---- Workspace nav items ----
const WORKSPACE_ITEMS = [
  { id: "context", icon: "icon-folder", label: "Context Canvas", active: true },
  { id: "tasks", icon: "icon-list", label: "Task Queue" },
  { id: "sourcemap", icon: "icon-table", label: "Source Map" },
]

// ---- Placeholder tasks ----
const PLACEHOLDER_TASKS = [
  { id: "t1", text: "Normalize memory graph", done: true },
  { id: "t2", text: "Verify source citations", done: false },
  { id: "t3", text: "Publish handoff note", done: false },
]

interface LeftPaneProps {
  backendUrl: string
  onSelectFile?: (path: string) => void
}

export function LeftPane({ backendUrl, onSelectFile }: LeftPaneProps) {
  const [nodes, setNodes] = useState<FileNode[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${backendUrl}/api/workspace/tree`)
      .then(r => r.json())
      .then(data => {
        const tree = buildTree(data.files || [])
        setNodes(sortNodes(tree))
      })
      .catch(err => setError(String(err)))
  }, [backendUrl])

  const toggle = useCallback((path: string) => {
    setNodes(prev => {
      const update = (list: FileNode[]): FileNode[] =>
        list.map(n => {
          if (n.path === path && n.isDir) return { ...n, expanded: !n.expanded }
          if (n.children.length) return { ...n, children: update(n.children) }
          return n
        })
      return update(prev)
    })
  }, [])

  return (
    <>
      {/* Brand */}
      <header className="brand">
        <span className="mark" />
        <div>
          <strong>QuarkAgent</strong>
          <span>Shared Context</span>
        </div>
      </header>

      {/* Workspace nav */}
      <nav className="nav-section" aria-label="Workspace">
        <p className="section-label">Workspace</p>
        {WORKSPACE_ITEMS.map(item => (
          <button key={item.id} className={`row ${item.active ? "active" : ""}`}>
            <svg className="codex-icon"><use href={`#${item.icon}`} /></svg>
            {item.label}
          </button>
        ))}
      </nav>

      {/* File tree */}
      <section className="nav-section">
        <p className="section-label">Files</p>
        {error ? (
          <div style={{ padding: "0 8px", color: "#d21f25", fontSize: "12px" }}>Failed to load</div>
        ) : nodes.length === 0 ? (
          <div style={{ padding: "0 8px", color: "var(--muted)", fontSize: "12px" }}>Loading...</div>
        ) : (
          <FileTree nodes={nodes} toggle={toggle} onSelect={onSelectFile} depth={0} />
        )}
      </section>

      {/* Tasks */}
      <section className="nav-section">
        <p className="section-label">Tasks</p>
        {PLACEHOLDER_TASKS.map(task => (
          <label key={task.id} className="task">
            <input type="checkbox" defaultChecked={task.done} />
            {task.text}
          </label>
        ))}
      </section>

      {/* Footer */}
      <footer className="left-footer">
        <button className="row">
          <svg className="codex-icon"><use href="#icon-settings" /></svg>
          Settings
        </button>
      </footer>
    </>
  )
}

// ---- FileTree (recursive) ----
function FileTree({ nodes, toggle, onSelect, depth }: {
  nodes: FileNode[]
  toggle: (path: string) => void
  onSelect?: (path: string) => void
  depth: number
}) {
  return (
    <>
      {nodes.map(node => (
        <div key={node.path}>
          <button
            className={`file-row depth-${depth}`}
            onClick={() => node.isDir ? toggle(node.path) : onSelect?.(node.path)}
            title={node.path}
          >
            {node.name}
          </button>
          {node.isDir && node.expanded && node.children.length > 0 && (
            <FileTree nodes={sortNodes(node.children)} toggle={toggle} onSelect={onSelect} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  )
}
