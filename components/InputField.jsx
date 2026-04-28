import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Shared InputField component used across WeeklySchedule and RegisterScreen.
 */
export default function InputField({
  inputRef,
  label,
  icon,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  rightElement,
  hint,
  hintColor,
  maxLength,
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.wrap}>
        {icon ? (
          <Ionicons
            name={icon}
            size={17}
            color="#94a3b8"
            style={styles.iconStyle}
          />
        ) : null}
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#cbd5e1"
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType || "default"}
          secureTextEntry={secureTextEntry || false}
          autoCapitalize={autoCapitalize ?? "sentences"}
          returnKeyType={returnKeyType || "next"}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={blurOnSubmit ?? false}
          maxLength={maxLength}
        />
        {rightElement || null}
      </View>
      {hint ? (
        <Text style={[styles.hint, hintColor ? { color: hintColor } : null]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 7,
  },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    paddingHorizontal: 14,
    height: 52,
  },
  iconStyle: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: "#0f172a" },
  hint: { fontSize: 11, color: "#94a3b8", marginTop: 4, marginLeft: 2 },
});