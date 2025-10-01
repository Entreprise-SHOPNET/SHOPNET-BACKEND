

// Route: /Route/discover.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/products?limit=5&page=1
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Requête principale : récupère tous les produits triés par popularité
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        p.likes_count,
        p.shares_count,
        p.views_count,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      ORDER BY (p.likes_count + p.shares_count + p.views_count + 
                (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id)) DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Compter le total pour pagination
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM products');

    const formatted = products.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price) || 0,
      images: p.images || [],
      popularity: p.likes_count + p.shares_count + p.views_count + p.comments_count
    }));

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: formatted.length,
      products: formatted
    });

  } catch (err) {
    console.error('Erreur GET /discover:', err.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
