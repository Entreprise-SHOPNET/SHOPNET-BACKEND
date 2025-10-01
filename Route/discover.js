

// Route /Route/discover.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/products/discover?page=1&limit=5
router.get('/discover', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    // Requête pour récupérer les produits avec popularité
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        IFNULL(
          (SELECT JSON_ARRAYAGG(pi.absolute_url) 
           FROM product_images pi 
           WHERE pi.product_id = p.id), 
          JSON_ARRAY()
        ) AS images,
        COALESCE(p.likes_count, 0) AS likes_count,
        COALESCE(p.views_count, 0) AS views_count,
        COALESCE(p.shares_count, 0) AS shares_count,
        COALESCE((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id), 0) AS comments_count,
        (COALESCE(p.likes_count,0) + COALESCE(p.views_count,0) + COALESCE(p.shares_count,0) +
          COALESCE((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id),0)
        ) AS popularity_score
      FROM products p
      ORDER BY popularity_score DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Formater le résultat
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title || "Titre non disponible",
      price: parseFloat(product.price) || 0,
      image: product.images[0] || null,
      likes: product.likes_count,
      views: product.views_count,
      shares: product.shares_count,
      comments: product.comments_count,
      popularity_score: product.popularity_score
    }));

    // Compter le total des produits pour pagination
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM products`);

    res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: formatted.length,
      products: formatted
    });

  } catch (error) {
    console.error('Erreur GET /discover:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
