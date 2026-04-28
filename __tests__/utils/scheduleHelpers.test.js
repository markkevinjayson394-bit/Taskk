import {
  getClassRangeMinutes,
  parseTimeToMinutes,
  toTimeLabel,
} from "../../utils/scheduleHelpers";

describe("parseTimeToMinutes", () => {
  it("parses normal time", () => expect(parseTimeToMinutes("09:30")).toBe(570));
  it("parses midnight", () => expect(parseTimeToMinutes("00:00")).toBe(0));
  it("parses noon", () => expect(parseTimeToMinutes("12:00")).toBe(720));
  it("returns null for malformed input", () =>
    expect(parseTimeToMinutes("abc")).toBeNull());
  it("returns null for null", () =>
    expect(parseTimeToMinutes(null)).toBeNull());

  it("parses ISO date string", () =>
    expect(parseTimeToMinutes("2026-03-31T08:30:00.000Z")).toBe(510));
  it("parses ISO date string at midnight", () =>
    expect(parseTimeToMinutes("2026-03-31T00:00:00.000Z")).toBe(0));
  it("returns null for invalid ISO string", () =>
    expect(parseTimeToMinutes("2026-03-31Txx:yy:00.000Z")).toBeNull());
});

describe("getClassRangeMinutes", () => {
  it("parses HH:MM start/end fields", () => {
    const result = getClassRangeMinutes({ start: "09:00", end: "10:30" });
    expect(result).toEqual({ start: 540, end: 630, duration: 90 });
  });

  it("parses ISO date string start/end fields", () => {
    const result = getClassRangeMinutes({
      start: "2026-03-31T08:00:00.000Z",
      end: "2026-03-31T09:30:00.000Z",
    });
    expect(result).toEqual({ start: 480, end: 570, duration: 90 });
  });

  it("prefers startTime over start", () => {
    const result = getClassRangeMinutes({
      startTime: "10:00",
      start: "2026-03-31T08:00:00.000Z",
      endTime: "11:00",
      end: "2026-03-31T09:30:00.000Z",
    });
    expect(result).toEqual({ start: 600, end: 660, duration: 60 });
  });

  it("returns null when start is missing", () => {
    expect(getClassRangeMinutes({ end: "10:00" })).toBeNull();
  });

  it("returns duration null when end is missing", () => {
    const result = getClassRangeMinutes({ start: "09:00" });
    expect(result).toEqual({ start: 540, end: null, duration: null });
  });
});

describe("toTimeLabel", () => {
  it("midnight (0)", () => expect(toTimeLabel(0)).toBe("12:00 AM"));
  it("noon (720)", () => expect(toTimeLabel(720)).toBe("12:00 PM"));
  it("60 minutes", () => expect(toTimeLabel(60)).toBe("1:00 AM"));
  it("90 minutes", () => expect(toTimeLabel(90)).toBe("1:30 AM"));
  it("779 minutes", () => expect(toTimeLabel(779)).toBe("12:59 PM"));
});
