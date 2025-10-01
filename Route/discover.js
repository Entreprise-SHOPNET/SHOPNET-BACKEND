

const express = require('express');
const router = express.Router();
const db = require('../db');

// Utilitaire pour parser JSON en toute sécurité
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};

// GET /api/products/discover
// Récupère tous les produits, avec likes, shares, vues, commentaires et images Cloudinary
router.get('/discover', async (req, res) => {
  try {
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Requête principale
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.description,
        p.price,
        p.original_price,
        p.category,
        p.condition,
        p.stock,
        p.location,
        p.created_at,
        p.updated_at,
        p.likes_count,
        p.shares_count,
        p.views_count,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      ORDER BY p.views_count DESC, p.likes_count DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Total pour pagination
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM products');

    // Formatter les données
    const formatted = products.map(product => ({
      id: product.id,
      title: product.title || "Titre non disponible",
      description: product.description || "Description non disponible",
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      category: product.category || null,
      condition: product.condition || null,
      stock: parseInt(product.stock) || 0,
      location: product.location || null,
      created_at: product.created_at,
      updated_at: product.updated_at,
      likes: product.likes_count || 0,
      shares: product.shares_count || 0,
      views: product.views_count || 0,
      comments: product.comments_count || 0,
      images: safeJsonParse(product.images),
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
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
    console.error('Erreur GET /products/discover:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
