
//CREATION DE LA BOURIQUE--------------////////////////////
// Route/Profile/boutiquesGratuit.js
const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Middleware pour parser JSON
router.use(express.json({ limit: '10mb' }));

// ✅ Route POST : créer une boutique gratuite
router.post('/create', authMiddleware, async (req, res) => {
  const db = req.db;
  const { nom, proprietaire, email, whatsapp, adresse, categorie, description } = req.body;

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
    // ✅ Vérification unicité email et WhatsApp
    const [existing] = await db.execute(
      "SELECT id FROM boutiques WHERE email = ? OR whatsapp = ?",
      [email, whatsapp]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Une boutique avec cet email ou numéro WhatsApp existe déjà.'
      });
    }

    // Insertion dans la base
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


//RECUPERATION DE LA BOUTIQUE----///////////////////////////////
// ✅ Route GET : récupérer la boutique de l'utilisateur connecté
router.get('/check', authMiddleware, async (req, res) => {
  const db = req.db;
  const userId = req.user.id;

  try {
    const [rows] = await db.execute(
      'SELECT * FROM boutiques WHERE proprietaire = ? OR email = ? OR whatsapp = ? LIMIT 1',
      [req.user.nom, req.user.email, req.user.whatsapp]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Aucune boutique trouvée pour cet utilisateur." });
    }

    return res.status(200).json({
      success: true,
      boutique: rows[0],
    });
  } catch (err) {
    console.error('Erreur récupération boutique :', err);
    return res.status(500).json({ success: false, message: "Erreur serveur lors de la récupération de la boutique." });
  }
});

module.exports = router;
