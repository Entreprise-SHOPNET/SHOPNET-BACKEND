// backend/Route/Notifications/notificationsRoute.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');

// GET /api/notifications?page=1&limit=10
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = req.db;

    // Utilisateur actuellement connecté
    const utilisateurId = req.userId;

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [notifications] = await db.query(
      `SELECT *
       FROM notifications
       WHERE utilisateur_id = ?
       ORDER BY date_notification DESC
       LIMIT ? OFFSET ?`,
      [utilisateurId, limit, offset]
    );

    res.status(200).json({
      success: true,
      notifications
    });

  } catch (error) {
    console.error('Erreur récupération notifications:', error);

    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;
