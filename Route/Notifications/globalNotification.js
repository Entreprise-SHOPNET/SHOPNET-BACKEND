// 📄 Route/Notifications/globalNotification.js
// backend/Route/Notifications/globalNotification.js
const express = require('express');
const router = express.Router();
const messagesTypes = require('./messagesTypes'); // 🔹 import des messages

/**
 * Route pour envoyer des notifications globales aléatoires
 * POST /api/notify/random-global
 * Body optionnel: { priorite?: 'basse'|'normale'|'haute', maxParJour?: number }
 */
router.post('/random-global', async (req, res) => {
  try {
    const db = req.db;
    const io = req.io;
    const { priorite, maxParJour } = req.body;

    // 1️⃣ Récupérer tous les utilisateurs (vendeurs + acheteurs)
    const [utilisateurs] = await db.query(`
      SELECT id FROM utilisateurs WHERE role IN ('vendeur', 'acheteur')
    `);

    if (!utilisateurs || utilisateurs.length === 0) {
      return res.status(404).json({ message: 'Aucun utilisateur trouvé.' });
    }

    const dateNow = new Date();
    let notificationsSent = 0;

    // 2️⃣ Boucle sur chaque utilisateur
    for (const user of utilisateurs) {
      // Choisir un message aléatoire
      const randomIndex = Math.floor(Math.random() * messagesTypes.length);
      const message = messagesTypes[randomIndex];

      // 🔹 Vérifier si ce message a déjà été envoyé aujourd'hui
      const [existe] = await db.query(
        `SELECT * FROM notifications 
         WHERE utilisateur_id = ? AND titre = ? AND DATE(date_envoi) = CURDATE()`,
        [user.id, message.titre]
      );

      if (existe.length > 0) {
        console.log(`⚠️ Notification "${message.titre}" déjà envoyée à ${user.id} aujourd'hui.`);
        continue; // passer à l’utilisateur suivant
      }

      // 3️⃣ Insérer la notification dans la base
      await db.query(
        `INSERT INTO notifications 
          (utilisateur_id, cible, type, titre, contenu, lu, priorite, date_envoi, date_notification)
         VALUES (?, 'tous', 'info', ?, ?, 0, ?, ?, ?)`,
        [user.id, message.titre, message.contenu, priorite || 'normale', dateNow, dateNow]
      );

      // 4️⃣ Envoyer en temps réel via Socket.IO
      if (io) {
        io.emit('notification_global', {
          utilisateur_id: user.id,
          titre: message.titre,
          contenu: message.contenu,
          priorite: priorite || 'normale',
          date: dateNow,
        });
      }

      notificationsSent++;

      // Si maxParJour défini, arrêter après ce nombre
      if (maxParJour && notificationsSent >= maxParJour) break;
    }

    res.status(200).json({
      success: true,
      message: `Notifications aléatoires envoyées à ${notificationsSent} utilisateurs.`,
    });
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi aléatoire :', error);
    res.status(500).json({ success: false, message: 'Erreur serveur.', error });
  }
});

module.exports = router;
