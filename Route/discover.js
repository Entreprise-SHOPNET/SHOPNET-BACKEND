

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/products/discover
// Récupère tous les produits triés par popularité (likes, comments, shares, views)
// Pagination avec ?page=1&limit=10
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // Requête pour récupérer les produits
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        IFNULL((SELECT pi.absolute_url FROM product_images pi WHERE pi.product_id = p.id LIMIT 1), '') AS image,
        p.likes_count,
        p.shares_count,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        p.views_count
      FROM products p
      ORDER BY (p.likes_count + p.shares_count + p.views_count + 
                (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id)) DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Compter le total pour pagination
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM products`);

    // Formater les résultats
    const formatted = products.map(p => ({
      id: p.id,
      title: p.title || 'Titre non disponible',
      price: parseFloat(p.price) || 0,
      image: p.image || null,
      likes: p.likes_count || 0,
      shares: p.shares_count || 0,
      comments: p.comments_count || 0,
      views: p.views_count || 0
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
