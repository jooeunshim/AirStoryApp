import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { updateMyProfile } from "./api/auth";
import { useAuth } from "./authContext";
import { manager, useBLE } from "./bleContext";
import { ChipPicker } from "./components/ChipPicker";
import { groupsFor, normalizeGroup, normalizePeriod, useClassStructure } from "./useClassStructure";

export default function Settings() {
  const router = useRouter();
  const { connectedDevice, setConnectedDevice } = useBLE();
  const {
    profile,
    role,
    classMemberships,
    hasClassWorkspace,
    activeWorkspaceId,
    setActiveWorkspace,
    refreshMe,
  } = useAuth();
  const isTeacher = role === "teacher";
  const insets = useSafeAreaInsets();

  const { structure, loading: loadingStructure, refresh: refreshStructure } =
    useClassStructure(activeWorkspaceId);

  // Instructor is class-level identity and stays teacher-only. Period and group are the user's
  // own placement: the backend's PATCH /auth/me/profile is requireAuth with no role check, and a
  // student's group genuinely changes week to week, so both roles pick their own. School is not
  // here at all — it belongs to the workspace and is set on the web.
  const [instructor, setInstructor] = useState("");
  const [period, setPeriod] = useState("");
  const [group, setGroup] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Seed the form from the active workspace's profile. normalizePeriod/normalizeGroup only matter
  // for values written before pickers existed ("1" -> "P1"); picker output is already correct.
  useEffect(() => {
    setInstructor(profile?.instructor || "");
    setPeriod(normalizePeriod(profile?.period));
    setGroup(normalizeGroup(profile?.groupCode));
  }, [profile?.instructor, profile?.period, profile?.groupCode]);

  // Free-text names: strip only CSV-breaking characters (matches the web sanitizer).
  const sanitizeName = (t: string) => t.replace(/[",\n\r]/g, "").substring(0, 60);

  const onPullToRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshMe(), refreshStructure()]);
    } finally {
      setRefreshing(false);
    }
  };

  const switchWorkspace = async (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) return;
    setError("");
    // The structure hook re-fetches on workspaceId change, and the seeding effect above re-runs
    // when the new workspace's profile arrives.
    await setActiveWorkspace(workspaceId);
  };

  const saveProfile = async () => {
    setError("");
    // Profiles are per-workspace, so there is nothing to save into until the class workspace
    // is known (a brand-new account in Public only, or an offline first launch).
    if (!activeWorkspaceId) {
      setError("No class workspace yet — your teacher needs to add you to a class first.");
      return;
    }
    setSaving(true);
    try {
      // schoolCode is deliberately omitted: the field is optional, and the backend preserves the
      // existing value when it is absent. The app no longer owns that column.
      await updateMyProfile({
        workspaceId: activeWorkspaceId,
        instructor: instructor.trim(),
        period,
        groupCode: group,
      });
      // Pull the saved values back and refresh the offline cache, then return home.
      await refreshMe();
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Could not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const disconnectDevice = () => {
    Alert.alert("Disconnect Device", "Disconnect the current sensor?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          if (connectedDevice) {
            try {
              await manager.cancelDeviceConnection(connectedDevice.id);
            } catch (e) {
              console.log("Disconnect error:", e);
            }
          }
          setConnectedDevice(null);
          // Only the device pairing is local now; the profile lives on the account.
          await AsyncStorage.removeItem("savedMacAddress").catch(() => {});
          Alert.alert("Done", "Device disconnected.");
        },
      },
    ]);
  };

  const readOnly = (label: string, value: string) => (
    <View key={label}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.readonlyBox}>
        <Text style={styles.readonlyText}>{value || "—"}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullToRefresh} />}
    >
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>
        {hasClassWorkspace
          ? "Your class details, synced to your account."
          : "You are not in a class yet."}
      </Text>

      {readOnly("Name", profile?.fullName || "")}

      {!hasClassWorkspace ? (
        // Only in the Public/school aggregates: nothing here is writable, and the backend rejects
        // uploads into those workspaces. Say so rather than showing a form that cannot save.
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No class yet</Text>
          <Text style={styles.emptyText}>
            Your teacher needs to invite you to a class before you can set a period and group or
            upload data. Once you have joined, pull down to refresh.
          </Text>
        </View>
      ) : (
        <>
          {/* Item 2: only meaningful with more than one class. */}
          {classMemberships.length > 1 ? (
            <View style={styles.section}>
              <Text style={styles.label}>Class workspace</Text>
              {classMemberships.map((m) => {
                const selected = m.workspace_id === activeWorkspaceId;
                return (
                  <TouchableOpacity
                    key={m.workspace_id}
                    style={[styles.wsRow, selected && styles.wsRowSelected]}
                    onPress={() => switchWorkspace(m.workspace_id)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.wsTextWrap}>
                      <Text style={[styles.wsName, selected && styles.wsNameSelected]}>
                        {m.workspace_name || "Untitled class"}
                      </Text>
                      {m.school_name ? <Text style={styles.wsSchool}>{m.school_name}</Text> : null}
                    </View>
                    {selected ? <Text style={styles.wsCheck}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            readOnly("Class workspace", profile?.workspaceName || "")
          )}

          {/* School is a property of the class, not of the member: it comes from the schools
              directory via the teacher's Manage Classes setting on the web. Read-only for both
              roles — an editable field here would write user_profiles.school_code, which nothing
              displays or uploads. */}
          {readOnly("School", profile?.schoolName || "")}
          {!profile?.schoolName ? (
            <Text style={styles.hint}>
              Your teacher has not set this class&apos;s school yet. Data cannot be uploaded until
              they do.
            </Text>
          ) : null}

          {isTeacher ? (
            <>
              <Text style={styles.label}>Class (Instructor)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Mr. Smith"
                value={instructor}
                onChangeText={(t) => setInstructor(sanitizeName(t))}
                maxLength={60}
                editable={!saving}
              />
            </>
          ) : (
            readOnly("Class (Instructor)", profile?.instructor || "")
          )}

          {/* Item 4: options come from the workspace's class structure, not free text. */}
          <ChipPicker
            label="Period"
            options={structure?.periods ?? []}
            value={period}
            onChange={setPeriod}
            disabled={saving}
          />
          <ChipPicker
            label="Group"
            options={groupsFor(structure, period || structure?.periods[0] || "")}
            value={group}
            onChange={setGroup}
            disabled={saving}
          />
          {loadingStructure ? (
            <Text style={styles.hint}>Checking the latest class options…</Text>
          ) : null}

          {!isTeacher ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>
                Your school and class name are set by your teacher. Pick the period and group you
                are working in — this is attached to every upload and cannot be changed afterwards.
              </Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.buttonPrimary, saving && styles.btnDisabled]}
            onPress={saveProfile}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity style={styles.buttonReset} onPress={disconnectDevice}>
        <Text style={styles.buttonResetText}>Disconnect Device</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 29,
    fontWeight: "bold",
    color: "#1a73e8",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    marginBottom: 32,
  },
  label: {
    fontSize: 17,
    color: "#333",
    marginBottom: 8,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    fontSize: 17,
    marginBottom: 20,
  },
  readonlyBox: {
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#f9f9f9",
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  readonlyText: {
    fontSize: 17,
    color: "#555",
  },
  noteBox: {
    backgroundColor: "#e8f0fe",
    borderRadius: 10,
    padding: 14,
    marginBottom: 24,
  },
  section: { marginBottom: 20 },
  hint: { fontSize: 14, color: "#9aa0a6", marginBottom: 16 },
  wsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#eceff4",
    backgroundColor: "#f5f7fb",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  wsRowSelected: { borderColor: "#1a73e8", backgroundColor: "#e8f0fe" },
  wsTextWrap: { flex: 1 },
  wsName: { fontSize: 17, fontWeight: "600", color: "#333" },
  wsNameSelected: { color: "#1a73e8" },
  wsSchool: { fontSize: 14, color: "#5f6368", marginTop: 2 },
  wsCheck: { fontSize: 20, color: "#1a73e8", fontWeight: "700" },
  emptyBox: {
    backgroundColor: "#fef7e0",
    borderRadius: 12,
    padding: 18,
    marginBottom: 24,
  },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#8a6d1f", marginBottom: 6 },
  emptyText: { fontSize: 15, color: "#8a6d1f", lineHeight: 21 },
  noteText: {
    fontSize: 14,
    color: "#1a73e8",
    lineHeight: 20,
  },
  error: {
    color: "#c5221f",
    fontSize: 15,
    marginBottom: 12,
  },
  buttonPrimary: {
    backgroundColor: "#1a73e8",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "600",
  },
  buttonReset: {
    borderWidth: 1.5,
    borderColor: "red",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonResetText: {
    color: "red",
    fontSize: 19,
    fontWeight: "600",
  },
  back: {
    alignItems: "center",
    padding: 8,
  },
  backText: {
    color: "#1a73e8",
    fontSize: 17,
  },
});
