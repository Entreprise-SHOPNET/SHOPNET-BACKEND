const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

router.use(cors({
  origin: ['http://localhost', 'http://100.64.134.89'],
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
// GET /products — Liste avec pagination
// ----------------------------
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    // Récupération des paramètres de pagination
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 5; // Par défaut 5 produits
    const category = req.query.category;

    let whereClause = '';
    let queryParams = [userId];
    let countParams = [];

    if (category && category !== 'undefined') {
      whereClause = ' WHERE p.category = ?';
      queryParams.push(category);
      countParams.push(category);
    }

    // Requête principale avec OFFSET/LIMIT
    const query = `
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        IFNULL((SELECT JSON_ARRAYAGG(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls,
        p.likes_count,
        p.shares_count,
        EXISTS (
          SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?
        ) AS isLiked
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    queryParams.push(limit, offset);

    const [products] = await db.query(query, queryParams);

    // Compter le total pour pagination
    const countQuery = `SELECT COUNT(*) AS total FROM products p ${whereClause}`;
    const [[{ total }]] = await db.query(countQuery, countParams);

    // Formatter le résultat
    const formatted = products.map(product => ({
      ...product,
      title: product.title ?? "Titre non disponible",
      description: product.description ?? "Description non disponible",
      images: product.images || [],
      image_urls: product.image_urls || [],
      delivery_options: safeJsonParse(product.delivery_options),
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      stock: parseInt(product.stock) || 0,
      likes: product.likes_count || 0,
      shares: product.shares_count ?? 0,
      isLiked: Boolean(product.isLiked),
      comments: product.comments_count ?? 0,
      seller: {
        id: product.seller_id?.toString(),
        name: product.seller_name ?? "Vendeur inconnu",
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null
      }
    }));

    // Réponse avec infos de pagination
    res.json({
      success: true,
      offset,
      limit,
      total,
      count: formatted.length,
      products: formatted
    });

  } catch (error) {
    console.error('Erreur GET /products:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ----------------------------
// GET /products/:id — Détail d'un produit (inchangé)
// ----------------------------
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const productId = req.params.id;
    const userId = req.userId;

    const [rows] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.phone AS seller_phone,
        u.email AS seller_email,
        u.address AS seller_address,
        u.profile_photo AS seller_avatar,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        (SELECT COUNT(*) FROM product_likes pl WHERE pl.product_id = p.id) AS likes_count,
        EXISTS (
          SELECT 1 FROM product_likes pl WHERE pl.product_id = p.id AND pl.user_id = ?
        ) AS isLiked,
        IFNULL((SELECT JSON_ARRAYAGG(pi.image_path) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images,
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS image_urls
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.id = ?
      LIMIT 1
    `, [userId, productId]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Produit introuvable' });
    }

    const product = rows[0];
    const formatted = {
      id: product.id,
      title: product.title,
      description: product.description || null,
      price: parseFloat(product.price) || 0,
      original_price: product.original_price ? parseFloat(product.original_price) : null,
      category: product.category,
      condition: product.condition,
      stock: parseInt(product.stock) || 0,
      location: product.location,
      created_at: product.created_at,
      updated_at: product.updated_at,
      likes: product.likes_count || 0,
      comments: product.comments_count || 0,
      isLiked: Boolean(product.isLiked),
      images: product.images || [],
      image_urls: product.image_urls || [],
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || null,
        phone: product.seller_phone || null,
        email: product.seller_email || null,
        address: product.seller_address || null,
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
      }
    };

    res.json({ success: true, product: formatted });
  } catch (error) {
    console.error('Erreur GET /products/:id:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ----------------------------
// POST /products — Création produit avec Cloudinary
// ----------------------------
router.post('/', authMiddleware, (req, res) => {
  upload(req, res, async (err) => {
    let connection;
    try {
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }

      const { title, price, original_price, category, condition, stock, location } = req.body;
      if (!title || title.trim().length < 3) throw new Error('Titre trop court');

      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice)) throw new Error('Prix invalide');

      const sellerId = req.userId;

      connection = await db.getConnection();
      await connection.beginTransaction();

      const productData = {
        title: title.trim(),
        description: req.body.description?.trim() || null,
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
        views_count: 0
      };

      const [productResult] = await connection.query(
        'INSERT INTO products SET ?', [productData]
      );
      const productId = productResult.insertId;

      let uploadedImages = [];
      if (req.files?.length > 0) {
        for (const file of req.files) {
          // Upload buffer vers Cloudinary
          const uploadResult = await uploadToCloudinary(file.buffer, {
            folder: 'shopnet',
            resource_type: 'image',
            public_id: `product_${Date.now()}_${Math.floor(Math.random() * 10000)}`
          });

          // Stocker en base (public_id = image_path, url = absolute_url)
          await connection.query(
            'INSERT INTO product_images (product_id, image_path, absolute_url) VALUES (?, ?, ?)',
            [productId, uploadResult.public_id, uploadResult.secure_url]
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
        productId,
        images: uploadedImages,
        message: 'Produit créé avec succès'
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

module.exports = router;
