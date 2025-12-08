

const express = require('express');
const router = express.Router();

// GET /api/admin/dashboard
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    console.log('[DASHBOARD] Début récupération des statistiques');

    // 1️⃣ Nombre total d’utilisateurs
    const [totalUsersResult] = await db.query(
      'SELECT COUNT(*) AS totalUsers FROM utilisateurs'
    );
    const totalUsers = totalUsersResult?.[0]?.totalUsers || 0;
    console.log('[DASHBOARD] totalUsers:', totalUsers);

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

    console.log('[DASHBOARD] Nouveaux utilisateurs:', {
      newToday,
      newWeek,
      newMonth,
    });

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

    console.log('[DASHBOARD] Utilisateurs actifs:', {
      dailyActive,
      monthlyActive,
    });

    // 4️⃣ Activité par ville
    const [activityByLocation] = await db.query(`
      SELECT ville AS location, COUNT(*) AS users
      FROM utilisateurs
      GROUP BY ville
    `);
    console.log('[DASHBOARD] activityByLocation:', activityByLocation);

    // 5️⃣ Croissance sur les 7 derniers jours
    const [growth] = await db.query(`
      SELECT DATE(date_inscription) AS date, COUNT(*) AS count 
      FROM utilisateurs 
      WHERE date_inscription >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(date_inscription)
      ORDER BY DATE(date_inscription)
    `);
    console.log('[DASHBOARD] growth:', growth);

    // 6️⃣ Réponse finale
    res.json({
      success: true,
      totalUsers,
      newToday,
      newWeek,
      newMonth,
      dailyActive,
      monthlyActive,
      activityByLocation,
      growth,
    });

  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des données du dashboard',
    });
  }
});

module.exports = router;
