export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function api<T>(p: string, init?: RequestInit, token?: string): Promise<T> {
  const path = p.startsWith("/") ? p : `/${p}`;
  const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  try {
    const r = await fetch(`${API}${path}`, {
      ...init,
      headers,
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const errorMsg = data.detail || data.error?.message || `Request failed with status ${r.status}`;
      throw new Error(errorMsg);
    }

    if (data.success === false) {
      throw new Error(data.error?.message ?? "API Error");
    }

    return (data.data !== undefined ? data.data : data) as T;
  } catch (err: any) {
    if (err.message === "Failed to fetch") {
      throw new Error("Cannot connect to backend server. Make sure FastAPI backend is running at " + API);
    }
    throw err;
  }
}
