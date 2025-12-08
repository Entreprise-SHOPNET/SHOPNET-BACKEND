

const express = require('express');
const router = express.Router();

/**
 * Route GET /api/admin/dashboard
 * Retourne toutes les statistiques nécessaires pour le Dashboard Utilisateurs
 */
router.get('/', async (req, res) => {
  try {
    const db = req.db;

    // ----- 1. Nombre total d’utilisateurs -----
    const [totalUsersResult] = await db.query(`SELECT COUNT(*) AS totalUsers FROM utilisateurs`);
    const totalUsers = totalUsersResult[0].totalUsers;

    // ----- 2. Nouveaux utilisateurs -----
    const [newTodayResult] = await db.query(`
      SELECT COUNT(*) AS newToday 
      FROM utilisateurs 
      WHERE DATE(createdAt) = CURDATE()
    `);
    const newToday = newTodayResult[0].newToday;

    const [newWeekResult] = await db.query(`
      SELECT COUNT(*) AS newWeek
      FROM utilisateurs
      WHERE YEARWEEK(createdAt, 1) = YEARWEEK(CURDATE(), 1)
    `);
    const newWeek = newWeekResult[0].newWeek;

    const [newMonthResult] = await db.query(`
      SELECT COUNT(*) AS newMonth
      FROM utilisateurs
      WHERE MONTH(createdAt) = MONTH(CURDATE()) AND YEAR(createdAt) = YEAR(CURDATE())
    `);
    const newMonth = newMonthResult[0].newMonth;

    // ----- 3. Utilisateurs actifs -----
    const [dailyActiveResult] = await db.query(`
      SELECT COUNT(*) AS dailyActive
      FROM utilisateurs
      WHERE DATE(lastLogin) = CURDATE()
    `);
    const dailyActive = dailyActiveResult[0].dailyActive;

    const [monthlyActiveResult] = await db.query(`
      SELECT COUNT(*) AS monthlyActive
      FROM utilisateurs
      WHERE MONTH(lastLogin) = MONTH(CURDATE()) AND YEAR(lastLogin) = YEAR(CURDATE())
    `);
    const monthlyActive = monthlyActiveResult[0].monthlyActive;

    // ----- 4. Nombre total de connexions -----
    const [connectionsResult] = await db.query(`
      SELECT SUM(connections) AS totalConnections FROM utilisateurs
    `);
    const totalConnections = connectionsResult[0].totalConnections || 0;

    // ----- 5. Activité par ville ou pays -----
    const [activityByLocation] = await db.query(`
      SELECT city AS location, COUNT(*) AS users, SUM(connections) AS connections
      FROM utilisateurs
      GROUP BY city
    `);

    // ----- 6. Croissance utilisateurs (exemple des 7 derniers jours) -----
    const [growth] = await db.query(`
      SELECT DATE(createdAt) AS date, COUNT(*) AS count
      FROM utilisateurs
      WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(createdAt)
      ORDER BY DATE(createdAt)
    `);

    // ----- Réponse JSON -----
    res.json({
      success: true,
      totalUsers,
      newToday,
      newWeek,
      newMonth,
      dailyActive,
      monthlyActive,
      totalConnections,
      activityByLocation,
      growth
    });

  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des données du dashboard' });
  }
});

module.exports = router;
