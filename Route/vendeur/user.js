const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// --- Config Cloudinary ---
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// --- Multer en mémoire ---
const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({
  storage: memoryStorage,
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) cb(null, true);
    else cb(new Error('Seuls les formats JPG, PNG et WEBP sont autorisés'));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// --- Utilitaire upload buffer vers Cloudinary ---
function uploadBufferToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// --- GET /profile : récupération du profil + statistiques ---
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

// --- PUT /profile : mise à jour des informations texte ---
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

// --- PUT /profile/photo Cloudinary ---
router.put(
  '/profile/photo',
  authMiddleware,
  uploadMemory.single('profile_photo'),
  async (req, res) => {
    try {
      const userId = req.userId;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, 'profile_photos');

      await db.execute(
        'UPDATE utilisateurs SET profile_photo = ? WHERE id = ?',
        [uploadResult.secure_url, userId]
      );

      res.json({
        success: true,
        message: 'Photo de profil mise à jour',
        profile_photo: uploadResult.secure_url
      });
    } catch (err) {
      console.error('Erreur PUT /profile/photo Cloudinary :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

// --- PUT /cover/photo Cloudinary ---
router.put(
  '/cover/photo',
  authMiddleware,
  uploadMemory.single('cover_photo'),
  async (req, res) => {
    try {
      const userId = req.userId;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
      }

      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, 'cover_photos');

      await db.execute(
        'UPDATE utilisateurs SET cover_photo = ? WHERE id = ?',
        [uploadResult.secure_url, userId]
      );

      res.json({
        success: true,
        message: 'Photo de couverture mise à jour',
        cover_photo: uploadResult.secure_url
      });
    } catch (err) {
      console.error('Erreur PUT /cover/photo Cloudinary :', err);
      res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
  }
);

module.exports = router;
