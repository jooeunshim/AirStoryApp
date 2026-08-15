import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged, User } from "firebase/auth";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { auth } from "./api/firebase";
import { getMe } from "./api/auth";

/**
 * Per-workspace profile cache: Record<workspaceId, Profile>. Persisted so offline launches (field
 * collection in Vietnam) still have the right school / period / group for stamping session CSVs.
 * Keyed by workspace because a teacher with several classes has a different placement in each, and
 * because unsynced work in one class must survive switching to another.
 */
const PROFILE_CACHE_KEY = "airstory_profile_cache_v2";
/** Superseded single-profile cache; read once on launch to migrate, then ignored. */
const LEGACY_PROFILE_CACHE_KEY = "airstory_profile_cache";
/** The workspace the user last chose explicitly. */
const ACTIVE_WORKSPACE_KEY = "airstory_active_workspace";

/** One entry of /auth/me's `memberships[]`. Each workspace carries its own role and profile. */
export interface Membership {
  workspace_id: string;
  workspace_name: string;
  kind: "class" | "school" | "public";
  school_id: string | null;
  school_name: string;
  role: "teacher" | "student";
  /**
   * Not currently returned by /auth/me — the backend ORDER BYs w.created_at but does not SELECT
   * it. Declared optional so the sort below starts working the moment it is exposed.
   */
  created_at?: string;
  profile: {
    workspace_id: string;
    school_code: string;
    instructor: string;
    period: string;
    group_code: string;
    student_code: string;
  };
}

export interface Profile {
  /** The class workspace this profile belongs to; profiles are per-workspace. */
  workspaceId: string;
  workspaceName: string;
  schoolCode: string;
  instructor: string;
  period: string;
  groupCode: string;
  studentCode: string;
  fullName: string;
  role: "teacher" | "student" | "";
}

type ProfileCache = Record<string, Profile>;

/**
 * The account's class workspaces, oldest first.
 *
 * Only `kind === "class"` can be written to — Public and school workspaces are read-only
 * aggregates and the backend rejects uploads into them. Selecting by kind also avoids reading the
 * Public membership's hardcoded 'student' role, which would make a teacher look like a student.
 *
 * created_at is not in the payload today, so the comparator falls through to a stable no-op and
 * preserves the server's order (which is itself `ORDER BY w.created_at`). If the field is ever
 * added, the sort becomes authoritative and we stop depending on response ordering.
 */
function classMembershipsOf(me: any): Membership[] {
  const all: Membership[] = me?.memberships || [];
  return all
    .filter((m) => m.kind === "class")
    .slice()
    .sort((a, b) => {
      const at = a.created_at ?? "";
      const bt = b.created_at ?? "";
      if (!at || !bt) return 0; // Array.prototype.sort is stable: server order is preserved.
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
}

/**
 * Which class workspace the app acts on. An explicit prior choice wins as long as it is still one
 * of the account's classes; otherwise the oldest class. Never "whichever happened to be first".
 */
function resolveActiveWorkspaceId(classes: Membership[], persisted: string | null): string | null {
  if (!classes.length) return null;
  if (persisted && classes.some((m) => m.workspace_id === persisted)) return persisted;
  return classes[0].workspace_id;
}

/** Flatten one membership into the compact shape the app screens consume. */
function toProfile(me: any, membership: Membership): Profile {
  const p = membership.profile || ({} as Membership["profile"]);
  return {
    workspaceId: membership.workspace_id,
    workspaceName: membership.workspace_name || "",
    schoolCode: p.school_code || "",
    instructor: p.instructor || "",
    period: p.period || "",
    groupCode: p.group_code || "",
    studentCode: p.student_code || "",
    fullName: me?.user?.full_name || "",
    role: membership.role || "",
  };
}

interface AuthContextType {
  initializing: boolean;
  user: User | null;
  me: any | null;
  /** Effective profile for the active workspace: live from /auth/me, or the cached copy offline. */
  profile: Profile | null;
  role: "teacher" | "student" | "";
  /** Every class workspace the account belongs to, oldest first. */
  classMemberships: Membership[];
  /** False when the account is only in Public/school workspaces — nothing is writable. */
  hasClassWorkspace: boolean;
  /** The class workspace all reads/writes target. Survives offline via the profile cache. */
  activeWorkspaceId: string | null;
  /** Full class membership from the last successful /auth/me; null when offline. */
  activeMembership: Membership | null;
  /** Switch class workspace and remember the choice across launches. */
  setActiveWorkspace: (workspaceId: string) => Promise<void>;
  /** Workspaces with cached data — what syncWithBackend must reconcile, not just the active one. */
  cachedWorkspaceIds: string[];
  /** Last /auth/me failure that isn't "needs onboarding" (401 / 500 / offline / timeout). */
  meError: string | null;
  needsOnboarding: boolean;
  loadingMe: boolean;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  initializing: true,
  user: null,
  me: null,
  profile: null,
  role: "",
  classMemberships: [],
  hasClassWorkspace: false,
  activeWorkspaceId: null,
  activeMembership: null,
  setActiveWorkspace: async () => {},
  cachedWorkspaceIds: [],
  meError: null,
  needsOnboarding: false,
  loadingMe: false,
  refreshMe: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<any | null>(null);
  const [profileCache, setProfileCache] = useState<ProfileCache>({});
  const [persistedWorkspaceId, setPersistedWorkspaceId] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loadingMe, setLoadingMe] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);

  // Hydrate cache + last chosen workspace before (or instead of) a successful /auth/me.
  useEffect(() => {
    (async () => {
      try {
        const [[, rawCache], [, rawActive], [, rawLegacy]] = await AsyncStorage.multiGet([
          PROFILE_CACHE_KEY,
          ACTIVE_WORKSPACE_KEY,
          LEGACY_PROFILE_CACHE_KEY,
        ]);
        if (rawCache) {
          setProfileCache(JSON.parse(rawCache));
        } else if (rawLegacy) {
          // Migrate the old single-profile cache into the keyed map so an existing install keeps
          // working offline after this upgrade.
          const legacy: Profile = JSON.parse(rawLegacy);
          if (legacy?.workspaceId) {
            const migrated = { [legacy.workspaceId]: legacy };
            setProfileCache(migrated);
            AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(migrated)).catch(() => {});
          }
        }
        if (rawActive) setPersistedWorkspaceId(rawActive);
      } catch {
        // A corrupt cache must not block launch; /auth/me will repopulate it.
      }
    })();
  }, []);

  const refreshMe = useCallback(async () => {
    if (!auth.currentUser) {
      setMe(null);
      setNeedsOnboarding(false);
      setMeError(null);
      // Must clear here too: callers set loadingMe before invoking us, so returning without
      // clearing it strands the router gate on its spinner forever.
      setLoadingMe(false);
      return;
    }
    setLoadingMe(true);
    setMeError(null);
    try {
      const data = await getMe();
      setMe(data);
      setNeedsOnboarding(false);
      setMeError(null);
      // Cache every class workspace, not just the active one, so switching classes offline still
      // shows the right placement and sync can reconcile them all.
      const classes = classMembershipsOf(data);
      if (classes.length) {
        setProfileCache((prev) => {
          const next = { ...prev };
          for (const m of classes) next[m.workspace_id] = toProfile(data, m);
          AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
      }
    } catch (e: any) {
      const message = String(e?.message || "Could not load your account.");
      if (message.toLowerCase().includes("no account")) {
        // Signed in to Firebase but not provisioned yet -> onboarding, not an error.
        setMe(null);
        setNeedsOnboarding(true);
        setMeError(null);
      } else {
        // Everything else (401 / 500 / offline / timeout) is recorded so the UI can show it.
        // State is otherwise left alone, so a cached profile still serves offline use.
        setMeError(message);
      }
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        setLoadingMe(true); // block the router gate until /auth/me resolves
        await refreshMe();
      } else {
        // Signed out: drop account state and every cached profile (the next user may differ).
        setMe(null);
        setNeedsOnboarding(false);
        setLoadingMe(false);
        setMeError(null);
        setProfileCache({});
        setPersistedWorkspaceId(null);
        AsyncStorage.multiRemove([
          PROFILE_CACHE_KEY,
          LEGACY_PROFILE_CACHE_KEY,
          ACTIVE_WORKSPACE_KEY,
        ]).catch(() => {});
      }
      setInitializing(false);
    });
    return unsubscribe;
  }, [refreshMe]);

  const classMemberships = classMembershipsOf(me);
  const cachedWorkspaceIds = Object.keys(profileCache);

  // Live resolution when /auth/me has landed; otherwise fall back to the remembered choice (or any
  // cached workspace) so an offline launch still knows where it is.
  const activeWorkspaceId =
    resolveActiveWorkspaceId(classMemberships, persistedWorkspaceId) ??
    (persistedWorkspaceId && profileCache[persistedWorkspaceId] ? persistedWorkspaceId : null) ??
    cachedWorkspaceIds[0] ??
    null;

  const activeMembership =
    classMemberships.find((m) => m.workspace_id === activeWorkspaceId) ?? null;

  const profile =
    (activeMembership ? toProfile(me, activeMembership) : null) ??
    (activeWorkspaceId ? profileCache[activeWorkspaceId] ?? null : null);

  const role = profile?.role ?? "";
  const hasClassWorkspace = classMemberships.length > 0 || Boolean(profile);

  const setActiveWorkspace = useCallback(async (workspaceId: string) => {
    setPersistedWorkspaceId(workspaceId);
    try {
      await AsyncStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    } catch {
      // A failed write only costs the preference on next launch; the switch still applies now.
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        initializing,
        user,
        me,
        profile,
        role,
        classMemberships,
        hasClassWorkspace,
        activeWorkspaceId,
        activeMembership,
        setActiveWorkspace,
        cachedWorkspaceIds,
        meError,
        needsOnboarding,
        loadingMe,
        refreshMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
