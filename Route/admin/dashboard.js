

// ========================================
// SHOPNET Admin Dashboard Backend
// Route: /api/admin/dashboard
// ========================================

const express = require('express');
const router = express.Router();

// GET /api/admin/dashboard
router.get('/', async (req, res) => {
  try {
    const db = req.db;

    // -------------------------
    // 1️⃣ Total utilisateurs
    // -------------------------
    const [totalUsersResult] = await db.query(
      'SELECT COUNT(*) AS totalUsers FROM utilisateurs'
    );
    const totalUsers = totalUsersResult?.[0]?.totalUsers || 0;

    // -------------------------
    // 2️⃣ Nouveaux utilisateurs
    // -------------------------
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

    // -------------------------
    // 3️⃣ Utilisateurs actifs
    // -------------------------
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

    // -------------------------
    // 4️⃣ Activité par ville
    // -------------------------
    const [activityByLocationResult] = await db.query(`
      SELECT ville AS city, COUNT(*) AS users
      FROM utilisateurs
      GROUP BY ville
      ORDER BY users DESC
    `);
    const activityByLocation = activityByLocationResult || [];

    // -------------------------
    // 5️⃣ Croissance 7 derniers jours
    // -------------------------
    const [growthResult] = await db.query(`
      SELECT DATE(date_inscription) AS date, COUNT(*) AS count
      FROM utilisateurs
      WHERE date_inscription >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(date_inscription)
      ORDER BY DATE(date_inscription)
    `);
    const growth = growthResult || [];

    // -------------------------
    // 6️⃣ Total produits
    // -------------------------
    const [totalProductsResult] = await db.query(`
      SELECT COUNT(*) AS totalProducts
      FROM products
    `);
    const totalProducts = totalProductsResult?.[0]?.totalProducts || 0;

    // -------------------------
    // 7️⃣ Produits supprimés
    // -------------------------
    const [deletedProductsResult] = await db.query(`
      SELECT COUNT(*) AS deletedProducts
      FROM products_deleted_logs
      WHERE MONTH(date_deleted) = MONTH(CURDATE())
        AND YEAR(date_deleted) = YEAR(CURDATE())
    `);
    const deletedProducts = deletedProductsResult?.[0]?.deletedProducts || 0;

    // -------------------------
    // 8️⃣ Produits bloqués
    // -------------------------
    const [blockedProductsResult] = await db.query(`
      SELECT COUNT(*) AS blockedProducts
      FROM products
      WHERE is_active = 0
    `);
    const blockedProducts = blockedProductsResult?.[0]?.blockedProducts || 0;

    // -------------------------
    // 9️⃣ Produits ajoutés ce mois
    // -------------------------
    const [productsThisMonthResult] = await db.query(`
      SELECT COUNT(*) AS productsThisMonth
      FROM products
      WHERE MONTH(created_at) = MONTH(CURDATE())
        AND YEAR(created_at) = YEAR(CURDATE())
    `);
    const productsThisMonth = productsThisMonthResult?.[0]?.productsThisMonth || 0;

    // -------------------------
    // 🔹 Nouveaux vendeurs aujourd'hui
    // -------------------------
    const [newVendorsResult] = await db.query(`
      SELECT COUNT(DISTINCT seller_id) AS newVendorsToday
      FROM products
      WHERE DATE(created_at) = CURDATE()
    `);
    const newVendorsToday = newVendorsResult?.[0]?.newVendorsToday || 0;

    // -------------------------
    // 🔟 Catégories actives
    // -------------------------
    let activeCategories = 0;
    try {
      const [activeCategoriesResult] = await db.query(`
        SELECT COUNT(*) AS activeCategories
        FROM categories
        WHERE statut = 'actif'
      `);
      activeCategories = activeCategoriesResult?.[0]?.activeCategories || 0;
    } catch {
      activeCategories = 0; // table categories peut ne pas exister
    }

    // -------------------------
    // Produits les plus vus (top 5)
    // -------------------------
    const [mostViewedResult] = await db.query(`
      SELECT title, views_count
      FROM products
      ORDER BY views_count DESC
      LIMIT 5
    `);
    const mostViewed = mostViewedResult || [];

    // -------------------------
    // Catégories les plus utilisées
    // -------------------------
    const [categoriesResult] = await db.query(`
      SELECT category, COUNT(*) AS count
      FROM products
      GROUP BY category
      ORDER BY count DESC
    `);
    const categories = categoriesResult || [];

    // -------------------------
    // 🔹 Réponse JSON complète
    // -------------------------
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
      totalProducts,
      deletedProducts,
      blockedProducts,
      productsThisMonth,
      newVendorsToday,
      activeCategories,
      mostViewed,
      categories
    });

  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des données du dashboard'
    });
  }
});



// -------------------------
// Mettre à jour l'activité utilisateur
// -------------------------
router.post('/update-activity', async (req, res) => {
  try {
    const userId = req.body.userId;
    if (!userId) return res.status(400).json({ success: false, message: "userId requis" });

    await req.db.query(`
      UPDATE utilisateurs
      SET derniere_connexion = NOW()
      WHERE id = ?
    `, [userId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



module.exports = router;
