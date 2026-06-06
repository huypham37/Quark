#!/usr/bin/env bun
/**
 * OpenAI Codex (ChatGPT Plus/Pro) OAuth login.
 *
 * Usage:
 *   bun run scripts/codex-login.ts
 *
 * Supports two login methods:
 *   1. Browser login (PKCE) — opens your default browser
 *   2. Device code login — headless, use a second device
 *
 * This exercises the full auth path end-to-end against real OpenAI servers.
 */

import {
	loginWithBrowser,
	loginWithDeviceCode,
	saveToken,
} from "../src/provider/codex-auth"
import { createCodexFetch } from "../src/provider/codex-fetch"

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

function prompt(question: string): Promise<string> {
	process.stdout.write(`${question} `)
	return new Promise((resolve) => {
		const onData = (data: Buffer) => {
			process.stdin.off("data", onData)
			resolve(data.toString().trim())
		}
		process.stdin.once("data", onData)
	})
}

// ---------------------------------------------------------------------------
// Choose login method
// ---------------------------------------------------------------------------

console.log("\n--- OpenAI Codex OAuth Login ---\n")
console.log("Choose login method:")
console.log("  1. Browser login (opens your default browser)")
console.log("  2. Device code login (headless, use phone/another device)")

const choice = await prompt("Enter 1 or 2:")

let token

if (choice === "2") {
	// -----------------------------------------------------------------------
	// Device code flow
	// -----------------------------------------------------------------------
	console.log("\nStarting device code flow...")

	token = await loginWithDeviceCode({
		onDeviceCode: (info) => {
			console.log(`\n  Open this URL in your browser:`)
			console.log(`  ${info.verificationUri}\n`)
			console.log(`  Enter this code: ${info.userCode}\n`)
			console.log(`  Waiting for authorization...`)
		},
	})
} else {
	// -----------------------------------------------------------------------
	// Browser PKCE flow
	// -----------------------------------------------------------------------
	console.log("\nStarting browser login flow...")

	token = await loginWithBrowser({
		onUrl: (url) => {
			console.log(`\n  Opening browser to:`)
			console.log(`  ${url}\n`)
			// Try to open the user's default browser
			import("node:child_process").then(({ spawn }) => {
				const openers = {
					darwin: ["open"],
					linux: ["xdg-open"],
					win32: ["cmd", ["/c", "start"]],
				} as Record<string, [string, string[]?]>
				const platform = process.platform as keyof typeof openers
				const [cmd, args] = openers[platform] ?? ["open"]
				spawn(cmd, args ? [...args, url] : [url], { stdio: "ignore" }).unref()
			}).catch(() => {
				// Silently fail if we can't open the browser
			})
		},
		onPrompt: async () => {
			console.log("\n  If the browser didn't open, paste the redirect URL here.")
			return prompt("Paste code or redirect URL:")
		},
	})
}

console.log(`\nAuthorization successful!`)
console.log(`Account ID: ${token.accountId}`)
console.log(`Token expires: ${new Date(token.expires).toISOString()}`)

// Persist token for agent use
saveToken(token)
console.log(`Token saved to ~/.config/quark/codex-token.json`)

console.log(`\nNOTE: This is a ChatGPT Plus/Pro consumer token.`)
console.log(`It is wired to chatgpt.com/backend-api via the custom Codex provider.`)
console.log(`Set your model spec to: codex/gpt-5.5`)

console.log(`\n--- Done ---\n`)
