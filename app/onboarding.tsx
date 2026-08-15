import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
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
import { useKeyboardAwareForm } from "./useKeyboardAwareForm";
import {
  extractInviteToken,
  getInvitePreview,
  logout,
  provisionAccount,
  register,
  type InvitePreview,
} from "./api/auth";
import { useAuth } from "./authContext";

type Mode = "choose" | "student" | "teacher";

// Backend tokens are 32 random bytes as base64url (43 chars); the schema accepts 20–128. Use the
// schema's floor as the "looks like a token" threshold so we don't preview obvious typos.
const MIN_TOKEN_LENGTH = 20;

/** Firebase sign-up error codes -> copy a student can act on. */
function friendlyAuthError(e: any): string {
  const code = String(e?.code || e?.message || "");
  if (code.includes("email-already-in-use")) {
    return "That email already has an account. Go back and log in instead.";
  }
  if (code.includes("invalid-email")) return "Please enter a valid email address.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("network")) return "Network error — check your connection and try again.";
  return e?.message || "Could not create your account. Please try again.";
}

export default function Onboarding() {
  const { user, refreshMe } = useAuth();
  // Two entry paths: a signed-out visitor creating an account, or a Firebase user who has no app
  // account yet. The latter already has an identity, so we skip email/password entirely.
  const isSignedIn = Boolean(user);

  const [mode, setMode] = useState<Mode>("choose");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteInput, setInviteInput] = useState("");

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [checkingInvite, setCheckingInvite] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const {
    scrollRef,
    handleFocus,
    onLayout,
    onContentSizeChange,
    keyboardAdjustStyle,
    behavior,
    keyboardVerticalOffset,
  } = useKeyboardAwareForm();

  const inviteToken = extractInviteToken(inviteInput);

  // Look the invitation up as it is typed/pasted, so the class and teacher are confirmed before
  // any account exists. Debounced, and cancelled on change so a slow response can't overwrite a
  // newer one.
  useEffect(() => {
    if (mode !== "student" || inviteToken.length < MIN_TOKEN_LENGTH) {
      setPreview(null);
      setPreviewError("");
      setCheckingInvite(false);
      return;
    }
    let cancelled = false;
    setCheckingInvite(true);
    setPreviewError("");
    const timer = setTimeout(async () => {
      try {
        const found = await getInvitePreview(inviteToken);
        if (cancelled) return;
        setPreview(found);
        setPreviewError("");
        // The backend rejects a mismatch between the invite and the signed-in email, so prefill it.
        setEmail((current) => current || found.email || "");
      } catch (e: any) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(e?.message || "Could not check that invitation.");
      } finally {
        if (!cancelled) setCheckingInvite(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, inviteToken]);

  const resetTo = (next: Mode) => {
    setMode(next);
    setError("");
    setPreviewError("");
  };

  const submit = async () => {
    if (submitting) return;
    setError("");

    if (fullName.trim().length < 2) {
      setError("Enter your full name (at least 2 characters).");
      return;
    }
    if (mode === "teacher" && workspaceName.trim().length < 2) {
      setError("Enter a class name (at least 2 characters).");
      return;
    }
    if (mode === "student" && inviteToken.length < MIN_TOKEN_LENGTH) {
      setError("Paste the invitation link your teacher sent you.");
      return;
    }
    if (!isSignedIn) {
      if (!email.trim()) {
        setError("Enter your email address.");
        return;
      }
      if (password.length < 6) {
        setError("Choose a password with at least 6 characters.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const args =
        mode === "teacher"
          ? { fullName: fullName.trim(), workspaceName: workspaceName.trim() }
          : { fullName: fullName.trim(), inviteToken };

      if (isSignedIn) {
        await provisionAccount(args);
      } else {
        await register({ ...args, email: email.trim().toLowerCase(), password });
      }
      // Clearing needsOnboarding lets the router gate move us to Home; no manual navigation.
      await refreshMe();
    } catch (e: any) {
      setError(friendlyAuthError(e));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------------------------- role picker ---------------------------------- */

  if (mode === "choose") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="person-add-outline" size={40} color="#1a73e8" />
        </View>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.body}>
          {isSignedIn
            ? "You're signed in, but you don't have an AirStory account yet. Finish setting it up."
            : "Choose how you're joining AirStory."}
        </Text>

        {/* Students are the primary users, so their path leads. */}
        <TouchableOpacity style={styles.choicePrimary} onPress={() => resetTo("student")}>
          <Ionicons name="people" size={26} color="#fff" />
          <View style={styles.choiceTextWrap}>
            <Text style={styles.choicePrimaryTitle}>I&apos;m a student</Text>
            <Text style={styles.choicePrimarySub}>Join with an invitation from your teacher</Text>
          </View>
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.choiceSecondary} onPress={() => resetTo("teacher")}>
          <Ionicons name="school-outline" size={24} color="#1a73e8" />
          <View style={styles.choiceTextWrap}>
            <Text style={styles.choiceSecondaryTitle}>I&apos;m a teacher</Text>
            <Text style={styles.choiceSecondarySub}>Create a class and invite students</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color="#1a73e8" />
        </TouchableOpacity>

        {isSignedIn ? (
          <TouchableOpacity style={styles.linkBtn} onPress={() => logout()}>
            <Text style={styles.linkText}>Sign out</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    );
  }

  /* ------------------------------------- form -------------------------------------- */

  const isStudent = mode === "student";

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
        <Text style={styles.title}>{isStudent ? "Join your class" : "Create your class"}</Text>
        <Text style={styles.body}>
          {isStudent
            ? "Paste the invitation link your teacher sent you."
            : "You'll be the teacher of this class and can invite students from the web app."}
        </Text>

        {isStudent ? (
          <>
            <Text style={styles.label}>Invitation link or code</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="https://airstory.app/join/..."
              placeholderTextColor="#9aa0a6"
              value={inviteInput}
              onChangeText={setInviteInput}
              onFocus={handleFocus}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              editable={!submitting}
            />

            {checkingInvite ? (
              <View style={styles.inviteRow}>
                <ActivityIndicator size="small" color="#1a73e8" />
                <Text style={styles.inviteChecking}>Checking invitation…</Text>
              </View>
            ) : null}

            {previewError ? <Text style={styles.error}>{previewError}</Text> : null}

            {preview ? (
              <View style={styles.previewCard}>
                <View style={styles.inviteRow}>
                  <Ionicons name="checkmark-circle" size={20} color="#188038" />
                  <Text style={styles.previewTitle}>{preview.workspaceName}</Text>
                </View>
                {preview.invitedBy ? (
                  <Text style={styles.previewLine}>Invited by {preview.invitedBy}</Text>
                ) : null}
                <Text style={styles.previewLine}>
                  Joining as {preview.role}
                  {preview.period ? ` · Period ${preview.period}` : ""}
                </Text>
                <Text style={styles.previewLine}>For {preview.email}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.label}>Class name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Period 3 Environmental Science"
              placeholderTextColor="#9aa0a6"
              value={workspaceName}
              onChangeText={setWorkspaceName}
              onFocus={handleFocus}
              maxLength={80}
              editable={!submitting}
            />
          </>
        )}

        <Text style={styles.label}>Your full name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Jordan Lee"
          placeholderTextColor="#9aa0a6"
          value={fullName}
          onChangeText={setFullName}
          onFocus={handleFocus}
          maxLength={80}
          editable={!submitting}
        />

        {isSignedIn ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>Signed in as {user?.email}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>Email address</Text>
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
              editable={!submitting}
            />

            <Text style={styles.label}>Choose a password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="At least 6 characters"
                placeholderTextColor="#9aa0a6"
                value={password}
                onChangeText={setPassword}
                onFocus={handleFocus}
                secureTextEntry={!showPassword}
                editable={!submitting}
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
          </>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, submitting && styles.btnDisabled]}
          onPress={submit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {isStudent ? "Join class" : "Create class"}
            </Text>
          )}
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => resetTo("choose")}
          disabled={submitting}
        >
          <Text style={styles.linkText}>Back</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  container: { flexGrow: 1, justifyContent: "center", backgroundColor: "#fff", padding: 28 },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "#e8f0fe",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: "800", color: "#202124", textAlign: "center", marginBottom: 10 },
  body: { fontSize: 15, color: "#5f6368", textAlign: "center", lineHeight: 22, marginBottom: 26 },

  choicePrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#1a73e8",
    borderRadius: 18,
    padding: 20,
    marginBottom: 14,
  },
  choiceSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#e8eaed",
    borderRadius: 18,
    padding: 20,
  },
  choiceTextWrap: { flex: 1 },
  choicePrimaryTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  choicePrimarySub: { color: "#d7e6fb", fontSize: 13, marginTop: 2 },
  choiceSecondaryTitle: { color: "#202124", fontSize: 17, fontWeight: "700" },
  choiceSecondarySub: { color: "#5f6368", fontSize: 13, marginTop: 2 },

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
  inputMultiline: { minHeight: 76, textAlignVertical: "top" },
  passwordWrap: { position: "relative", justifyContent: "center" },
  passwordInput: { marginBottom: 18, paddingRight: 52 },
  eyeBtn: {
    position: "absolute",
    right: 6,
    top: 0,
    bottom: 18,
    justifyContent: "center",
    paddingHorizontal: 10,
  },

  inviteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inviteChecking: { color: "#5f6368", fontSize: 14, marginBottom: 4 },
  previewCard: {
    backgroundColor: "#e6f4ea",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    gap: 4,
  },
  previewTitle: { fontSize: 16, fontWeight: "700", color: "#188038" },
  previewLine: { fontSize: 14, color: "#33691e" },

  noteBox: { backgroundColor: "#f5f7fb", borderRadius: 14, padding: 14, marginBottom: 18 },
  noteText: { fontSize: 14, color: "#5f6368" },

  primaryBtn: {
    backgroundColor: "#1a73e8",
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
  error: { color: "#c5221f", fontSize: 14, textAlign: "center", marginTop: 14, fontWeight: "500" },
  linkBtn: { marginTop: 20, alignItems: "center" },
  linkText: { color: "#1a73e8", fontSize: 15, fontWeight: "600" },
});
