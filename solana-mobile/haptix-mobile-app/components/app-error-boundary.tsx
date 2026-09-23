import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

interface AppErrorBoundaryState {
  error: Error | null
}

/**
 * Turns a boot failure into something readable.
 *
 * Without this, anything thrown while the first screen renders unmounts the tree and
 * leaves a blank screen: no message, no stack, nothing to act on. That is exactly how a
 * missing native module or an unreachable chain module presents itself, so the failure
 * is indistinguishable from the app never loading at all.
 *
 * Deliberately dependency-free — no theme context, no app components, no custom fonts.
 * The boundary has to keep working when the provider tree or the font loader it wraps is
 * the thing that failed, so it falls back to hardcoded colours and the system font.
 */
export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Haptix] Unhandled error during render:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Haptix could not start</Text>
        <Text style={styles.subtitle}>
          The screen was blank because the error below had nowhere to be shown. Screenshot this — it is the whole
          diagnosis.
        </Text>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.mono}>{String(error.stack ?? error.message ?? error)}</Text>
        </ScrollView>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f17',
    paddingTop: 72,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 10,
  },
  title: {
    color: '#f4f6fb',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9aa4b8',
    fontSize: 14,
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#242c3d',
    borderRadius: 12,
    backgroundColor: '#131824',
  },
  scrollContent: {
    padding: 12,
  },
  mono: {
    color: '#ff9f9f',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
})
