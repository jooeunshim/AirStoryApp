import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { convertCsvToImportRows, fetchUploadedSessionCodes, parseCsvLine, uploadMeasurements } from "./airstoryApi";
import { updateMyProfile } from "./api/auth";
import { useAuth } from "./authContext";
import { ChipPicker } from "./components/ChipPicker";
import { groupsFor, normalizeGroup, normalizePeriod, useClassStructure } from "./useClassStructure";

const UPLOADED_IDS_KEY = "uploaded_session_ids";
/** Placement confirmed at the last successful upload, per workspace: Record<wsId, "P1|G2">. */
const LAST_PLACEMENT_KEY = "airstory_last_upload_placement";

interface Session {
  id: string;
  name: string;
  path: string;
}

export default function History() {
  const router = useRouter();
  const { profile, activeWorkspaceId, activeMembership, cachedWorkspaceIds, refreshMe } = useAuth();
  const { structure } = useClassStructure(activeWorkspaceId);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [csvCache, setCsvCache] = useState<Record<string, string>>({});
  // uploadedIds is persisted to AsyncStorage so green checkmarks survive app restart.
  // Note: stored locally per device - won't sync across devices.
  const [uploadingIds, setUploadingIds] = useState<string[]>([]);
  const [uploadedIds, setUploadedIds] = useState<string[]>([]);

  // Upload confirmation (item 5): the session awaiting confirmation, plus the placement being
  // confirmed for it.
  const [pendingSession, setPendingSession] = useState<Session | null>(null);
  const [confirmPeriod, setConfirmPeriod] = useState("");
  const [confirmGroup, setConfirmGroup] = useState("");

  const activeClassName = activeMembership?.workspace_name || profile?.workspaceName || "";

  useEffect(() => {
    loadSessions();
    loadUploadedIds();
  }, []);

  // Reconcile against every workspace with cached data, not just the active one: a session
  // uploaded to another class must not lose its checkmark when that class isn't selected.
  useEffect(() => {
    const ids = Array.from(new Set([...cachedWorkspaceIds, activeWorkspaceId].filter(Boolean)));
    if (ids.length) syncWithBackend(ids as string[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, cachedWorkspaceIds.join(",")]);

  const loadUploadedIds = async () => {
    try {
      const stored = await AsyncStorage.getItem(UPLOADED_IDS_KEY);
      if (stored) {
        const ids = JSON.parse(stored) as string[];
        setUploadedIds(ids);
      }
    } catch (e) {
      console.log("Failed to load uploaded ids:", e);
    }
  };

  const syncWithBackend = async (workspaceIds: string[]) => {
    try {
      const stored = await AsyncStorage.getItem(UPLOADED_IDS_KEY);
      if (!stored) return;

      // Union across workspaces. A session code found in ANY of them is still uploaded; only a
      // code absent everywhere was genuinely deleted. Querying one workspace in isolation would
      // wrongly clear checkmarks for data that lives in another class.
      const results = await Promise.all(
        workspaceIds.map((id) => fetchUploadedSessionCodes(id).catch(() => null))
      );
      // A failed lookup (offline, permissions) yields null — treat the whole pass as inconclusive
      // rather than deleting checkmarks on incomplete information.
      if (results.some((r) => r === null)) return;

      const known = new Set(results.flat() as string[]);
      const localIds: string[] = JSON.parse(stored);
      const validIds = localIds.filter((id) => known.has(id));

      if (validIds.length !== localIds.length) {
        setUploadedIds(validIds);
        await AsyncStorage.setItem(UPLOADED_IDS_KEY, JSON.stringify(validIds));
        console.log(`Synced with backend: removed ${localIds.length - validIds.length} stale uploaded ids`);
      }
    } catch (e) {
      console.log("Failed to sync with backend:", e);
    }
  };

  const loadSessions = async () => {
    try {
      const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory!);
      const csvFiles = files.filter(f => f.endsWith(".csv"));
      const extractDateKey = (fileName: string) => {
        const withoutExt = fileName.replace(".csv", "");
        const lastUnderscore = withoutExt.lastIndexOf("_");
        if (lastUnderscore === -1) return "";
        const dateStr = withoutExt.substring(lastUnderscore + 1);
        return dateStr.length === 14 ? dateStr : "";
      };
      csvFiles.sort((a, b) => extractDateKey(b).localeCompare(extractDateKey(a)));
      const loaded = csvFiles.map(f => ({
        id: f,
        name: f.replace("session_", "").replace(".csv", ""),
        path: FileSystem.documentDirectory + f,
      }));
      setSessions(loaded);
    } catch (e) {
      console.log("Error loading sessions:", e);
    }
  };

  const shareSession = async (session: Session) => {
    try {
      await Sharing.shareAsync(session.path);
    } catch (e) {
      console.log("Share error:", e);
    }
  };

  const toggleExpand = async (session: Session) => {
    if (expandedIds.includes(session.id)) {
      setExpandedIds(prev => prev.filter(id => id !== session.id));
      return;
    }
    if (!(session.id in csvCache)) {
      try {
        const content = await FileSystem.readAsStringAsync(session.path, { encoding: "utf8" });
        setCsvCache(prev => ({ ...prev, [session.id]: content }));
      } catch (e) {
        console.log("Read CSV error:", e);
        setCsvCache(prev => ({ ...prev, [session.id]: "Failed to load data" }));
      }
    }
    setExpandedIds(prev => [...prev, session.id]);
  };

  const deleteSession = async (session: Session) => {
    Alert.alert(
      "Delete Session",
      "Are you sure you want to delete this session?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await FileSystem.deleteAsync(session.path);
              setExpandedIds(prev => prev.filter(id => id !== session.id));
              setCsvCache(prev => {
                const next = { ...prev };
                delete next[session.id];
                return next;
              });
              const updatedIds = uploadedIds.filter(id => id !== session.id);
              setUploadedIds(updatedIds);
              await AsyncStorage.setItem(UPLOADED_IDS_KEY, JSON.stringify(updatedIds));
              loadSessions();
            } catch (e) {
              console.log("Delete error:", e);
            }
          }
        }
      ]
    );
  };

  const readLastPlacement = async (workspaceId: string): Promise<string | null> => {
    try {
      const raw = await AsyncStorage.getItem(LAST_PLACEMENT_KEY);
      if (!raw) return null;
      return (JSON.parse(raw) as Record<string, string>)[workspaceId] ?? null;
    } catch {
      return null;
    }
  };

  const writeLastPlacement = async (workspaceId: string, key: string) => {
    try {
      const raw = await AsyncStorage.getItem(LAST_PLACEMENT_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      map[workspaceId] = key;
      await AsyncStorage.setItem(LAST_PLACEMENT_KEY, JSON.stringify(map));
    } catch {
      // Losing this only means the next upload asks for confirmation again — harmless.
    }
  };

  /**
   * Entry point for the Upload button. Decides whether the placement needs confirming before the
   * upload commits: always on the first upload to a workspace, and whenever period/group differ
   * from the last confirmed pair. Unchanged placement uploads straight through so a student
   * uploading several sessions in a row isn't prompted every time.
   */
  const beginUpload = async (session: Session) => {
    if (uploadingIds.includes(session.id) || uploadedIds.includes(session.id)) return;

    if (!activeWorkspaceId) {
      Alert.alert("No class workspace", "You are not in a class yet, so there is nowhere to upload.");
      return;
    }

    const period = normalizePeriod(profile?.period);
    const group = normalizeGroup(profile?.groupCode);

    if (!period || !group) {
      Alert.alert("Set your period and group", "Choose your period and group in Settings first.");
      return;
    }

    const last = await readLastPlacement(activeWorkspaceId);
    if (last === `${period}|${group}`) {
      await performUpload(session, period, group);
      return;
    }

    setConfirmPeriod(period);
    setConfirmGroup(group);
    setPendingSession(session);
  };

  /**
   * Commit the upload with an explicit placement. Period/group are forced onto every row, so what
   * is confirmed here is exactly what lands — and it cannot be corrected afterwards, since no
   * backend endpoint rewrites period/group on an existing session.
   */
  const performUpload = async (session: Session, period: string, group: string) => {
    if (!activeWorkspaceId) return;
    try {
      setUploadingIds(prev => [...prev, session.id]);

      const csvContent = await FileSystem.readAsStringAsync(session.path, { encoding: "utf8" });

      const sessionMetadata = {
        sessionCode: session.id,
        sessionName: formatName(session.name).name,
        school: "PHG01",
        instructor: profile?.instructor || "",
        period,
        group,
      };
      const rows = convertCsvToImportRows(csvContent, sessionMetadata);

      if (rows.length === 0) {
        Alert.alert("Empty CSV", "No data rows found in this session.");
        return;
      }

      await uploadMeasurements(activeWorkspaceId, rows);
      await writeLastPlacement(activeWorkspaceId, `${period}|${group}`);

      // If the confirmed placement differs from the stored profile, persist it so later sessions
      // are stamped correctly at collection time. Best-effort: the upload already succeeded.
      if (period !== normalizePeriod(profile?.period) || group !== normalizeGroup(profile?.groupCode)) {
        updateMyProfile({ workspaceId: activeWorkspaceId, period, groupCode: group })
          .then(() => refreshMe())
          .catch(() => {});
      }

      setUploadedIds(prev => {
        const newIds = [...prev, session.id];
        AsyncStorage.setItem(UPLOADED_IDS_KEY, JSON.stringify(newIds)).catch(e =>
          console.log("Failed to save uploaded ids:", e)
        );
        return newIds;
      });
      Alert.alert("Success", `Uploaded ${rows.length} measurements successfully!`);
    } catch (e: any) {
      console.log("Upload error:", e);
      Alert.alert("Upload failed", e?.message || "Unknown error occurred.");
    } finally {
      setUploadingIds(prev => prev.filter(id => id !== session.id));
    }
  };

  const confirmAndUpload = async () => {
    const session = pendingSession;
    if (!session) return;
    setPendingSession(null);
    await performUpload(session, confirmPeriod, confirmGroup);
  };

  const filterCsvForPreview = (csvData: string): string => {
    const previewColumns = ["Timestamp", "Period", "Group", "PM 2.5", "CO", "Temperature", "Humidity"];
    const lines = csvData.split("\n");
    if (lines.length === 0) return "";
    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    const indices = previewColumns.map(col => headers.indexOf(col));
    return lines
      .map(line => {
        const cells = parseCsvLine(line);
        return indices.map(i => (i === -1 ? "" : (cells[i] ?? ""))).join(",");
      })
      .join("\n");
  };

  const formatName = (fileName: string) => {
    const withoutExt = fileName.replace(".csv", "");
    const lastUnderscore = withoutExt.lastIndexOf("_");
    if (lastUnderscore !== -1) {
      const dateStr = withoutExt.substring(lastUnderscore + 1);
      const sessionName = withoutExt.substring(0, lastUnderscore).replace(/_/g, " ");
      if (dateStr.length === 14) {
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const hour = dateStr.substring(8, 10);
        const min = dateStr.substring(10, 12);
        const dateFormatted = `${year}. ${month}. ${day}. ${hour}:${min}`;
        return { name: sessionName, date: dateFormatted };
      }
    }
    return { name: withoutExt, date: "" };
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Session History</Text>

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No sessions yet</Text>
        }
        renderItem={({ item }) => {
          const isExpanded = expandedIds.includes(item.id);
          const csvContent = csvCache[item.id];
          return (
            <View style={styles.sessionWrapper}>
              <View style={styles.sessionItem}>
                <TouchableOpacity style={styles.sessionInfo} onPress={() => toggleExpand(item)}>
                  <View style={styles.sessionHeaderRow}>
                    <View
                      style={[
                        styles.statusDot,
                        uploadedIds.includes(item.id) ? styles.statusDotUploaded : styles.statusDotPending,
                      ]}
                    />
                    <Text style={styles.sessionName}>{formatName(item.name).name}</Text>
                  </View>
                  <Text style={styles.sessionTime}>{formatName(item.name).date}</Text>
                  <Text style={styles.exportText}>Tap to view data</Text>
                </TouchableOpacity>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <TouchableOpacity
                    onPress={() => beginUpload(item)}
                    style={styles.iconBtn}
                    disabled={uploadingIds.includes(item.id) || uploadedIds.includes(item.id)}
                  >
                    {uploadingIds.includes(item.id) ? (
                      <ActivityIndicator size="small" color="#1a73e8" />
                    ) : uploadedIds.includes(item.id) ? (
                      <Ionicons name="cloud-done-outline" size={22} color="#34a853" />
                    ) : (
                      <Ionicons name="cloud-upload-outline" size={22} color="#1a73e8" />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => shareSession(item)} style={styles.iconBtn}>
                    <Ionicons name="share-social-outline" size={22} color="#1a73e8" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteSession(item)} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={22} color="red" />
                  </TouchableOpacity>
                </View>
              </View>
              {isExpanded && (
                <View style={styles.csvContainer}>
                  <ScrollView style={styles.csvVertical} nestedScrollEnabled>
                    <ScrollView horizontal nestedScrollEnabled>
                      <Text style={styles.csvText}>
                        {csvContent ? filterCsvForPreview(csvContent) : "Loading..."}
                      </Text>
                    </ScrollView>
                  </ScrollView>
                </View>
              )}
            </View>
          );
        }}
      />

      <TouchableOpacity
        style={styles.buttonPrimary}
        onPress={() => {
          loadSessions();
          const ids = Array.from(new Set([...cachedWorkspaceIds, activeWorkspaceId].filter(Boolean)));
          if (ids.length) syncWithBackend(ids as string[]);
        }}
      >
        <Text style={styles.buttonText}>Refresh</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonHome} onPress={() => router.replace("/")}>
        <Text style={styles.buttonHomeText}>Go to Home</Text>
      </TouchableOpacity>

      {/* Item 5: last chance to fix the placement — nothing can change it after upload. */}
      <Modal
        visible={pendingSession !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingSession(null)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Confirm upload</Text>
              <Text style={styles.modalBody}>
                This data will be attached to the period and group below. It cannot be changed after
                uploading.
              </Text>

              {/* Item 3: which class this lands in, display only. */}
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Class</Text>
                <Text style={styles.modalRowValue}>{activeClassName || "—"}</Text>
              </View>
              <View style={styles.modalRow}>
                <Text style={styles.modalRowLabel}>Session</Text>
                <Text style={styles.modalRowValue} numberOfLines={1}>
                  {pendingSession ? formatName(pendingSession.name).name : ""}
                </Text>
              </View>

              <View style={styles.modalPickers}>
                <ChipPicker
                  label="Period"
                  options={structure?.periods ?? []}
                  value={confirmPeriod}
                  onChange={setConfirmPeriod}
                />
                <ChipPicker
                  label="Group"
                  options={groupsFor(structure, confirmPeriod || structure?.periods[0] || "")}
                  value={confirmGroup}
                  onChange={setConfirmGroup}
                />
              </View>

              <TouchableOpacity
                style={[styles.buttonPrimary, (!confirmPeriod || !confirmGroup) && styles.btnDisabled]}
                onPress={confirmAndUpload}
                disabled={!confirmPeriod || !confirmGroup}
              >
                <Text style={styles.buttonText}>Upload to {confirmGroup || "…"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setPendingSession(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 29,
    fontWeight: "bold",
    color: "#1a73e8",
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  empty: {
    textAlign: "center",
    color: "#888",
    marginTop: 40,
    fontSize: 17,
  },
  sessionWrapper: {
    marginBottom: 10,
  },
  sessionItem: {
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  exportText: {
    fontSize: 14,
    color: "#1a73e8",
    marginTop: 4,
  },
  iconBtn: {
    padding: 8,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotPending: {
    backgroundColor: "#e74c3c",
  },
  statusDotUploaded: {
    backgroundColor: "#34a853",
  },
  sessionName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  sessionTime: {
    fontSize: 15,
    color: "#888",
    marginTop: 4,
  },
  csvContainer: {
    backgroundColor: "#fafafa",
    borderRadius: 8,
    marginTop: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  csvVertical: {
    maxHeight: 300,
  },
  csvText: {
    fontFamily: "Courier",
    fontSize: 15,
    color: "#333",
  },
  buttonPrimary: {
    backgroundColor: "#1a73e8",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonText: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "600",
  },
  buttonHome: {
    borderWidth: 1.5,
    borderColor: "#1a73e8",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonHomeText: {
    color: "#1a73e8",
    fontSize: 19,
    fontWeight: "600",
  },
  btnDisabled: { opacity: 0.5 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  modalScroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#fff", borderRadius: 20, padding: 22 },
  modalTitle: { fontSize: 22, fontWeight: "800", color: "#202124", marginBottom: 8 },
  modalBody: { fontSize: 15, color: "#5f6368", lineHeight: 21, marginBottom: 18 },
  modalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f3f4",
  },
  modalRowLabel: { fontSize: 15, color: "#5f6368" },
  modalRowValue: { fontSize: 15, fontWeight: "600", color: "#202124", flexShrink: 1 },
  modalPickers: { marginTop: 18 },
  modalCancel: { paddingVertical: 14, alignItems: "center" },
  modalCancelText: { color: "#5f6368", fontSize: 16, fontWeight: "600" },
});
