import React from "react";
import { Alert, ScrollView } from "react-native";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { render } from "../../utils/test-utils";
import EulaScreen from "../../app/eula";

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn(() => Promise.resolve());
const mockSignOut = jest.fn(() => Promise.resolve());
const mockServerTimestamp = jest.fn(() => "__server_timestamp__");
const mockGetAuth = jest.fn(() => ({
  currentUser: { uid: "student-123", email: "student@example.com" },
}));

let mockParams = { mode: "consent", source: "login" };

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("../../config/firebase", () => ({
  app: {},
  db: {},
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("firebase/auth", () => ({
  __esModule: true,
  getAuth: (...args) => mockGetAuth(...args),
  signOut: (...args) => mockSignOut(...args),
}));

jest.mock("firebase/firestore", () => ({
  __esModule: true,
  doc: jest.fn(() => ({ path: "users/student-123" })),
  getDoc: (...args) => mockGetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }) => children,
  useTheme: () => ({
    colors: {
      background: "#ffffff",
      card: "#f8fafc",
      text: "#0f172a",
      muted: "#94a3b8",
      primary: "#0057D9",
      border: "#e2e8f0",
    },
    isDark: false,
  }),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

jest.mock("../../utils/classScheduleCache", () => ({
  clearLocalClassSchedule: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../utils/onboarding", () => ({
  getPostOnboardingRoute: jest.fn(
    (role = "student") => (role === "admin" ? "/(admin)/home" : "/(tabs)/home")
  ),
  getTutorialRoute: jest.fn(
    (role = "student") =>
      `/tutorial?role=${role === "admin" ? "admin" : "student"}`
  ),
  hasCompletedOnboarding: jest.fn(() => Promise.resolve(true)),
}));

describe("EULA screen", () => {
  let alertSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { mode: "consent", source: "login" };
    mockCanGoBack.mockReturnValue(false);
    mockGetAuth.mockReturnValue({
      currentUser: { uid: "student-123", email: "student@example.com" },
    });
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        role: "student",
        eula: {
          pendingConsent: true,
          acceptedVersion: null,
          acceptedAt: null,
        },
      }),
    });
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("accepting the EULA updates the user profile and continues to home", async () => {
    const { UNSAFE_getByType, findByText, getByText } = render(<EulaScreen />);

    await findByText(/By tapping I Agree/i);

    fireEvent.scroll(UNSAFE_getByType(ScrollView), {
      nativeEvent: {
        layoutMeasurement: { height: 100 },
        contentOffset: { y: 1200 },
        contentSize: { height: 1250 },
      },
    });

    fireEvent.press(getByText("I Agree to the Terms"));

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        { path: "users/student-123" },
        {
          "eula.pendingConsent": false,
          "eula.acceptedVersion": "1.1",
          "eula.acceptedAt": "__server_timestamp__",
        }
      );
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    });
  });

  test("declining the EULA signs out and returns to login", async () => {
    const { findByText, getByText } = render(<EulaScreen />);

    await findByText(/By tapping I Agree/i);
    fireEvent.press(getByText("Decline"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Decline EULA",
      expect.any(String),
      expect.any(Array)
    );

    const buttons = alertSpy.mock.calls[0][2];
    const goToLogin = buttons.find((button) => button.text === "Go to Login");

    await goToLogin.onPress();

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    });
  });
});
