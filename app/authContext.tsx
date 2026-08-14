import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged, User } from "firebase/auth";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { auth } from "./api/firebase";
import { getMe } from "./api/auth";

// Last-known profile, persisted so offline launches (e.g. field data collection in Vietnam)
// still have the correct school / period / group for stamping session CSVs.
const PROFILE_CACHE_KEY = "airstory_profile_cache";

export interface Profile {
  schoolCode: string;
  instructor: string;
  period: string;
  groupCode: string;
  studentCode: string;
  fullName: string;
  role: "teacher" | "student" | "";
}

/** Flatten the /auth/me payload into the compact shape the app screens consume. */
function normalizeProfile(me: any): Profile | null {
  if (!me) return null;
  const p = me.profile || {};
  const role = (me.memberships?.[0]?.role as Profile["role"]) || "";
  return {
    schoolCode: p.school_code || "",
    instructor: p.instructor || "",
    period: p.period || "",
    groupCode: p.group_code || "",
    studentCode: p.student_code || "",
    fullName: me.user?.full_name || "",
    role,
  };
}

interface AuthContextType {
  initializing: boolean;
  user: User | null;
  me: any | null;
  /** Effective profile: live from /auth/me, or the cached copy when offline. */
  profile: Profile | null;
  role: "teacher" | "student" | "";
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
  needsOnboarding: false,
  loadingMe: false,
  refreshMe: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<any | null>(null);
  const [cachedProfile, setCachedProfile] = useState<Profile | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loadingMe, setLoadingMe] = useState(false);

  // Hydrate the cached profile from disk on launch so it's available before (or instead of)
  // a successful /auth/me when offline.
  useEffect(() => {
    AsyncStorage.getItem(PROFILE_CACHE_KEY)
      .then((raw) => {
        if (raw) setCachedProfile(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  const refreshMe = useCallback(async () => {
    if (!auth.currentUser) {
      setMe(null);
      setNeedsOnboarding(false);
      return;
    }
    setLoadingMe(true);
    try {
      const data = await getMe();
      setMe(data);
      setNeedsOnboarding(false);
      const norm = normalizeProfile(data);
      if (norm) {
        setCachedProfile(norm);
        AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(norm)).catch(() => {});
      }
    } catch (e: any) {
      // "no account" 401 => onboarding. Any other error (offline / transient) leaves state
      // untouched so the cached profile remains the offline fallback.
      if (String(e?.message || "").toLowerCase().includes("no account")) {
        setMe(null);
        setNeedsOnboarding(true);
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
        // Signed out: drop the account state and the cached profile (next user may differ).
        setMe(null);
        setNeedsOnboarding(false);
        setLoadingMe(false);
        setCachedProfile(null);
        AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => {});
      }
      setInitializing(false);
    });
    return unsubscribe;
  }, [refreshMe]);

  const profile = normalizeProfile(me) ?? cachedProfile;
  const role = profile?.role ?? "";

  return (
    <AuthContext.Provider
      value={{ initializing, user, me, profile, role, needsOnboarding, loadingMe, refreshMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
