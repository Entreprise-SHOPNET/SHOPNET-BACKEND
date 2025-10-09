

require('dotenv').config();
const nodemailer = require('nodemailer');

/**
 * Envoyer un OTP via SMTP Gmail
 * @param {string} to - Email du destinataire
 * @param {string} fullName - Nom complet de l'utilisateur
 * @param {string} otpCode - Code OTP
 */
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    // Configurer le transporteur SMTP
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER,  // ton email Gmail
        pass: process.env.MAIL_PASS   // clé d'application Google
      }
    });

    // Construire le mail HTML
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.MAIL_USER,
      to,
      subject: 'Votre code de confirmation SHOPNET',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Bienvenue sur SHOPNET, ${fullName} !</h2>
          <p>Voici votre code de vérification :</p>
          <h1 style="color: #4CB050;">${otpCode}</h1>
          <p><i>Ce code expirera dans 10 minutes.</i></p>
        </div>
      `
    };

    // Envoyer le mail
    await transporter.sendMail(mailOptions);
    console.log(`[INFO] ✅ OTP envoyé à ${to}`);
    return true;

  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
