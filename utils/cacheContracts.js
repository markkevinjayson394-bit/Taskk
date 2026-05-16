import { loadFromCache, saveToCache } from "../context/OfflineContext";

export function buildCacheContract({
  data = null,
  source = "empty",
  lastSync = null,
  hasCache = false,
  offlineSupported = true,
} = {}) {
  return {
    data,
    source,
    lastSync,
    hasCache,
    offlineSupported,
  };
}

export async function readCacheContract(
  cacheKey,
  { defaultData = null, offlineSupported = true } = {}
) {
  const cached = await loadFromCache(cacheKey);
  return buildCacheContract({
    data: cached?.data ?? defaultData,
    source: cached ? "cache" : "empty",
    lastSync: cached?.savedAt ?? null,
    hasCache: Boolean(cached),
    offlineSupported,
  });
}

export async function saveCacheContract(
  cacheKey,
  data,
  { offlineSupported = true } = {}
) {
  await saveToCache(cacheKey, data);
  return buildCacheContract({
    data,
    source: "remote",
    lastSync: new Date().toISOString(),
    hasCache: true,
    offlineSupported,
  });
}
