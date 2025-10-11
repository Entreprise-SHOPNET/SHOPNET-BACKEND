

// Route/Profile/boutiquesGratuit.js
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const cloudinary = require('cloudinary').v2;

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Middleware pour parser JSON
router.use(express.json({ limit: '10mb' }));

// Route pour créer une boutique standard gratuite
router.post('/create', authMiddleware, async (req, res) => {
  const db = req.db;
  const {
    nom,
    proprietaire,
    email,
    whatsapp,
    adresse,
    categorie,
    description,
    logoUrl
  } = req.body;

  // Vérifications de base
  if (!nom || !proprietaire || !email || !whatsapp || !adresse || !categorie || !description) {
    return res.status(400).json({ success: false, message: 'Tous les champs sont requis.' });
  }

  if (!/^([^\s@]+)@gmail\.com$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Email invalide, doit se terminer par @gmail.com' });
  }

  if (!/^(0|243)\d{8,12}$/.test(whatsapp)) {
    return res.status(400).json({ success: false, message: 'Numéro WhatsApp invalide.' });
  }

  try {
    let logoCloudUrl = null;

    // Si un logo est fourni, on upload sur Cloudinary
    if (logoUrl) {
      const uploadResponse = await cloudinary.uploader.upload(logoUrl, {
        folder: 'boutiques_standard',
        resource_type: 'image',
      });
      logoCloudUrl = uploadResponse.secure_url;
    }

    // Insertion dans la base
    const [result] = await db.execute(
      `INSERT INTO boutiques (nom, proprietaire, email, whatsapp, adresse, categorie, description, logoUrl, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Standard')`,
      [nom, proprietaire, email, whatsapp, adresse, categorie, description, logoCloudUrl]
    );

    return res.status(201).json({
      success: true,
      message: 'Boutique Standard créée avec succès !',
      boutiqueId: result.insertId,
      logoUrl: logoCloudUrl,
    });

  } catch (err) {
    console.error('Erreur création boutique gratuite :', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la création de la boutique.' });
  }
});

module.exports = router;
