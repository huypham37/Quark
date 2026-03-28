import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const TOKEN_DIR = path.join(os.homedir(), ".config", "atom")
const TOKEN_FILE = path.join(TOKEN_DIR, "claude-web-proxy-token.json")

export function saveClaudeWebProxyApiKey(apiKey: string): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true })
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ apiKey, savedAt: Date.now() }),
    "utf-8",
  )
}

export function loadClaudeWebProxyApiKey(): string | null {
  if (process.env.CLAUDE_WEB_PROXY_API_KEY) {
    return process.env.CLAUDE_WEB_PROXY_API_KEY
  }

  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8")
    const data = JSON.parse(raw) as { apiKey?: string }
    return data.apiKey ?? null
  } catch {
    return null
  }
}
