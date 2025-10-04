

require('dotenv').config();
const { Resend } = require('resend');

// Initialisation de Resend avec la clé de ton .env
const resend = new Resend(process.env.RESEND_API_KEY);

// Fonction pour envoyer un OTP par e-mail
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'SHOPIA <noreply@resend.dev>',
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
      `,
    });

    if (error) {
      console.error('[ERREUR ENVOI OTP]', error);
      return false;
    }

    console.log(`[INFO] ✅ OTP envoyé avec succès à ${to}: ${otpCode}`);
    return true;
  } catch (err) {
    console.error('[ERREUR EMAIL]', err);
    return false;
  }
}

module.exports = { sendOTPEmail };
