
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Helper : créer un dossier si absent
function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Dossier créé : ${dir}`);
  }
}

// --- Config Multer pour profil
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/profile';
    ensureDirExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${Date.now()}${ext}`);
  }
});

// --- Config Multer pour cover
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/cover';
    ensureDirExists(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cover_${Date.now()}${ext}`);
  }
});

// --- Filtrage fichiers images
function imageFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!allowedExt.includes(ext)) {
    return cb(new Error('Seuls JPG, PNG et WEBP sont autorisés'));
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

// --- Middleware erreurs Multer
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

// --- GET /profile : récupération des infos utilisateur
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    const [rows] = await db.execute(
      'SELECT id, nom, email, profile_photo, cover_photo FROM utilisateurs WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    }

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Erreur GET /profile :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

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

      const profilePhotoUrl = `https://shopnet-backend.onrender.com/uploads/profile/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET profile_photo = ? WHERE id = ?',
        [profilePhotoUrl, userId]
      );

      res.json({
        success: true,
        message: 'Photo de profil mise à jour',
        profile_photo: profilePhotoUrl
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

      const coverPhotoUrl = `https://shopnet-backend.onrender.com/uploads/cover/${req.file.filename}`;

      await db.execute(
        'UPDATE utilisateurs SET cover_photo = ? WHERE id = ?',
        [coverPhotoUrl, userId]
      );

      res.json({
        success: true,
        message: 'Photo de couverture mise à jour',
        cover_photo: coverPhotoUrl
      });
    } catch (err) {
      console.error('Erreur PUT /cover/photo :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// --- Middleware d’erreur Multer
router.use(multerErrorHandler);

module.exports = router;
