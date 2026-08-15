import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://air-sensor-api.onrender.com/api";

const SHARED_EMAIL = "phg-students@airstory.local";
const SHARED_PASSWORD = "phg-students-2026";

const STORAGE_KEY_TOKEN = "airstory_token";
const STORAGE_KEY_WORKSPACE = "airstory_workspace_id";
const STORAGE_KEY_EXPIRES_AT = "airstory_token_expires_at";

const TOKEN_LIFETIME_MS = 14 * 60 * 1000;

export interface ImportRow {
  capturedAt: string;
  sessionCode?: string;
  sessionName?: string;
  sessionNotes?: string;
  location?: string;
  school?: string;
  instructor?: string;
  period?: string;
  group?: string;
  indoorOutdoor?: "INDOOR" | "OUTDOOR";
  latitude?: number | null;
  longitude?: number | null;
  pm25: number;
  co: number;
  temp: number;
  humidity: number;
}

export interface SessionMetadata {
  sessionCode: string;
  sessionName: string;
  school?: string;
  instructor?: string;
  period?: string;
  group?: string;
}

export interface AirStoryUser {
  id: string;
  email: string;
  fullName: string;
  workspaceId: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AirStoryUser;
}

export interface UploadResponse {
  [key: string]: unknown;
}

export interface AuthSession {
  token: string;
  workspaceId: string;
}

export async function loginToAirStory(): Promise<AuthSession> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: SHARED_EMAIL, password: SHARED_PASSWORD }),
    });
  } catch (e) {
    throw new Error(`Network error during login: ${(e as Error).message}`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {}
    throw new Error(`Login failed (${response.status}): ${detail}`);
  }

  let data: LoginResponse;
  try {
    data = (await response.json()) as LoginResponse;
  } catch (e) {
    throw new Error(`Failed to parse login response: ${(e as Error).message}`);
  }

  const token = data.accessToken;
  const workspaceId = data.user?.workspaceId;
  if (!token || !workspaceId) {
    throw new Error("Login response missing accessToken or workspaceId");
  }

  const expiresAt = Date.now() + TOKEN_LIFETIME_MS;
  await AsyncStorage.multiSet([
    [STORAGE_KEY_TOKEN, token],
    [STORAGE_KEY_WORKSPACE, workspaceId],
    [STORAGE_KEY_EXPIRES_AT, String(expiresAt)],
  ]);

  return { token, workspaceId };
}

export async function getStoredToken(): Promise<AuthSession | null> {
  const entries = await AsyncStorage.multiGet([
    STORAGE_KEY_TOKEN,
    STORAGE_KEY_WORKSPACE,
    STORAGE_KEY_EXPIRES_AT,
  ]);
  const map = Object.fromEntries(entries) as Record<string, string | null>;
  const token = map[STORAGE_KEY_TOKEN];
  const workspaceId = map[STORAGE_KEY_WORKSPACE];
  const expiresAtStr = map[STORAGE_KEY_EXPIRES_AT];

  if (!token || !workspaceId || !expiresAtStr) return null;

  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;

  return { token, workspaceId };
}

export async function getValidToken(): Promise<AuthSession> {
  const stored = await getStoredToken();
  if (stored) return stored;
  return loginToAirStory();
}

export async function uploadMeasurements(
  workspaceId: string,
  token: string,
  rows: ImportRow[]
): Promise<UploadResponse> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/workspaces/${workspaceId}/import/csv`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows }),
    });
  } catch (e) {
    throw new Error(`Network error during upload: ${(e as Error).message}`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {}
    throw new Error(`Upload failed (${response.status}): ${detail}`);
  }

  try {
    return (await response.json()) as UploadResponse;
  } catch (e) {
    throw new Error(`Failed to parse upload response: ${(e as Error).message}`);
  }
}

/**
 * Fetch all measurements from the backend and extract unique sessionCodes.
 * Used to sync the app's "uploaded" status with the backend's actual state.
 * If a teacher deleted data, the corresponding sessionCode won't appear here.
 */
export async function fetchUploadedSessionCodes(
  workspaceId: string,
  token: string
): Promise<string[]> {
  const url = `${BASE_URL}/workspaces/${workspaceId}/measurements`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch measurements (${response.status}): ${text}`);
  }

  const data = await response.json();
  const measurements: any[] = data.measurements || [];

  const sessionCodes = new Set<string>();
  for (const m of measurements) {
    const code = m.session?.session_code || m.session_code || m.sessionCode;
    if (code) sessionCodes.add(code);
  }

  return Array.from(sessionCodes);
}

const CSV_HEADERS = [
  "Timestamp",
  "Date",
  "Time",
  "Session ID",
  "Session Name",
  "School",
  "Class (Instructor)",
  "Period",
  "Group",
  "Location",
  "Latitude",
  "Longitude",
  "INDOOR/OUTDOOR",
  "PM 2.5",
  "CO",
  "Temperature",
  "Humidity",
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function toIsoTimestamp(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return new Date().toISOString();
  if (!Number.isNaN(Date.parse(trimmed))) {
    const iso = new Date(trimmed).toISOString();
    return iso;
  }
  return new Date().toISOString();
}

function parseFloatOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? null : n;
}

function parseFloatOrZero(value: string): number {
  const n = parseFloat(value.trim());
  return Number.isNaN(n) ? 0 : n;
}

export function convertCsvToImportRows(
  csvContent: string,
  sessionMetadata: SessionMetadata
): ImportRow[] {
  const lines = csvContent.split("\n");
  if (lines.length === 0) return [];

  const headerLine = lines[0];
  const headerCells = parseCsvLine(headerLine).map(h => h.trim());
  const indexOf = (name: CsvHeader): number => headerCells.indexOf(name);

  const idx = {
    timestamp: indexOf("Timestamp"),
    latitude: indexOf("Latitude"),
    longitude: indexOf("Longitude"),
    indoorOutdoor: indexOf("INDOOR/OUTDOOR"),
    pm25: indexOf("PM 2.5"),
    co: indexOf("CO"),
    temperature: indexOf("Temperature"),
    humidity: indexOf("Humidity"),
  };

  const rows: ImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;

    const cells = parseCsvLine(raw);
    const get = (column: number): string => (column >= 0 && column < cells.length ? cells[column] : "");

    const indoorRaw = get(idx.indoorOutdoor).trim().toUpperCase();
    const indoorOutdoor: "INDOOR" | "OUTDOOR" = indoorRaw === "INDOOR" ? "INDOOR" : "OUTDOOR";

    const row: ImportRow = {
      capturedAt: toIsoTimestamp(get(idx.timestamp)),
      // Session-key fields are forced to constant values for all rows in this upload
      // so the backend groups them as one session (sessionKey = sessionCode|school|instructor|period|group|location).
      sessionCode: sessionMetadata.sessionCode,
      sessionName: sessionMetadata.sessionName,
      school: sessionMetadata.school,
      instructor: sessionMetadata.instructor,
      period: sessionMetadata.period,
      group: sessionMetadata.group,
      location: sessionMetadata.sessionName,
      latitude: parseFloatOrNull(get(idx.latitude)),
      longitude: parseFloatOrNull(get(idx.longitude)),
      indoorOutdoor,
      pm25: parseFloatOrZero(get(idx.pm25)),
      co: parseFloatOrZero(get(idx.co)),
      temp: parseFloatOrZero(get(idx.temperature)),
      humidity: parseFloatOrZero(get(idx.humidity)),
    };

    rows.push(row);
  }

  return rows;
}

// Test usage:
// (async () => {
//   const { token, workspaceId } = await getValidToken();
//   console.log("Got token:", token.substring(0, 20) + "...");
//   console.log("Workspace ID:", workspaceId);
// })();
//
// Upload example:
// (async () => {
//   const { token, workspaceId } = await getValidToken();
//   const rows = convertCsvToImportRows(csvText, { sessionName: "Demo" });
//   const result = await uploadMeasurements(workspaceId, token, rows);
//   console.log("Upload result:", result);
// })();
