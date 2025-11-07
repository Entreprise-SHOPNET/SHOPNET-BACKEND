

// Route/Notifications/compteurNonLus.js
const express = require('express');
const router = express.Router();

// Obtenir le nombre de notifications non lues pour un utilisateur
router.get('/unreadCount/:userId', async (req, res) => {
  const { userId } = req.params;
  const db = req.db;

  try {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS unreadCount FROM notifications WHERE utilisateur_id = ? AND lu = 0',
      [userId]
    );
    res.json({ unreadCount: rows[0].unreadCount });
  } catch (error) {
    console.error('❌ Erreur récupérer compteur non lus:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Marquer toutes les notifications comme lues pour un utilisateur
router.post('/markAsRead/:userId', async (req, res) => {
  const { userId } = req.params;
  const db = req.db;

  try {
    await db.query(
      'UPDATE notifications SET lu = 1 WHERE utilisateur_id = ? AND lu = 0',
      [userId]
    );
    res.json({ success: true, message: 'Notifications marquées comme lues' });
  } catch (error) {
    console.error('❌ Erreur marquer notifications comme lues:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;
