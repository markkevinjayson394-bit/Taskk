jest.mock("react-native", () => ({
  NativeModules: {
    NativeAlarmModule: {
      scheduleExactAlarm: jest.fn().mockResolvedValue("native-id-abc"),
      cancelExactAlarm: jest.fn().mockResolvedValue(true),
      cancelAllExactAlarms: jest.fn().mockResolvedValue(true),
      stopActiveAlarm: jest.fn().mockResolvedValue(true),
      canScheduleExactAlarms: jest.fn().mockResolvedValue(true),
      isIgnoringBatteryOptimizations: jest.fn().mockResolvedValue(true),
      openExactAlarmSettings: jest.fn(),
      pickAlarmTone: jest.fn().mockResolvedValue({ uri: "/test/ring.mp3", label: "Test Ring", source: "device" }),
      pickAlarmAudioFile: jest.fn().mockResolvedValue({ uri: "/test/file.mp3", label: "Test File", source: "device" }),
    },
  },
  Platform: { OS: "android" },
  TurboModuleRegistry: { get: jest.fn() },
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

import {
  isNativeAlarmSupported,
  isNativeAlarmScheduledId,
  toNativeAlarmScheduledId,
  fromNativeAlarmScheduledId,
  canPickNativeAlarmTone,
  canPickNativeAlarmAudioFile,
  scheduleNativeAlarm,
  cancelNativeAlarmByScheduledId,
  cancelAllNativeAlarms,
  stopActiveNativeAlarm,
  pickNativeAlarmTone,
  pickNativeAlarmAudioFile,
} from "../../utils/nativeAlarm";

const NATIVE_ALARM_ID_PREFIX = "native-alarm:";

describe("nativeAlarm", () => {
  describe("isNativeAlarmScheduledId", () => {
    it("returns true for prefixed ids", () => {
      expect(isNativeAlarmScheduledId("native-alarm:abc123")).toBe(true);
    });
    it("returns false for plain strings", () => {
      expect(isNativeAlarmScheduledId("abc123")).toBe(false);
    });
    it("returns false for non-string", () => {
      expect(isNativeAlarmScheduledId(null)).toBe(false);
      expect(isNativeAlarmScheduledId(123)).toBe(false);
    });
  });

  describe("toNativeAlarmScheduledId / fromNativeAlarmScheduledId", () => {
    it("round-trips through prefixed id", () => {
      const alarmId = "my-alarm-42";
      const scheduledId = toNativeAlarmScheduledId(alarmId);
      expect(scheduledId).toBe(`${NATIVE_ALARM_ID_PREFIX}${alarmId}`);
      expect(fromNativeAlarmScheduledId(scheduledId)).toBe(alarmId);
    });

    it("fromNativeAlarmScheduledId returns input unchanged if not prefixed", () => {
      expect(fromNativeAlarmScheduledId("plain-id")).toBe("plain-id");
    });
  });

  describe("canPickNativeAlarmTone", () => {
    it("is true when the method exists on android", () => {
      expect(canPickNativeAlarmTone).toBe(true);
    });
  });

  describe("canPickNativeAlarmAudioFile", () => {
    it("is true when the method exists on android", () => {
      expect(canPickNativeAlarmAudioFile).toBe(true);
    });
  });

  describe("scheduleNativeAlarm", () => {
    it("schedules and returns a prefixed id", async () => {
      const id = await scheduleNativeAlarm({
        alarmId: "test-alarm",
        triggerAt: Date.now() + 60000,
        title: "Test",
        body: "Body",
      });
      expect(id).toBe(`${NATIVE_ALARM_ID_PREFIX}native-id-abc`);
    });

    it("returns null for missing alarmId", async () => {
      const result = await scheduleNativeAlarm({ triggerAt: Date.now(), title: "t" });
      expect(result).toBe(null);
    });

    it("returns null for non-finite triggerAt", async () => {
      const result = await scheduleNativeAlarm({ alarmId: "x", triggerAt: NaN, title: "t" });
      expect(result).toBe(null);
    });
  });

  describe("cancelNativeAlarmByScheduledId", () => {
    it("cancels by prefixed scheduled id", async () => {
      const result = await cancelNativeAlarmByScheduledId("native-alarm:some-id");
      expect(result).toBe(true);
    });

    it("returns false for empty scheduledId", async () => {
      const result = await cancelNativeAlarmByScheduledId("");
      expect(result).toBe(false);
    });
  });

  describe("cancelAllNativeAlarms", () => {
    it("cancels all alarms", async () => {
      const result = await cancelAllNativeAlarms();
      expect(result).toBe(true);
    });
  });

  describe("stopActiveNativeAlarm", () => {
    it("stops the active alarm", async () => {
      const result = await stopActiveNativeAlarm();
      expect(result).toBe(true);
    });
  });

  describe("pickNativeAlarmTone", () => {
    it("returns normalized tone selection", async () => {
      const result = await pickNativeAlarmTone();
      expect(result).toEqual({
        uri: "/test/ring.mp3",
        label: "Test Ring",
        source: "device",
      });
    });

    it("returns normalized with currentUri", async () => {
      const result = await pickNativeAlarmTone("/custom/ring.mp3");
      expect(result?.uri).toBe("/test/ring.mp3");
    });
  });

  describe("pickNativeAlarmAudioFile", () => {
    it("returns normalized file selection", async () => {
      const result = await pickNativeAlarmAudioFile();
      expect(result).toEqual({
        uri: "/test/file.mp3",
        label: "Test File",
        source: "device",
      });
    });
  });
});