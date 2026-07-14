import { spawn } from "node:child_process"
import { authStatus, loginApiKey, loginOAuth, logoutProvider } from "./auth"
import { BUNDLED_PROVIDER_DEFINITIONS } from "../provider/definitions"
import { loadConfig } from "../config/config"

export async function runAuthCommand(args: string[]): Promise<number> {
  const command = args[0]
  if (command === "status") {
    const statuses = await authStatus()
    console.log("Provider\tStatus\tSource")
    for (const status of statuses) {
      console.log(`${status.providerId}\t${status.state}\t${status.origin ?? "none"}`)
    }
    return 0
  }

  if (command === "logout") {
    const providerId = args[1]
    if (!providerId) throw new Error("Usage: quark auth logout <provider>")
    await logoutProvider(providerId)
    console.log(`Logged out of ${providerId}. Legacy token files, if any, were left untouched.`)
    return 0
  }

  if (command === "login") {
    const providerId = args[1]
    if (!providerId) throw new Error("Usage: quark auth login <provider> [--session]")
    const normalized = providerId.toLowerCase()
    const provider = BUNDLED_PROVIDER_DEFINITIONS[normalized as keyof typeof BUNDLED_PROVIDER_DEFINITIONS]
    if (!provider) {
      const configured = loadConfig().providers[normalized]
      if (configured) {
        throw new Error(
          configured.api_key_env
            ? `"${providerId}" is a custom provider and does not support \`quark auth login\`. Set ${configured.api_key_env} as configured by providers.${normalized}.api_key_env.`
            : `"${providerId}" is a legacy custom provider and does not support \`quark auth login\`. Migrate it to base_url and api_key_env.`,
        )
      }
      throw new Error(
        `"${providerId}" is not a supported provider. Configure an OpenAI-compatible custom provider with base_url and api_key_env instead. Supported providers: ${Object.keys(BUNDLED_PROVIDER_DEFINITIONS).join(", ")}.`,
      )
    }
    if (provider.auth.type === "none") {
      console.log(`${provider.name} requires no authentication.`)
      return 0
    }
    if (!process.stdin.isTTY) {
      throw new Error(
        `Authentication login for "${providerId}" requires an interactive terminal. Set the provider's standard environment variable for headless use.`,
      )
    }

    const persistence = args.includes("--session") ? "session" : "store"
    if (provider.auth.type === "oauth-device") {
      await runOAuthLogin(provider.id, provider.auth.implementation, persistence, args)
    } else {
      const apiKey = await readMaskedLine(`API key for ${providerId}: `)
      await loginApiKey({ providerId, apiKey, persistence })
    }
    console.log(`Authenticated ${providerId} using ${persistence === "session" ? "this session" : "the machine credential store"}.`)
    return 0
  }

  throw new Error("Usage: quark auth <login|status|logout> [provider]")
}

async function runOAuthLogin(
  providerId: string,
  implementation: "copilot" | "codex",
  persistence: "session" | "store",
  args: string[],
): Promise<void> {
  const controller = new AbortController()
  const onInterrupt = () => controller.abort()
  process.once("SIGINT", onInterrupt)
  const prompt = createLinePrompt(controller.signal)
  try {
    let method: "browser" | "device" | undefined
    if (implementation === "codex") {
      console.log("Choose login method:\n  1. Browser login\n  2. Device code login")
      const choice = await prompt.ask("Enter 1 or 2: ")
      if (choice !== "1" && choice !== "2") throw new Error('Login method must be "1" or "2".')
      method = choice === "2" ? "device" : "browser"
    }

    const enterpriseIndex = args.indexOf("--enterprise")
    if (enterpriseIndex >= 0 && !args[enterpriseIndex + 1]) {
      throw new Error("Usage: quark auth login copilot [--enterprise <domain>] [--session]")
    }
    if (enterpriseIndex >= 0 && implementation !== "copilot") {
      throw new Error("--enterprise is only supported for Copilot login.")
    }

    await loginOAuth({
      providerId,
      persistence,
      method,
      enterpriseDomain: enterpriseIndex >= 0 ? args[enterpriseIndex + 1] : undefined,
      signal: controller.signal,
      onDeviceCode: (info) => {
        console.log(`\nOpen this URL in your browser:\n  ${info.verificationUri}`)
        console.log(`Enter this code: ${info.userCode}\n`)
        console.log("Waiting for authorization...")
      },
      onBrowserUrl: (url) => {
        console.log(`\nOpen this URL in your browser:\n  ${url}\n`)
        openBrowser(url)
      },
      onBrowserPrompt: () => prompt.ask("Paste the authorization code or redirect URL if needed: "),
    })
  } finally {
    process.off("SIGINT", onInterrupt)
    prompt.close()
  }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url]
  try {
    spawn(command[0]!, command.slice(1), { stdio: "ignore", detached: true }).unref()
  } catch {
    // The URL is already printed for environments without a browser opener.
  }
}

function createLinePrompt(signal: AbortSignal): { ask: (message: string) => Promise<string>; close: () => void } {
  let listener: ((chunk: Buffer | string) => void) | undefined
  let rejectPrompt: ((error: Error) => void) | undefined
  const cancel = () => {
    if (listener) process.stdin.off("data", listener)
    listener = undefined
    process.stdin.pause()
    rejectPrompt?.(new Error("Login cancelled"))
    rejectPrompt = undefined
  }
  signal.addEventListener("abort", cancel)
  return {
    ask(message) {
      if (signal.aborted) return Promise.reject(new Error("Login cancelled"))
      process.stdout.write(message)
      process.stdin.resume()
      return new Promise((resolve, reject) => {
        rejectPrompt = reject
        listener = (chunk) => {
          listener = undefined
          rejectPrompt = undefined
          process.stdin.pause()
          resolve(String(chunk).trim())
        }
        process.stdin.once("data", listener)
      })
    },
    close() {
      signal.removeEventListener("abort", cancel)
      if (listener) process.stdin.off("data", listener)
      listener = undefined
      rejectPrompt = undefined
      process.stdin.pause()
    },
  }
}

async function readMaskedLine(prompt: string): Promise<string> {
  process.stdout.write(prompt)
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")
  let value = ""
  try {
    for await (const chunk of process.stdin) {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n")
          return value
        }
        if (character === "\u0003") throw new Error("Login cancelled")
        if (character === "\u007f") value = value.slice(0, -1)
        else value += character
      }
    }
    return value
  } finally {
    process.stdin.setRawMode?.(false)
    process.stdin.pause()
  }
}
