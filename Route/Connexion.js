


const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // 🔑 Import du module JWT

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

module.exports = router;
