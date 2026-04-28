// utils/logger.js
// Centralized app logging and production error reporting.

import * as Sentry from "@sentry/react-native";

export const warnIfDev = __DEV__ ? console.warn.bind(console) : () => {};
export const logIfDev = __DEV__ ? console.log.bind(console) : () => {};
export const errorIfDev = __DEV__ ? console.error.bind(console) : () => {};

/**
 * @typedef {Object} LoggerMeta
 * @property {string=} message
 * @property {Record<string, string>=} tags
 * @property {Record<string, unknown>=} extra
 */

function toError(error, fallbackMessage = "Unexpected application error") {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error.trim());
  return new Error(fallbackMessage);
}

/**
 * @param {unknown} error
 * @param {LoggerMeta} [meta]
 */
function captureWithSentry(error, meta = {}) {
  const { tags, extra } = meta;
  try {
    Sentry.captureException(error, { tags, extra });
  } catch {
    // Reporting should never break the caller.
  }
}

/**
 * @param {unknown} error
 * @param {LoggerMeta} [meta]
 */
export function reportError(
  error,
  meta = {}
) {
  const { message = "Unexpected application error", tags, extra } = meta;
  const normalized = toError(error, message);
  errorIfDev(message, normalized);
  captureWithSentry(normalized, { tags, extra });
  return normalized;
}

/**
 * @param {unknown} error
 * @param {LoggerMeta} [meta]
 */
export function reportWarning(
  error,
  meta = {}
) {
  const { message = "Recoverable application warning", tags, extra } = meta;
  const normalized = toError(error, message);
  warnIfDev(message, normalized);
  captureWithSentry(normalized, {
    tags: { severity: "warning", ...(tags || {}) },
    extra,
  });
  return normalized;
}
