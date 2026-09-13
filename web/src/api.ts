import type { ExportResponse, SessionResponse, StateResponse, UndoResponse } from "./types"

export class Api {
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
    return data
  }

  state(sessionId: string | null): Promise<StateResponse> {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
    return this.request(`/api/state${query}`)
  }

  createSession(): Promise<{ session: SessionResponse["session"] }> {
    return this.request("/api/sessions", { method: "POST" })
  }

  loadSession(sessionId: string): Promise<SessionResponse> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`)
  }

  send(sessionId: string, text: string): Promise<{ sessionId: string }> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    })
  }

  cancel(sessionId: string): Promise<{ cancelled: boolean }> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" })
  }

  answer(requestId: string, answers: string[][], rejected = false): Promise<{ answered: boolean }> {
    return this.request(`/api/questions/${encodeURIComponent(requestId)}`, {
      method: "POST",
      body: JSON.stringify({ answers, rejected }),
    })
  }

  undo(sessionId: string): Promise<UndoResponse> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/undo`, { method: "POST" })
  }

  exportMarkdown(sessionId: string): Promise<ExportResponse> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}/export`, { method: "POST" })
  }
}
