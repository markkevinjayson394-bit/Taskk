export const ACTIVE_UID_KEY = "active_uid_v1";
export const EULA_VERSION = "1.1";

function normalizeAcceptedVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getUserEulaState(userData) {
  const eula =
    userData?.eula && typeof userData.eula === "object" ? userData.eula : null;

  const pendingConsent = eula?.pendingConsent === true;
  const acceptedVersion = normalizeAcceptedVersion(eula?.acceptedVersion);
  const acceptedAt = eula?.acceptedAt ?? null;
  const acceptedAlready = !pendingConsent && acceptedVersion !== null;

  return {
    pendingConsent,
    acceptedVersion,
    acceptedAt,
    acceptedAlready,
  };
}

export function needsEulaConsent(userData) {
  return getUserEulaState(userData).pendingConsent;
}

export function buildPendingEulaState() {
  return {
    pendingConsent: true,
    acceptedVersion: null,
    acceptedAt: null,
  };
}

export function getEulaConsentRoute(source = "login") {
  return `/eula?mode=consent&source=${source}`;
}
