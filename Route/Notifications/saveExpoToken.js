

/// Route/Notifications/saveExpoToken.js
const express = require('express');
const router = express.Router();

// POST /api/save-expo-token
router.post('/save-expo-token', async (req, res) => {
  try {
    const db = req.db; // déjà attaché dans server.js
    const { userId, expoPushToken } = req.body;

    if (!userId || !expoPushToken) {
      return res.status(400).json({ message: 'userId et expoPushToken sont requis.' });
    }

    // Mettre à jour l'utilisateur avec son token Expo
    const [result] = await db.query(
      'UPDATE utilisateurs SET expoPushToken = ? WHERE id = ?',
      [expoPushToken, Number(userId)] // 👈 Conversion en nombre pour MySQL
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    console.log(`✅ Expo Push Token enregistré pour l’utilisateur ${userId}`);
    return res.status(200).json({ message: 'Token Expo enregistré avec succès.' });
  } catch (error) {
    console.error('❌ Erreur sauvegarde Expo Token:', error);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
