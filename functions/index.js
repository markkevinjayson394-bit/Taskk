const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.setDefaultRole = functions.auth.user().onCreate(async (user) => {
  const profile = {
    role: "student",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (user.email) {
    profile.email = user.email;
  }

  await admin.firestore().doc(`users/${user.uid}`).set(profile, { merge: true });
  return null;
});
