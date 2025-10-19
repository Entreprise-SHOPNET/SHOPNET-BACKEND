

const express = require("express");
const router = express.Router();
const db = require("../../db");

// Fonction utilitaire pour parser un champ JSON depuis MySQL
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};

// Route publique : profil d’un vendeur + ses produits
router.get("/sellers/:id", async (req, res) => {
  const sellerId = req.params.id;

  try {
    // Récupère le vendeur par son id (sans filtre sur email_verified)
    const [sellerRows] = await db.query(
      `
      SELECT 
        id,
        fullName,
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
      [sellerId],
    );

    if (!sellerRows || sellerRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Vendeur non trouvé" });
    }

    const seller = sellerRows[0];

    // Récupère les produits du vendeur
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
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      WHERE p.seller_id = ?
      ORDER BY p.created_at DESC
    `,
      [sellerId],
    );

    const formattedProducts = products.map((prod) => ({
      id: prod.id,
      title: prod.title,
      description: prod.description,
      price: parseFloat(prod.price),
      original_price: prod.original_price
        ? parseFloat(prod.original_price)
        : null,
      stock: parseInt(prod.stock) || 0,
      category: prod.category,
      condition: prod.condition,
      created_at: prod.created_at,
      images: prod.images || [],
    }));

    const formattedSeller = {
      id: seller.id,
      name: seller.fullName,
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
      products: formattedProducts,
    };

    return res.json({ success: true, seller: formattedSeller });
  } catch (error) {
    console.error("Erreur GET /sellers/:id:", error.message);
    return res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});








//// PUBLIE PRODUIT DE LA BOUT

// ----------------------------
// POST /products — Création produit + liaison à la boutique du vendeur
// ----------------------------
router.post("/", authMiddleware, (req, res) => {
  upload(req, res, async (err) => {
    let connection;
    try {
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }

      const {
        title,
        price,
        category,
        condition,
        stock,
        location,
        description,
      } = req.body;
      if (!title || title.trim().length < 3)
        throw new Error("Titre trop court");
      if (!price || isNaN(parseFloat(price))) throw new Error("Prix invalide");

      const sellerId = req.userId;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // 🔎 Récupérer la boutique du vendeur connecté
      const [boutiqueRows] = await connection.query(
        "SELECT id FROM boutiques WHERE userId = ? LIMIT 1",
        [sellerId],
      );
      if (boutiqueRows.length === 0)
        throw new Error("Aucune boutique trouvée pour cet utilisateur");

      const boutiqueId = boutiqueRows[0].id;

      // 🧾 Création du produit
      const [productResult] = await connection.query(
        `
        INSERT INTO products (title, description, price, category, condition, stock, location, seller_id, boutique_id, likes_count, shares_count, comments_count, views_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0)
      `,
        [
          title,
          description,
          parseFloat(price),
          category || "autre",
          condition || "neuf",
          stock ? parseInt(stock) : 0,
          location || null,
          sellerId,
          boutiqueId,
        ],
      );

      const productId = productResult.insertId;
      const uploadedImages = [];

      // 📤 Upload images vers Cloudinary
      if (req.files?.length > 0) {
        for (const file of req.files) {
          const uploadResult = await uploadToCloudinary(file.buffer, {
            folder: "shopnet/products",
            resource_type: "image",
            public_id: `product_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          });

          await connection.query(
            "INSERT INTO product_images (product_id, image_path, absolute_url) VALUES (?, ?, ?)",
            [productId, uploadResult.public_id, uploadResult.secure_url],
          );

          uploadedImages.push({
            public_id: uploadResult.public_id,
            url: uploadResult.secure_url,
          });
        }
      }

      await connection.commit();
      connection.release();

      res.status(201).json({
        success: true,
        message: "Produit ajouté avec succès à votre boutique",
        productId,
        images: uploadedImages,
      });
    } catch (error) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      console.error("Erreur POST /products:", error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });
});

/// GET RECUPERER L E PRODUIT DE LA BOUTIQUE
// ----------------------------
// GET /products/my — Produits du propriétaire connecté
// ----------------------------
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    const [products] = await db.query(
      `
      SELECT 
        p.*,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) 
                FROM product_images pi 
                WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      WHERE p.seller_id = ?
      ORDER BY p.created_at DESC
    `,
      [userId],
    );

    res.json({
      success: true,
      count: products.length,
      products: products.map((p) => ({
        ...p,
        price: parseFloat(p.price) || 0,
        stock: parseInt(p.stock) || 0,
        images: p.images || [],
      })),
    });
  } catch (error) {
    console.error("Erreur GET /products/my:", error.message);
    res.status(500).json({ success: false, error: "Erreur serveur" });
  }
});

module.exports = router;
