

// Route /Route/discover.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/products/discover
router.get('/discover', async (req, res) => {
  try {
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
        (p.likes_count + p.views_count + p.shares_count +
          (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id)
        ) AS popularity_score
      FROM products p
      ORDER BY popularity_score DESC
      LIMIT 100
    `);

    // Formater le résultat
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title,
      price: parseFloat(product.price) || 0,
      image: product.images[0] || null // Première image uniquement
    }));

    res.json({
      success: true,
      count: formatted.length,
      products: formatted
    });

  } catch (error) {
    console.error('Erreur GET /discover:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
