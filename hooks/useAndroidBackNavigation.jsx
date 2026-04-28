import { useNavigation, usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { BackHandler, Platform, ToastAndroid } from "react-native";

export function useAndroidBackNavigation({
  rootPath,
  exitMessage = "Press back again to exit",
}) {
  const navigation = useNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const lastBackPressRef = useRef(0);

  useEffect(() => {
    lastBackPressRef.current = 0;
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;

    const backSub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (navigation?.canGoBack?.()) {
        navigation.goBack();
        return true;
      }

      const currentPath = String(pathname || "");
      if (rootPath && currentPath && currentPath !== rootPath) {
        router.replace(rootPath);
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressRef.current = now;
      ToastAndroid.show(exitMessage, ToastAndroid.SHORT);
      return true;
    });

    return () => backSub.remove();
  }, [exitMessage, navigation, pathname, rootPath, router]);
}
