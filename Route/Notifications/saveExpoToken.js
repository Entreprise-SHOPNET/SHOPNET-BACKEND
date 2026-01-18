

/// Route/Notifications/saveExpoToken.js
/// Route/Notifications/saveExpoToken.js
const express = require('express');
const router = express.Router();

// POST /api/save-expo-token
router.post('/save-expo-token', async (req, res) => {
  try {
    console.log('🔹 Requête reçue pour enregistrer un Expo Push Token');
    console.log('🔹 Body reçu:', req.body);

    const db = req.db; // déjà attaché dans server.js
    const { userId, expoPushToken } = req.body;

    // Vérification des données reçues
    if (!userId || !expoPushToken) {
      console.warn('⚠️ userId ou expoPushToken manquant');
      return res.status(400).json({
        message: 'userId et expoPushToken sont requis.',
        receivedBody: req.body,
      });
    }

    console.log(`🔹 Tentative d'enregistrement du token pour userId: ${userId}`);
    console.log(`🔹 Token reçu: ${expoPushToken}`);

    // Mettre à jour l'utilisateur avec son token Expo
    const [result] = await db.query(
      'UPDATE utilisateurs SET expoPushToken = ? WHERE id = ?',
      [expoPushToken, Number(userId)]
    );

    console.log('🔹 Résultat de la requête UPDATE:', result);

    if (result.affectedRows === 0) {
      console.warn(`⚠️ Aucun utilisateur trouvé avec l'id: ${userId}`);
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    console.log(`✅ Expo Push Token enregistré pour l’utilisateur ${userId}`);
    return res.status(200).json({
      message: 'Token Expo enregistré avec succès.',
      token: expoPushToken,
      userId,
    });
  } catch (error) {
    console.error('❌ Erreur serveur lors de la sauvegarde du token Expo:', error);
    return res.status(500).json({
      message: 'Erreur serveur.',
      error: error.message,
    });
  }
});

module.exports = router;
