import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearLocalClassSchedule,
  getDaysSinceLastSync,
  loadLocalClassSchedule,
  saveLocalClassSchedule,
} from "../../utils/classScheduleCache";
import { warnIfDev } from "../../utils/logger";

jest.mock("../../utils/logger", () => ({
  warnIfDev: jest.fn(),
}));

describe("classScheduleCache", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  test("saves and loads parsed classes per user", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1714000000000);
    const classes = [
      {
        subject: "Algorithms",
        dayOfWeek: 1,
        startHour: 8,
        startMinute: 30,
      },
    ];

    await saveLocalClassSchedule("user-1", classes);

    await expect(loadLocalClassSchedule("user-1")).resolves.toEqual({
      savedAt: 1714000000000,
      classes,
    });

    nowSpy.mockRestore();
  });

  test("clears a saved cache entry", async () => {
    await saveLocalClassSchedule("user-1", [{ subject: "Math" }]);

    await clearLocalClassSchedule("user-1");

    await expect(loadLocalClassSchedule("user-1")).resolves.toBeNull();
  });

  test("returns null for days since last sync when nothing is cached", async () => {
    await expect(getDaysSinceLastSync("user-1")).resolves.toBeNull();
  });

  test("computes days since last sync from savedAt", async () => {
    await AsyncStorage.setItem(
      "local_parsed_class_schedule_v1_user-1",
      JSON.stringify({ savedAt: 1714000000000, classes: [] })
    );
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1714172800000);

    await expect(getDaysSinceLastSync("user-1")).resolves.toBeCloseTo(2, 5);

    nowSpy.mockRestore();
  });

  test("returns null and warns when cached data is malformed", async () => {
    await AsyncStorage.setItem("local_parsed_class_schedule_v1_user-1", "not-json");

    await expect(loadLocalClassSchedule("user-1")).resolves.toBeNull();
    expect(warnIfDev).toHaveBeenCalled();
  });
});
