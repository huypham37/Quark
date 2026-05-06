import { SourceEditor } from "./SourceEditor"
import { HtmlPreview } from "./HtmlPreview"
import { DiffReview } from "./DiffReview"
import type { ActiveReview, MiddleView } from "../state"

interface MiddlePaneProps {
  activeView: MiddleView
  activeFile: string | null
  activeReview: ActiveReview | null
  previewRefreshKey: number
  backendUrl: string
  onViewChange: (view: MiddleView) => void
  onDraftChange?: (content: string, path: string) => void
  onApprove: () => void
  onAlways: () => void
  onReject: () => void
  onCorrect: (correction: string) => void
}

export { type MiddleView }
export type { MiddlePaneProps }

export function MiddlePane({
  activeView,
  activeFile,
  activeReview,
  previewRefreshKey,
  backendUrl,
  onDraftChange,
  onApprove,
  onAlways,
  onReject,
  onCorrect,
}: MiddlePaneProps) {
  return (
    <div className="canvas-shell">
      {/* Visual view */}
      <section className={`canvas-view editor-view ${activeView === "visual" ? "active" : ""}`} data-view="visual" aria-label="Visual preview">
        <div className="editor-frame">
          <header>
            <span>Rendered preview</span>
            <small>flowchart TD</small>
          </header>
          <VisualPreview />
        </div>
      </section>

      {/* Source view */}
      <section className={`canvas-view source-view ${activeView === "source" ? "active" : ""}`} data-view="source" aria-label="Source editor">
        <SourceEditor
          filePath={activeFile}
          backendUrl={backendUrl}
          onDraftChange={onDraftChange}
        />
      </section>

      {/* Preview view */}
      <section className={`canvas-view ${activeView === "preview" ? "active" : ""}`} data-view="preview" aria-label="HTML preview">
        <HtmlPreview
          filePath={activeFile}
          backendUrl={backendUrl}
          refreshKey={previewRefreshKey}
        />
      </section>

      {/* Diff view */}
      <section className={`canvas-view ${activeView === "diff" ? "active" : ""}`} data-view="diff" aria-label="Diff review">
        {activeReview ? (
          <DiffReview
            review={activeReview}
            onApprove={onApprove}
            onAlways={onAlways}
            onReject={onReject}
            onCorrect={onCorrect}
          />
        ) : (
          <EmptyState message="No diff to review" />
        )}
      </section>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      {message}
    </div>
  )
}

function VisualPreview() {
  return (
    <svg className="mermaid-preview" viewBox="0 0 500 330" role="img" aria-label="Rendered Mermaid context flow">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <path className="link" d="M250 64v42" />
      <path className="link" d="M190 164H105v52" />
      <path className="link" d="M310 164h85v52" />
      <path className="link" d="M105 268h95" />
      <path className="link" d="M395 268h-95" />

      <g className="node primary" transform="translate(160 22)">
        <rect width="180" height="42" rx="8" />
        <text x="90" y="26" textAnchor="middle">User request</text>
      </g>
      <g className="node" transform="translate(180 106)">
        <rect width="140" height="58" rx="8" />
        <text x="70" y="26" textAnchor="middle">QuarkAgent</text>
        <text x="70" y="44" textAnchor="middle">context parser</text>
      </g>
      <g className="node" transform="translate(40 216)">
        <rect width="130" height="52" rx="8" />
        <text x="65" y="31" textAnchor="middle">Source view</text>
      </g>
      <g className="node" transform="translate(330 216)">
        <rect width="130" height="52" rx="8" />
        <text x="65" y="31" textAnchor="middle">Visual preview</text>
      </g>
      <g className="node output" transform="translate(180 238)">
        <rect width="140" height="52" rx="8" />
        <text x="70" y="31" textAnchor="middle">Shared output</text>
      </g>
    </svg>
  )
}
