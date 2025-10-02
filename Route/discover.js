


// routes/discover.js
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

// 🔹 Cloudinary config
const CLOUD_NAME = 'dddr7gb6w';
const CLOUD_FOLDER = 'mode';
const cloudinaryUrl = (publicId) => `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${CLOUD_FOLDER}/${publicId}.jpg`;

/**
 * GET /api/products/discover
 * Retourne une liste simple de produits avec images Cloudinary
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
        IFNULL((SELECT JSON_ARRAYAGG(public_id) 
                FROM product_images pi 
                WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_ids
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    // Total produits pour pagination
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM products`);

    // Formatage final
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
      images: safeJsonParse(product.image_ids).map(id => cloudinaryUrl(id)),
      seller: {
        id: product.seller_id?.toString(),
        name: product.seller_name ?? "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
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
    console.error("❌ Erreur GET /discover:", error);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

module.exports = router;
