// __mocks__/@notifee/react-native.js
const notifee = {
  createChannel: jest.fn().mockResolvedValue("channel-id"),
  createChannelGroup: jest.fn().mockResolvedValue(undefined),
  displayNotification: jest.fn().mockResolvedValue(undefined),
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
  getNotificationSettings: jest.fn().mockResolvedValue({
    authorizationStatus: 1,
  }),
  requestPermission: jest.fn().mockResolvedValue({ authorizationStatus: 1 }),
  onForegroundEvent: jest.fn(() => jest.fn()),
  onBackgroundEvent: jest.fn(),
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1, NONE: 0 },
  AndroidColor: { RED: "#ff0000" },
  AuthorizationStatus: { AUTHORIZED: 1, DENIED: 0, NOT_DETERMINED: -1 },
  EventType: { DELIVERED: 3, PRESS: 1, ACTION_PRESS: 2 },
};

export default notifee;
export const AndroidImportance = notifee.AndroidImportance;
export const AndroidColor = notifee.AndroidColor;
export const AuthorizationStatus = notifee.AuthorizationStatus;
export const EventType = notifee.EventType;
