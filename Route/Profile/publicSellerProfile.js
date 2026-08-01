const express = require("express");
const router = express.Router();
const db = require("../../db");

// ================================================================
// 1. ROUTE PROFIL VENDEUR (sans produits)
//    GET /api/sellers/:id
// ================================================================
router.get("/sellers/:id", async (req, res) => {
  const sellerId = req.params.id;

  try {
    const [sellerRows] = await db.query(
      `
      SELECT 
        id,
        fullName,
        email,
        phone,
        companyName,
        address,
        profile_photo,
        cover_photo,
        description,
        created_at
      FROM utilisateurs
      WHERE id = ?
      LIMIT 1
      `,
      [sellerId]
    );

    if (!sellerRows || sellerRows.length === 0) {
      return res.status(404).json({ success: false, error: "Vendeur non trouvé" });
    }

    const seller = sellerRows[0];

    const formattedSeller = {
      id: seller.id,
      name: seller.fullName,
      email: seller.email || null,
      phone: seller.phone || null,
      companyName: seller.companyName || null,
      address: seller.address || null,
      profilePhoto: seller.profile_photo
        ? seller.profile_photo.startsWith("http")
          ? seller.profile_photo
          : `${req.protocol}://${req.get("host")}${seller.profile_photo}`
        : null,
      coverPhoto: seller.cover_photo
        ? seller.cover_photo.startsWith("http")
          ? seller.cover_photo
          : `${req.protocol}://${req.get("host")}${seller.cover_photo}`
        : null,
      description: seller.description || null,
      memberSince: seller.created_at,
    };

    return res.json({ success: true, seller: formattedSeller });
  } catch (error) {
    console.error("Erreur GET /sellers/:id:", error.message);
    return res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

// ================================================================
// 2. ROUTE PRODUITS DU VENDEUR (PAGINÉE)
//    GET /api/sellers/:id/products?page=1&limit=10
// ================================================================
router.get("/sellers/:id/products", async (req, res) => {
  const sellerId = req.params.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [sellerCheck] = await db.query(
      "SELECT id FROM utilisateurs WHERE id = ? LIMIT 1",
      [sellerId]
    );
    if (!sellerCheck || sellerCheck.length === 0) {
      return res.status(404).json({ success: false, error: "Vendeur non trouvé" });
    }

    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) AS total FROM products WHERE seller_id = ?",
      [sellerId]
    );

    const [products] = await db.query(
      `
      SELECT 
        p.id,
        p.title,
        p.description,
        p.price,
        p.original_price,
        p.stock,
        p.category,
        p.condition,
        p.created_at,
        IFNULL(
          (SELECT JSON_ARRAYAGG(pi.absolute_url) 
           FROM product_images pi 
           WHERE pi.product_id = p.id), 
          JSON_ARRAY()
        ) AS images
      FROM products p
      WHERE p.seller_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
      `,
      [sellerId, limit, offset]
    );

    const formattedProducts = products.map((prod) => ({
      id: prod.id,
      title: prod.title,
      description: prod.description,
      price: parseFloat(prod.price),
      original_price: prod.original_price ? parseFloat(prod.original_price) : null,
      stock: parseInt(prod.stock) || 0,
      category: prod.category,
      condition: prod.condition,
      created_at: prod.created_at,
      images: prod.images || [],
    }));

    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
      products: formattedProducts,
    });
  } catch (error) {
    console.error("Erreur GET /sellers/:id/products:", error.message);
    return res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

module.exports = router;
