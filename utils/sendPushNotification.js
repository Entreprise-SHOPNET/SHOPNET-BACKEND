


const admin = require("../config/firebase"); // firebase-admin

async function sendPushNotification(token, title, body, data = {}) {
  try {
    if (!token) {
      console.log("⚠️ Token FCM manquant");
      return null;
    }

    console.log("📡 Envoi FCM vers :", token);

    const message = {
      token: token,

      notification: {
        title: title || "SHOPNET",
        body: body || "",
      },

      data: Object.keys(data || {}).reduce((acc, key) => {
        acc[key] = String(data[key]); // FCM exige STRING
        return acc;
      }, {}),

      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "default",
        },
      },

      apns: {
        payload: {
          aps: {
            sound: "default",
          },
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