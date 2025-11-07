


const { Expo } = require('expo-server-sdk');
const expo = new Expo();

async function sendPushNotification(to, title, body, data = {}) {
  try {
    console.log('🔹 Tentative envoi notification:', { to, title, body, data });

    if (!to) {
      console.warn('⚠️ Aucun token fourni pour la notification.');
      return;
    }

    if (!Expo.isExpoPushToken(to)) {
      console.warn('⚠️ Token Expo invalide :', to);
      return;
    }

    const messages = [{
      to,
      sound: 'default',
      title,
      body,
      data,
    }];

    console.log('📨 Messages préparés pour Expo:', messages);

    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log('✅ Ticket envoyé à Expo:', ticketChunk);
      } catch (err) {
        console.error('❌ Erreur envoi chunk à Expo:', err);
      }
    }
  } catch (error) {
    console.error('❌ Erreur générale envoi notification:', error);
  }
}

module.exports = sendPushNotification;
