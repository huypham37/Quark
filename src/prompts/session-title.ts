// Prompt source for auto-generated session titles.
//
// Kept separate from title generation so the instruction can evolve without
// coupling it to request orchestration or persistence.

export const titlePrompt = `What topic or area is the user exploring? Reply with ONLY a short topic label (2-5 words).
Use a noun phrase — NOT a verb/action. Use plain text only — no markdown, no quotes.
If the user has a clear specific task, name the area it belongs to, not the action.
Examples: "Auto Title Generation", "Dark Mode Support", "API Authentication", "Database Schema Design", "React Performance"

User: {{message}}

Topic:`
