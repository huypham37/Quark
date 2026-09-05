// Prompt source for compacting a session into durable branch context.

export const compactionPrompt = `Analyze this conversation and produce a continuation context for a child branch session.

1. Identify all relevant files that should be loaded into the next session's context. Include files that will be edited, dependencies being touched, relevant tests, configs, and key reference docs. Be generous—the cost of an extra file is low; missing a critical one means another archaeology dig. Target 8-15 files, up to 20 for complex work. List them under a "## Files" heading as bullet points with absolute paths when known, or relative paths from the project root.

2. Draft the context and goal description under a "## Context" heading. Describe what we're working on and provide whatever context helps continue the work. Preserve: decisions, constraints, user preferences, technical patterns. Exclude: conversation back-and-forth, dead ends, meta-commentary. Structure it based on what fits—could be tasks, findings, a simple paragraph, or detailed steps.

The user controls what context matters. If they mentioned something to preserve, include it—trust their judgment about their workflow.

Be factual and concise. The output will be frozen and reused for every subsequent sibling branch, so make it self-contained and durable.`

export function buildCompactionPrompt(transcript: string): string {
  return `${compactionPrompt}\n\n${transcript}`
}
