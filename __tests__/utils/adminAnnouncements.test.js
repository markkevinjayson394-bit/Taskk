import {
  AUDIENCE_OPTIONS,
  buildAnnouncementPayload,
  buildAudienceLabel,
  filterAnnouncements,
  formatAnnouncementDateTime,
  getSelectedAudience,
  validateAnnouncementForm,
} from "../../utils/adminAnnouncements";

describe("adminAnnouncements", () => {
  const announcements = [
    {
      id: "1",
      title: "Enrollment Reminder",
      message: "BSIT students submit forms",
      audience: "course",
      college: "COT",
      course: "BSIT",
      year: "1",
      section: "A",
    },
    {
      id: "2",
      title: "Year Level Assembly",
      message: "All second year students attend",
      audience: "year",
      college: "COE",
      year: "2",
    },
  ];

  test("validateAnnouncementForm guards required fields", () => {
    expect(
      validateAnnouncementForm({
        title: "",
        message: "Body",
        audience: "all",
        currentUid: "user-1",
      })
    ).toEqual({
      ok: false,
      title: "Missing Fields",
      message: "Please fill in both title and message.",
    });
  });

  test("buildAnnouncementPayload scopes fields by audience", () => {
    expect(
      buildAnnouncementPayload({
        title: " Exam Week ",
        message: " Prepare ",
        audience: "course",
        college: "COT",
        course: "BSIT",
        year: "1",
        section: "A",
        imageBase64: "img",
        imageNote: " note ",
      })
    ).toEqual({
      title: "Exam Week",
      message: "Prepare",
      audience: "course",
      college: "COT",
      course: "BSIT",
      year: "1",
      section: "A",
      imageBase64: "img",
      imageNote: "note",
    });
  });

  test("filterAnnouncements filters by audience and search text", () => {
    const result = filterAnnouncements(
      announcements,
      "course",
      "submit forms",
      (value) => value
    );
    expect(result).toEqual([announcements[0]]);
  });

  test("buildAudienceLabel expands college and audience details", () => {
    expect(buildAudienceLabel(announcements[0], (value) => value)).toBe(
      "Specific Section - COT - BSIT"
    );
  });

  test("getSelectedAudience falls back to all students", () => {
    expect(getSelectedAudience("missing")).toEqual(AUDIENCE_OPTIONS[0]);
  });

  test("formatAnnouncementDateTime formats a valid date", () => {
    const result = formatAnnouncementDateTime(new Date("2026-04-01T08:30:00Z"));
    expect(result).toContain("2026");
  });
});
