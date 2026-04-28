const useRouter = () => ({
  replace: jest.fn(),
  push: jest.fn(),
  back: jest.fn(),
});

const useLocalSearchParams = () => ({});

module.exports = {
  useRouter,
  useLocalSearchParams,
  Stack: ({ children }) => children,
};
