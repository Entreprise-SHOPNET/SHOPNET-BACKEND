

require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SHOPNET <onboarding@resend.dev>', // Pas besoin de domaine
        to: [to],
        subject: 'Votre code de confirmation SHOPNET',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Bienvenue sur SHOPNET, ${fullName} !</h2>
            <p>Voici votre code de vérification :</p>
            <h1 style="color: #4CB050;">${otpCode}</h1>
            <p><i>Ce code expirera dans 10 minutes.</i></p>
          </div>
        `
      })
    });

    if (!res.ok) throw new Error(await res.text());

    console.log(`[INFO] ✅ OTP envoyé à ${to}`);
    return true;
  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
