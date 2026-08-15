import { apiRequest } from "./api/http";

// Auth is entirely Firebase now: apiRequest attaches the current ID token and the Firebase SDK
// refreshes it, so this module holds no credentials, no token cache, and no expiry logic.

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

export interface UploadResponse {
  [key: string]: unknown;
}

/**
 * Upload measurement rows into a workspace. Must be a *class* workspace — the backend rejects
 * the Public and school aggregates as read-only.
 */
export async function uploadMeasurements(
  workspaceId: string,
  rows: ImportRow[]
): Promise<UploadResponse> {
  return apiRequest(`/workspaces/${workspaceId}/import/csv`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

/**
 * Fetch all measurements from the backend and extract unique sessionCodes.
 * Used to sync the app's "uploaded" status with the backend's actual state.
 * If a teacher deleted data, the corresponding sessionCode won't appear here.
 */
export async function fetchUploadedSessionCodes(workspaceId: string): Promise<string[]> {
  const data = await apiRequest(`/workspaces/${workspaceId}/measurements`);
  const measurements: any[] = data?.measurements || [];

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

// Upload example — the workspace id comes from useAuth().activeWorkspaceId (the class
// workspace); the Firebase ID token is attached by apiRequest, so there is nothing to pass:
//
// const rows = convertCsvToImportRows(csvText, sessionMetadata);
// const result = await uploadMeasurements(activeWorkspaceId, rows);
