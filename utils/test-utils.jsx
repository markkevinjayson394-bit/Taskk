import { render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../context/ThemeContext";

function AllProviders({ children }) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function renderWithProviders(ui, options) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react-native";
export { renderWithProviders as render };
