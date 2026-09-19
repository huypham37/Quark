import type {
  BranchResponse,
  CatalogResponse,
  ExportResponse,
  ModelsResponse,
  SessionResponse,
  StatusResponse,
  StateResponse,
  UndoResponse,
} from "./types"

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

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) })
  }

  state(sessionId: string | null): Promise<StateResponse> {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""
    return this.request(`/api/state${query}`)
  }

  catalog(): Promise<CatalogResponse> {
    return this.request("/api/catalog")
  }

  models(): Promise<ModelsResponse> {
    return this.request("/api/models")
  }

  createSession(): Promise<{ session: SessionResponse["session"] }> {
    return this.post("/api/sessions")
  }

  loadSession(sessionId: string): Promise<SessionResponse> {
    return this.request(`/api/sessions/${encodeURIComponent(sessionId)}`)
  }

  send(sessionId: string, text: string): Promise<{ sessionId: string }> {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, { text })
  }

  cancel(sessionId: string): Promise<{ cancelled: boolean }> {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`)
  }

  answer(requestId: string, answers: string[][], rejected = false): Promise<{ answered: boolean }> {
    return this.post(`/api/questions/${encodeURIComponent(requestId)}`, { answers, rejected })
  }

  undo(sessionId: string): Promise<UndoResponse> {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/undo`)
  }

  exportMarkdown(sessionId: string): Promise<ExportResponse> {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/export`)
  }

  branch(kind: "steer" | "compact", sessionId: string, goal: string): Promise<BranchResponse> {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/${kind}`, { goal })
  }

  setModel(spec: string): Promise<StatusResponse> {
    return this.post("/api/model", { spec })
  }

  /** Pass null to clear the override and fall back to the agent default. */
  setThinking(effort: string | null): Promise<StatusResponse> {
    return this.post("/api/thinking", { effort })
  }

  setAgent(name: string): Promise<StatusResponse> {
    return this.post("/api/agent", { name })
  }

  activateSkill(name: string): Promise<{ activated: boolean; reason?: string; active: string[] }> {
    return this.post("/api/skills", { name })
  }

  reloadConfig(): Promise<StatusResponse & { reloaded: boolean }> {
    return this.post("/api/reload-config")
  }
}
