const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("pairboard_token");
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Не удалось связаться с сервером" }));
    throw new ApiError(body.message ?? "Ошибка запроса", response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export { API_URL };
