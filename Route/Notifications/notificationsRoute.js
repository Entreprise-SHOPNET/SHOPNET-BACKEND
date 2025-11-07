// backend/Route/Notifications/notificationsRoute.js
const express = require('express');
const router = express.Router();

// GET /api/notifications?page=1&limit=10
router.get('/', async (req, res) => {
  try {
    const db = req.db;

    // Pagination
    const page = parseInt(req.query.page) || 1; // page actuelle
    const limit = parseInt(req.query.limit) || 10; // nombre de notifications par page
    const offset = (page - 1) * limit;

    const [notifications] = await db.query(
      `SELECT * FROM notifications
       ORDER BY date_notification DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error('Erreur récupération notifications:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;
