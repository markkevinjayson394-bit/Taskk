import { createContext, useContext, useEffect, useState } from "react";
import { Appearance } from "react-native";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const systemTheme = Appearance.getColorScheme();
  const [theme, setTheme] = useState(systemTheme || "light");

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setTheme(colorScheme || "light");
    });
    return () => sub.remove();
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const isDark = theme === "dark"; // FIX #9: export isDark

  const colors =
    theme === "dark"
      ? {
          background: "#0f172a",
          card: "#1e293b",
          text: "#f8fafc",
          muted: "#94a3b8",
          border: "#334155",
          primary: "#3b82f6",
          danger: "#ef4444",
          success: "#22c55e",
          highlight: "#020617",
          dangerBg: "#1f1010",
        }
      : {
          background: "#f2f4f8",
          card: "#ffffff",
          text: "#0f172a",
          muted: "#555",
          border: "#ccc",
          primary: "#007bff",
          danger: "#dc3545",
          success: "#28a745",
          highlight: "#e7f0ff",
          dangerBg: "#fff5f5",
        };

  return (
    // FIX #9: added isDark to context value
    <ThemeContext.Provider value={{ theme, colors, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
