const viteEnv = (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string; VITE_API_TOKEN?: string } }).env;

export const API_BASE = viteEnv?.VITE_API_BASE ?? '';
const API_TOKEN = viteEnv?.VITE_API_TOKEN?.trim() ?? '';

export function apiHeaders(headers?: HeadersInit): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(API_TOKEN ? { 'X-Vimo-Api-Token': API_TOKEN } : {}),
    ...(headers ?? {}),
  };
}

export async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: apiHeaders(init?.headers),
  });

  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) {
        message = body.error.message;
      }
    } catch {
      // Keep the status-based message when the body is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
