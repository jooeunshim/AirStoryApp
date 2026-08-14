import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "./authContext";
import { manager, useBLE } from "./bleContext";

const SERVICE_UUID = "0000181A-0000-1000-8000-00805F9B34FB";
const CHAR_UUID = "00002A6E-0000-1000-8000-00805F9B34FB";

function RecordingBadge() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => setVisible(v => !v), 600);
    return () => clearInterval(interval);
  }, []);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: visible ? "#e53935" : "transparent", marginRight: 8 }} />
      <Text style={{ color: "#e53935", fontSize: 16, fontWeight: "600" }}>Recording</Text>
    </View>
  );
}

export default function Session() {
  const router = useRouter();
  const { connectedDevice } = useBLE();
  const { profile } = useAuth();

  // Account-synced profile (cached offline) stamps the session metadata into each CSV row.
  const className = profile?.instructor || "";
  const school = profile?.schoolCode || "";
  const period = profile?.period || "";
  const group = profile?.groupCode || "";

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setInitialized(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (initialized && !connectedDevice) {
        router.replace("/");
      }
    }, [connectedDevice, initialized])
  );

  const [sessionName, setSessionName] = useState("");
  const [siteType, setSiteType] = useState("Indoor");
  const [duration, setDuration] = useState(0);
  const [startTime] = useState(new Date().toISOString());

  const [pm25, setPm25] = useState(0);
  const [co, setCo] = useState(0);
  const [temp, setTemp] = useState(0);
  const [hum, setHum] = useState(0);
  const [lat, setLat] = useState(0);
  const [lon, setLon] = useState(0);
  const [battery, setBattery] = useState(0);
  const [isReceiving, setIsReceiving] = useState(false);

  const csvRows = useRef<string[]>([]);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setDuration(d => d + 1);
    }, 1000);

    if (connectedDevice) {
      connectAndListen(connectedDevice.id);
    }
    getLocation();

    return () => {
      clearInterval(timerRef.current);
      manager.stopDeviceScan();
    };
  }, []);

  const getLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    const loc = await Location.getCurrentPositionAsync({});
    setLat(loc.coords.latitude);
    setLon(loc.coords.longitude);
  };

  const connectAndListen = async (id: string) => {
    try {
      connectedDevice!.monitorCharacteristicForService(SERVICE_UUID, CHAR_UUID, (error, char) => {
        if (error || !char?.value) return;
        const decoded = atob(char.value);
        const parts = decoded.split(",");
        if (parts.length >= 4) {
          setPm25(parseFloat(parts[0]) || 0);
          setCo(parseFloat(parts[1]) || 0);
          setTemp(parseFloat(parts[2]) || 0);
          setHum(parseFloat(parts[3]) || 0);
          if (parts[4]) setBattery(parseFloat(parts[4]) || 0);          
          setIsReceiving(true);
        }
      });
    } catch (e) {
      console.log("BLE error:", e);
    }
  };

  useEffect(() => {
    if (temp === 0 && hum === 0) return;
    if (!sessionName.trim()) return;
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
    const sessionId = `${className}_${period}_${group}_${Date.now()}`;
    const row = `${ts},${date},${time},${sessionId},${sessionName},${school},${className},${period},${group},"${lat},${lon}",${lat},${lon},${siteType},${pm25},${co},${temp},${hum}`;
    csvRows.current.push(row);
  }, [pm25, co, temp, hum]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  const endSession = async () => {
    Alert.alert(
      "End Session",
      "What would you like to do?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => router.replace("/") },
        { text: "Save & Exit", onPress: () => saveAndExit() },
      ]
    );
  };

  const sanitizeName = (name: string) => {
    return name
      .replace(/[^a-zA-Z0-9가-힣\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 20)
      .toLowerCase();
  };

  const [saving, setSaving] = useState(false);

  const saveAndExit = async () => {
    if (saving) return;
    if (!sessionName.trim()) {
      Alert.alert("Session Name Required", "Please enter a session name before saving.");
      return;
    }
    setSaving(true);
    clearInterval(timerRef.current);
    const header = "Timestamp,Date,Time,Session ID,Session Name,School,Class (Instructor),Period,Group,Location,Latitude,Longitude,INDOOR/OUTDOOR,PM 2.5,CO,Temperature,Humidity";
    const csvContent = [header, ...csvRows.current].join("\n");
    const cleanSession = sanitizeName(sessionName);
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:T]/g, "").substring(0, 14);
    const fileName = `${cleanSession}_${dateStr}.csv`;
    const filePath = FileSystem.documentDirectory + fileName;
    await FileSystem.writeAsStringAsync(filePath, csvContent, { encoding: "utf8" });
    console.log("Saved to:", filePath);
    router.push("/history");
    setSaving(false);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>New Session</Text>
{connectedDevice && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <View style={styles.connectedBadge}>
            <Text style={styles.connectedText}>Device Connected: {connectedDevice.name}</Text>
          </View>
{battery > 0 && (
            <View style={[styles.connectedBadge, { 
              backgroundColor: 
                battery >= 4.2 ? "#e8f0fe" :
                Math.min(100, Math.max(0, Math.round(((battery - 3.0) / (4.2 - 3.0)) * 100))) <= 20 ? "#ffebee" :
                Math.min(100, Math.max(0, Math.round(((battery - 3.0) / (4.2 - 3.0)) * 100))) <= 25 ? "#fff3e0" :
                "#e6f4ea"
            }]}>
              <Text style={[styles.connectedText, { 
                color: 
                  battery >= 4.2 ? "#1a73e8" :
                  Math.min(100, Math.max(0, Math.round(((battery - 3.0) / (4.2 - 3.0)) * 100))) <= 20 ? "#c62828" :
                  Math.min(100, Math.max(0, Math.round(((battery - 3.0) / (4.2 - 3.0)) * 100))) <= 25 ? "#e65100" :
                  "#2e7d32"
              }]}>
{battery >= 4.2 
                  ? `🔋⚡ (${Math.min(100, Math.max(0, Math.round(((battery - 3.0) / (4.2 - 3.0)) * 100)))}%)`
                  : `🔋 ${Math.min(100, Math.max(0, Math.round(((battery - 3.0) / (4.2 - 3.0)) * 100)))}%`}              </Text>
            </View>
          )}
        </View>
      )}
      {isReceiving && <RecordingBadge />}

      <TextInput
        style={styles.input}
        placeholder="Session Name (e.g. Bus station)"
        value={sessionName}
        onChangeText={setSessionName}
      />

      <View style={styles.siteRow}>
        <Text style={styles.label}>Site type</Text>
        <TouchableOpacity
          style={[styles.siteBtn, siteType === "Indoor" && styles.siteBtnActive]}
          onPress={() => setSiteType("Indoor")}
        >
          <Text style={[styles.siteBtnText, siteType === "Indoor" && styles.siteBtnTextActive]}>Indoor</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.siteBtn, siteType === "Outdoor" && styles.siteBtnActive]}
          onPress={() => setSiteType("Outdoor")}
        >
          <Text style={[styles.siteBtnText, siteType === "Outdoor" && styles.siteBtnTextActive]}>Outdoor</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.info}>Start Time: {new Date(startTime).toLocaleString()}</Text>
      <Text style={styles.info}>Duration: {formatDuration(duration)}</Text>
      <Text style={styles.info}>Location: {lat.toFixed(4)}, {lon.toFixed(4)}</Text>

      <Text style={styles.sectionTitle}>Data Preview</Text>

      <View style={styles.dataGrid}>
        <View style={styles.dataCard}>
          <Text style={styles.dataValue}>{pm25}</Text>
          <Text style={styles.dataLabel}>PM2.5 ug/m3</Text>
        </View>
        <View style={styles.dataCard}>
          <Text style={styles.dataValue}>{co}</Text>
          <Text style={styles.dataLabel}>CO ppm</Text>
        </View>
        <View style={styles.dataCard}>
          <Text style={styles.dataValue}>{temp}</Text>
          <Text style={styles.dataLabel}>Temp C</Text>
        </View>
        <View style={styles.dataCard}>
          <Text style={styles.dataValue}>{hum}</Text>
          <Text style={styles.dataLabel}>Hum %</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.endButton} onPress={endSession}>
        <Text style={styles.endButtonText}>{saving ? "Saving..." : "End Session"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 24, paddingTop: 60 },
  header: { fontSize: 29, fontWeight: "bold", color: "#1a73e8", marginBottom: 20 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 12, fontSize: 17, marginBottom: 16 },
  siteRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  label: { fontSize: 17, color: "#333", marginRight: 8 },
  siteBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#ddd" },
  siteBtnActive: { backgroundColor: "#1a73e8", borderColor: "#1a73e8" },
  siteBtnText: { color: "#888", fontSize: 16 },
  siteBtnTextActive: { color: "#fff" },
  info: { fontSize: 16, color: "#555", marginBottom: 4 },
  sectionTitle: { fontSize: 19, fontWeight: "600", color: "#333", marginTop: 16, marginBottom: 12 },
  dataGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 24 },
  dataCard: { width: "46%", backgroundColor: "#f5f5f5", borderRadius: 12, padding: 16, alignItems: "center" },
  dataCardActive: { backgroundColor: "#1a73e8" },
  dataValue: { fontSize: 34, fontWeight: "bold", color: "#333" },
  dataLabel: { fontSize: 15, color: "#888", marginTop: 4 },
  batteryWarning: { backgroundColor: "#ffebee", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 16, width: "100%", alignItems: "center" },
  batteryWarningText: { color: "#c62828", fontSize: 16, fontWeight: "600" },
  connectedBadge: { backgroundColor: "#e6f4ea", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 16, alignSelf: "flex-start" },
  connectedText: { color: "#2e7d32", fontSize: 16, fontWeight: "600" },
  endButton: { backgroundColor: "#1a73e8", padding: 16, borderRadius: 12, alignItems: "center", marginBottom: 40 },
  endButtonText: { color: "#fff", fontSize: 19, fontWeight: "600" },
});