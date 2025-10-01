

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const db = require('../db');

// GET /api/products/discover
// Récupère les produits "découverte" triés par likes, shares, views, commandes ou ajout au panier
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const sortBy = req.query.sort_by || 'likes'; // likes, shares, views, orders, cart

    // Mapping des colonnes selon sort_by
    const sortColumns = {
      likes: 'p.likes_count',
      shares: 'p.shares_count',
      views: 'p.views_count',
      orders: 'COALESCE(op.orders_count, 0)',
      cart: 'COALESCE(cp.cart_count, 0)'
    };

    const orderBy = sortColumns[sortBy] || 'p.likes_count';

    // Requête principale
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        EXISTS (
          SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?
        ) AS isLiked,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        COALESCE(op.orders_count, 0) AS orders_count,
        COALESCE(cp.cart_count, 0) AS cart_count
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      LEFT JOIN (
        SELECT produit_id, COUNT(*) AS orders_count
        FROM commande_produits
        GROUP BY produit_id
      ) op ON op.produit_id = p.id
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS cart_count
        FROM carts
        GROUP BY product_id
      ) cp ON cp.product_id = p.id
      ORDER BY ${orderBy} DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    // Total pour pagination
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM products');

    // Formater le résultat
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title,
      description: product.description,
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      stock: parseInt(product.stock) || 0,
      category: product.category,
      condition: product.condition,
      location: product.location,
      created_at: product.created_at,
      updated_at: product.updated_at,
      likes: product.likes_count || 0,
      shares: product.shares_count || 0,
      views: product.views_count || 0,
      orders: product.orders_count || 0,
      cart_adds: product.cart_count || 0,
      comments: product.comments_count || 0,
      isLiked: Boolean(product.isLiked),
      images: product.images || [],
      seller: {
        id: product.seller_id?.toString(),
        name: product.seller_name || "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http') ? product.seller_avatar : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
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
    console.error('Erreur GET /discover:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
