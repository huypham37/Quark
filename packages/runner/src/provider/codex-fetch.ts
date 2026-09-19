/**
 * Codex fetch wrapper
 * Injects Authorization: Bearer <token> on every request and removes x-api-key.
 * Minimal wrapper — no provider-specific stream rewriting like Copilot.
 */

import type { FetchFn } from "./codex-auth"

export function createCodexFetch(options: {
	getToken: () => Promise<string>
	fetch?: FetchFn
}): FetchFn {
	const baseFetch = options.fetch ?? globalThis.fetch

	return async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const token = await options.getToken()

		// Merge headers: preserve request headers, inject Bearer auth, remove x-api-key
		const headers: Record<string, string> = init?.headers
			? Object.fromEntries(new Headers(init.headers as Record<string, string>).entries())
			: {}
		delete headers["x-api-key"]
		headers["authorization"] = `Bearer ${token}`

		return baseFetch(input, {
			...init,
			headers,
		})
	}
}
