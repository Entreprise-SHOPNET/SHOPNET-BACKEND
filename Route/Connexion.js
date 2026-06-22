


const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // 🔑 Import du module JWT
const authMiddleware = require('../middlewares/authMiddleware');


router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // 1. Vérification des champs requis
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email/téléphone et mot de passe requis'
      });
    }

    // 2. Recherche dans la base de données
    const [users] = await req.db.query(
      `SELECT id, fullName, email, phone, password, companyName, nif, address 
       FROM utilisateurs 
       WHERE email = ? OR phone = ?`,
      [identifier, identifier]
    );

    // 3. Vérification existence utilisateur
    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Aucun compte trouvé avec ces identifiants'
      });
    }

    const user = users[0];

    // 4. Comparaison mot de passe
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Mot de passe incorrect'
      });
    }

    // 5. Génération du token JWT 🔐
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // ou '1d' pour un token qui expire après 24h
    );

    // 6. Réponse avec token et données utilisateur (sans mot de passe)
    const { password: _, ...userData } = user;

    res.json({
      success: true,
      message: 'Connexion réussie',
      token: token, // ← Voilà le token ici
      user: userData
    });

  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});


//------------------------------------------------//
// SYSTEME DE RESET DE MOTS DE PASSE OUBLIE
//------------------------------------------------//

const crypto = require('crypto');

router.post('/forgot-password', async (req, res) => {
  try {

    const { identifier } = req.body; // email ou téléphone

    // Vérification champ
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: "Email ou numéro requis"
      });
    }

    // Vérifier utilisateur avec email OU téléphone
    const [users] = await req.db.query(
      `SELECT id, email, phone 
       FROM utilisateurs 
       WHERE email = ? OR phone = ?`,
      [identifier, identifier]
    );

    // Si utilisateur n'existe pas
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Aucun compte trouvé avec cet email ou numéro"
      });
    }

    const user = users[0];

    // Générer token sécurisé
    const token = crypto.randomBytes(32).toString('hex');

    // Expiration 30 minutes
    const expires = new Date(Date.now() + 30 * 60 * 1000);

    // Sauvegarder token
    await req.db.query(
      `UPDATE utilisateurs
       SET reset_password_token = ?, reset_password_expires = ?
       WHERE id = ?`,
      [token, expires, user.id]
    );

    console.log("🔐 Reset password token:", token);

    // Envoyer token au frontend
    res.json({
      success: true,
      token: token,
      message: "Token généré avec succès"
    });

  } catch (error) {
    console.error("Erreur forgot-password:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur"
    });
  }
});


//------------------------------------------------//
// SYSTEME DE RESET DE MOTS DE PASSE OUBLIER BACKEND
//------------------------------------------------//

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Vérification des champs
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token et nouveau mot de passe requis"
      });
    }

    // Chercher utilisateur avec token valide
    const [users] = await req.db.query(
      `SELECT id, reset_password_expires 
       FROM utilisateurs 
       WHERE reset_password_token = ?`,
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Token invalide"
      });
    }

    const user = users[0];

    // Vérifier expiration
    if (new Date() > new Date(user.reset_password_expires)) {
      return res.status(400).json({
        success: false,
        message: "Token expiré"
      });
    }

    // Hasher nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Mettre à jour mot de passe et supprimer token
    await req.db.query(
      `UPDATE utilisateurs
       SET password = ?, 
           reset_password_token = NULL,
           reset_password_expires = NULL
       WHERE id = ?`,
      [hashedPassword, user.id]
    );

    res.json({
      success: true,
      message: "Mot de passe réinitialisé avec succès"
    });

  } catch (error) {
    console.error("Erreur reset-password:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur"
    });
  }
});



//------------------------------------------------//
// CHANGER MOT DE PASSE UTILISATEUR CONNECTÉ
//------------------------------------------------//

router.put('/change-password', authMiddleware, async (req, res) => {
  try {

    const {
      currentPassword,
      newPassword,
      confirmPassword
    } = req.body;

    // Vérification des champs
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Tous les champs sont requis"
      });
    }

    // Vérification confirmation
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Les mots de passe ne correspondent pas"
      });
    }

    // Longueur minimale
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Le nouveau mot de passe doit contenir au moins 6 caractères"
      });
    }

    // Récupérer utilisateur connecté
    const [users] = await req.db.query(
      `SELECT id, password
       FROM utilisateurs
       WHERE id = ?`,
      [req.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur introuvable"
      });
    }

    const user = users[0];

    // Vérifier ancien mot de passe
    const isMatch = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Mot de passe actuel incorrect"
      });
    }

    // Empêcher même mot de passe
    const samePassword = await bcrypt.compare(
      newPassword,
      user.password
    );

    if (samePassword) {
      return res.status(400).json({
        success: false,
        message: "Le nouveau mot de passe doit être différent de l'ancien"
      });
    }

    // Hasher nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Mise à jour
    await req.db.query(
      `UPDATE utilisateurs
       SET password = ?
       WHERE id = ?`,
      [hashedPassword, req.userId]
    );

    res.json({
      success: true,
      message: "Mot de passe modifié avec succès"
    });

  } catch (error) {
    console.error("Erreur change-password :", error);

    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur"
    });
  }
});






//------------------------------------------------//
// AJOUT / CHANGEMENT EMAIL UTILISATEUR CONNECTÉ
//------------------------------------------------//

router.put('/change-email', authMiddleware, async (req, res) => {
  try {

    const { email } = req.body;

    // 1. Vérification champ
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email requis"
      });
    }

    // 2. Validation format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Format d'email invalide"
      });
    }

    // 3. Vérifier si email existe déjà
    const [existing] = await req.db.query(
      `SELECT id FROM utilisateurs WHERE email = ?`,
      [email]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cet email est déjà utilisé"
      });
    }

    // 4. Vérifier utilisateur connecté
    const [users] = await req.db.query(
      `SELECT id FROM utilisateurs WHERE id = ?`,
      [req.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur introuvable"
      });
    }

    // 5. Mise à jour email
    await req.db.query(
      `UPDATE utilisateurs SET email = ? WHERE id = ?`,
      [email, req.userId]
    );

    // 6. Réponse succès
    return res.json({
      success: true,
      message: "Email ajouté / modifié avec succès"
    });

  } catch (error) {
    console.error("Erreur change-email :", error);

    return res.status(500).json({
      success: false,
      message: "Erreur interne du serveur"
    });
  }
});


module.exports = router;
