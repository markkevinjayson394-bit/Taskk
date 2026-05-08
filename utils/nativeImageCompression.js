import { NativeModules, Platform, TurboModuleRegistry } from "react-native";

const NativeImageCompressionModule =
  NativeModules.NativeImageCompressionModule ??
  TurboModuleRegistry?.get?.("NativeImageCompressionModule");

export const canCompressNativeImages =
  Platform.OS === "android" &&
  Boolean(NativeImageCompressionModule) &&
  typeof NativeImageCompressionModule.compressImageToBase64 === "function";

export async function compressImageToBase64DataUri(uri, maxBytes) {
  if (!canCompressNativeImages || !uri) return null;

  const result = await NativeImageCompressionModule.compressImageToBase64(
    String(uri),
    Number(maxBytes)
  );
  if (!result || typeof result.base64 !== "string" || !result.base64.trim()) {
    return null;
  }

  const mimeType =
    typeof result.mimeType === "string" && result.mimeType.trim()
      ? result.mimeType.trim()
      : "image/jpeg";
  const sizeBytes = Number(result.sizeBytes);
  const width = Number(result.width);
  const height = Number(result.height);

  return {
    dataUri: `data:${mimeType};base64,${result.base64}`,
    mimeType,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
  };
}
