


const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const transporter = require('../mailer');

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, companyName, nif, address } = req.body;

    // Validation des champs
    const requiredFields = ['fullName', 'email', 'phone', 'password'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Champs manquants: ${missingFields.join(', ')}` 
      });
    }

    // Vérification des doublons
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

    // Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);
    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Création de l'utilisateur
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

    // Envoi de l'email avec OTP
    await transporter.sendMail({
      from: `"SHOPIA" <${process.env.EMAIL_FROM || 'no-reply@shopia.com'}>`,
      to: email,
      subject: 'Votre code de confirmation SHOPIA',
      html: `
        <h2>Bienvenue sur SHOPIA, ${fullName} !</h2>
        <p>Votre code de vérification :</p>
        <h1 style="color: #4CB050;">${otpCode}</h1>
        <p><i>Ce code expirera dans 10 minutes.</i></p>
      `
    });

    res.json({
      success: true,
      userId: result.insertId,
      message: 'Un code de vérification a été envoyé à votre email.'
    });

  } catch (error) {
    console.error('[ERREUR INSCRIPTION]', error.stack);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création du compte'
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;

    // 1. Vérification de l'OTP
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

    // 2. Génération d'un NOUVEAU token avec l'ID utilisateur
    const tokenPayload = { 
      id: user[0].id,  // L'élément crucial qui était manquant
      email: user[0].email,
      phone: user[0].phone
    };
    
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 3. Mise à jour de l'utilisateur
    await req.db.query(
      `UPDATE utilisateurs 
       SET otp_code = NULL, 
           otp_expires_at = NULL,
           is_verified = TRUE
       WHERE id = ?`,
      [userId]
    );

    // 4. Réponse avec le nouveau token
    res.json({
      success: true,
      token: token,
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