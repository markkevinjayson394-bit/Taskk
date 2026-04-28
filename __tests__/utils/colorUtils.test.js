import {
  getSubjectColor,
  hashString,
  normalizeSubjectKey,
  toRgba,
} from "../../utils/colorUtils";

describe("colorUtils", () => {
  it("toRgba converts hex", () => {
    expect(toRgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("hashString is stable", () => {
    expect(hashString("math")).toBe(hashString("math"));
  });

  it("normalizeSubjectKey lowercases and trims", () => {
    expect(normalizeSubjectKey("  Math 101  ")).toBe("math_101");
  });

  it("getSubjectColor picks from the provided palette", () => {
    const palette = ["#111111", "#222222", "#333333"];
    expect(palette).toContain(getSubjectColor("Math", palette));
  });
});
