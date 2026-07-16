const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const API_TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: "TIMEOUT" | "NETWORK") {
    super(message);
    this.name = "ApiError";
  }
}

type ApiOptions = RequestInit & { timeoutMs?: number };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = localStorage.getItem("pairboard_token");
  const { timeoutMs = API_TIMEOUT_MS, signal, ...requestOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${API_URL}/api${path}`, {
      ...requestOptions,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...requestOptions.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Не удалось связаться с сервером" }));
      throw new ApiError(body.message ?? "Ошибка запроса", response.status);
    }
    return response.status === 204 ? undefined as T : await response.json();
  } catch (reason) {
    if (reason instanceof ApiError) throw reason;
    if (timedOut) throw new ApiError(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} секунд`, 0, "TIMEOUT");
    if (signal?.aborted) throw reason;
    throw new ApiError("Не удалось подключиться к серверу приложения. Проверьте соединение и повторите попытку.", 0, "NETWORK");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export { API_URL };
