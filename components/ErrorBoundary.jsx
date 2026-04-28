import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { reportError } from "../utils/logger";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    reportError(error, {
      message: "ErrorBoundary caught an unhandled error",
      extra: { componentStack: errorInfo?.componentStack ?? null },
      tags: { location: "error_boundary" },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            An unexpected error occurred. Please restart the app.
          </Text>
          {__DEV__ && this.state.error?.message ? (
            <Text style={styles.devMessage}>{this.state.error.message}</Text>
          ) : null}
          <TouchableOpacity
            style={styles.button}
            onPress={() =>
              this.setState((prev) => ({
                hasError: false,
                error: null,
                resetKey: prev.resetKey + 1,
              }))
            }
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return <View key={this.state.resetKey} style={{ flex: 1 }}>{this.props.children}</View>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 10,
  },
  message: {
    fontSize: 16,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 20,
  },
  devMessage: {
    fontSize: 13,
    color: "#991b1b",
    textAlign: "center",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default ErrorBoundary;
