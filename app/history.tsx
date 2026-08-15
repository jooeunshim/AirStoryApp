import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { convertCsvToImportRows, fetchUploadedSessionCodes, getValidToken, parseCsvLine, uploadMeasurements } from "./airstoryApi";

const UPLOADED_IDS_KEY = "uploaded_session_ids";

interface Session {
  id: string;
  name: string;
  path: string;
}

export default function History() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [csvCache, setCsvCache] = useState<Record<string, string>>({});
  // uploadedIds is persisted to AsyncStorage so green checkmarks survive app restart.
  // Note: stored locally per device - won't sync across devices.
  const [uploadingIds, setUploadingIds] = useState<string[]>([]);
  const [uploadedIds, setUploadedIds] = useState<string[]>([]);

  useEffect(() => {
    loadSessions();
    loadUploadedIds();
    syncWithBackend();
  }, []);

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

  const syncWithBackend = async () => {
    try {
      const { token, workspaceId } = await getValidToken();
      const backendSessionCodes = await fetchUploadedSessionCodes(workspaceId, token);

      const stored = await AsyncStorage.getItem(UPLOADED_IDS_KEY);
      if (!stored) return;

      const localIds: string[] = JSON.parse(stored);
      const validIds = localIds.filter(id => backendSessionCodes.includes(id));

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

  const uploadSession = async (session: Session) => {
    if (uploadingIds.includes(session.id) || uploadedIds.includes(session.id)) {
      return;
    }

    try {
      setUploadingIds(prev => [...prev, session.id]);

      const className = (await AsyncStorage.getItem("className")) || "";
      const period = (await AsyncStorage.getItem("period")) || "";
      const group = (await AsyncStorage.getItem("group")) || "";

      if (!period || !group) {
        Alert.alert("Settings Required", "Please set your group in Settings first.");
        return;
      }

      const csvContent = await FileSystem.readAsStringAsync(session.path, { encoding: "utf8" });

      const sessionMetadata = {
        sessionCode: session.id,
        sessionName: formatName(session.name).name,
        school: "PHG01",
        instructor: className,
        period,
        group,
      };
      const rows = convertCsvToImportRows(csvContent, sessionMetadata);

      if (rows.length === 0) {
        Alert.alert("Empty CSV", "No data rows found in this session.");
        return;
      }

      const { token, workspaceId } = await getValidToken();
      await uploadMeasurements(workspaceId, token, rows);

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
                    onPress={() => uploadSession(item)}
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
          syncWithBackend();
        }}
      >
        <Text style={styles.buttonText}>Refresh</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonHome} onPress={() => router.replace("/")}>
        <Text style={styles.buttonHomeText}>Go to Home</Text>
      </TouchableOpacity>
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
});
