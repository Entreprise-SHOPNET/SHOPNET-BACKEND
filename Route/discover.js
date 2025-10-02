

const express = require('express');
const router = express.Router();
const db = require('../db');

// 🔧 Helper pour parser JSON
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};

// 🔹 Cloudinary base URL
const CLOUD_NAME = 'dddr7gb6w';
const CLOUD_FOLDER = 'mode'; // ton dossier sur Cloudinary
const cloudinaryUrl = (publicId) => `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${CLOUD_FOLDER}/${publicId}.jpg`;

/**
 * GET /api/products/discover
 * Retourne les produits populaires selon le trend_score global
 */
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        -- images stockées comme public_id sur Cloudinary
        IFNULL((SELECT JSON_ARRAYAGG(pi.public_id) 
                FROM product_images pi 
                WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_ids,

        -- nombre de commentaires
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,

        -- nombre d'ajouts au panier
        (SELECT COUNT(*) FROM carts c WHERE c.product_id = p.id) AS cart_count,

        -- nombre de commandes
        (SELECT COUNT(*) FROM commande_produits cp WHERE cp.produit_id = p.id) AS orders_count,

        -- Score tendance
        (
          (p.likes_count * 2) +
          (p.shares_count * 3) +
          (p.views_count * 1) +
          ((SELECT COUNT(*) FROM carts c WHERE c.product_id = p.id) * 4) +
          ((SELECT COUNT(*) FROM commande_produits cp WHERE cp.produit_id = p.id) * 5) +
          ((SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) * 2)
        ) AS trend_score

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      ORDER BY trend_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Total produits
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM products`);

    const formatted = rows.map(product => ({
      id: product.id,
      title: product.title ?? "Titre non disponible",
      description: product.description ?? null,
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
      comments: product.comments_count || 0,
      cart_count: product.cart_count || 0,
      orders_count: product.orders_count || 0,
      images: safeJsonParse(product.image_ids).map(id => cloudinaryUrl(id)),
      seller: {
        id: product.seller_id?.toString(),
        name: product.seller_name ?? "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
      },
      trend_score: product.trend_score
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
    console.error("❌ Erreur GET /discover:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

module.exports = router;
