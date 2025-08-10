


const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Fonction pour uniformiser les réponses d'erreur
function sendErrorResponse(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

router.post('/verify-otp', async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return sendErrorResponse(res, 400, 'ID utilisateur et code requis.');
    }

    const [userResult] = await req.db.query(
      'SELECT id, email, otp_code, otp_expires_at, fullName, phone, role FROM utilisateurs WHERE id = ?',
      [userId]
    );

    if (userResult.length === 0) {
      return sendErrorResponse(res, 404, 'Utilisateur non trouvé.');
    }

    const user = userResult[0];
    const now = new Date();

    if (now > user.otp_expires_at) {
      return sendErrorResponse(res, 410, 'Code expiré. Renvoyez le code.');
    }

    if (otp !== user.otp_code) {
      return sendErrorResponse(res, 401, 'Code invalide.');
    }

    // ✅ Marquer comme vérifié
    await req.db.query(
      'UPDATE utilisateurs SET email_verified = 1 WHERE id = ?',
      [userId]
    );

    // ✅ Générer un token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role }, // <-- ici on met bien `id`
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ✅ Renvoyer token + user
    res.json({
      success: true,
      message: 'Code vérifié avec succès.',
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
      }
    });

  } catch (error) {
    console.error('Erreur dans /verify-otp:', error);
    sendErrorResponse(res, 500, 'Erreur serveur.');
  }
});

module.exports = router;

