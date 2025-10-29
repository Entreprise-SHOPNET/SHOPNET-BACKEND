
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- CONFIGURATION CLOUDINARY --- //
// Remplace ces variables par tes propres informations Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- MULTER STORAGE POUR CLOUDINARY --- //
const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shopnet/profile', // dossier Cloudinary pour les profils
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }], // redimension max
  },
});

const coverStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'shopnet/cover', // dossier Cloudinary pour les couvertures
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1200, height: 400, crop: 'limit' }], // redimension max
  },
});

// --- MULTER UPLOAD --- //
const uploadProfile = multer({ storage: profileStorage, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadCover = multer({ storage: coverStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// --- MIDDLEWARE ERREUR MULTER --- //
function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    console.error('Erreur Multer:', err);
    return res.status(400).json({ success: false, message: `Erreur lors de l’upload : ${err.message}` });
  } else if (err) {
    console.error('Erreur upload:', err);
    return res.status(400).json({ success: false, message: `Erreur lors du traitement du fichier : ${err.message}` });
  }
  next();
}

// --- ROUTES --- //

// GET /profile : récupération du profil + statistiques
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
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé. Veuillez vérifier vos informations.' });
    }

    res.json({ success: true, message: 'Profil récupéré avec succès.', user: rows[0] });
  } catch (err) {
    console.error('Erreur GET /profile :', err);
    res.status(500).json({ success: false, message: 'Une erreur serveur est survenue lors de la récupération du profil.' });
  }
});

// PUT /profile : mise à jour des informations texte du profil
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

    res.json({ success: true, message: 'Vos informations de profil ont été mises à jour avec succès !' });
  } catch (err) {
    console.error('Erreur PUT /profile :', err);
    res.status(500).json({ success: false, message: 'Impossible de mettre à jour le profil. Veuillez réessayer plus tard.' });
  }
});

// PUT /profile/photo : upload photo de profil sur Cloudinary
router.put('/profile/photo', authMiddleware, uploadProfile.single('profile_photo'), async (req, res) => {
  try {
    const userId = req.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucune photo reçue. Veuillez sélectionner une image.' });
    }

    // req.file.path contient l'URL Cloudinary de l'image uploadée
    const profilePhotoUrl = req.file.path;

    await db.execute('UPDATE utilisateurs SET profile_photo = ? WHERE id = ?', [profilePhotoUrl, userId]);

    res.json({
      success: true,
      message: 'Votre photo de profil a été mise à jour avec succès !',
      profile_photo: profilePhotoUrl
    });
  } catch (err) {
    console.error('Erreur PUT /profile/photo :', err);
    res.status(500).json({ success: false, message: 'Impossible de mettre à jour la photo de profil. Veuillez réessayer plus tard.' });
  }
});

// PUT /cover/photo : upload photo de couverture sur Cloudinary
router.put('/cover/photo', authMiddleware, uploadCover.single('cover_photo'), async (req, res) => {
  try {
    const userId = req.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucune photo de couverture reçue. Veuillez sélectionner une image.' });
    }

    // req.file.path contient l'URL Cloudinary de l'image uploadée
    const coverPhotoUrl = req.file.path;

    await db.execute('UPDATE utilisateurs SET cover_photo = ? WHERE id = ?', [coverPhotoUrl, userId]);

    res.json({
      success: true,
      message: 'Votre photo de couverture a été mise à jour avec succès !',
      cover_photo: coverPhotoUrl
    });
  } catch (err) {
    console.error('Erreur PUT /cover/photo :', err);
    res.status(500).json({ success: false, message: 'Impossible de mettre à jour la photo de couverture. Veuillez réessayer plus tard.' });
  }
});

// GET /my-products : récupérer les produits de l'utilisateur connecté
router.get('/my-products', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    const [products] = await db.execute(`SELECT id, title, price FROM products WHERE seller_id = ?`, [userId]);

    if (products.length === 0) {
      return res.json({ success: true, message: 'Vous n’avez aucun produit pour le moment.', products: [] });
    }

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

    res.json({ success: true, message: 'Produits récupérés avec succès.', products: productsWithImages });
  } catch (err) {
    console.error('Erreur GET /my-products :', err);
    res.status(500).json({ success: false, message: 'Impossible de récupérer vos produits pour le moment.' });
  }
});

// Middleware Multer pour gérer les erreurs
router.use(multerErrorHandler);

module.exports = router;
