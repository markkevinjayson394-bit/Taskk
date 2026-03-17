import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState } from "react";
import { Appearance } from "react-native";

const ThemeContext = createContext();
const THEME_PREFERENCE_KEY = "theme_preference_v1";

const getSystemTheme = () => Appearance.getColorScheme() || "light";

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getSystemTheme());
  const [followSystemTheme, setFollowSystemTheme] = useState(true);

  useEffect(() => {
    let active = true;

    const hydrateThemePreference = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
        if (!active) return;

        if (savedTheme === "light" || savedTheme === "dark") {
          setTheme(savedTheme);
          setFollowSystemTheme(false);
          return;
        }
      } catch {}

      if (!active) return;
      setTheme(getSystemTheme());
      setFollowSystemTheme(true);
    };

    hydrateThemePreference();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (!followSystemTheme) return;
      setTheme(colorScheme || "light");
    });
    return () => sub.remove();
  }, [followSystemTheme]);

  const toggleTheme = async () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    setFollowSystemTheme(false);
    try {
      await AsyncStorage.setItem(THEME_PREFERENCE_KEY, nextTheme);
    } catch {}
  };

  const isDark = theme === "dark";

  const colors =
    theme === "dark"
      ? {
          background: "#0b1220",
          card: "#111c2e",
          surface: "#0f172a",
          text: "#f8fafc",
          muted: "#9fb0c7",
          border: "#24324a",
          primary: "#3b82f6",
          danger: "#ef4444",
          success: "#16a34a",
          highlight: "#1a2740",
          dangerBg: "#1f1010",
          shadow: "rgba(2,6,23,0.6)",
        }
      : {
          background: "#f3f6fb",
          card: "#ffffff",
          surface: "#f8fbff",
          text: "#0f172a",
          muted: "#64748b",
          border: "#dbe3ee",
          primary: "#2563eb",
          danger: "#ef4444",
          success: "#16a34a",
          highlight: "#eaf2ff",
          dangerBg: "#fff5f5",
          shadow: "rgba(15,23,42,0.08)",
        };

  return (
    <ThemeContext.Provider value={{ theme, colors, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
