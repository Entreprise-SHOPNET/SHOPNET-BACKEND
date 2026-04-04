

const admin = require("firebase-admin");

// 🔥 éviter double initialisation
if (!admin.apps.length) {
  const serviceAccount = require("./serviceAccountKey.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase Admin initialisé avec succès");
} else {
  console.log("⚠️ Firebase déjà initialisé (réutilisation)");
}

module.exports = admin;