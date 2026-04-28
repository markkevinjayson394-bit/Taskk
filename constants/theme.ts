/**
 * App-wide design tokens for light and dark themes.
 */

import { Platform } from 'react-native';

const tintColorLight = '#2563eb';
const tintColorDark = '#3b82f6';

export const Colors = {
  light: {
    text: '#0f172a',
    background: '#f3f6fb',
    card: '#ffffff',
    surface: '#f8fbff',
    border: '#dbe3ee',
    primary: '#2563eb',
    danger: '#ef4444',
    success: '#16a34a',
    highlight: '#eaf2ff',
    dangerBg: '#fff5f5',
    shadow: 'rgba(15,23,42,0.08)',
    muted: '#64748b',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#f8fafc',
    background: '#0b1220',
    card: '#111c2e',
    surface: '#0f172a',
    border: '#24324a',
    primary: '#3b82f6',
    danger: '#ef4444',
    success: '#16a34a',
    highlight: '#1a2740',
    dangerBg: '#1f1010',
    shadow: 'rgba(2,6,23,0.6)',
    muted: '#e2e8f0',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
