


// Route: /Route/discover.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Fonction utilitaire pour parser JSON
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};

// GET /api/products/discover
// Récupère tous les produits triés par popularité
router.get('/', async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    // Requête principale : récupère tous les produits triés par popularité
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) 
                FROM product_images pi 
                WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls,
        p.likes_count,
        p.views_count,
        p.shares_count,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        (p.likes_count + p.views_count + p.shares_count + 
          (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id)) AS popularity
      FROM products p
      ORDER BY popularity DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Compter le total pour pagination
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM products`);

    // Formater le résultat
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title || 'Titre non disponible',
      price: parseFloat(product.price) || 0,
      images: safeJsonParse(product.image_urls),
      likes: product.likes_count || 0,
      views: product.views_count || 0,
      shares: product.shares_count || 0,
      comments: product.comments_count || 0
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

  } catch (error) {
    console.error('Erreur GET /discover:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
