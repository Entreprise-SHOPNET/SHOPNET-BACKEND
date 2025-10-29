const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- Configuration Cloudinary avec variables d'environnement
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// --- GET /profile : récupération du profil + statistiques
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    const [rows] = await db.execute(
      `SELECT   
        u.id, u.fullName, u.email, u.phone, u.companyName, u.nif, u.address,  
        u.profile_photo, u.cover_photo, u.description, u.role,   
        DATE_FORMAT(u.date_inscription, '%Y-%m-%d') AS date_inscription,  
        (SELECT COUNT(*) FROM products WHERE seller_id = u.id) AS productsCount,  
        (SELECT COUNT(*) FROM orders WHERE vendeur_id = u.id) AS salesCount,  
        (SELECT COUNT(*) FROM orders WHERE client_id = u.id) AS ordersCount,  
        (SELECT IFNULL(AVG(note), 0) FROM avis WHERE vendeur_id = u.id) AS rating  
      FROM utilisateurs u   
      WHERE u.id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Erreur GET /profile :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// --- PUT /profile : mise à jour des informations texte
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { fullName, phone, companyName, nif, address, description } = req.body;

    await db.execute(
      `UPDATE utilisateurs 
       SET fullName = ?, phone = ?, companyName = ?, nif = ?, address = ?, description = ? 
       WHERE id = ?`,
      [fullName, phone, companyName, nif, address, description, userId]
    );

    res.json({ success: true, message: 'Profil mis à jour avec succès' });
  } catch (err) {
    console.error('Erreur PUT /profile :', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour' });
  }
});

// --- Multer Storage Cloudinary pour profil
const storageProfile = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shopnet/profile',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    public_id: (req, file) => `profile_${Date.now()}`,
  },
});

// --- Multer Storage Cloudinary pour couverture
const storageCover = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shopnet/cover',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    public_id: (req, file) => `cover_${Date.now()}`,
  },
});

const uploadProfile = multer({ storage: storageProfile, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadCover = multer({ storage: storageCover, limits: { fileSize: 5 * 1024 * 1024 } });

// Middleware pour gérer erreurs multer
function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    console.error('Erreur Multer:', err);
    return res.status(400).json({ success: false, message: err.message });
  } else if (err) {
    console.error('Erreur upload:', err);
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
}

// --- PUT /profile/photo (upload Cloudinary)
router.put('/profile/photo', authMiddleware, uploadProfile.single('profile_photo'), async (req, res) => {
  try {
    const userId = req.userId;

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    const profilePhotoUrl = req.file.path;

    await db.execute('UPDATE utilisateurs SET profile_photo = ? WHERE id = ?', [profilePhotoUrl, userId]);

    res.json({ success: true, message: 'Photo de profil mise à jour', profile_photo: profilePhotoUrl });
  } catch (err) {
    console.error('Erreur PUT /profile/photo :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// --- PUT /cover/photo (upload Cloudinary)
router.put('/cover/photo', authMiddleware, uploadCover.single('cover_photo'), async (req, res) => {
  try {
    const userId = req.userId;

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    const coverPhotoUrl = req.file.path;

    await db.execute('UPDATE utilisateurs SET cover_photo = ? WHERE id = ?', [coverPhotoUrl, userId]);

    res.json({ success: true, message: 'Photo de couverture mise à jour', cover_photo: coverPhotoUrl });
  } catch (err) {
    console.error('Erreur PUT /cover/photo :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// --- GET /my-products : récupérer les produits de l'utilisateur
router.get('/my-products', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    const [products] = await db.execute(`SELECT id, title, price FROM products WHERE seller_id = ?`, [userId]);

    if (products.length === 0) return res.json({ success: true, products: [] });

    const productIds = products.map(p => p.id);
    const [images] = await db.query(
      `SELECT product_id, absolute_url FROM product_images WHERE product_id IN (?)`,
      [productIds]
    );

    const imagesByProduct = {};
    images.forEach(img => {
      if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
      imagesByProduct[img.product_id].push(img.absolute_url);
    });

    const productsWithImages = products.map(p => ({ ...p, images: imagesByProduct[p.id] || [] }));

    res.json({ success: true, products: productsWithImages });
  } catch (err) {
    console.error('Erreur GET /my-products :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.use(multerErrorHandler);

module.exports = router;
