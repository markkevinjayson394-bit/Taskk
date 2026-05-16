import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  buildCacheContract,
  readCacheContract,
  saveCacheContract,
} from "../../utils/cacheContracts";

jest.mock("../../config/firebase", () => ({
  auth: { currentUser: null, onAuthStateChanged: jest.fn() },
}));

describe("cacheContracts", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("builds cache metadata with stable defaults", () => {
    expect(buildCacheContract({ data: ["a"], source: "cache" })).toMatchObject({
      data: ["a"],
      source: "cache",
      lastSync: null,
      hasCache: false,
      offlineSupported: true,
    });
  });

  it("returns default data when offline cache is empty", async () => {
    const result = await readCacheContract("missing-cache-key", {
      defaultData: [],
    });

    expect(result).toEqual({
      data: [],
      source: "empty",
      lastSync: null,
      hasCache: false,
      offlineSupported: true,
    });
  });

  it("returns cached data and last-sync metadata", async () => {
    await AsyncStorage.setItem(
      "cache-key",
      JSON.stringify({
        data: { pending: [{ id: "task-1" }] },
        savedAt: "2026-05-16T01:00:00.000Z",
      })
    );

    const result = await readCacheContract("cache-key", {
      defaultData: { pending: [] },
    });

    expect(result).toEqual({
      data: { pending: [{ id: "task-1" }] },
      source: "cache",
      lastSync: "2026-05-16T01:00:00.000Z",
      hasCache: true,
      offlineSupported: true,
    });
  });

  it("saves remote data through the same contract shape", async () => {
    const result = await saveCacheContract(
      "remote-cache-key",
      [{ id: "announcement-1" }],
      { offlineSupported: false }
    );
    const cached = await readCacheContract("remote-cache-key", {
      defaultData: [],
      offlineSupported: false,
    });

    expect(result).toMatchObject({
      data: [{ id: "announcement-1" }],
      source: "remote",
      hasCache: true,
      offlineSupported: false,
    });
    expect(result.lastSync).toEqual(expect.any(String));
    expect(cached).toMatchObject({
      data: [{ id: "announcement-1" }],
      source: "cache",
      hasCache: true,
      offlineSupported: false,
    });
    expect(cached.lastSync).toEqual(expect.any(String));
  });
});
