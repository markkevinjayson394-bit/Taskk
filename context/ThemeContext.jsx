import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import { Colors } from "../constants/theme";
import { warnIfDev } from "../utils/logger";

const ThemeContext = createContext();
const THEME_PREFERENCE_KEY = "theme_preference_v1";

const getSystemTheme = () => Appearance.getColorScheme() || "light";
const getThemePreferenceStorageKey = (uid) =>
  uid ? `${THEME_PREFERENCE_KEY}_${uid}` : THEME_PREFERENCE_KEY;

export function ThemeProvider({ children, uid }) {
  const [theme, setTheme] = useState(getSystemTheme());
  const [followSystemTheme, setFollowSystemTheme] = useState(true);

  useEffect(() => {
    let active = true;

    const hydrateThemePreference = async () => {
      const storageKey = getThemePreferenceStorageKey(uid);

      try {
        const savedTheme = await AsyncStorage.getItem(storageKey);
        if (!active) return;

        if (savedTheme === "light" || savedTheme === "dark") {
          setTheme(savedTheme);
          setFollowSystemTheme(false);
          return;
        }
      } catch (err) {
        warnIfDev("ThemeProvider: failed to hydrate theme preference:", err);
      }

      if (!active) return;
      setTheme(getSystemTheme());
      setFollowSystemTheme(true);
    };

    hydrateThemePreference();

    return () => {
      active = false;
    };
  }, [uid]);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (!followSystemTheme) return;
      setTheme(colorScheme || "light");
    });
    return () => sub.remove();
  }, [followSystemTheme]);

  const toggleTheme = async () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    const storageKey = getThemePreferenceStorageKey(uid);
    setTheme(nextTheme);
    setFollowSystemTheme(false);

    try {
      await AsyncStorage.setItem(storageKey, nextTheme);
    } catch (err) {
      warnIfDev("ThemeProvider: failed to save theme preference:", err);
    }
  };

  const resetTheme = async () => {
    const storageKey = getThemePreferenceStorageKey(uid);
    const systemTheme = getSystemTheme();

    try {
      await AsyncStorage.removeItem(storageKey);
    } catch (err) {
      warnIfDev("ThemeProvider: failed to clear theme preference:", err);
    }

    setTheme(systemTheme);
    setFollowSystemTheme(true);
  };

  const isDark = theme === "dark";
  const colors = useMemo(
    () => (theme === "dark" ? Colors.dark : Colors.light),
    [theme]
  );

  return (
    <ThemeContext.Provider
      value={{ theme, colors, toggleTheme, resetTheme, isDark }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
