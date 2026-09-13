// slash — slash command registry for the web composer
//
// Mirrors the filtering behaviour of the TUI palette: the palette opens
// when the composer text starts with "/", and matches are ranked with
// prefix hits first, then substring hits.

export interface SlashCommand {
  id: string
  description: string
  /** Short usage hint shown after the command name, e.g. "<model-name>" */
  usage?: string
}

/** Slash commands the web client can execute */
export const slashCommands: SlashCommand[] = [
  { id: "help", description: "Show available commands" },
  { id: "new", description: "Create a new session" },
  { id: "clear", description: "Clear messages and start new session" },
  { id: "sessions", description: "Switch to another session" },
  { id: "undo", description: "Undo last agent file changes" },
  { id: "export", description: "Export conversation history to markdown" },
]

export function filterSlashCommands(query: string, limit = slashCommands.length): SlashCommand[] {
  if (!query) return slashCommands.slice(0, limit)
  const needle = query.toLowerCase()
  const prefix: SlashCommand[] = []
  const partial: SlashCommand[] = []
  for (const command of slashCommands) {
    const id = command.id.toLowerCase()
    if (id.startsWith(needle)) prefix.push(command)
    else if (id.includes(needle) || command.description.toLowerCase().includes(needle)) partial.push(command)
  }
  return [...prefix, ...partial].slice(0, limit)
}

/** Returns the query after a leading slash, or null when the text is not a command. */
export function slashQuery(text: string): string | null {
  const firstLine = text.split("\n")[0]!
  if (!firstLine.startsWith("/")) return null
  return firstLine.slice(1).trim()
}
