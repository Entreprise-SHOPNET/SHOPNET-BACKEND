
const express = require('express');
const router = express.Router();
const db = require('../db');

// Utilitaire pour parser JSON safely
const safeJsonParse = (str) => {
  try { return str ? JSON.parse(str) : []; }
  catch { return []; }
};

// GET /discover?page=1&limit=5
router.get('/', async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    // Requête principale
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        p.likes_count,
        p.shares_count,
        p.views_count,
        IFNULL((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id), 0) AS comments_count,
        IFNULL((SELECT pi.absolute_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1), '') AS image
      FROM products p
      ORDER BY (p.likes_count + p.shares_count + IFNULL((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id),0) + p.views_count) DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Compter total produits
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM products');

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: products.length,
      products: products.map(p => ({
        id: p.id,
        title: p.title,
        price: parseFloat(p.price),
        image: p.image || null,
        likes: p.likes_count || 0,
        shares: p.shares_count || 0,
        views: p.views_count || 0,
        comments: p.comments_count || 0
      }))
    });

  } catch (err) {
    console.error('Erreur GET /discover :', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
