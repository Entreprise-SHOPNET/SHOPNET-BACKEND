

const admin = require("../config/firebase");

async function sendPushNotification(token, title, body, data = {}) {
  try {
    if (!token) {
      console.log("⚠️ Token FCM manquant");
      return null;
    }

    console.log("📡 Envoi FCM vers :", token);

    const message = {
      token,

      notification: {
        title: title || "SHOPNET",
        body: body || "",
      },

      data: Object.keys(data || {}).reduce((acc, key) => {
        acc[key] = String(data[key]);
        return acc;
      }, {}),

      // ✅ ANDROID CORRIGÉ (IMPORTANT)
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "default",

          // 🔥 AJOUT IMAGE ICI
          imageUrl: data.image || undefined,
        },
      },

      // ✅ iOS (optionnel mais propre)
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
        fcm_options: {
          image: data.image || undefined,
        },
      },
    };

    const response = await admin.messaging().send(message);

    console.log("✅ FCM envoyé avec succès :", response);

    return response;

  } catch (error) {
    console.error("❌ Erreur FCM :", error.message);
    return null;
  }
}

module.exports = sendPushNotification;
