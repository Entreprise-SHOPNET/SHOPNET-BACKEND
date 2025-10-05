

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: 'SHOPNET',
          email: process.env.EMAIL_FROM
        },
        to: [{ email: to, name: fullName }],
        subject: 'Votre code de confirmation SHOPNET',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Bienvenue sur SHOPNET, ${fullName} !</h2>
            <p>Voici votre code de vérification :</p>
            <h1>${otpCode}</h1>
            <p><i>Ce code expirera dans 10 minutes.</i></p>
          </div>
        `
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }

    console.log(`[INFO] ✅ OTP envoyé à ${to}`);
    return true;
  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
