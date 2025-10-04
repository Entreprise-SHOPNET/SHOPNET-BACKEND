


require('dotenv').config();
const nodemailer = require('nodemailer');

// Création du transporteur Gmail avec clé d'application
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,      // ton Gmail
    pass: process.env.MAIL_PASS       // clé d'application (16 caractères)
  }
});

// Fonction pour envoyer un OTP par e-mail
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || `SHOPIA <${process.env.MAIL_USER}>`,
      to,
      subject: 'Votre code de confirmation SHOPIA',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #333;">Bienvenue sur <span style="color: #4CB050;">SHOPIA</span>, ${fullName} !</h2>
          <p>Voici votre code de vérification :</p>
          <h1 style="color: #4CB050; font-size: 32px; letter-spacing: 3px;">${otpCode}</h1>
          <p style="margin-top: 10px; color: #555;">
            <i>Ce code expirera dans 10 minutes.</i>
          </p>
        </div>
      `
    };

    // Envoi de l'email
    const info = await transporter.sendMail(mailOptions);
    console.log(`[INFO] ✅ OTP envoyé à ${to}: ${otpCode}, MessageID: ${info.messageId}`);
    return true;

  } catch (err) {
    console.error('[ERREUR EMAIL]', err);
    return false;
  }
}

module.exports = { sendOTPEmail };
