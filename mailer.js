

require('dotenv').config();
const Resend = require('resend').Resend;

// Initialisation de Resend avec la clé API
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Envoie un OTP par email
 * @param {string} to - Adresse email du destinataire
 * @param {string} fullName - Nom complet de l'utilisateur
 * @param {string} otpCode - Code OTP
 */
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'SHOPNET <no-reply@resend.dev>',
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
    });

    if (error) throw new Error(error.message);

    console.log(`[INFO] ✅ OTP envoyé à ${to}`);
    return true;

  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
