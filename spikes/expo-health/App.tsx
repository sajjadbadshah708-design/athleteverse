// MVP Sprint-0 phone smoke test only. No business rules are duplicated in the app.
// It calls the same versioned public API endpoint as the web client.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '') ?? '';
const endpoint = configured ? `${configured}/api/v1/health` : '';

type Result = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; detail: string } | { kind: 'error'; detail: string };

export default function App() {
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  async function check() {
    if (!endpoint) {
      setResult({ kind: 'error', detail: 'Set EXPO_PUBLIC_API_URL to a reachable HTTPS API origin (or a LAN URL for local testing).' });
      return;
    }
    setResult({ kind: 'loading' });
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const response = await fetch(endpoint, { method: 'GET', headers: { 'X-Client': Platform.OS === 'ios' ? 'ios' : 'android', 'X-App-Version': '0.1.0' }, signal: ctrl.signal });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult({ kind: 'success', detail: JSON.stringify(data, null, 2) });
    } catch (error) {
      setResult({ kind: 'error', detail: error instanceof Error ? error.message : 'Connection failed' });
    } finally {
      clearTimeout(timeout);
    }
  }

  useEffect(() => { void check(); }, []);

  return <SafeAreaView style={styles.safe}>
    <View style={styles.content}>
      <Text style={styles.title}>AthleteVerse</Text>
      <Text style={styles.subtitle}>Expo ↔ shared REST API connectivity smoke test</Text>
      <Text selectable style={styles.url}>{endpoint || 'API URL not configured'}</Text>
      {result.kind === 'loading' && <ActivityIndicator accessibilityLabel="Checking API" />}
      {result.kind === 'success' && <Text selectable style={styles.success}>Connected\n{result.detail}</Text>}
      {result.kind === 'error' && <Text selectable style={styles.error}>Connection unavailable\n{result.detail}</Text>}
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => void check()}>
        <Text style={styles.buttonText}>Retry API check</Text>
      </Pressable>
      <Text style={styles.note}>This is only the MVP phone build-chain check. Registration, booking, staff operations, and notifications are post-MVP mobile screens.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  content: { flex: 1, justifyContent: 'center', gap: 20, paddingHorizontal: 28 },
  title: { fontSize: 32, fontWeight: '700', color: '#203a5e' },
  subtitle: { fontSize: 17, color: '#334155' },
  url: { fontSize: 13, color: '#475569' },
  success: { color: '#176044', fontSize: 16 },
  error: { color: '#991b1b', fontSize: 16 },
  button: { borderRadius: 10, padding: 16, backgroundColor: '#203a5e', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  note: { color: '#64748b', fontSize: 13, lineHeight: 20 },
});
