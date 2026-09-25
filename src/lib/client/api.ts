let csrfToken: string | null = null;
let authToken: string | null = typeof window !== "undefined" ? localStorage.getItem("chudsmp_token") : null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window !== "undefined") {
    if (token) localStorage.setItem("chudsmp_token", token);
    else localStorage.removeItem("chudsmp_token");
  }
}

export function getAuthToken(): string | null {
  if (!authToken && typeof window !== "undefined") {
    authToken = localStorage.getItem("chudsmp_token");
  }
  return authToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public actionUrl?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (csrfToken && method !== "GET" && method !== "HEAD") {
    headers["x-csrf-token"] = csrfToken;
  }

  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `Request failed (${res.status})`;
    const code = data?.error?.code || data?.code;
    const actionUrl = data?.error?.action_url || data?.action_url;
    throw new ApiError(res.status, msg, code, actionUrl);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
