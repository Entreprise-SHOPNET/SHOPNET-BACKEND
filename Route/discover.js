

// Route/discover.js
const express = require('express');
const cors = require('cors');
const router = express.Router();
const db = require('../db'); // connexion à la base de données

// Autoriser CORS
router.use(cors());

// ✅ Vérification que la route est bien chargée
console.log("✅ Route /discover chargée");

// ======================
// Produits populaires - /discover
// ======================
router.get('/discover', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || null; // Optionnel
    const { sort_by = 'likes', limit = 20, page = 1 } = req.query;
    const limitNum = parseInt(limit, 10) || 20;
    const pageNum = parseInt(page, 10) || 1;
    const offset = (pageNum - 1) * limitNum;

    // Colonnes valides pour le tri
    const validSort = {
      likes: 'p.likes_count',
      views: 'p.views_count',
      comments: '(SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id)',
      shares: 'p.shares_count',
      cart: '(SELECT COUNT(*) FROM carts c WHERE c.product_id = p.id)',
      orders: '(SELECT COUNT(*) FROM commande_produits cp WHERE cp.produit_id = p.id)'
    };

    const sortColumn = validSort[sort_by] || 'p.likes_count';

    // ======================
    // ⚡ Requête SQL
    // ======================
    const [products] = await db.query(`
      SELECT 
        p.id, p.title, p.description, p.price, p.original_price, p.category, p.condition, 
        p.stock, p.location, p.created_at, p.likes_count, p.shares_count, p.views_count,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        (SELECT COUNT(*) FROM carts c WHERE c.product_id = p.id) AS cart_count,
        (SELECT COUNT(*) FROM commande_produits cp WHERE cp.produit_id = p.id) AS orders_count,
        ${userId ? `EXISTS(SELECT 1 FROM product_likes pl WHERE pl.user_id = ${db.escape(userId)} AND pl.product_id = p.id) AS isLiked,` : '0 AS isLiked,'}
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      ORDER BY ${sortColumn} DESC
      LIMIT ? OFFSET ?
    `, [limitNum, offset]);

    // ======================
    // Formatage
    // ======================
    const formatted = products.map(p => ({
      id: p.id,
      title: p.title,
      description: p.description,
      price: parseFloat(p.price) || 0,
      original_price: p.original_price ? parseFloat(p.original_price) : null,
      category: p.category,
      condition: p.condition,
      stock: parseInt(p.stock) || 0,
      location: p.location,
      created_at: p.created_at,
      likes: p.likes_count || 0,
      shares: p.shares_count || 0,
      comments: p.comments_count || 0,
      views: p.views_count || 0,
      inCart: p.cart_count || 0,
      ordered: p.orders_count || 0,
      isLiked: Boolean(p.isLiked),
      images: p.images || []
    }));

    res.json({
      success: true,
      count: formatted.length,
      page: pageNum,
      limit: limitNum,
      products: formatted
    });

  } catch (err) {
    console.error('❌ Erreur /discover:', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la récupération des produits populaires.' });
  }
});

// ✅ Export
module.exports = router;
