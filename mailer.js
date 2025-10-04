

require('dotenv').config();
const axios = require('axios');

/**
 * Envoi d’un OTP par e-mail via Brevo (API officielle)
 */
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          name: 'SHOPNET',
          email: process.env.EMAIL_FROM || 'entrepriseshopia@gmail.com',
        },
        to: [{ email: to, name: fullName }],
        subject: 'Votre code de confirmation SHOPNET',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #333;">Bienvenue sur <span style="color: #4CB050;">SHOPNET</span>, ${fullName} !</h2>
            <p>Voici votre code de vérification :</p>
            <h1 style="color: #4CB050; font-size: 32px; letter-spacing: 3px;">${otpCode}</h1>
            <p style="margin-top: 10px; color: #555;">
              <i>Ce code expirera dans 10 minutes.</i>
            </p>
          </div>
        `,
      },
      {
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
        },
        timeout: 15000,
      }
    );

    console.log(`[INFO] ✅ Email OTP envoyé à ${to}`);
    return true;
  } catch (err) {
    console.error('[ERREUR EMAIL]', err.response?.data || err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
