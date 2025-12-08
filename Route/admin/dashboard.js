

const express = require('express');
const router = express.Router();

// GET /api/admin/dashboard
router.get('/', async (req, res) => {
  try {
    const db = req.db;

    // 1️⃣ Total utilisateurs
    const [totalUsersResult] = await db.query(
      'SELECT COUNT(*) AS totalUsers FROM utilisateurs'
    );
    const totalUsers = totalUsersResult?.[0]?.totalUsers || 0;

    // 2️⃣ Nouveaux utilisateurs
    const [newTodayResult] = await db.query(`
      SELECT COUNT(*) AS newToday
      FROM utilisateurs
      WHERE DATE(date_inscription) = CURDATE()
    `);

    const newToday = newTodayResult?.[0]?.newToday || 0;

    const [newWeekResult] = await db.query(`
      SELECT COUNT(*) AS newWeek
      FROM utilisateurs
      WHERE YEARWEEK(date_inscription, 1) = YEARWEEK(CURDATE(), 1)
    `);

    const newWeek = newWeekResult?.[0]?.newWeek || 0;

    const [newMonthResult] = await db.query(`
      SELECT COUNT(*) AS newMonth
      FROM utilisateurs
      WHERE MONTH(date_inscription) = MONTH(CURDATE())
      AND YEAR(date_inscription) = YEAR(CURDATE())
    `);

    const newMonth = newMonthResult?.[0]?.newMonth || 0;

    // 3️⃣ Utilisateurs actifs
    const [dailyActiveResult] = await db.query(`
      SELECT COUNT(*) AS dailyActive
      FROM utilisateurs
      WHERE DATE(derniere_connexion) = CURDATE()
    `);
    const dailyActive = dailyActiveResult?.[0]?.dailyActive || 0;

    const [monthlyActiveResult] = await db.query(`
      SELECT COUNT(*) AS monthlyActive
      FROM utilisateurs
      WHERE MONTH(derniere_connexion) = MONTH(CURDATE())
      AND YEAR(derniere_connexion) = YEAR(CURDATE())
    `);
    const monthlyActive = monthlyActiveResult?.[0]?.monthlyActive || 0;

    // 4️⃣ Activité par ville
    const [activityByLocation] = await db.query(`
      SELECT ville AS city, COUNT(*) AS users
      FROM utilisateurs
      GROUP BY ville
    `);

    // 5️⃣ Croissance 7 derniers jours
    const [growth] = await db.query(`
      SELECT DATE(date_inscription) AS date, COUNT(*) AS count
      FROM utilisateurs
      WHERE date_inscription >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(date_inscription)
      ORDER BY DATE(date_inscription)
    `);

    res.json({
      success: true,
      totalUsers,
      newToday,
      newWeek,
      newMonth,
      dailyActive,
      monthlyActive,
      activityByLocation,
      growth
    });

  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des données du dashboard'
    });
  }
});

module.exports = router;
