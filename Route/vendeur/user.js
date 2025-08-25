

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- GET /profile : récupération du profil + statistiques
// --- PUT /profile/photo : mise à jour photo de profil
router.put(
  '/profile/photo',
  authMiddleware,
  uploadProfile.single('profile_photo'),
  async (req, res) => {
    try {
      const userId = req.userId;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      // 🔥 Utiliser ton domaine Render
      const profilePhotoUrl = `https://shopnet-backend.onrender.com/uploads/profile/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET profile_photo = ? WHERE id = ?',
        [profilePhotoUrl, userId]
      );

      res.json({
        success: true,
        message: 'Photo de profil mise à jour',
        profile_photo: profilePhotoUrl,
      });
    } catch (err) {
      console.error('Erreur PUT /profile/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// --- PUT /cover/photo : mise à jour photo de couverture
router.put(
  '/cover/photo',
  authMiddleware,
  uploadCover.single('cover_photo'),
  async (req, res) => {
    try {
      const userId = req.userId;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      // 🔥 Utiliser ton domaine Render
      const coverPhotoUrl = `https://shopnet-backend.onrender.com/uploads/cover/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET cover_photo = ? WHERE id = ?',
        [coverPhotoUrl, userId]
      );

      res.json({
        success: true,
        message: 'Photo de couverture mise à jour',
        cover_photo: coverPhotoUrl,
      });
    } catch (err) {
      console.error('Erreur PUT /cover/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);
// --- Configuration Multer avec logs d'erreur et vérification des dossiers

// Helper pour créer dossier si absent
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
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

const uploadCover = multer({
  storage: coverStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Middleware pour gérer erreurs multer proprement
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

// --- PUT /profile/photo : mise à jour photo de profil
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

      const profilePhotoPath = `/uploads/profile/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET profile_photo = ? WHERE id = ?',
        [profilePhotoPath, userId]
      );

      res.json({
        success: true,
        message: 'Photo de profil mise à jour',
        profile_photo: profilePhotoPath,
      });
    } catch (err) {
      console.error('Erreur PUT /profile/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// --- PUT /cover/photo : mise à jour photo de couverture
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

      const coverPhotoPath = `/uploads/cover/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET cover_photo = ? WHERE id = ?',
        [coverPhotoPath, userId]
      );

      res.json({
        success: true,
        message: 'Photo de couverture mise à jour',
        cover_photo: coverPhotoPath,
      });
    } catch (err) {
      console.error('Erreur PUT /cover/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// --- Middleware d’erreur multer (à placer après les routes si besoin)
router.use(multerErrorHandler);

module.exports = router;

