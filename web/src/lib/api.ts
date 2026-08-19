export class APIError extends Error {
  status: number
  code: string
  data: Record<string, unknown>

  constructor(message: string, status: number, code = "", data: Record<string, unknown> = {}) {
    super(message)
    this.name = "APIError"
    this.status = status
    this.code = code
    this.data = data
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  })
  const text = await response.text()
  let data: Record<string, unknown> = {}
  if (text) {
    try { data = JSON.parse(text) as Record<string, unknown> }
    catch { throw new APIError(response.ok ? "Invalid server response" : text.trim() || "Request failed", response.status) }
  }
  if (!response.ok) throw new APIError(String(data.error || "Request failed"), response.status, String(data.code || ""), data)
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: HeadersInit) => request<T>(path, { method: "POST", body: JSON.stringify(body || {}), headers }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body || {}) }),
  del: <T = Record<string, never>>(path: string) => request<T>(path, { method: "DELETE" }),
}
