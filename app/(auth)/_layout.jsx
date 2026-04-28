/**
 * app/(auth)/_layout.jsx
 *
 * FIX 1: Removed the artificial 100ms setTimeout delay. It served no real
 *         purpose and caused a flash of the loading spinner on every auth
 *         navigation. The Stack is now rendered immediately.
 *
 * FIX 2: Removed the unreachable `hasError` / error UI state. `setHasError`
 *         was never called anywhere in the component, making the error screen
 *         dead code. If you need error handling here in the future, wire it
 *         to a real async operation (e.g. a storage read) with a try/catch.
 */

import { Stack } from "expo-router";
import { useAndroidBackNavigation } from "../../hooks/useAndroidBackNavigation";

export default function AuthLayout() {
  useAndroidBackNavigation({ rootPath: "/(auth)/login" });

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
      }}
    />
  );
}



