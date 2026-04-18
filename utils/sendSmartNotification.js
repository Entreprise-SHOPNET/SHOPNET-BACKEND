

// utils/sendSmartNotification.js

const admin = require("firebase-admin");
const { generateNotification } = require("./notificationEngine");

/**
 * Envoie une notification intelligente via FCM
 * @param {string} token - FCM token utilisateur
 * @param {string} type - type notification (cart_abandoned, trend, etc.)
 * @param {string} product - nom du produit
 * @param {object} extraData - données supplémentaires (optionnel)
 */
async function sendSmartNotification(token, type, product, extraData = {}) {
  try {
    if (!token) {
      console.log("❌ Token FCM manquant");
      return;
    }

    // 1. Générer message intelligent
    const notification = generateNotification(type, product);

    // 2. Construire message FCM
    const message = {
      token: token,
      notification: {
        title: notification.title,
        body: notification.message,
      },
      data: {
        type: type,
        product: product,
        ...Object.keys(extraData).reduce((acc, key) => {
          acc[key] = String(extraData[key]);
          return acc;
        }, {}),
      },
    };

    // 3. Envoi Firebase
    const response = await admin.messaging().send(message);

    console.log("✅ Notification envoyée :", response);

    return response;
  } catch (error) {
    console.error("❌ Erreur envoi notification :", error.message);
  }
}

module.exports = sendSmartNotification;

