import React from "react";
import { fireEvent, waitFor } from "@testing-library/react-native";
import { render } from "../../utils/test-utils";
import Tutorial from "../../app/tutorial";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ role: "student" }),
}));

jest.mock("../../config/firebase", () => ({
  auth: { currentUser: { uid: "test-uid", email: "student@example.com" } },
}));

jest.mock("../../utils/onboarding", () => ({
  getPostOnboardingRoute: (role = "student") =>
    role === "admin" ? "/(admin)/home" : "/(tabs)/home",
  markOnboardingCompleted: jest.fn(() => Promise.resolve()),
}));

describe("Tutorial screen", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  test("renders the first slide", () => {
    const { getByText } = render(<Tutorial />);

    expect(getByText(/home shows your next academic move/i)).toBeTruthy();
    expect(getByText(/home tab/i)).toBeTruthy();
  });

  test("next button advances to the second slide", () => {
    const { getByText } = render(<Tutorial />);

    fireEvent.press(getByText(/^next$/i));

    expect(
      getByText(/schedule keeps your classes fixed and visible/i)
    ).toBeTruthy();
    expect(getByText(/schedule screen/i)).toBeTruthy();
  });

  test("finish button navigates away", async () => {
    const { getByText } = render(<Tutorial />);

    for (let i = 0; i < 6; i += 1) {
      fireEvent.press(getByText(/^next$/i));
    }

    fireEvent.press(getByText(/open app/i));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/home");
    });
  });
});
