export async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${fallback} (HTTP ${response.status}; the server returned a web page instead of API data.)`);
  }
  const body = await response.json().catch(() => null) as any;
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `${fallback} (HTTP ${response.status})`);
  }
  return body as T;
}
