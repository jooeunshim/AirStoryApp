import { auth } from "./firebase";

// The backend mounts routes under `/api/...`, so the base must end at `/api`. On a phone there is
// no window.location, so we default to the deployed Render API. Override for local backend testing
// with EXPO_PUBLIC_API_BASE_URL (e.g. http://192.168.1.56:4000 — your Mac's LAN IP, not localhost).
const DEFAULT_API_BASE = "https://air-sensor-api.onrender.com/api";

function normalizeApiBase(raw?: string): string {
  const u = (raw || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
  return u.endsWith("/api") ? u : `${u}/api`;
}

export const API_BASE = normalizeApiBase(process.env.EXPO_PUBLIC_API_BASE_URL);

// React Native's fetch has no default timeout. Without this, a backend that accepts the
// connection but never answers (a suspended Render instance does exactly that) leaves the
// request pending forever, which strands the UI on a spinner rather than showing an error.
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Current Firebase ID token, or null when signed out. The Firebase SDK caches and refreshes the
 * token automatically, so getIdToken() returns a valid (~1 hr) token without our own refresh logic.
 */
async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export async function apiRequest(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal });
  } catch (e: any) {
    // An abort means the server accepted the connection but never replied — distinct from an
    // outright network failure, and worth saying so since it usually means the API is asleep.
    // React Native has not been consistent about the rejection's `name`, so trust our own flag.
    if (timedOut || e?.name === "AbortError") {
      throw new Error(
        `Could not reach the AirStory server — it did not respond within ${REQUEST_TIMEOUT_MS / 1000}s. ` +
          `It may be starting up; please try again in a moment.`
      );
    }
    throw new Error("Network error — could not reach the AirStory server. Check your connection.");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      // ignore JSON parse error
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}
