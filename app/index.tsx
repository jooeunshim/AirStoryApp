import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { logout } from "./api/auth";
import { useAuth } from "./authContext";
import { useBLE } from "./bleContext";

export default function Index() {
  const router = useRouter();
  const { connectedDevice } = useBLE();
  const { profile, activeMembership, hasClassWorkspace } = useAuth();

  // Profile is the source of truth (synced to the account); cached for offline launches.
  const school = profile?.schoolCode || "";
  const instructor = profile?.instructor || "";
  const period = profile?.period || "";
  const group = profile?.groupCode || "";
  const groupSet = Boolean(group);
  // Item 3: which class is active, read-only. Falls back to the cached name when offline.
  const className = activeMembership?.workspace_name || profile?.workspaceName || "";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AirStory</Text>
      <Text style={styles.subtitle}>TAMGU Lab</Text>
      {className ? <Text style={styles.className}>{className}</Text> : null}
      {school ? <Text style={styles.school}>{school}</Text> : null}
      {groupSet && period ? (
        <Text style={styles.groupInfo}>
          {instructor ? `${instructor} | ` : ""}Period {period} | Group {group}
        </Text>
      ) : null}

      {/* Item 7: only in Public/school aggregates — nothing is writable, so say so plainly
          instead of prompting for a group that cannot be saved. */}
      {!hasClassWorkspace ? (
        <View style={styles.warningBadge}>
          <Text style={styles.warningTitle}>No class yet</Text>
          <Text style={styles.warningText}>
            Your teacher needs to invite you to a class before you can record or upload data.
          </Text>
        </View>
      ) : !groupSet ? (
        <View style={styles.warningBadge}>
          <Text style={styles.warningTitle}>Group not set</Text>
          <Text style={styles.warningText}>
            Choose your period and group in Settings before starting a session.
          </Text>
          <TouchableOpacity style={styles.warningButton} onPress={() => router.push("/settings")}>
            <Text style={styles.warningButtonText}>Go to Settings →</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {connectedDevice ? (
        <View style={styles.connectedBadge}>
          <Text style={styles.connectedText}>Device Connected: {connectedDevice.name}</Text>
        </View>
      ) : (
        <View style={styles.disconnectedBadge}>
          <Text style={styles.disconnectedText}>No Device Connected</Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        {!connectedDevice ? (
          <TouchableOpacity
            style={styles.buttonPrimary}
            onPress={() => router.push("/connect")}
          >
            <Text style={styles.buttonText}>Connect Device</Text>
          </TouchableOpacity>
        ) : (
          // Recording is pointless without a class to upload into, so it is disabled rather
          // than allowed to produce data that can never leave the phone.
          <TouchableOpacity
            style={[styles.buttonPrimary, !hasClassWorkspace && styles.buttonDisabled]}
            onPress={() => router.push("/session")}
            disabled={!hasClassWorkspace}
          >
            <Text style={styles.buttonText}>New Session</Text>
          </TouchableOpacity>
        )}

        {/* History stays reachable without a class: previously recorded sessions are still
            viewable and exportable, only uploading is blocked. */}
        <TouchableOpacity
          style={styles.buttonPrimary}
          onPress={() => router.push("/history")}
        >
          <Text style={styles.buttonText}>View History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.buttonOutline}
          onPress={() => router.push("/settings")}
        >
          <Text style={styles.buttonOutlineText}>Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={async () => {
            // Clearing the Firebase session fires onAuthStateChanged; the router gate
            // then redirects to /login.
            await logout();
          }}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 38, fontWeight: "bold", color: "#1a73e8", marginBottom: 4 },
  subtitle: { fontSize: 22, color: "#333", marginBottom: 8 },
  className: { fontSize: 18, color: "#202124", fontWeight: "700", marginBottom: 2, textAlign: "center" },
  school: { fontSize: 16, color: "#888", marginBottom: 4, textAlign: "center" },
  groupInfo: { fontSize: 16, color: "#1a73e8", marginBottom: 16, fontWeight: "600" },
  warningBadge: { backgroundColor: "#fff3e0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16, width: "100%", alignItems: "center" },
  warningTitle: { color: "#e65100", fontSize: 17, fontWeight: "700", marginBottom: 4 },
  warningText: { color: "#e65100", fontSize: 16, fontWeight: "500", textAlign: "center", marginBottom: 12 },
  warningButton: { backgroundColor: "#e65100", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, alignItems: "center" },
  warningButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  connectedBadge: { backgroundColor: "#e6f4ea", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 24 },
  connectedText: { color: "#2e7d32", fontSize: 16, fontWeight: "600" },
  disconnectedBadge: { backgroundColor: "#f5f5f5", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 24 },
  disconnectedText: { color: "#888", fontSize: 16 },
  buttonContainer: { width: "100%", gap: 12 },
  buttonPrimary: { backgroundColor: "#1a73e8", padding: 16, borderRadius: 12, alignItems: "center" },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#fff", fontSize: 19, fontWeight: "600" },
  buttonOutline: { borderWidth: 1.5, borderColor: "#1a73e8", padding: 16, borderRadius: 12, alignItems: "center" },
  buttonOutlineText: { color: "#1a73e8", fontSize: 19, fontWeight: "600" },
  signOutBtn: { padding: 14, borderRadius: 12, alignItems: "center", marginTop: 4 },
  signOutText: { color: "#c5221f", fontSize: 15, fontWeight: "600" },
});