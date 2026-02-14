
const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

router.use(cors({
  origin: [
    'http://100.64.134.89:5000', 
    'http://100.64.134.89',
    'https://100.64.134.89:5000' // Ajoutez votre URL Render ici
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Multer en mémoire (pas de fichier local)
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (validTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Seules les images JPEG/PNG/WEBP sont acceptées'), false);
};
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter
}).array('images', 5);

// Fonction utilitaire : upload buffer vers Cloudinary en Promise
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// Fonctions utilitaires existantes pour GET routes (reste inchangé)
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};

// ----------------------------
// GET /products — Liste complète (inchangé)
// ----------------------------
// ----------------------------
// GET /products — FEED PUBLIC
// ----------------------------
router.get('/', async (req, res) => {
  try {
    const userId = req.headers.authorization ? req.userId : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const parseJson = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      try { return JSON.parse(value); } catch { return []; }
    };

    // Récupération des produits depuis la base
    const [products] = await db.query(`
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        (SELECT JSON_ARRAYAGG(
            CASE
              WHEN pi.absolute_url IS NOT NULL AND pi.absolute_url != ''
              THEN pi.absolute_url
              ELSE pi.image_path
            END
          )
          FROM product_images pi
          WHERE pi.product_id = p.id
        ) AS image_urls,
        p.likes_count,
        p.shares_count,
        ${userId ? `EXISTS (
          SELECT 1 FROM product_likes pl
          WHERE pl.product_id = p.id AND pl.user_id = ${db.escape(userId)}
        )` : '0'} AS isLiked
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
      ORDER BY 
        p.is_boosted DESC,
        p.boost_priority DESC,
        p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM products WHERE is_active = 1`
    );

    const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

    // Formatage final pour le frontend
    const formatted = products.map(p => {
      const parsedImages = parseJson(p.image_urls).map(img =>
        img.startsWith("http") ? img : `${CLOUDINARY_BASE}${img}`
      );

      return {
        id: p.id.toString(),
        title: p.title,
        description: p.description,
        price: Number(p.price),
        original_price: p.original_price ? Number(p.original_price) : null,
        images: parsedImages,      // affichage front
        image_urls: parsedImages,  // communique correctement avec le frontend
        likes: p.likes_count || 0,
        shares: p.shares_count || 0,
        comments: p.comments_count || 0,
        isLiked: Boolean(p.isLiked),
        isPromotion: Boolean(p.is_boosted),
        seller: {
          id: p.seller_id?.toString(),
          name: p.seller_name || 'Vendeur inconnu',
          avatar: p.seller_avatar
            ? p.seller_avatar.startsWith('http')
              ? p.seller_avatar
              : `${req.protocol}://${req.get('host')}${p.seller_avatar}`
            : 'https://via.placeholder.com/40'
        }
      };
    });

    res.json({
      success: true,
      page,
      totalPages: Math.ceil(total / limit),
      products: formatted
    });

  } catch (err) {
    console.error('GET /products error:', err);
    res.status(500).json({ success: false });
  }
});




// ----------------------------
// POST /products — Création produit avec Cloudinary et boost auto pour Premium
// ----------------------------
router.post('/', authMiddleware, (req, res) => {
  upload(req, res, async (err) => {
    let connection;
    try {
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }

      const {
        title,
        price,
        original_price,
        category,
        condition,
        stock,
        location,
        description
      } = req.body;

      if (!title || title.trim().length < 3) throw new Error('Titre trop court');

      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice)) throw new Error('Prix invalide');

      const sellerId = req.userId;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // ------------------
      // Créer le produit
      // ------------------
      const productData = {
        title: title.trim(),
        description: description?.trim() || null,
        price: parsedPrice,
        original_price: original_price ? parseFloat(original_price) : null,
        category: category || 'autre',
        condition: condition || 'neuf',
        stock: stock ? parseInt(stock) : 0,
        location: location?.trim() || null,
        seller_id: sellerId,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        views_count: 0,
        is_boosted: 0 // par défaut
      };

      const [productResult] = await connection.query(
        'INSERT INTO products SET ?',
        [productData]
      );
      const productId = productResult.insertId;

      // ------------------
      // Upload images Cloudinary
      // ------------------
      let uploadedImages = [];
      if (req.files?.length > 0) {
        for (const file of req.files) {
          const uploadResult = await uploadToCloudinary(file.buffer, {
            folder: 'shopnet',
            resource_type: 'image',
            public_id: `product_${Date.now()}_${Math.floor(Math.random() * 10000)}`
          });

          await connection.query(
            'INSERT INTO product_images (product_id, image_path, absolute_url, is_primary, created_at) VALUES (?, ?, ?, ?, NOW())',
            [productId, uploadResult.public_id, uploadResult.secure_url, 1]
          );

          uploadedImages.push({
            public_id: uploadResult.public_id,
            url: uploadResult.secure_url,
          });
        }
      }

      // ------------------
      // Vérifier si le vendeur a une boutique Premium
      // ------------------
      const [premiumRows] = await connection.query(
        'SELECT id FROM boutiques_premium WHERE utilisateur_id = ? AND statut IN (?, ?)',
        [sellerId, 'validé', 'active']
      );

      if (premiumRows.length > 0) {
        // Auto-boost produit Premium
        const boostId = `BOOST_${Date.now()}_${Math.floor(Math.random()*10000)}`;
        const now = new Date();
        const endDate = new Date(now.getTime() + 24*60*60*1000); // boost 24h

        await connection.query(
          `INSERT INTO product_boosts
            (product_id, user_id, amount, duration_hours, start_date, end_date, status, boost_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [productId, sellerId, 0, 24, now, endDate, 'active', boostId, now]
        );

        await connection.query(
          'UPDATE products SET is_boosted = 1 WHERE id = ?',
          [productId]
        );
      }

      await connection.commit();
      connection.release();

      res.status(201).json({
        success: true,
        productId,
        images: uploadedImages,
        message: 'Produit créé avec succès' + (premiumRows.length > 0 ? ' et boosté automatiquement' : '')
      });

    } catch (error) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      console.error('Erreur création produit:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });
});



// ===============================
// ✅ DISCOVER - DÉTAIL PRODUIT PUBLIC (CORRIGÉ)
// ===============================

router.get('/discover/product/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    if (!productId || isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID produit invalide'
      });
    }

    // =========================
    // 1️⃣ PRODUIT + VENDEUR + BOUTIQUE ACTIVE
    // =========================
    const [rows] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.phone AS seller_phone,
        u.email AS seller_email,
        u.address AS seller_address,
        u.latitude AS seller_latitude,
        u.longitude AS seller_longitude,

        bp.id AS boutique_id,
        bp.nom AS boutique_nom,
        bp.adresse AS boutique_adresse,
        bp.ville AS boutique_ville,
        bp.latitude AS boutique_latitude,
        bp.longitude AS boutique_longitude

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      LEFT JOIN boutiques_premium bp 
        ON bp.utilisateur_id = u.id 
        AND bp.statut IN ('validé','active')

      WHERE p.id = ?
      AND (p.is_active = 1 OR p.is_active IS NULL)
      LIMIT 1
    `, [productId]);

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    const product = rows[0];

    // =========================
    // 2️⃣ IMAGES PRODUIT
    // =========================
    const [imagesRows] = await db.query(`
      SELECT absolute_url 
      FROM product_images
      WHERE product_id = ?
    `, [productId]);

    const images = imagesRows
      .filter(img => img.absolute_url)
      .map(img => img.absolute_url);

    // =========================
    // 3️⃣ PRODUITS SIMILAIRES (même catégorie)
    // =========================
    const [similarRaw] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url
      FROM products p
      WHERE p.category = ?
      AND p.id != ?
      AND (p.is_active = 1 OR p.is_active IS NULL)
      ORDER BY p.created_at DESC
      LIMIT 6
    `, [product.category, productId]);

    const similar = similarRaw.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price) || 0,
      image_url: p.image_url || null
    }));

    // =========================
    // 4️⃣ PRODUITS DU MÊME VENDEUR
    // =========================
    const [sameSellerRaw] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url
      FROM products p
      WHERE p.seller_id = ?
      AND p.id != ?
      AND (p.is_active = 1 OR p.is_active IS NULL)
      ORDER BY p.created_at DESC
      LIMIT 6
    `, [product.seller_id, productId]);

    const sameSeller = sameSellerRaw.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price) || 0,
      image_url: p.image_url || null
    }));

    // =========================
    // 5️⃣ FORMATAGE FINAL
    // =========================
    res.json({
      success: true,
      product: {
        id: product.id,
        title: product.title,
        description: product.description,
        price: parseFloat(product.price) || 0,
        original_price: product.original_price
          ? parseFloat(product.original_price)
          : null,
        category: product.category,
        condition: product.condition,
        stock: parseInt(product.stock) || 0,
        location: product.location,
        created_at: product.created_at,
        latitude: product.latitude,
        longitude: product.longitude,
        images
      },
      boutique: product.boutique_id ? {
        id: product.boutique_id,
        nom: product.boutique_nom,
        adresse: product.boutique_adresse,
        ville: product.boutique_ville,
        latitude: product.boutique_latitude,
        longitude: product.boutique_longitude
      } : null,
      seller: {
        id: product.seller_id,
        nom: product.seller_name,
        phone: product.seller_phone,
        email: product.seller_email,
        adresse: product.seller_address,
        latitude: product.seller_latitude,
        longitude: product.seller_longitude
      },
      similar_products: similar,
      same_seller_products: sameSeller
    });

  } catch (error) {
    console.error('❌ Erreur GET /discover/product/:id:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});





// Page de ID 




// ----------------------------
// DELETE /products/:id — Supprimer un produit
// ----------------------------// ----------------------------
// DELETE /products/:id — Supprimer un produit
// ----------------------------
router.delete('/:id', authMiddleware, async (req, res) => {
  const productId = req.params.id;       // ID du produit à supprimer
  const userId = req.userId;             // ID du vendeur depuis le token JWT
  let connection;

  try {
    connection = await db.getConnection();   // Connexion à la base
    await connection.beginTransaction();     // Démarrer une transaction pour sécurité

    // -------------------------
    // 1️⃣ Vérifier que le produit appartient bien à l’utilisateur
    // -------------------------
    const [rows] = await connection.query(
      'SELECT id FROM products WHERE id = ? AND seller_id = ? LIMIT 1',
      [productId, userId]
    );

    if (rows.length === 0) {
      await connection.release();
      return res.status(403).json({ success: false, error: "Vous n'êtes pas autorisé à supprimer ce produit" });
    }

    // -------------------------
    // 2️⃣ Supprimer toutes les entrées dans commande_produits
    // pour éviter les erreurs de foreign key
    // -------------------------
    await connection.query('DELETE FROM commande_produits WHERE produit_id = ?', [productId]);

    // -------------------------
    // 3️⃣ Supprimer toutes les images Cloudinary liées au produit
    // -------------------------
    const [images] = await connection.query(
      'SELECT image_path FROM product_images WHERE product_id = ?',
      [productId]
    );

    for (const img of images) {
      try {
        await cloudinary.uploader.destroy(img.image_path);
      } catch (err) {
        console.warn(`⚠️ Impossible de supprimer ${img.image_path} de Cloudinary :`, err.message);
      }
    }

    // -------------------------
    // 4️⃣ Supprimer les images en base
    // -------------------------
    await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId]);

    // -------------------------
    // 5️⃣ Enregistrer le produit supprimé dans la table log
    // -------------------------
    await connection.query(
      'INSERT INTO products_deleted_logs (product_id, seller_id) VALUES (?, ?)',
      [productId, userId]
    );

    // -------------------------
    // 6️⃣ Supprimer physiquement le produit
    // -------------------------
    await connection.query('DELETE FROM products WHERE id = ?', [productId]);

    // -------------------------
    // 7️⃣ Valider la transaction
    // -------------------------
    await connection.commit();
    connection.release();

    // -------------------------
    // 8️⃣ Réponse au frontend
    // -------------------------
    res.json({ success: true, message: 'Produit supprimé avec succès' });

  } catch (error) {
    // -------------------------
    // 9️⃣ Gestion des erreurs et rollback
    // -------------------------
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('Erreur DELETE /products/:id:', error.message);
    res.status(500).json({ success: false, error: "Erreur lors de la suppression du produit" });
  }
});




module.exports = router;

