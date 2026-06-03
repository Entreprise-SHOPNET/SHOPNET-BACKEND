

// utils/sendSmartNotification.js
// utils/sendSmartNotification.js

const { generateNotification } = require("./notificationEngine");
const sendPushNotification = require("./sendPushNotification");

/**
 * 📢 Envoi notification intelligente SHOPNET
 */
async function sendSmartNotification(token, type, product, extra = {}) {
  try {
    if (!token) {
      console.log("⚠️ Token FCM manquant");
      return null;
    }

    // 🔥 Génération notification (avec image)
    const notif = generateNotification(
      type,
      product,
      extra.image || null
    );

    console.log("📡 Envoi Smart Notif :", {
      type,
      product,
      image: notif.image,
    });

    // 🔔 Envoi vers Firebase
    return await sendPushNotification(
      token,
      notif.title,
      notif.message,
      {
        ...extra,
        image: notif.image || null, // 🔥 IMPORTANT
        product,
        type,
      }
    );

  } catch (error) {
    console.error("❌ sendSmartNotification error:", error.message);
    return null;
  }
}

module.exports = sendSmartNotification;

