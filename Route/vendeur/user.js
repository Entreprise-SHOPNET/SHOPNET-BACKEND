const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

// --- Configuration Cloudinary ---
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

// --- Configuration Multer ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/temp';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `temp_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!allowedExt.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error('Format d’image non supporté'));
    }
    cb(null, true);
  }
});

// --- PUT /profile/photo (upload Cloudinary) ---
router.put('/profile/photo', authMiddleware, upload.single('profile_photo'), async (req, res) => {
  try {
    const userId = req.userId;
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });

    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: 'shopnet/profile'
    });

    fs.unlinkSync(req.file.path); // suppression du fichier local

    await db.execute('UPDATE utilisateurs SET profile_photo = ? WHERE id = ?', [
      uploadResult.secure_url,
      userId
    ]);

    res.json({
      success: true,
      message: 'Photo de profil mise à jour',
      profile_photo: uploadResult.secure_url
    });
  } catch (err) {
    console.error('Erreur PUT /profile/photo :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// --- PUT /cover/photo (upload Cloudinary) ---
router.put('/cover/photo', authMiddleware, upload.single('cover_photo'), async (req, res) => {
  try {
    const userId = req.userId;
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });

    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: 'shopnet/cover'
    });

    fs.unlinkSync(req.file.path); // suppression du fichier local

    await db.execute('UPDATE utilisateurs SET cover_photo = ? WHERE id = ?', [
      uploadResult.secure_url,
      userId
    ]);

    res.json({
      success: true,
      message: 'Photo de couverture mise à jour',
      cover_photo: uploadResult.secure_url
    });
  } catch (err) {
    console.error('Erreur PUT /cover/photo :', err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;
