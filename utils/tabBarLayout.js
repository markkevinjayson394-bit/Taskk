export const TAB_BAR_BASE_HEIGHT = 58;
export const TAB_BAR_PADDING_TOP = 8;
export const TAB_BAR_VISIBLE_HEIGHT = TAB_BAR_BASE_HEIGHT + TAB_BAR_PADDING_TOP;
export const TAB_BAR_SIDE_MARGIN = 14;
export const TAB_BAR_MIN_BOTTOM_GAP = 4;
export const TAB_BAR_CONTENT_EXTRA_PADDING = 12;

function normalizeBottomInset(inset = 0) {
  return Math.max(Number(inset) || 0, 0);
}

export function getFloatingTabBarBottomOffset(inset = 0) {
  return Math.max(normalizeBottomInset(inset), TAB_BAR_MIN_BOTTOM_GAP);
}

export function getFloatingTabBarHeight(inset = 0) {
  return TAB_BAR_BASE_HEIGHT + normalizeBottomInset(inset);
}

export function getTabBarContentBottomPadding(
  inset = 0,
  extraPadding = TAB_BAR_CONTENT_EXTRA_PADDING
) {
  return (
    getFloatingTabBarBottomOffset(inset) +
    getFloatingTabBarHeight(inset) +
    Math.max(Number(extraPadding) || 0, 0)
  );
}
