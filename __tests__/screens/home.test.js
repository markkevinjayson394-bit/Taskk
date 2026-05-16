import { act, cleanup, fireEvent, waitFor } from "@testing-library/react-native";
import HomeDashboard from "../../app/(tabs)/home";
import { render } from "../../utils/test-utils";

const mockPush = jest.fn();
const mockRescheduleAll = jest.fn(() => Promise.resolve());
const mockMarkSynced = jest.fn(() => Promise.resolve());
const mockLoadFromCache = jest.fn();
const mockSaveToCache = jest.fn(() => Promise.resolve());
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockUpdateDoc = jest.fn(() => Promise.resolve());
const mockCancelAssignmentNotifications = jest.fn(() => Promise.resolve());

jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback) => {
      React.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock("../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }) => children,
  useTheme: () => ({
    colors: {
      background: "#ffffff",
      card: "#f8fafc",
      border: "#e2e8f0",
      text: "#0f172a",
      muted: "#64748b",
      primary: "#2563eb",
    },
    isDark: false,
  }),
}));

jest.mock("../../context/NotificationContext", () => ({
  useNotifications: () => ({ rescheduleAll: mockRescheduleAll }),
}));

jest.mock("../../context/OfflineContext", () => ({
  CACHE_KEYS: {
    profile: (uid) => `cache_profile_${uid}`,
    schedule: (uid) => `cache_schedule_${uid}`,
    assignments: (uid) => `cache_assignments_${uid}`,
    announcements: (uid) => `cache_announcements_${uid}`,
  },
  formatSyncTime: () => "Just now",
  loadFromCache: (...args) => mockLoadFromCache(...args),
  saveToCache: (...args) => mockSaveToCache(...args),
  useOffline: () => ({
    isOnline: true,
    lastSync: new Date().toISOString(),
    pendingSyncSummary: { total: 0 },
    checkConnectivity: jest.fn(),
    markSynced: mockMarkSynced,
  }),
}));

jest.mock("../../config/firebase", () => ({
  auth: { currentUser: { uid: "student-1" } },
  db: {},
}));

jest.mock("firebase/firestore", () => ({
  doc: jest.fn((...args) => args),
  collection: jest.fn((...args) => args),
  query: jest.fn((...args) => args),
  where: jest.fn((...args) => args),
  orderBy: jest.fn((...args) => args),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
}));

jest.mock("../../utils/scheduleMatcher", () => ({
  findBestScheduleDoc: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("../../utils/deadlineAlarmBackground", () => ({
  cancelDeadlineAlarms: (...args) => mockCancelAssignmentNotifications(...args),
}));

jest.mock("../../components/DeadlineAlarmModal", () => ({
  __esModule: true,
  default: () => null,
  useDeadlineAlarmScheduler: () => ({
    alarmVisible: false,
    alarmTask: null,
    alarmThresholdKey: null,
    acknowledgeAlarm: jest.fn(),
    notDoneAlarm: jest.fn(),
  }),
}));

jest.mock("@sentry/react-native", () => ({
  captureException: jest.fn(),
}));

// ─── Cache shape helpers ──────────────────────────────────────────────────────
// Each key prefix maps to the exact shape the component reads.
// The schedule key is stored with a "_week" suffix:
//   CACHE_KEYS.schedule(uid) + "_week"  →  "cache_schedule_<uid>_week"
// so the matcher must include that suffix to avoid returning null and leaving
// the component in a hung loading state.
function buildDefaultCacheMock() {
  return async (key) => {
    const k = String(key);
    if (k.includes("cache_profile_")) {
      return {
        data: {
          fullName: "Student One",
          studentInfo: {
            course: "BSIT",
            year: "3",
            section: "A",
            semester: "2nd Semester",
            academicYear: "2025-2026",
          },
        },
      };
    }
    // FIX: match the "_week" suffix that loadFromOfflineCache appends.
    if (k.includes("cache_schedule_")) {
      return { data: {} };
    }
    if (k.includes("cache_assignments_")) {
      return { data: { pending: [], done: [] } };
    }
    if (k.includes("cache_announcements_")) {
      return { data: [] };
    }
    return null;
  };
}

/**
 * Flush the full async chain that fetchDashboardData goes through:
 *   mount → useFocusEffect → loadFromOfflineCache (N cache reads) →
 *   getDoc (rejects) → catch → loadFromOfflineCache again → setState
 *
 * A single Promise.resolve() tick is not enough for this depth.
 * We loop until the microtask queue is truly empty (up to maxTicks).
 */
async function flushAllMicrotasks(maxTicks = 20) {
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("Home dashboard", () => {
  const Sentry = require("@sentry/react-native");

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        fullName: "Student One",
        studentInfo: {
          course: "BSIT",
          year: "3",
          section: "A",
          semester: "2nd Semester",
          academicYear: "2025-2026",
        },
      }),
    });

    mockGetDocs
      .mockResolvedValueOnce({
        docs: [
          {
            id: "task-1",
            data: () => ({
              title: "Write lab report",
              subject: "Physics",
              dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
              completed: false,
              priority: "high",
              type: "assignment",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          {
            id: "ann-1",
            data: () => ({
              title: "Lab Schedule Changed",
              message: "Physics lab moved to Room B201.",
              audience: "all",
              createdAt: new Date().toISOString(),
            }),
          },
        ],
      })
      .mockResolvedValue({ docs: [] });

    mockLoadFromCache.mockImplementation(buildDefaultCacheMock());
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Urgent task render + mark done ───────────────────────────────────
  test("renders urgent tasks and marks a task done", async () => {
    const { getAllByText, getByText } = render(<HomeDashboard />);

    // FIX: flush microtasks so Promise chains in fetchDashboardData settle
    await flushAllMicrotasks(50);

    await waitFor(
      () => {
        expect(getAllByText("Write lab report").length).toBeGreaterThan(0);
      },
      { timeout: 12000 }
    );

    fireEvent.press(getByText(/^done$/i));

    await waitFor(() => {
      expect(mockCancelAssignmentNotifications).toHaveBeenCalled();
      expect(mockUpdateDoc).toHaveBeenCalled();
      expect(mockRescheduleAll).toHaveBeenCalled();
    });
  });

  // ── 2. Cache fallback on remote failure ──────────────────────────────────
  //
  // fetchDashboardData flow on failure:
  //   useFocusEffect (mount) → loadFromOfflineCache (pre-populate) →
  //   getDoc (throws) → catch → loadFromOfflineCache (markCached: true) →
  //   setUpcomingAssignments([cachedTask]) → render
  //
  // FIX: The previous version used jest.advanceTimersByTime(60_000) which
  // triggered the unrelated nowTick setInterval outside act(), causing an
  // "not wrapped in act" warning and consuming most of the timeout budget.
  //
  // The correct approach: let the component mount (useFocusEffect fires via
  // the mock), then flush microtasks deeply enough for the full async chain
  // to resolve before waitFor starts polling.
  test("falls back to cached dashboard data when remote loading fails", async () => {
    mockLoadFromCache.mockImplementation(async (key) => {
      const k = String(key);
      if (k.includes("cache_assignments_")) {
        return {
          data: {
            pending: [
              {
                id: "cached-1",
                title: "Cached planner task",
                subject: "Research",
                dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                completed: false,
                priority: "medium",
                type: "project",
              },
            ],
            done: [],
          },
        };
      }
      if (k.includes("cache_profile_")) {
        return {
          data: {
            fullName: "Cached Student",
            studentInfo: { course: "BSIT", year: "3", section: "A" },
          },
        };
      }
      if (k.includes("cache_announcements_")) {
        return { data: [] };
      }
      if (k.includes("cache_schedule_")) {
        return { data: {} };
      }
      return null;
    });

    // Reject ALL calls (not just the first) so both the initial getDoc inside
    // fetchDashboardData AND any retry also fail, forcing the catch branch.
    mockGetDoc.mockRejectedValue(new Error("dashboard fetch failed"));
    mockGetDocs.mockRejectedValue(new Error("dashboard fetch failed"));

    const { getAllByText } = render(<HomeDashboard />);

    // FIX: flush deeply enough for the full async chain to complete.
    // The chain is: mount → loadFromOfflineCache (4 cache reads in parallel) →
    // getDoc (rejects) → catch handler → loadFromOfflineCache again (4 more
    // reads) → setState. That's at minimum 3 async "hops" so we need more
    // than 3 Promise.resolve() ticks.
    await flushAllMicrotasks(50);

    await waitFor(
      () => {
        expect(getAllByText("Cached planner task").length).toBeGreaterThan(0);
      },
      { timeout: 12000 }
    );

    await waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalled();
    });
  }, 20000);
});
