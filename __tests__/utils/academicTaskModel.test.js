import { parseDueDate } from "../../utils/academicTaskModel";

describe("parseDueDate", () => {
  it("returns null for null", () => expect(parseDueDate(null)).toBeNull());
  it("parses ISO string", () =>
    expect(parseDueDate("2025-01-15")).toBeInstanceOf(Date));
  it("parses Firestore Timestamp", () => {
    const ts = { toDate: () => new Date("2025-01-15") };
    expect(parseDueDate(ts)).toEqual(new Date("2025-01-15"));
  });
  it("parses plain Firestore object", () => {
    expect(parseDueDate({ seconds: 1700000000 })).toBeInstanceOf(Date);
  });
});
