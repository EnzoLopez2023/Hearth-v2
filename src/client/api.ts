import { accessToken } from "./auth";

export type ApiRow = Record<string, string | number | null>;

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = path.startsWith("/api/") ? await accessToken() : undefined;
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = await response.json() as ApiErrorBody;
    } catch {
      // Intermediaries can return non-JSON failures; status remains actionable.
    }
    throw new ApiError(
      body.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.request_id
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function apiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "authentication_not_configured") {
      return "This fieldbook is not connected to an identity provider. Configure OIDC, or explicitly enable the development identity outside production.";
    }
    return error.requestId ? `${error.message} · request ${error.requestId}` : error.message;
  }
  return error instanceof Error ? error.message : "The fieldbook could not complete the request.";
}
