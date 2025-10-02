

// Route: /api/products-discover
const express = require('express');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');

// GET /api/products-discover
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 8;
    const offset = (page - 1) * limit;

    // Récupérer les produits avec stats et mise en avant
    const query = `
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        (SELECT COUNT(*) FROM product_likes pl WHERE pl.product_id = p.id) AS likes_count,
        (SELECT COUNT(*) FROM product_shares ps WHERE ps.product_id = p.id) AS shares_count,
        (SELECT COUNT(*) FROM carts c WHERE c.product_id = p.id) AS cart_count,
        (SELECT IFNULL(SUM(cp.quantite),0) FROM commande_produits cp WHERE cp.produit_id = p.id) AS order_count,
        EXISTS (
          SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?
        ) AS isLiked,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      ORDER BY p.is_featured DESC, 
               ((likes_count*3) + (shares_count*2) + (comments_count*1.5) + (cart_count*2) + (order_count*5) + views_count) DESC
      LIMIT ? OFFSET ?
    `;

    const params = [userId, limit, offset];
    const [products] = await db.query(query, params);

    // Compter le total
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM products');

    // Formater les données
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
      updated_at: p.updated_at,
      views: p.views_count || 0,
      likes: p.likes_count || 0,
      shares: p.shares_count || 0,
      comments: p.comments_count || 0,
      cart_count: p.cart_count || 0,
      orders_count: p.order_count || 0,
      isLiked: Boolean(p.isLiked),
      images: p.images || [],
      seller: {
        id: p.seller_id?.toString(),
        name: p.seller_name || "Vendeur inconnu",
        avatar: p.seller_avatar
          ? (p.seller_avatar.startsWith('http')
              ? p.seller_avatar
              : `${req.protocol}://${req.get('host')}${p.seller_avatar}`)
          : null
      }
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
    console.error('Erreur GET /products-discover:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
