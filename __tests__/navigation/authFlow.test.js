import React from "react";
import { waitFor } from "@testing-library/react-native";
import { render } from "../../utils/test-utils";
import RootLayout from "../../app/_layout";

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

jest.mock("expo-router", () => {
  const React = require("react");

  function Stack({ children }) {
    return React.createElement(React.Fragment, null, children);
  }
  Stack.Screen = function Screen() { return null; };

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

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(admin)/home");
    });
  });

  test("user without accepted EULA is routed to EULA screen", async () => {
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
    mockAsyncStorage.getItem.mockResolvedValue("accepted");

    render(<RootLayout />);

    await waitFor(() => {
      expect(authModule.signOut).toHaveBeenCalled();
    });
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith("active_uid_v1");
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
    expect(mockReplace).not.toHaveBeenCalledWith("/(tabs)/home");
  });
});
