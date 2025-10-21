

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const router = express.Router();
const db = require('../../../db');
const authMiddleware = require('../../../middlewares/authMiddleware');

// ---------------------------
// Configuration Cloudinary
// ---------------------------
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// ---------------------------
// Multer : upload images
// ---------------------------
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  cb(null, validTypes.includes(file.mimetype));
};
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 }, fileFilter }).array('images', 5);

function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

// ---------------------------
// POST /boutique/products — Créer produit
// ---------------------------
router.post('/', authMiddleware, (req, res) => {
  upload(req, res, async (err) => {
    let connection;
    try {
      if (err) return res.status(400).json({ success: false, error: err.message });

      const { title, price, category, description, stock, location } = req.body;
      if (!title || title.trim().length < 3) throw new Error('Titre trop court');

      const sellerId = req.userId;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // Vérifier le nombre de produits existants pour cette boutique
      const [boutiqueRow] = await connection.query(
        'SELECT type FROM boutiques WHERE proprietaire_id = ? LIMIT 1',
        [sellerId]
      );
      if (!boutiqueRow || boutiqueRow.length === 0) throw new Error('Boutique introuvable');
      const boutiqueType = boutiqueRow[0].type || 'Standard';

      const [existingProducts] = await connection.query(
        'SELECT COUNT(*) AS total FROM products WHERE seller_id = ?',
        [sellerId]
      );
      const totalProducts = existingProducts[0].total;

      if (boutiqueType === 'Standard' && totalProducts >= 10) {
        return res.status(403).json({
          success: false,
          message: 'Vous avez atteint 10 produits maximum pour la boutique Standard. Passez à Premium/Pro pour en ajouter plus.'
        });
      }

      // Insertion du produit
      const [productResult] = await connection.query(
        'INSERT INTO products (title, description, price, category, stock, location, seller_id, likes_count, shares_count, views_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)',
        [title.trim(), description || null, parseFloat(price), category || 'autre', parseInt(stock) || 0, location || null, sellerId]
      );
      const productId = productResult.insertId;

      // Upload images sur Cloudinary
      const uploadedImages = [];
      if (req.files?.length > 0) {
        for (const file of req.files) {
          const uploadResult = await uploadToCloudinary(file.buffer, {
            folder: 'shopnet',
            resource_type: 'image',
            public_id: `product_${Date.now()}_${Math.floor(Math.random() * 10000)}`
          });
          await connection.query(
            'INSERT INTO product_images (product_id, image_path, absolute_url) VALUES (?, ?, ?)',
            [productId, uploadResult.public_id, uploadResult.secure_url]
          );
          uploadedImages.push({ public_id: uploadResult.public_id, url: uploadResult.secure_url });
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
      console.error('Erreur POST /boutique/products:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });
});

// ---------------------------
// GET /boutique/products — Récupérer max 10 produits pour Standard
// ---------------------------
router.get('/', authMiddleware, async (req, res) => {
  try {
    const sellerId = req.userId;
    const [boutiqueRow] = await db.query(
      'SELECT type FROM boutiques WHERE proprietaire_id = ? LIMIT 1',
      [sellerId]
    );
    if (!boutiqueRow || boutiqueRow.length === 0) return res.status(404).json({ success: false, error: 'Boutique introuvable' });
    const boutiqueType = boutiqueRow[0].type || 'Standard';

    const limit = boutiqueType === 'Standard' ? 10 : 50;

    // Récupérer les produits
    const [products] = await db.query(`
      SELECT p.*, 
        IFNULL((SELECT JSON_ARRAYAGG(pi.absolute_url) FROM product_images pi WHERE pi.product_id = p.id), JSON_ARRAY()) AS images
      FROM products p
      WHERE seller_id = ?
    `, [sellerId]);

    // Algorithme simple "IA" pour mettre en avant : tri par popularité
    const sortedProducts = products.sort((a, b) => {
      const scoreA = (a.likes_count || 0) + (a.shares_count || 0) + (a.views_count || 0);
      const scoreB = (b.likes_count || 0) + (b.shares_count || 0) + (b.views_count || 0);
      return scoreB - scoreA;
    });

    res.json({
      success: true,
      total: sortedProducts.length,
      products: sortedProducts.slice(0, limit)
    });

  } catch (error) {
    console.error('Erreur GET /boutique/products:', error.message);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});




// ---------------------------
// GET /me — Récupérer la boutique de l'utilisateur
// ---------------------------
router.get('/me', authMiddleware, async (req, res) => {
  const userId = req.userId;
  try {
    const [rows] = await db.query(
      `SELECT id, nom, proprietaire, email, whatsapp, adresse, categorie, description, type, created_at 
       FROM boutiques 
       WHERE proprietaire_id = ? LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucune boutique trouvée pour cet utilisateur.'
      });
    }

    return res.status(200).json({
      success: true,
      boutique: rows[0]
    });

  } catch (err) {
    console.error('Erreur récupération profil boutique :', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération de la boutique.'
    });
  }
});




module.exports = router;
