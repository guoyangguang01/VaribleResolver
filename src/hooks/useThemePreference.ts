import { useEffect, useState } from "react";
import {
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../lib/theme";

export function useThemePreference() {
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(readThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolvedTheme = resolveTheme(themePreference, systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#14171c" : "#f3f5f7",
      );
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    window.programStudio?.setTheme?.(themePreference);
  }, [resolvedTheme, themePreference]);

  return {
    themePreference,
    setThemePreference,
    resolvedTheme,
  };
}
