import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClassStructure, type ClassStructure } from "./api/auth";

/** Cached structures: Record<workspaceId, ClassStructure>. */
const STRUCTURE_CACHE_KEY = "airstory_class_structure_v1";

/** Matches the backend's own default for a workspace with no stored row (1 period, 4 groups). */
const FALLBACK: ClassStructure = {
  periods: ["P1"],
  groupsByPeriod: { P1: ["G1", "G2", "G3", "G4"] },
  periodCount: 1,
  groupCount: 4,
};

/**
 * Coerce a stored period into the backend's label form.
 *
 * Only for READING values written before pickers existed — free text allowed "1", "p2", " P3 ".
 * New values come from the picker and are already correct. Unrecognised input is returned trimmed
 * rather than discarded, so a legacy oddity stays visible instead of silently becoming blank.
 */
export function normalizePeriod(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const digits = s.replace(/^[Pp]/, "");
  return /^\d+$/.test(digits) ? `P${Number(digits)}` : s;
}

/** Same, for group: "1" / "g2" / " G3 " -> "G1" / "G2" / "G3". */
export function normalizeGroup(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const digits = s.replace(/^[Gg]/, "");
  return /^\d+$/.test(digits) ? `G${Number(digits)}` : s;
}

/** Groups available for a period. Every period maps to the same list, so the arg is a formality. */
export function groupsFor(structure: ClassStructure | null, period: string): string[] {
  if (!structure) return [];
  return structure.groupsByPeriod[period] ?? structure.groupsByPeriod[structure.periods[0]] ?? [];
}

type Cache = Record<string, ClassStructure>;

/**
 * Class structure for one workspace, cached on disk so the settings screen renders without a
 * network round-trip. A cached copy is shown immediately and refreshed in the background; the
 * network is only load-bearing the very first time a workspace is seen.
 */
export function useClassStructure(workspaceId: string | null) {
  const [structure, setStructure] = useState<ClassStructure | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Cache>({});

  const readCache = useCallback(async (): Promise<Cache> => {
    if (Object.keys(cacheRef.current).length) return cacheRef.current;
    try {
      const raw = await AsyncStorage.getItem(STRUCTURE_CACHE_KEY);
      cacheRef.current = raw ? JSON.parse(raw) : {};
    } catch {
      cacheRef.current = {};
    }
    return cacheRef.current;
  }, []);

  const fetchFor = useCallback(
    async (wsId: string) => {
      setLoading(true);
      setError(null);
      try {
        const fresh = await getClassStructure(wsId);
        setStructure(fresh);
        const cache = await readCache();
        cacheRef.current = { ...cache, [wsId]: fresh };
        AsyncStorage.setItem(STRUCTURE_CACHE_KEY, JSON.stringify(cacheRef.current)).catch(() => {});
      } catch (e: any) {
        // Offline or server trouble: keep whatever is already on screen. Only surface an error
        // when there is nothing cached to fall back to.
        setError(e?.message || "Could not load class options.");
      } finally {
        setLoading(false);
      }
    },
    [readCache]
  );

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setStructure(null);
      setError(null);
      return;
    }
    (async () => {
      const cache = await readCache();
      if (cancelled) return;
      if (cache[workspaceId]) setStructure(cache[workspaceId]);
      await fetchFor(workspaceId);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, readCache, fetchFor]);

  const refresh = useCallback(async () => {
    if (workspaceId) await fetchFor(workspaceId);
  }, [workspaceId, fetchFor]);

  return {
    /** Never null once a workspace is selected: falls back to the backend's own default shape. */
    structure: workspaceId ? structure ?? FALLBACK : null,
    /** True only while a request is in flight; cached data renders regardless. */
    loading,
    /** Set only when a fetch failed; cached/fallback options are still usable. */
    error,
    refresh,
  };
}
