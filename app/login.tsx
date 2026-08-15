import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { login } from "./api/auth";
import { useKeyboardAwareForm } from "./useKeyboardAwareForm";

/** Turn raw Firebase auth error codes into friendly copy. */
function friendlyAuthError(e: any): string {
  const code = String(e?.code || e?.message || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Incorrect email or password.";
  }
  if (code.includes("invalid-email")) return "Please enter a valid email address.";
  if (code.includes("user-disabled")) return "This account has been disabled.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait and try again.";
  if (code.includes("network")) return "Network error — check your connection and try again.";
  return e?.message || "Could not sign in. Please try again.";
}

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    scrollRef,
    handleFocus,
    onLayout,
    onContentSizeChange,
    keyboardAdjustStyle,
    behavior,
    keyboardVerticalOffset,
  } = useKeyboardAwareForm();

  const handleLogin = async () => {
    if (busy) return;
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      // On success, onAuthStateChanged updates the auth context and the router gate
      // navigates into the app — no manual navigation needed here.
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.container, keyboardAdjustStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
      >
        <View style={styles.card}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            <Ionicons name="people" size={40} color="#1a73e8" />
          </View>

          {/* Heading */}
          <Text style={styles.heading}>Log In</Text>
          <Text style={styles.subtitle}>Sign in to AirStory to continue.</Text>

          {/* Email */}
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="name@school.edu"
            placeholderTextColor="#9aa0a6"
            value={email}
            onChangeText={setEmail}
            onFocus={handleFocus}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            editable={!busy}
          />

          {/* Password */}
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="••••••••"
              placeholderTextColor="#9aa0a6"
              value={password}
              onChangeText={setPassword}
              onFocus={handleFocus}
              secureTextEntry={!showPassword}
              autoComplete="password"
              editable={!busy}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={22}
                color="#9aa0a6"
              />
            </TouchableOpacity>
          </View>

          {/* Log In button */}
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.btnRow}>
                <Text style={styles.primaryBtnText}>Log In</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* OR divider */}
          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.divider} />
          </View>

          {/* Google (stubbed — later phase) */}
          <TouchableOpacity
            style={[styles.googleBtn, styles.btnDisabled]}
            disabled
            activeOpacity={1}
          >
            <Ionicons name="logo-google" size={20} color="#9aa0a6" />
            <Text style={styles.googleText}>Continue with Google</Text>
          </TouchableOpacity>
          <Text style={styles.comingSoon}>Google sign-in coming soon</Text>

          {/* Sign up link */}
          <TouchableOpacity
            style={styles.signupLink}
            onPress={() => router.push("/onboarding")}
            disabled={busy}
          >
            <Text style={styles.signupText}>Need an account? Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f5f7fb" },
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 28,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  heading: { fontSize: 28, fontWeight: "800", color: "#202124", textAlign: "center" },
  subtitle: { fontSize: 15, color: "#5f6368", textAlign: "center", marginTop: 6, marginBottom: 24 },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#5f6368",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: "#f5f7fb",
    borderWidth: 2,
    borderColor: "#eceff4",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: "#202124",
    marginBottom: 18,
  },
  passwordWrap: {
    position: "relative",
    justifyContent: "center",
  },
  passwordInput: {
    marginBottom: 18,
    paddingRight: 52, // room for the eye toggle
  },
  eyeBtn: {
    position: "absolute",
    right: 6,
    top: 0,
    bottom: 18, // align within the input box, above its marginBottom
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  primaryBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    shadowColor: "#1a73e8",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  primaryBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
  error: { color: "#c5221f", fontSize: 14, textAlign: "center", marginTop: 14, fontWeight: "500" },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 22, gap: 12 },
  divider: { flex: 1, height: 1, backgroundColor: "#e8eaed" },
  dividerText: { fontSize: 12, fontWeight: "700", color: "#9aa0a6", letterSpacing: 1 },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dadce0",
    borderRadius: 14,
    paddingVertical: 15,
  },
  googleText: { fontSize: 16, fontWeight: "700", color: "#9aa0a6" },
  comingSoon: { fontSize: 12, color: "#9aa0a6", textAlign: "center", marginTop: 8 },
  signupLink: { marginTop: 22, alignItems: "center" },
  signupText: { color: "#1a73e8", fontSize: 15, fontWeight: "600" },
});
