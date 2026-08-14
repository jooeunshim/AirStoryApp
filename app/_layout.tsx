import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./authContext";
import { BLEProvider } from "./bleContext";

// Routes reachable while signed out (the auth flow itself).
const PUBLIC_ROUTES = ["login", "onboarding"];

function AuthGate({ children }: { children: React.ReactNode }) {
  const { initializing, user, needsOnboarding, loadingMe } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  // The index route ("/") has no first segment.
  const current = (segments[0] as string) ?? "index";

  useEffect(() => {
    if (initializing) return;
    if (user && loadingMe) return; // wait for /auth/me before deciding
    const onPublic = PUBLIC_ROUTES.includes(current);

    if (!user) {
      if (!onPublic) router.replace("/login");
      return;
    }
    if (needsOnboarding) {
      if (current !== "onboarding") router.replace("/onboarding");
      return;
    }
    // Authenticated with an app account: don't sit on the login/onboarding screens.
    if (onPublic) router.replace("/");
  }, [initializing, user, needsOnboarding, loadingMe, current, router]);

  if (initializing || (user && loadingMe)) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color="#1a73e8" />
      </View>
    );
  }

  return <>{children}</>;
}

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
