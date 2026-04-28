import {
  daysUntil,
  formatMonthLabel,
  formatTime12,
  getDaysInMonth,
  getFirstDayOfMonth,
  getGreeting,
  getTodayString,
  parseDateKey,
  parseMonthKey,
  toDateKey,
  weekMonthLabel,
  weekRangeLabel,
} from "../../utils/dateHelpers";

describe("dateHelpers", () => {
  describe("day and month keys", () => {
    it("formats a date key in local time", () => {
      expect(toDateKey(new Date(2025, 0, 15, 13, 45))).toBe("2025-01-15");
    });

    it("parses a date key", () => {
      const parsed = parseDateKey("2025-01-15");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.getFullYear()).toBe(2025);
      expect(parsed?.getMonth()).toBe(0);
      expect(parsed?.getDate()).toBe(15);
    });

    it("parses a month key with a one-based month", () => {
      expect(parseMonthKey("2025-01")).toEqual({ year: 2025, month: 1 });
    });

    it("returns the number of days in a month", () => {
      expect(getDaysInMonth(2024, 2)).toBe(29);
    });

    it("returns the first weekday index for a month", () => {
      expect(getFirstDayOfMonth(2025, 1)).toBe(3);
    });
  });

  describe("formatters", () => {
    it("formats a 12-hour time label", () => {
      expect(formatTime12(new Date(2025, 0, 15, 13, 5))).toBe("1:05 PM");
    });

    it("formats a month label", () => {
      expect(formatMonthLabel(2025, 1)).toBe("January 2025");
    });

    it("formats week labels", () => {
      expect(
        weekRangeLabel(new Date(2025, 0, 13), new Date(2025, 0, 19))
      ).toBe("Jan 13 - Jan 19");
      expect(weekMonthLabel(new Date(2025, 0, 13))).toBe("January 2025");
    });
  });

  describe("home helpers", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("computes whole days until the due date", () => {
      jest.setSystemTime(new Date(2025, 0, 15, 9, 0, 0));
      expect(daysUntil("2025-01-17T18:00:00")).toBe(2);
    });

    it("formats today's label", () => {
      expect(getTodayString(new Date(2025, 0, 15, 9, 0, 0))).toBe(
        "Wednesday, January 15, 2025"
      );
    });

    it("returns the expected greeting bucket", () => {
      expect(getGreeting(new Date(2025, 0, 15, 8, 0, 0))).toEqual({
        text: "Good morning",
      });
      expect(getGreeting(new Date(2025, 0, 15, 14, 0, 0))).toEqual({
        text: "Good afternoon",
      });
      expect(getGreeting(new Date(2025, 0, 15, 20, 0, 0))).toEqual({
        text: "Good evening",
      });
    });
  });
});
