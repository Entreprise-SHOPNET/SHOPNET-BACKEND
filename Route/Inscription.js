


const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendOTPEmail } = require('../mailer'); // version Resend

// Génère un OTP à 6 chiffres
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Route POST /register
 * Inscription et envoi OTP
 */
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, companyName, nif, address } = req.body;

    // 1️⃣ Validation des champs obligatoires
    const requiredFields = ['fullName', 'email', 'phone', 'password'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Champs manquants: ${missingFields.join(', ')}` 
      });
    }

    // 2️⃣ Vérification des doublons
    const [existing] = await req.db.query(
      'SELECT id FROM utilisateurs WHERE email = ? OR phone = ?',
      [email, phone]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email ou numéro déjà utilisé'
      });
    }

    // 3️⃣ Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4️⃣ Génération OTP et expiration
    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // 5️⃣ Création de l'utilisateur
    const [result] = await req.db.query('INSERT INTO utilisateurs SET ?', {
      fullName,
      email,
      phone,
      password: hashedPassword,
      companyName: companyName || null,
      nif: nif || null,
      address: address || null,
      otp_code: otpCode,
      otp_expires_at: otpExpires,
      is_verified: false
    });

    // 6️⃣ Envoi du mail OTP (asynchrone)
    const emailSent = await sendOTPEmail(email, fullName, otpCode);
    if (!emailSent) {
      console.warn(`[WARN] OTP non envoyé à ${email}`);
    }

    // 7️⃣ Réponse côté client
    res.json({
      success: true,
      userId: result.insertId,
      message: 'Un code de vérification a été généré et envoyé à votre email.'
    });

  } catch (error) {
    console.error('[ERREUR INSCRIPTION]', error.stack);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création du compte'
    });
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
      `SELECT id, email, phone FROM utilisateurs 
       WHERE id = ? AND otp_code = ? AND otp_expires_at > NOW()`,
      [userId, otp]
    );

    if (!user.length) {
      return res.status(400).json({
        success: false,
        message: 'Code OTP invalide ou expiré'
      });
    }

    // Génération token JWT
    const tokenPayload = { 
      id: user[0].id,
      email: user[0].email,
      phone: user[0].phone
    };
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Mise à jour utilisateur : OTP effacé, compte vérifié
    await req.db.query(
      `UPDATE utilisateurs 
       SET otp_code = NULL, 
           otp_expires_at = NULL,
           is_verified = TRUE
       WHERE id = ?`,
      [userId]
    );

    // Réponse côté client
    res.json({
      success: true,
      token,
      message: 'Compte vérifié avec succès !',
      user: {
        id: user[0].id,
        email: user[0].email,
        phone: user[0].phone
      }
    });

  } catch (error) {
    console.error('[ERREUR VERIFICATION OTP]', error.stack);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification'
    });
  }
});

module.exports = router;

module.exports = router;
