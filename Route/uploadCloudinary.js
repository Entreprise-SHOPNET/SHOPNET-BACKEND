


// Route/uploadCloudinary.js
// Route/uploadCloudinary.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

// 📌 Multer config : stockage temporaire en local
const upload = multer({ dest: 'uploads/' });

// 📌 POST /api/upload
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucune image envoyée' });
    }

    // 📤 Upload sur Cloudinary AVEC WATERMARK
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'shopnet',
      use_filename: true,
      unique_filename: false,

      // 💧 WATERMARK CENTRÉ
      transformation: [
        {
          width: 800,
          crop: "limit"
        },
        {
          overlay: {
            font_family: "Arial",
            font_size: 50,
            text: "SHOPNET • Verified"
          },
          gravity: "center",
          opacity: 40,
          color: "#FFFFFF"
        }
      ]
    });

    // ❌ Supprimer le fichier temporaire après upload
    fs.unlinkSync(req.file.path);

    res.status(200).json({
      success: true,
      message: 'Image envoyée avec succès',
      url: result.secure_url
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'upload",
      error: error.message
    });
  }
});

module.exports = router;
