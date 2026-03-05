// firebaseConfig.js
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import {
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyATU3db7Insdhl0SBT1-AlsaO6_vXyG8i4",
  authDomain: "my-expo-auth-app-290eb.firebaseapp.com",
  projectId: "my-expo-auth-app-290eb",
  storageBucket: "my-expo-auth-app-290eb.appspot.com",
  messagingSenderId: "719496561355",
  appId: "1:719496561355:web:250898c948e69d1d42d14e",
  measurementId: "G-BZN4MKH8MR",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ Initialize Auth with AsyncStorage persistence
const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});

// Firestore & Storage
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };

