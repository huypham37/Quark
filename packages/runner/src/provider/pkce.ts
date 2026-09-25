/**
 * PKCE (Proof Key for Code Exchange) utilities using Web Crypto API.
 * Works in Node.js 20+, Bun, and browsers.
 */

function base64urlEncode(bytes: Uint8Array): string {
	let binary = ""
	for (const byte of bytes) {
		binary += String.fromCharCode(byte)
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Generate PKCE code verifier and challenge.
 * Returns a 32-byte random verifier and its SHA-256 hash as a challenge,
 * both base64url-encoded (no padding).
 */
export async function generatePKCE(): Promise<{
	verifier: string
	challenge: string
}> {
	// Generate random verifier
	const verifierBytes = new Uint8Array(32)
	crypto.getRandomValues(verifierBytes)
	const verifier = base64urlEncode(verifierBytes)

	// Compute SHA-256 challenge
	const encoder = new TextEncoder()
	const data = encoder.encode(verifier)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const challenge = base64urlEncode(new Uint8Array(hashBuffer))

	return { verifier, challenge }
}
