

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * Envoi d’un OTP par e-mail via Brevo (API officielle) en utilisant fetch
 */
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
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
      }),
      // Timeout manuel pour fetch
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[ERREUR EMAIL]', errorData);
      return false;
    }

    console.log(`[INFO] ✅ Email OTP envoyé à ${to}`);
    return true;

  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
