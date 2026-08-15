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

/**
 * Returns the signed-in user's app account: `{ user, memberships }`. Each membership carries its
 * own `role` and nested `profile`; there is no top-level profile.
 */
export async function getMe(): Promise<any> {
  return apiRequest("/auth/me");
}

export interface UpdateProfileArgs {
  /** Required by the backend: profiles are per-workspace, so the target must be explicit. */
  workspaceId: string;
  schoolCode?: string;
  instructor?: string;
  period?: string;
  groupCode?: string;
}

/**
 * Update the signed-in user's own profile row (school / instructor / period / group) via
 * PATCH /auth/me/profile — the same endpoint the web My Page uses, so changes sync across
 * web and phone for the same account. Partial update: only provided fields change.
 *
 * workspaceId is mandatory; the backend 400s without it. Pass the active *class* workspace.
 */
export async function updateMyProfile(args: UpdateProfileArgs): Promise<any> {
  const body: Record<string, string> = { workspaceId: args.workspaceId };
  if (args.schoolCode !== undefined) body.schoolCode = args.schoolCode;
  if (args.instructor !== undefined) body.instructor = args.instructor;
  if (args.period !== undefined) body.period = args.period;
  if (args.groupCode !== undefined) body.groupCode = args.groupCode;
  return apiRequest("/auth/me/profile", { method: "PATCH", body: JSON.stringify(body) });
}

/**
 * Registration payload. The backend takes exactly four fields and derives everything else:
 * role comes from the invitation (or is "teacher" when you create a workspace), and the profile
 * is seeded from the invitation. Exactly one of workspaceName / inviteToken may be set.
 */
export interface RegisterArgs {
  fullName: string;
  /** Optional — the verified Firebase token's email is the backend's source of truth. */
  email?: string;
  /** Teacher path: creates the workspace and makes you its teacher. */
  workspaceName?: string;
  /** Student path: joins the inviting workspace with the invitation's role and period. */
  inviteToken?: string;
}

export interface InvitePreview {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: "teacher" | "student";
  period: string;
  invitedBy: string;
  expiresAt: string;
}

/**
 * Build the /auth/register body, enforcing the backend's XOR locally so an invalid combination
 * fails before we create a Firebase identity that would immediately need cleaning up.
 */
function buildRegisterBody(args: RegisterArgs): Record<string, string> {
  const workspaceName = args.workspaceName?.trim() || "";
  const inviteToken = args.inviteToken?.trim() || "";
  if (Boolean(workspaceName) === Boolean(inviteToken)) {
    throw new Error(
      "Provide exactly one of a workspace name (teacher) or an invitation (student)."
    );
  }
  const body: Record<string, string> = { fullName: String(args.fullName || "").trim() };
  const email = String(args.email || "").trim().toLowerCase();
  if (email) body.email = email;
  if (workspaceName) body.workspaceName = workspaceName;
  if (inviteToken) body.inviteToken = inviteToken;
  return body;
}

/**
 * Provision the app account for a user who is ALREADY signed in to Firebase but has no backend
 * account yet (the needsOnboarding path). apiRequest attaches their ID token, which /auth/register
 * verifies. Deliberately does NOT delete the Firebase account on failure — that account predates
 * this call and may be a perfectly good login that simply hit a transient backend error.
 */
export async function provisionAccount(args: RegisterArgs): Promise<any> {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(buildRegisterBody(args)),
  });
}

/**
 * Full sign-up for a new visitor: create the Firebase identity, then provision the app account.
 * If provisioning fails (expired invitation, email mismatch, server error) the just-created
 * Firebase account is deleted so the email is free and the user can retry cleanly.
 */
export async function register(
  args: RegisterArgs & { email: string; password: string }
): Promise<any> {
  // Validate before touching Firebase so a bad form never creates an orphan account.
  const body = buildRegisterBody(args);
  const normalizedEmail = String(args.email || "").trim().toLowerCase();
  const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, args.password);
  try {
    return await apiRequest("/auth/register", { method: "POST", body: JSON.stringify(body) });
  } catch (err) {
    try {
      await cred.user.delete();
    } catch {
      // If cleanup fails, surface the original error; the account can be reused on next sign-in.
    }
    throw err;
  }
}

/**
 * Pull the token out of whatever the student pasted. Teachers share a link built by the web app
 * (`${origin}/join/<token>`), so a full URL is the common case; a bare token is also accepted.
 * Tokens are 32 random bytes as base64url, so the charset is [A-Za-z0-9_-].
 */
export function extractInviteToken(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const fromPath = raw.match(/\/join\/([A-Za-z0-9_-]+)/);
  if (fromPath) return fromPath[1];
  const fromQuery = raw.match(/[?&]invite=([A-Za-z0-9_-]+)/);
  if (fromQuery) return fromQuery[1];
  return raw;
}

/**
 * Unauthenticated preview of an invitation, so a student can confirm the class and teacher before
 * an account is created. 404 = unknown token; 410 = revoked / already used / expired.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  return apiRequest(`/auth/invitations/${encodeURIComponent(token)}`);
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
