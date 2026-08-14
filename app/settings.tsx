import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

export default function Settings() {
  const router = useRouter();
  const { connectedDevice, setConnectedDevice } = useBLE();
  const { profile, role, refreshMe } = useAuth();
  const isTeacher = role === "teacher";
  const insets = useSafeAreaInsets();

  // Editable copies (teacher only). Period is synced in the web's "P#" format; we edit just the digits.
  const [school, setSchool] = useState("");
  const [instructor, setInstructor] = useState("");
  const [periodDigits, setPeriodDigits] = useState("");
  const [group, setGroup] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Seed the form from the account profile whenever it changes (login, refresh, save).
  useEffect(() => {
    setSchool(profile?.schoolCode || "");
    setInstructor(profile?.instructor || "");
    setPeriodDigits((profile?.period || "").replace(/^[Pp]/, ""));
    setGroup(profile?.groupCode || "");
  }, [profile?.schoolCode, profile?.instructor, profile?.period, profile?.groupCode]);

  // Free-text names: strip only CSV-breaking characters (matches the web sanitizer).
  const sanitizeName = (t: string) => t.replace(/[",\n\r]/g, "").substring(0, 60);
  const sanitizeGroup = (t: string) => t.replace(/[^a-zA-Z0-9가-힣]/g, "").substring(0, 16);

  const saveProfile = async () => {
    setError("");
    setSaving(true);
    try {
      const period = periodDigits ? `P${periodDigits}` : "";
      await updateMyProfile({
        schoolCode: school.trim(),
        instructor: instructor.trim(),
        period,
        groupCode: group.trim(),
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
    >
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>
        {isTeacher
          ? "Your class details, synced to your account."
          : "Set by your teacher, synced to your account."}
      </Text>

      {readOnly("Name", profile?.fullName || "")}

      {isTeacher ? (
        <>
          <Text style={styles.label}>School</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Lincoln High School"
            value={school}
            onChangeText={(t) => setSchool(sanitizeName(t))}
            maxLength={60}
            editable={!saving}
          />

          <Text style={styles.label}>Class (Instructor)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mr. Smith"
            value={instructor}
            onChangeText={(t) => setInstructor(sanitizeName(t))}
            maxLength={60}
            editable={!saving}
          />

          <Text style={styles.label}>Period</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 1"
            value={periodDigits}
            onChangeText={(t) => setPeriodDigits(t.replace(/[^0-9]/g, "").substring(0, 2))}
            keyboardType="numeric"
            maxLength={2}
            editable={!saving}
          />

          <Text style={styles.label}>Group</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. G1"
            value={group}
            onChangeText={(t) => setGroup(sanitizeGroup(t))}
            maxLength={16}
            editable={!saving}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.buttonPrimary, saving && styles.btnDisabled]}
            onPress={saveProfile}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          {readOnly("School", profile?.schoolCode || "")}
          {readOnly("Class (Instructor)", profile?.instructor || "")}
          {readOnly("Period", profile?.period || "")}
          {readOnly("Group", profile?.groupCode || "")}
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              Your school, period, and group are assigned by your teacher. Ask your teacher to update
              them if anything looks wrong.
            </Text>
          </View>
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
