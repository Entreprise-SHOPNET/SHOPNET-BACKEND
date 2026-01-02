



// backend/routes/analytics.js
const express = require('express');
const router = express.Router();
const db = require('..//..//db');
const authMiddleware = require('..//..//middlewares/authMiddleware');

// =============================================================================
// ANALYTICS GLOBALES DE LA BOUTIQUE
// GET /api/analytics/boutique/:boutiqueId
// =============================================================================
router.get('/boutique/:boutiqueId', authMiddleware, async (req, res) => {
  try {
    const { boutiqueId } = req.params;
    const period = parseInt(req.query.period) || 30; // Par défaut 30 jours
    const userId = req.userId;

    // Vérifier que la boutique appartient à l'utilisateur
    const [boutiqueCheck] = await db.query(
      'SELECT id FROM boutiques_premium WHERE id = ? AND utilisateur_id = ?',
      [boutiqueId, userId]
    );

    if (boutiqueCheck.length === 0) {
      return res.status(403).json({ 
        success: false, 
        error: 'Accès interdit à cette boutique' 
      });
    }

    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - period);

    // 1. Nombre total de produits
    const [totalProductsRes] = await db.query(
      'SELECT COUNT(*) as count FROM products WHERE seller_id = ? AND is_active = 1',
      [userId]
    );

    // 2. Vues totales
    const [totalViewsRes] = await db.query(
      `SELECT COUNT(*) as count 
       FROM product_views pv
       JOIN products p ON pv.product_id = p.id
       WHERE p.seller_id = ? AND pv.viewed_at >= ?`,
      [userId, dateLimit]
    );

    // 3. Likes totaux
    const [totalLikesRes] = await db.query(
      `SELECT COUNT(*) as count 
       FROM product_likes pl
       JOIN products p ON pl.product_id = p.id
       WHERE p.seller_id = ? AND pl.created_at >= ?`,
      [userId, dateLimit]
    );

    // 4. Shares totaux
    const [totalSharesRes] = await db.query(
      `SELECT COUNT(*) as count 
       FROM product_shares ps
       JOIN products p ON ps.product_id = p.id
       WHERE p.seller_id = ? AND ps.shared_at >= ?`,
      [userId, dateLimit]
    );

    // 5. Commentaires totaux
    const [totalCommentsRes] = await db.query(
      `SELECT COUNT(*) as count 
       FROM product_comments pc
       JOIN products p ON pc.product_id = p.id
       WHERE p.seller_id = ? AND pc.created_at >= ?`,
      [userId, dateLimit]
    );

    // 6. Ventes totales
    const [totalSalesRes] = await db.query(
      `SELECT IFNULL(SUM(cp.quantite), 0) as count
       FROM commande_produits cp
       JOIN commandes c ON cp.commande_id = c.id
       JOIN products p ON cp.produit_id = p.id
       WHERE p.seller_id = ? 
         AND c.status IN ('confirmee', 'livree')
         AND c.date_commande >= ?`,
      [userId, dateLimit]
    );

    // 7. Produits les plus populaires
    const [popularProducts] = await db.query(
      `SELECT 
         p.id,
         p.title as name,
         p.price as prix,
         p.category,
         p.status,
         COUNT(DISTINCT pv.id) as views,
         COUNT(DISTINCT pl.id) as likes,
         COUNT(DISTINCT pc.id) as comments,
         COUNT(DISTINCT ps.id) as shares,
         (SELECT IFNULL(SUM(cp.quantite), 0) 
          FROM commande_produits cp 
          JOIN commandes c ON cp.commande_id = c.id 
          WHERE cp.produit_id = p.id AND c.status IN ('confirmee', 'livree')) as sales
       FROM products p
       LEFT JOIN product_views pv ON p.id = pv.product_id AND pv.viewed_at >= ?
       LEFT JOIN product_likes pl ON p.id = pl.product_id AND pl.created_at >= ?
       LEFT JOIN product_comments pc ON p.id = pc.product_id AND pc.created_at >= ?
       LEFT JOIN product_shares ps ON p.id = ps.product_id AND ps.shared_at >= ?
       WHERE p.seller_id = ? AND p.is_active = 1
       GROUP BY p.id
       ORDER BY (views + (likes * 2) + (comments * 3) + (shares * 4) + (sales * 5)) DESC
       LIMIT 10`,
      [dateLimit, dateLimit, dateLimit, dateLimit, userId]
    );

    const analyticsData = {
      success: true,
      period_days: period,
      totalProducts: totalProductsRes[0]?.count || 0,
      totalViews: totalViewsRes[0]?.count || 0,
      totalLikes: totalLikesRes[0]?.count || 0,
      totalShares: totalSharesRes[0]?.count || 0,
      totalComments: totalCommentsRes[0]?.count || 0,
      totalSales: totalSalesRes[0]?.count || 0,
      popularProducts: popularProducts.map(product => ({
        id: product.id,
        name: product.name,
        prix: parseFloat(product.prix) || 0,
        category: product.category || 'Non catégorisé',
        status: product.status || 'active',
        views: product.views || 0,
        likes: product.likes || 0,
        comments: product.comments || 0,
        shares: product.shares || 0,
        sales: product.sales || 0
      }))
    };

    res.json(analyticsData);

  } catch (error) {
    console.error('Erreur analytics boutique:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des analytics' 
    });
  }
});

// =============================================================================
// ANALYTICS DÉTAILLÉES - Données journalières
// GET /api/analytics/boutique/:boutiqueId/daily
// =============================================================================
router.get('/boutique/:boutiqueId/daily', authMiddleware, async (req, res) => {
  try {
    const { boutiqueId } = req.params;
    const period = parseInt(req.query.period) || 7;
    const userId = req.userId;

    // Vérifier l'accès
    const [boutiqueCheck] = await db.query(
      'SELECT id FROM boutiques_premium WHERE id = ? AND utilisateur_id = ?',
      [boutiqueId, userId]
    );

    if (boutiqueCheck.length === 0) {
      return res.status(403).json({ success: false, error: 'Accès interdit' });
    }

    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - period);

    // Statistiques par jour
    const [dailyStats] = await db.query(
      `SELECT 
         DATE(date) as date,
         SUM(views) as views,
         SUM(likes) as likes,
         SUM(comments) as comments,
         SUM(shares) as shares,
         SUM(sales) as sales
       FROM (
         SELECT DATE(pv.viewed_at) as date, COUNT(*) as views, 0 as likes, 0 as comments, 0 as shares, 0 as sales
         FROM product_views pv
         JOIN products p ON pv.product_id = p.id
         WHERE p.seller_id = ? AND pv.viewed_at >= ?
         GROUP BY DATE(pv.viewed_at)
         UNION ALL
         SELECT DATE(pl.created_at) as date, 0 as views, COUNT(*) as likes, 0 as comments, 0 as shares, 0 as sales
         FROM product_likes pl
         JOIN products p ON pl.product_id = p.id
         WHERE p.seller_id = ? AND pl.created_at >= ?
         GROUP BY DATE(pl.created_at)
         UNION ALL
         SELECT DATE(pc.created_at) as date, 0 as views, 0 as likes, COUNT(*) as comments, 0 as shares, 0 as sales
         FROM product_comments pc
         JOIN products p ON pc.product_id = p.id
         WHERE p.seller_id = ? AND pc.created_at >= ?
         GROUP BY DATE(pc.created_at)
         UNION ALL
         SELECT DATE(ps.shared_at) as date, 0 as views, 0 as likes, 0 as comments, COUNT(*) as shares, 0 as sales
         FROM product_shares ps
         JOIN products p ON ps.product_id = p.id
         WHERE p.seller_id = ? AND ps.shared_at >= ?
         GROUP BY DATE(ps.shared_at)
         UNION ALL
         SELECT DATE(c.date_commande) as date, 0 as views, 0 as likes, 0 as comments, 0 as shares, SUM(cp.quantite) as sales
         FROM commande_produits cp
         JOIN commandes c ON cp.commande_id = c.id
         JOIN products p ON cp.produit_id = p.id
         WHERE p.seller_id = ? AND c.status IN ('confirmee', 'livree') AND c.date_commande >= ?
         GROUP BY DATE(c.date_commande)
       ) as combined
       GROUP BY date
       ORDER BY date ASC`,
      [userId, dateLimit, userId, dateLimit, userId, dateLimit, userId, dateLimit, userId, dateLimit]
    );

    // Remplir les jours manquants avec 0
    const completeStats = [];
    for (let i = period; i >= 0; i--) {
      const currentDate = new Date();
      currentDate.setDate(currentDate.getDate() - i);
      const dateStr = currentDate.toISOString().split('T')[0];

      const existingStat = dailyStats.find(stat => stat.date.toISOString().split('T')[0] === dateStr);

      completeStats.push({
        date: dateStr,
        views: existingStat?.views || 0,
        likes: existingStat?.likes || 0,
        comments: existingStat?.comments || 0,
        shares: existingStat?.shares || 0,
        sales: existingStat?.sales || 0
      });
    }

    res.json({
      success: true,
      period_days: period,
      daily_stats: completeStats
    });

  } catch (error) {
    console.error('Erreur analytics quotidiennes:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des données quotidiennes' 
    });
  }
});

module.exports = router;
