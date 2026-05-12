import { act, waitFor } from "@testing-library/react-native";
import RootLayout from "../../app/_layout";
import { render } from "../../utils/test-utils";

const testState = {
  role: "student",
  eulaAccepted: true,
  onboardingCompleted: true,
  docExists: true,
};

const mockReplace = jest.fn();

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (Component) => Component,
  setUser: jest.fn(),
  captureException: jest.fn(),
  mobileReplayIntegration: jest.fn(() => "mobileReplay"),
  feedbackIntegration: jest.fn(() => "feedback"),
}));

jest.mock("expo-constants", () => ({
  appOwnership: "expo",
  expoConfig: { extra: { sentryDsn: "" } },
}));

jest.mock("expo-updates", () => ({
  isEnabled: false,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock("../../config/firebase", () => ({
  app: {},
  db: {},
}));

jest.mock("firebase/firestore", () => ({
  __esModule: true,
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(),
}));

// FIX: mockSignOut must be defined INSIDE the jest.mock factory.
// jest.mock() is hoisted to the top of the file by babel-jest, so any
// module-scope variable referenced in the factory (like a `const mockSignOut`
// declared below) is in the temporal dead zone at hoist time — it resolves
// to undefined. That makes `signOut` undefined in the mock module, so calling
// it inside resolveAuthenticatedRoute throws a TypeError, which is silently
// caught and falls through to "/(tabs)/home" without ever invoking the mock.
//
// Defining it inside the factory and retrieving it with jest.requireMock()
// ensures the same jest.fn() reference is used both by the mock module and
// by the test assertions.
jest.mock("firebase/auth", () => ({
  __esModule: true,
  getAuth: jest.fn(() => ({})),
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn().mockResolvedValue(undefined),
}));

// Retrieve the already-created mock function so tests can assert on it.
// This must be below jest.mock() but that's fine — requireMock is not hoisted.
const mockSignOut = jest.requireMock("firebase/auth").signOut;

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  bootstrapDeadlineAlarmChannel: jest.fn().mockResolvedValue(undefined),
  DEADLINE_NOTIF_TYPE: "deadline_alarm",
  ACTION_MARK_DONE: "markDone",
  ACTION_NOT_DONE: "notDone",
  handleDeadlineAlarmResponse: jest.fn(),
}));

jest.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }) => children,
  useTheme: () => ({ colors: {}, isDark: false }),
}));

jest.mock("expo-router", () => {
  const React = require("react");

  function Stack({ children }) {
    return React.createElement(React.Fragment, null, children);
  }
  Stack.Screen = function Screen() {
    return null;
  };

  return {
    useRouter: () => ({ replace: mockReplace }),
    Stack,
  };
});

// ROOT CAUSE FIX: __esModule: true is required here.
//
// _layout.jsx imports AsyncStorage as a default import:
//   import AsyncStorage from "@react-native-async-storage/async-storage";
//
// Without __esModule: true, Jest treats the mock factory's return value as a
// CommonJS module, so the "default export" becomes the entire object:
//   AsyncStorage === { default: { getItem, ... } }
//   AsyncStorage.getItem === undefined   ← throws when called
//
// The throw is silently caught by the try/catch in resolveAuthenticatedRoute,
// which falls through to the error-fallback route "/(tabs)/home" every time —
// making the EULA, admin, and missing-doc tests all appear to pass the EULA
// check and reach the wrong branch.
//
// With __esModule: true, Jest unwraps .default correctly:
//   AsyncStorage === { getItem, setItem, removeItem }  ✓
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key) => {
      if (key === "eula_v1") {
        return Promise.resolve(testState.eulaAccepted ? "true" : null);
      }
      return Promise.resolve(null);
    }),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../utils/onboarding", () => ({
  __esModule: true,
  getPostOnboardingRoute: jest.fn(
    (role = "student") => (role === "admin" ? "/(admin)/home" : "/(tabs)/home")
  ),
  getTutorialRoute: jest.fn(
    (role = "student") =>
      `/tutorial?role=${role === "admin" ? "admin" : "student"}`
  ),
  hasCompletedOnboarding: jest.fn(() =>
    Promise.resolve(testState.onboardingCompleted)
  ),
}));

jest.mock("../../utils/nativeAlarm", () => ({
  ensureNativeAlarmPermissions: jest.fn().mockResolvedValue({
    exactAlarm: { status: "unsupported", value: true },
    fullScreenIntent: { status: "unsupported", value: true },
  }),
  getPendingAlarmAction: jest.fn().mockResolvedValue(null),
  clearPendingAlarmAction: jest.fn().mockResolvedValue(undefined),
  isIgnoringBatteryOptimizations: jest
    .fn()
    .mockResolvedValue({ status: "unsupported", value: true }),
  rawNativeAlarmModule: null,
  requestIgnoreBatteryOptimizations: jest.fn(),
}));

jest.mock("../../utils/overdueAutoLaunch", () => ({
  checkAndAutoLaunchOverdueAlarm: jest.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wire onAuthStateChanged to fire `user` asynchronously on the next microtask.
 * Must be called BEFORE render() so the component picks up this implementation
 * when it subscribes inside the bootstrap useEffect.
 */
function mockAuthUser(authModule, user) {
  authModule.onAuthStateChanged.mockImplementationOnce((_auth, callback) => {
    Promise.resolve().then(() => callback(user));
    return jest.fn(); // unsubscribe no-op
  });
}

/**
 * Flush the full async chain for resolveAuthenticatedRoute:
 *   auth callback → AsyncStorage.getItem → getDoc → hasCompletedOnboarding →
 *   resolveRoute → router.replace
 *
 * 150ms is enough for all awaited steps to resolve in the fake-timer-free
 * test environment while keeping the suite fast.
 */
async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Auth flow", () => {
  let authModule;
  let firestoreModule;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset to safe defaults. Each test mutates only what it needs.
    testState.role = "student";
    testState.docExists = true;
    testState.eulaAccepted = true;
    testState.onboardingCompleted = true;

    authModule = require("firebase/auth");
    firestoreModule = require("firebase/firestore");

    authModule.getAuth.mockReturnValue({});

    // Re-apply getDoc after clearAllMocks. Reads testState at call time so
    // per-test mutations (set before render) are always visible.
    firestoreModule.getDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => testState.docExists,
        data: () => ({ role: testState.role }),
      })
    );

    // Default: logged-in student. Override with mockAuthUser() before render()
    // in tests that need a different user.
    authModule.onAuthStateChanged.mockImplementation((_auth, callback) => {
      Promise.resolve().then(() =>
        callback({ uid: "student-123", email: "student@school.com" })
      );
      return jest.fn();
    });
  });

  // ── 1. Happy path ────────────────────────────────────────────────────────
  test("logged-in student is routed to tabs home", async () => {
    render(<RootLayout />);
    await flushAsync();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    });
  });

  // ── 2. Logged-out ────────────────────────────────────────────────────────
  test("logged-out user is routed to login", async () => {
    mockAuthUser(authModule, null);

    render(<RootLayout />);
    await flushAsync();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    });
  });

  // ── 3. Admin routing ─────────────────────────────────────────────────────
  test("admin user is routed to admin home", async () => {
    // Mutate BEFORE mockAuthUser and BEFORE render so that when the auth
    // callback fires and calls getDoc, testState.role is already "admin".
    testState.role = "admin";
    mockAuthUser(authModule, { uid: "admin-456", email: "admin@school.com" });

    render(<RootLayout />);
    await flushAsync();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(admin)/home");
    });
  });

  // ── 4. EULA gate ─────────────────────────────────────────────────────────
  test("user without accepted EULA is routed to EULA screen", async () => {
    // Mutate BEFORE render so AsyncStorage.getItem("eula_v1") returns null
    // when resolveAuthenticatedRoute checks it.
    testState.eulaAccepted = false;

    render(<RootLayout />);
    await flushAsync();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("/eula")
      );
    });
  });

  // ── 5. Missing user document ─────────────────────────────────────────────
  test("user document missing triggers signOut and login redirect", async () => {
    // Mutate BEFORE render so getDoc returns exists() === false when
    // resolveAuthenticatedRoute calls it during the auth callback.
    testState.docExists = false;

    render(<RootLayout />);
    await flushAsync();

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    });
  });
});
