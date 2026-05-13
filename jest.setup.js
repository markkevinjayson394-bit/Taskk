global.__DEV__ = false;

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  wrap: (Component) => Component,
  setUser: jest.fn(),
  captureException: jest.fn(),
  mobileReplayIntegration: jest.fn(() => "mobileReplay"),
  feedbackIntegration: jest.fn(() => "feedback"),
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default
);

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { Text } = require("react-native");

  const Ionicons = ({ name, children, ...props }) =>
    React.createElement(Text, props, children || name || "icon");

  return { Ionicons };
});

jest.mock("expo-av", () => ({
  Audio: {
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    Sound: {
      createAsync: jest.fn(() =>
        Promise.resolve({
          sound: {
            stopAsync: jest.fn(() => Promise.resolve()),
            unloadAsync: jest.fn(() => Promise.resolve()),
          },
        })
      ),
    },
  },
}));

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: {
    Warning: "warning",
    Success: "success",
  },
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  cancelAsync: jest.fn(() => Promise.resolve()),
}));
