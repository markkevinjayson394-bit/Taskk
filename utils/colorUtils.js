import { PRIORITY_COLOR } from "./taskConstants";

export function toRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function normalizeSubjectKey(subject) {
  return typeof subject === "string"
    ? subject.toLowerCase().trim().replace(/\s+/g, "_")
    : "";
}

export function getSubjectColor(subject, palette) {
  if (!Array.isArray(palette) || palette.length === 0) return undefined;
  const key = normalizeSubjectKey(subject);
  const index = hashString(key) % palette.length;
  return palette[index];
}

export { PRIORITY_COLOR };
