

// Route/Profile/boutiquesGratuit.js
// Route/Profile/boutiquesGratuit.js
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

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
    description
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
    // Insertion dans la base sans logo
    const [result] = await db.execute(
      `INSERT INTO boutiques (nom, proprietaire, email, whatsapp, adresse, categorie, description, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Standard')`,
      [nom, proprietaire, email, whatsapp, adresse, categorie, description]
    );

    return res.status(201).json({
      success: true,
      message: 'Boutique Standard créée avec succès !',
      boutiqueId: result.insertId,
    });

  } catch (err) {
    console.error('Erreur création boutique gratuite :', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur lors de la création de la boutique.' });
  }
});

module.exports = router;

