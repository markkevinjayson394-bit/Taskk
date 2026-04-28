import { fireEvent, waitFor } from "@testing-library/react-native";
import HomeDashboard from "../../app/(tabs)/home";
import { render } from "../../utils/test-utils";
const mockPush = jest.fn();
const mockRescheduleAll = jest.fn(() => Promise.resolve());
const mockMarkSynced = jest.fn(() => Promise.resolve());
const mockLoadFromCache = jest.fn(() => Promise.resolve(null));
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
  cancelDeadlineAlarms: (...args) =>
    mockCancelAssignmentNotifications(...args),
}));
jest.mock("../../components/DeadlineAlarmModal", () => ({
  __esModule: true,
  default: () => null,
  useDeadlineAlarmScheduler: () => ({
    alarmVisible: false,
    alarmTask: null,
    acknowledgeAlarm: jest.fn(),
  }),
}));
jest.mock("@sentry/react-native", () => ({
  captureException: jest.fn(),
}));
describe("Home dashboard", () => {
  const Sentry = require("@sentry/react-native");
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup tomorrow's date for exam
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
    // Setup getDocs to return assignments, exams, and announcements
    mockGetDocs
      .mockResolvedValueOnce({
        // assignments query result
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
        // exams query result
        docs: [
          {
            id: "exam-1",
            data: () => ({
              title: "Midterm Physics",
              subject: "Physics",
              type: "exam",
              dueAt: tomorrow.toISOString(),
              completed: false,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        // announcements query result
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
    mockLoadFromCache.mockResolvedValue(null);
  });
  test("renders urgent tasks and marks a task done", async () => {
    const { getAllByText, getByText } = render(<HomeDashboard />);
    await waitFor(
      () => {
        expect(getAllByText("Write lab report").length).toBeGreaterThan(0);
      },
      { timeout: 4000 }
    );
    fireEvent.press(getByText(/^done$/i));
    await waitFor(() => {
      expect(mockCancelAssignmentNotifications).toHaveBeenCalled();
      expect(mockUpdateDoc).toHaveBeenCalled();
      expect(mockRescheduleAll).toHaveBeenCalled();
    });
  });
  test("falls back to cached dashboard data when remote loading fails", async () => {
    mockLoadFromCache.mockImplementation(async (key) => {
      if (String(key).includes("cache_assignments_")) {
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
      if (String(key).includes("cache_profile_")) {
        return {
          data: {
            fullName: "Cached Student",
            studentInfo: { course: "BSIT", year: "3", section: "A" },
          },
        };
      }
      if (String(key).includes("cache_announcements_")) {
        return { data: [] };
      }
      return null;
    });
    mockGetDoc.mockRejectedValueOnce(new Error("dashboard fetch failed"));
    const { getAllByText } = render(<HomeDashboard />);
    await waitFor(
      () => {
        expect(getAllByText("Cached planner task").length).toBeGreaterThan(0);
      },
      { timeout: 4000 }
    );
    await waitFor(() => {
      // reportError/reportWarning wrap Sentry internally;
      // this asserts that the error was captured via the logger on fetch failure.
      expect(Sentry.captureException).toHaveBeenCalled();
    });
  });
});

