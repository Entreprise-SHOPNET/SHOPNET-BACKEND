

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Génère OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * REGISTER USER
 */
router.post('/register', async (req, res) => {
  try {
    const { fullName, phone, password, email, companyName, address } = req.body;

    // champs obligatoires
    if (!fullName || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nom, téléphone et mot de passe sont obligatoires'
      });
    }

    // nettoyer email
    const cleanEmail = email && email.trim() !== "" ? email.trim() : null;

    // vérifier téléphone
    const [phoneCheck] = await req.db.query(
      'SELECT id FROM utilisateurs WHERE phone = ?',
      [phone]
    );

    if (phoneCheck.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Ce numéro est déjà utilisé'
      });
    }

    // vérifier email seulement si fourni
    if (cleanEmail) {
      const [emailCheck] = await req.db.query(
        'SELECT id FROM utilisateurs WHERE email = ?',
        [cleanEmail]
      );

      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Cet email est déjà utilisé'
        });
      }
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // OTP
    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    // insert user
    const [result] = await req.db.query(
      'INSERT INTO utilisateurs SET ?',
      {
        fullName,
        phone,
        email: cleanEmail,
        password: hashedPassword,
        companyName: companyName || null,
        address: address || null,
        otp_code: otpCode,
        otp_expires_at: otpExpires,
        is_verified: false
      }
    );

    res.json({
      success: true,
      userId: result.insertId,
      otp: otpCode, // ⚠️ dev only
      message: 'Compte créé avec succès'
    });

  } catch (error) {
    console.error('[REGISTER ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

/**
 * VERIFY OTP
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const [user] = await req.db.query(
      `SELECT id, phone, email 
       FROM utilisateurs 
       WHERE id = ? 
       AND otp_code = ? 
       AND otp_expires_at > NOW()
       AND is_verified = 0`,
      [userId, otp]
    );

    if (user.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Code OTP invalide ou expiré'
      });
    }

    // update user
    await req.db.query(
      `UPDATE utilisateurs 
       SET otp_code = NULL,
           otp_expires_at = NULL,
           is_verified = 1
       WHERE id = ?`,
      [userId]
    );

    // token
    const token = jwt.sign(
      {
        id: user[0].id,
        phone: user[0].phone,
        email: user[0].email
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      message: 'Compte vérifié avec succès'
    });

  } catch (error) {
    console.error('[VERIFY ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

module.exports = router;