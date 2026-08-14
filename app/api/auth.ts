import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase";
import { apiRequest } from "./http";

/** Lightweight backend reachability probe (unauthenticated). Returns false instead of throwing. */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiRequest("/health");
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

/**
 * Email/password sign-in. Firebase verifies the credentials and starts the session; subsequent
 * apiRequest calls (e.g. getMe) attach the resulting ID token automatically.
 */
export async function login(email: string, password: string): Promise<null> {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  await signInWithEmailAndPassword(auth, normalizedEmail, password);
  return null;
}

/** Returns the signed-in user's app account: `{ user, memberships, profile }`. */
export async function getMe(): Promise<any> {
  return apiRequest("/auth/me");
}

export interface UpdateProfileArgs {
  schoolCode?: string;
  instructor?: string;
  period?: string;
  groupCode?: string;
}

/**
 * Update the signed-in user's own profile row (school / instructor / period / group) via
 * PATCH /auth/me/profile — the same endpoint the web My Page uses, so changes sync across
 * web and phone for the same account. Partial update: only provided fields change.
 */
export async function updateMyProfile(args: UpdateProfileArgs): Promise<any> {
  const body: Record<string, string> = {};
  if (args.schoolCode !== undefined) body.schoolCode = args.schoolCode;
  if (args.instructor !== undefined) body.instructor = args.instructor;
  if (args.period !== undefined) body.period = args.period;
  if (args.groupCode !== undefined) body.groupCode = args.groupCode;
  return apiRequest("/auth/me/profile", { method: "PATCH", body: JSON.stringify(body) });
}

export interface RegisterArgs {
  email: string;
  password: string;
  fullName: string;
  workspaceName?: string;
  role?: "student" | "teacher";
  schoolCode?: string;
  instructor?: string;
  period?: string;
  groupCode?: string;
  studentCode?: string;
  joinWorkspaceId?: string;
  joinCode?: string;
}

/**
 * Create a Firebase identity, then provision the app account (workspace / profile / role). If the
 * backend provisioning fails (e.g. invalid join code), delete the orphaned Firebase account so the
 * email is free and the user can retry cleanly. (Used by onboarding — phase 2.)
 */
export async function register(args: RegisterArgs): Promise<any> {
  const normalizedEmail = String(args.email || "").trim().toLowerCase();
  const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, args.password);
  try {
    return await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: normalizedEmail,
        fullName: args.fullName,
        workspaceName: args.workspaceName || "Air Story class",
        role: args.role || "student",
        schoolCode: args.schoolCode || "",
        instructor: args.instructor || "",
        period: args.period || "",
        groupCode: args.groupCode || "",
        studentCode: args.studentCode || "",
        joinWorkspaceId: args.joinWorkspaceId,
        joinCode: args.joinCode || undefined,
      }),
    });
  } catch (err) {
    try {
      await cred.user.delete();
    } catch {
      // If cleanup fails, surface the original error; the account can be reused on next sign-in.
    }
    throw err;
  }
}

/** Validate a teacher join code (instructor / period / school) before a student signs up. */
export async function getJoinCodeConfig(code: string): Promise<any> {
  return apiRequest(`/auth/join-code/${encodeURIComponent(String(code || "").toUpperCase())}/config`);
}

/**
 * Google sign-in — STUBBED for a later phase. Native Google sign-in needs OAuth client IDs in the
 * airstory-web Google Cloud project plus a credential flow (expo-auth-session /
 * @react-native-google-signin), which is intentionally deferred.
 */
export async function loginWithGoogle(): Promise<never> {
  throw new Error("Google sign-in is coming soon.");
}

export async function logout(): Promise<void> {
  await signOut(auth);
}
