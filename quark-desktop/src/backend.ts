let backendUrl: string | null = null

export async function getBackendUrl(): Promise<string> {
  if (backendUrl) return backendUrl

  // Try Tauri invoke first
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    backendUrl = await invoke<string>("get_backend_url")
  } catch {
    // Fallback for Vite dev
    backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:3001"
  }

  // Wait for health
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${backendUrl}/api/health`)
      if (r.ok) return backendUrl!
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error("Backend not reachable")
}

export function apiUrl(path: string): string {
  if (!backendUrl) throw new Error("Backend not initialized")
  return `${backendUrl}${path}`
}
