

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Génère un OTP à 6 chiffres
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Route POST /register
 * Inscription et génération OTP directement pour l'app
 */
router.post('/register', async (req, res) => {
  try {
    const { fullName, phone, password, companyName, nif, address } = req.body;

    // Validation des champs obligatoires
    if (!fullName || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Champs manquants' });
    }

    // Vérification des doublons
    const [existing] = await req.db.query(
      'SELECT id FROM utilisateurs WHERE phone = ?',
      [phone]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Numéro déjà utilisé'
      });
    }

    // Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Génération OTP et expiration (10 minutes)
    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Création de l'utilisateur
    const [result] = await req.db.query('INSERT INTO utilisateurs SET ?', {
      fullName,
      phone,
      password: hashedPassword,
      companyName: companyName || null,
      nif: nif || null,
      address: address || null,
      otp_code: otpCode,
      otp_expires_at: otpExpires,
      is_verified: false
    });

    // 🔹 Retourne directement l'OTP dans la réponse (affichage app)
    res.json({
      success: true,
      userId: result.insertId,
      otp: otpCode, // à afficher dans l'app
      message: 'Votre code OTP est généré et visible dans l’application.'
    });

  } catch (error) {
    console.error('[ERREUR INSCRIPTION]', error.stack);
    res.status(500).json({ success: false, message: 'Erreur lors de la création du compte' });
  }
});

/**
 * Route POST /verify-otp
 * Vérifie le code OTP et active le compte
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;

    // Vérification OTP
    const [user] = await req.db.query(
      `SELECT id, phone FROM utilisateurs 
       WHERE id = ? AND otp_code = ? AND otp_expires_at > NOW()`,
      [userId, otp]
    );

    if (!user.length) {
      return res.status(400).json({ success: false, message: 'Code OTP invalide ou expiré' });
    }

    // Génération token JWT
    const token = jwt.sign({ id: user[0].id, phone: user[0].phone }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Mise à jour utilisateur : OTP effacé, compte vérifié
    await req.db.query(
      `UPDATE utilisateurs 
       SET otp_code = NULL, otp_expires_at = NULL, is_verified = TRUE
       WHERE id = ?`,
      [userId]
    );

    res.json({ success: true, token, message: 'Compte vérifié avec succès !' });

  } catch (error) {
    console.error('[ERREUR VERIFICATION OTP]', error.stack);
    res.status(500).json({ success: false, message: 'Erreur lors de la vérification' });
  }
});

module.exports = router;
