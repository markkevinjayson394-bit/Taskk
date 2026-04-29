import { waitFor } from "@testing-library/react-native";
import RootLayout from "../../app/_layout";
import { render } from "../../utils/test-utils";

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

jest.mock("firebase/auth", () => ({
  __esModule: true,
  getAuth: jest.fn(() => ({})),
  onAuthStateChanged: jest.fn((auth, callback) => {
    callback({ uid: "student-123", email: "student@school.com" });
    return jest.fn();
  }),
  signOut: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("firebase/firestore", () => ({
  __esModule: true,
  doc: jest.fn(() => ({})),
  getDoc: jest.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ role: "student" }),
  }),
}));

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

jest.mock("../../utils/onboarding", () => ({
  __esModule: true,
  getPostOnboardingRoute: (role = "student") =>
    role === "admin" ? "/(admin)/home" : "/(tabs)/home",
  getTutorialRoute: (role = "student") =>
    `/tutorial?role=${role === "admin" ? "admin" : "student"}`,
  hasCompletedOnboarding: jest.fn(() => Promise.resolve(true)),
}));

const mockAsyncStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorage);

describe("Auth flow", () => {
  const authModule = require("firebase/auth");
  const firestoreModule = require("firebase/firestore");
  const onboardingModule = require("../../utils/onboarding");

  beforeEach(() => {
    jest.clearAllMocks();
    authModule.getAuth.mockReturnValue({});
    authModule.onAuthStateChanged.mockImplementation((auth, callback) => {
      callback({ uid: "student-123", email: "student@school.com" });
      return jest.fn();
    });
    firestoreModule.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ role: "student" }),
    });
    onboardingModule.hasCompletedOnboarding.mockResolvedValue(true);

    mockAsyncStorage.getItem
      .mockResolvedValueOnce("true") // default eula
      .mockResolvedValueOnce(null) // EULA test
      .mockResolvedValueOnce("true") // admin test eula
      .mockResolvedValueOnce("true"); // missing doc test eula

    // _layout.js checks: (await AsyncStorage.getItem("eula_v1")) === "true"
    // Must be the exact string "true" — not "accepted" — to pass the EULA gate.
    // Default to accepted so it doesn't interfere with tests that aren't about EULA.
  });

  test("logged-in student is routed to tabs home", async () => {
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    });
  });

  test("logged-out user is routed to login", async () => {
    authModule.onAuthStateChanged.mockImplementationOnce((auth, callback) => {
      callback(null);
      return jest.fn();
    });

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    });
  });

  test("admin user is routed to admin home", async () => {
    authModule.onAuthStateChanged.mockImplementationOnce((auth, callback) => {
      callback({ uid: "admin-456", email: "admin@school.com" });
      return jest.fn();
    });
    firestoreModule.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ role: "admin" }),
    });
    // Explicit "true" so the EULA gate is cleared before role-based routing
    mockAsyncStorage.getItem.mockResolvedValue("true");

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(admin)/home");
    });
  });

  test("user without accepted EULA is routed to EULA screen", async () => {
    // null → (await AsyncStorage.getItem("eula_v1")) === "true" is false → /eula
    mockAsyncStorage.getItem.mockResolvedValue(null);

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("/eula")
      );
    });
    expect(mockReplace).not.toHaveBeenCalledWith("/(tabs)/home");
    expect(mockReplace).not.toHaveBeenCalledWith("/(admin)/home");
  });

  test("user document missing triggers signOut and login redirect", async () => {
    firestoreModule.getDoc.mockResolvedValueOnce({
      exists: () => false,
    });
    // EULA accepted — must be "true" so the code reaches the missing-doc
    // branch instead of short-circuiting to /eula first.
    mockAsyncStorage.getItem.mockResolvedValue("true");

    render(<RootLayout />);

    await waitFor(() => {
      expect(authModule.signOut).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("active_uid_v1");
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    });
    expect(mockReplace).not.toHaveBeenCalledWith("/(tabs)/home");
  });
});
