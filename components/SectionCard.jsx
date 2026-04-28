import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Reusable card wrapper for grouped UI sections.
 */
export default function SectionCard({ children, style, ...rest }) {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D0D5DD',
  },
});
