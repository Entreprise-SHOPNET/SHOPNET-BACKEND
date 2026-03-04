


const { Expo } = require('expo-server-sdk');
const expo = new Expo();

async function sendPushNotification(to, title, body, data = {}) {
  try {
    console.log('🔹 Tentative envoi notification:', { to, title, body, data });

    // Vérifier si un token est fourni
    if (!to) {
      console.warn('⚠️ Aucun token fourni pour la notification.');
      return;
    }

    // Vérifier si le token Expo est valide
    if (!Expo.isExpoPushToken(to)) {
      console.warn('⚠️ Token Expo invalide :', to);
      return;
    }

    console.log("📡 Envoi notification vers token :", to);

    // Message envoyé à Expo
    const messages = [
      {
        to,
        sound: "default",
        title,
        body,
        data,
        channelId: "default",   // important pour Android
        priority: "high"
      },
    ];

    console.log("📨 Messages préparés pour Expo :", messages);

    // Découper les messages si plusieurs
    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);

        // Analyse des réponses Expo
        for (const ticket of ticketChunk) {
          if (ticket.status === "ok") {
            console.log("✅ Notification acceptée par Expo. Ticket ID :", ticket.id);
          } else {
            console.error("❌ Notification refusée par Expo :", ticket);
          }
        }

      } catch (err) {
        console.error("❌ Erreur lors de l'envoi du chunk à Expo :", err);
      }
    }

  } catch (error) {
    console.error("❌ Erreur générale envoi notification :", error);
  }
}

module.exports = sendPushNotification;
