import { useState } from "react"
import type { ActiveReview } from "../state"

interface DiffReviewProps {
  review: ActiveReview
  onApprove: () => void
  onAlways: () => void
  onReject: () => void
  onCorrect: (correction: string) => void
}

export function DiffReview({ review, onApprove, onAlways, onReject, onCorrect }: DiffReviewProps) {
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState("")

  const lines = review.diff.split("\n")

  return (
    <div className="diff-review-pane">
      {/* Header */}
      <div className="diff-header">
        <div>
          <span className="tool-label">{review.tool}</span>
          <span className="file-label">{review.filePath}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {!correcting ? (
            <>
              <button onClick={onAlways} className="btn btn-always">Always</button>
              <button onClick={onApprove} className="btn btn-approve">Approve</button>
              <button onClick={onReject} className="btn btn-reject">Reject</button>
              <button onClick={() => setCorrecting(true)} className="btn btn-correct">Correct</button>
            </>
          ) : (
            <>
              <textarea
                value={correction}
                onChange={e => setCorrection(e.target.value)}
                placeholder="Describe the correction..."
                rows={2}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  background: "#ffffff",
                  color: "var(--text)",
                  fontSize: "13px",
                  minWidth: 300,
                  resize: "vertical",
                }}
              />
              <button
                onClick={() => { onCorrect(correction); setCorrecting(false); setCorrection("") }}
                disabled={!correction.trim()}
                className="btn btn-approve"
                style={{ opacity: correction.trim() ? 1 : 0.5 }}
              >
                Send
              </button>
              <button onClick={() => setCorrecting(false)} className="btn btn-correct">Cancel</button>
            </>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div className="diff-content">
        {lines.map((line, i) => {
          const bg = line.startsWith("+") ? "rgba(0,163,68,0.06)"
            : line.startsWith("-") ? "rgba(210,31,37,0.06)"
            : line.startsWith("@@") ? "rgba(94,78,205,0.04)"
            : "transparent"
          const color = line.startsWith("+") ? "#00a344"
            : line.startsWith("-") ? "#d21f25"
            : line.startsWith("@@") ? "var(--accent, #5e4ecd)"
            : "var(--muted, #6e6e85)"
          return (
            <div key={i} style={{
              background: bg,
              color,
              padding: "0 4px",
              whiteSpace: "pre",
            }}>
              {line || " "}
            </div>
          )
        })}
      </div>
    </div>
  )
}
