
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé. Veuillez vérifier vos informations.' });
    }

    res.json({ success: true, message: 'Profil récupéré avec succès.', user: rows[0] });

  } catch (err) {
    console.error('Erreur dans GET /profile :', err);
    res.status(500).json({ success: false, message: 'Une erreur serveur est survenue lors de la récupération du profil.' });
  }
});

// --- PUT /profile : mise à jour des informations texte du profil
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

// --- Configuration Multer avec logs d'erreur et vérification des dossiers
function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Dossier créé automatiquement : ${dir}`);
  }
}

// Storage profile
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/profile';
    ensureDirExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `profile_${Date.now()}${ext}`;
    cb(null, filename);
  }
});

// Storage cover
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/cover';
    ensureDirExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `cover_${Date.now()}${ext}`;
    cb(null, filename);
  }
});

// File filter Multer
function imageFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!allowedExt.includes(ext)) {
    return cb(new Error('Format de fichier non autorisé. Seuls JPG, PNG et WEBP sont acceptés.'));
  }
  cb(null, true);
}

const uploadProfile = multer({
  storage: profileStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

const uploadCover = multer({
  storage: coverStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Middleware pour gérer erreurs multer
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

// --- PUT /profile/photo
router.put('/profile/photo', authMiddleware, uploadProfile.single('profile_photo'), async (req, res) => {
  try {
    const userId = req.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucune photo reçue. Veuillez sélectionner une image.' });
    }

    const profilePhotoUrl = `https://shopnet-backend.onrender.com/uploads/profile/${req.file.filename}`;

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

// --- PUT /cover/photo
router.put('/cover/photo', authMiddleware, uploadCover.single('cover_photo'), async (req, res) => {
  try {
    const userId = req.userId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucune photo de couverture reçue. Veuillez sélectionner une image.' });
    }

    const coverPhotoUrl = `https://shopnet-backend.onrender.com/uploads/cover/${req.file.filename}`;

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

// --- GET /my-products : récupérer les produits de l'utilisateur connecté
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

router.use(multerErrorHandler);

module.exports = router;
