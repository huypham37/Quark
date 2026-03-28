import { describe, test, expect } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import {
  loadClaudeWebProxyApiKey,
  saveClaudeWebProxyApiKey,
} from "../../src/provider/claude-web-proxy-auth"

describe("claude-web-proxy-auth", () => {
  test("reads API key from env var first", () => {
    const prev = process.env.CLAUDE_WEB_PROXY_API_KEY
    process.env.CLAUDE_WEB_PROXY_API_KEY = "env-key"
    try {
      expect(loadClaudeWebProxyApiKey()).toBe("env-key")
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_WEB_PROXY_API_KEY
      else process.env.CLAUDE_WEB_PROXY_API_KEY = prev
    }
  })

  test("saves and loads key from ~/.config/atom", () => {
    const prev = process.env.CLAUDE_WEB_PROXY_API_KEY
    delete process.env.CLAUDE_WEB_PROXY_API_KEY

    const tokenDir = path.join(os.homedir(), ".config", "atom")
    const tokenFile = path.join(tokenDir, "claude-web-proxy-token.json")
    const existed = fs.existsSync(tokenFile)
    const backup = existed ? fs.readFileSync(tokenFile, "utf-8") : null

    try {
      saveClaudeWebProxyApiKey("file-key")
      expect(loadClaudeWebProxyApiKey()).toBe("file-key")
    } finally {
      if (backup !== null) {
        fs.writeFileSync(tokenFile, backup, "utf-8")
      } else if (fs.existsSync(tokenFile)) {
        fs.unlinkSync(tokenFile)
      }

      if (prev === undefined) delete process.env.CLAUDE_WEB_PROXY_API_KEY
      else process.env.CLAUDE_WEB_PROXY_API_KEY = prev
    }
  })
})
