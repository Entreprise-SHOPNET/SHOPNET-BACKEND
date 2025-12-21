

// backend/routes/admin/products.js
const express = require('express');
const router = express.Router();
const db = require('../../db'); // mysql2/promise

// =====================
// Dashboard Produits (sans token)
// =====================
router.get('/dashboard', async (req, res) => {
  try {
    // 1️⃣ Nombre total de produits actifs
    const [[{ totalProducts }]] = await db.query(
      `SELECT COUNT(*) AS totalProducts FROM products WHERE is_active = 1`
    );

    // 2️⃣ Produits ajoutés aujourd'hui
    const [[{ addedToday }]] = await db.query(
      `SELECT COUNT(*) AS addedToday FROM products WHERE DATE(created_at) = CURDATE()`
    );

    // 3️⃣ Produits supprimés ce mois (is_active = 0)
    const [[{ deletedThisMonth }]] = await db.query(
      `SELECT COUNT(*) AS deletedThisMonth FROM products WHERE is_active = 0 AND MONTH(updated_at) = MONTH(CURDATE())`
    );

    // 4️⃣ Produits les plus vus (top 10)
    const [mostViewed] = await db.query(
      `SELECT id, title, views_count 
       FROM products 
       WHERE is_active = 1 
       ORDER BY views_count DESC 
       LIMIT 10`
    );

    // 5️⃣ Catégories les plus utilisées
    const [categories] = await db.query(
      `SELECT category, COUNT(*) AS count 
       FROM products 
       WHERE is_active = 1 
       GROUP BY category 
       ORDER BY count DESC`
    );

    // 6️⃣ Top vendeurs actifs (top 10)
    const [topSellers] = await db.query(
      `SELECT u.id AS seller_id, u.fullName AS seller_name,
              COUNT(p.id) AS products_count,
              SUM(p.views_count) AS total_views,
              AVG(p.likes_count) AS avg_likes
       FROM products p
       JOIN utilisateurs u ON u.id = p.seller_id
       WHERE p.is_active = 1
       GROUP BY u.id
       ORDER BY products_count DESC, total_views DESC
       LIMIT 10`
    );

    return res.json({
      success: true,
      stats: {
        totalProducts,
        addedToday,
        deletedThisMonth
      },
      mostViewed,
      categories,
      topSellers
    });

  } catch (err) {
    console.error('❌ Erreur GET /admin/products/dashboard:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
