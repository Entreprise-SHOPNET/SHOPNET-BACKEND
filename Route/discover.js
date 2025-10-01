

const express = require('express');
const router = express.Router();
const db = require('../db');

// ----------------------------
// GET /api/products/discover
// Récupère tous les produits avec stats (likes, vues, commentaires) et images Cloudinary
// ----------------------------
router.get('/discover', async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        p.likes_count AS likes,
        p.views_count AS views,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      ORDER BY p.likes_count DESC, p.views_count DESC, comments DESC
      LIMIT 100
    `);

    // Formatter la réponse
    const formatted = products.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      likes: p.likes,
      views: p.views,
      comments: p.comments,
      images: p.images || []
    }));

    res.json({ success: true, count: formatted.length, products: formatted });
  } catch (error) {
    console.error('Erreur GET /products/discover:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
