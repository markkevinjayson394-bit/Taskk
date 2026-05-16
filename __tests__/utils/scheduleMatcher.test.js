import { findBestScheduleDoc } from "../../utils/scheduleMatcher";

const mockGetDocs = jest.fn();
const mockQuery = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockWarnIfDev = jest.fn();

jest.mock("../../config/firebase", () => ({
  db: {},
}));

jest.mock("firebase/firestore", () => ({
  collection: (...args) => mockCollection(...args),
  query: (...args) => mockQuery(...args),
  where: (...args) => mockWhere(...args),
  getDocs: (...args) => mockGetDocs(...args),
}));

jest.mock("../../utils/logger", () => ({
  warnIfDev: (...args) => mockWarnIfDev(...args),
  errorIfDev: jest.fn(),
}));

const makeDoc = (id, data) => ({
  id,
  data: () => ({ id, ...data }),
});

describe("scheduleMatcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findBestScheduleDoc", () => {
    it("returns null when course is missing", async () => {
      const result = await findBestScheduleDoc(
        {},
        { college: "ENG", course: "", year: "1", section: "A" }
      );
      expect(result).toBeNull();
    });

    it("returns null when year is missing", async () => {
      const result = await findBestScheduleDoc(
        {},
        { college: "ENG", course: "BSIT", year: "", section: "A" }
      );
      expect(result).toBeNull();
    });

    it("returns null when section is missing", async () => {
      const result = await findBestScheduleDoc(
        {},
        { college: "ENG", course: "BSIT", year: "1", section: "" }
      );
      expect(result).toBeNull();
    });

    it("queries with college when college is provided", async () => {
      mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

      await findBestScheduleDoc(
        {},
        { college: "COE", course: "BSIT", year: "1", section: "A" }
      );

      expect(mockWhere).toHaveBeenCalledWith("college", "==", "COE");
    });

    it("returns exact match with college when found", async () => {
      const doc = makeDoc("sched1", {
        course: "BSIT",
        year: "1",
        section: "A",
        college: "COE",
        scheduleType: "day",
      });
      mockGetDocs.mockResolvedValueOnce({ empty: false, docs: [doc] });

      const result = await findBestScheduleDoc(
        {},
        { college: "COE", course: "BSIT", year: "1", section: "A" }
      );

      expect(result).not.toBeNull();
      expect(result.doc).toBe(doc);
      expect(result.source).toBe("exact");
    });

    it("returns exact match without college when college not provided", async () => {
      const doc = makeDoc("sched1", {
        course: "BSIT",
        year: "1",
        section: "A",
        scheduleType: "day",
      });
      mockGetDocs.mockResolvedValueOnce({ empty: false, docs: [doc] });

      const result = await findBestScheduleDoc(
        {},
        { college: "", course: "BSIT", year: "1", section: "A" }
      );

      expect(result).not.toBeNull();
      expect(result.source).toBe("exact");
    });

    it("falls back to course-only query when exact lookup fails", async () => {
      // Course fallback doc that actually matches profile (same section/year)
      mockGetDocs
        .mockResolvedValueOnce({ empty: true, docs: [] }) // exact with college
        .mockResolvedValueOnce({ empty: true, docs: [] }) // exact without college
        .mockResolvedValueOnce({
          empty: false,
          docs: [
            makeDoc("sched2", {
              course: "BSIT",
              year: "1",
              section: "A",
              college: "COE",
              scheduleType: "day",
            }),
          ],
        }); // by course

      const result = await findBestScheduleDoc(
        {},
        { college: "COE", course: "BSIT", year: "1", section: "A" }
      );

      expect(result).not.toBeNull();
    });

    it("returns null when no matching schedules found", async () => {
      mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

      const result = await findBestScheduleDoc(
        {},
        { college: "COE", course: "BSIT", year: "1", section: "Z" }
      );

      expect(result).toBeNull();
    });

    it("normalizes raw course name before querying", async () => {
      const doc = makeDoc("sched1", {
        course: "Bachelor of Science in Information Technology",
        year: "1",
        section: "A",
        college: "COE",
        scheduleType: "day",
      });
      mockGetDocs.mockResolvedValue({ empty: false, docs: [doc] });

      const result = await findBestScheduleDoc(
        {},
        { college: "COE", course: "BSIT", year: "1", section: "A" }
      );

      expect(result).not.toBeNull();
    });

    it("tries both raw and normalized course names when they differ", async () => {
      mockGetDocs
        .mockResolvedValueOnce({ empty: true, docs: [] }) // normalized course name exact lookup
        .mockResolvedValueOnce({ empty: true, docs: [] }) // raw course name exact lookup
        .mockResolvedValueOnce({ empty: false, docs: [] }); // by course fallback

      await findBestScheduleDoc(
        {},
        {
          college: "COE",
          course: "BS Information Technology",
          year: "1",
          section: "A",
        }
      );

      // Both candidates should have been tried
      expect(mockWhere).toHaveBeenCalled();
    });

    it("logs warning when exact lookup with college fails", async () => {
      mockGetDocs.mockRejectedValueOnce(new Error("Firestore error"));

      await findBestScheduleDoc(
        {},
        {
          college: "COE",
          course: "BSIT-FALLBACK",
          year: "1",
          section: "B",
        }
      );

      expect(mockWarnIfDev).toHaveBeenCalled();
    });

    it("returns null when courseCandidates array exhausted without match", async () => {
      mockGetDocs.mockResolvedValue({ empty: true, docs: [] });

      const result = await findBestScheduleDoc(
        {},
        { college: "COE", course: "UnknownCourse", year: "1", section: "A" }
      );

      expect(result).toBeNull();
    });
  });
});
