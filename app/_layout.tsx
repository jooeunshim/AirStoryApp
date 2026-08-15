import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { logout } from "./api/auth";
import { AuthProvider, useAuth } from "./authContext";
import { BLEProvider } from "./bleContext";

// Routes reachable while signed out (the auth flow itself).
const PUBLIC_ROUTES = ["login", "onboarding"];

/** The only destinations the gate can send you to. Literals, so expo-router's typed routes accept them. */
type GateRoute = "/login" | "/onboarding" | "/";

/**
 * Where this auth state belongs, or null if the current route is already correct.
 *
 * Computed during render rather than inside the effect so the same answer can gate the render
 * itself. Deciding only in an effect means children mount for one frame first — which is how Home
 * flashed before the redirect to Log In.
 */
function resolveRedirect(
  user: unknown,
  needsOnboarding: boolean,
  current: string
): GateRoute | null {
  const onPublic = PUBLIC_ROUTES.includes(current);
  if (!user) return onPublic ? null : "/login";
  if (needsOnboarding) return current === "onboarding" ? null : "/onboarding";
  // Authenticated with an app account: don't sit on the login/onboarding screens.
  return onPublic ? "/" : null;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { initializing, user, profile, meError, needsOnboarding, loadingMe, refreshMe } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  // The index route ("/") has no first segment.
  const current = (segments[0] as string) ?? "index";

  // Auth state is still settling: nothing can be decided yet, and nothing protected may mount.
  const undecided = initializing || (user != null && loadingMe);
  const redirectTo = undecided ? null : resolveRedirect(user, needsOnboarding, current);

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  // Hold the loading state both while auth is unresolved AND while a redirect is pending, so no
  // screen is ever mounted only to be replaced a frame later.
  if (undecided || redirectTo) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  // Signed in, but /auth/me failed and there's no cached profile to fall back on. Say so instead
  // of dropping the user on an empty Home screen. If a cached profile exists we fall through and
  // let the app run offline — that path is the whole point of the cache.
  if (user && meError && !profile && !needsOnboarding) {
    return (
      <View style={styles.errorScreen}>
        <Text style={styles.errorTitle}>Can&apos;t load your account</Text>
        <Text style={styles.errorBody}>{meError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => refreshMe()}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signOutBtn} onPress={() => logout()}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    padding: 28,
  },
  errorTitle: { fontSize: 22, fontWeight: "800", color: "#202124", textAlign: "center", marginBottom: 12 },
  errorBody: { fontSize: 15, color: "#5f6368", textAlign: "center", lineHeight: 22, marginBottom: 28 },
  retryBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 40,
    alignItems: "center",
  },
  retryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  signOutBtn: { padding: 14, marginTop: 8 },
  signOutText: { color: "#c5221f", fontSize: 15, fontWeight: "600" },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <BLEProvider>
          <AuthGate>
            <Stack>
              <Stack.Screen name="index" options={{ title: "Home" }} />
              <Stack.Screen name="history" options={{ title: "Session History" }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding" options={{ title: "Set up your account" }} />
            </Stack>
          </AuthGate>
        </BLEProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
