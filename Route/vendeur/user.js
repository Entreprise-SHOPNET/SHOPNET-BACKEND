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
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.json({ success: true, user: rows[0] });

  } catch (err) {
    console.error('Erreur dans GET /profile :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
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

    res.json({ success: true, message: 'Profil mis à jour avec succès' });

  } catch (err) {
    console.error('Erreur PUT /profile :', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour' });
  }
});

// --- Configuration Multer avec logs d'erreur et vérification des dossiers
function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Dossier créé : ${dir}`);
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
    return cb(new Error('Seuls les formats JPG, PNG et WEBP sont autorisés'));
  }
  cb(null, true);
}

const uploadProfile = multer({
  storage: profileStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadCover = multer({
  storage: coverStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

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

// --- PUT /profile/photo
router.put(
  '/profile/photo',
  authMiddleware,
  uploadProfile.single('profile_photo'),
  async (req, res) => {
    try {
      const userId = req.userId;

      if (!req.file) {
        console.error('Aucun fichier reçu dans /profile/photo');
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      console.log('Fichier reçu /profile/photo:', req.file);

      // 🔹 Chemin relatif uniquement
      const profilePhotoPath = `/uploads/profile/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET profile_photo = ? WHERE id = ?',
        [profilePhotoPath, userId]
      );

      res.json({
        success: true,
        message: 'Photo de profil mise à jour',
        profile_photo: profilePhotoPath
      });
    } catch (err) {
      console.error('Erreur PUT /profile/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// --- PUT /cover/photo
router.put(
  '/cover/photo',
  authMiddleware,
  uploadCover.single('cover_photo'),
  async (req, res) => {
    try {
      const userId = req.userId;

      if (!req.file) {
        console.error('Aucun fichier reçu dans /cover/photo');
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      console.log('Fichier reçu /cover/photo:', req.file);

      // 🔹 Chemin relatif uniquement
      const coverPhotoPath = `/uploads/cover/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET cover_photo = ? WHERE id = ?',
        [coverPhotoPath, userId]
      );

      res.json({
        success: true,
        message: 'Photo de couverture mise à jour',
        cover_photo: coverPhotoPath
      });
    } catch (err) {
      console.error('Erreur PUT /cover/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

router.use(multerErrorHandler);

module.exports = router;
