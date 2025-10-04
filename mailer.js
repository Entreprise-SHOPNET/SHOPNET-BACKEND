

require('dotenv').config();
const mailjet = require('node-mailjet').connect(
  process.env.MAILJET_API_KEY_PUBLIC,
  process.env.MAILJET_API_KEY_PRIVATE
);

/**
 * Fonction pour envoyer un OTP à l'utilisateur
 * @param {string} to - Email du destinataire
 * @param {string} fullName - Nom complet de l'utilisateur
 * @param {string} otpCode - Code OTP à envoyer
 */
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const request = mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: process.env.EMAIL_FROM,
              Name: "SHOPIA"
            },
            To: [
              {
                Email: to,
                Name: fullName
              }
            ],
            Subject: "Votre code de confirmation SHOPIA",
            HTMLPart: `
              <h2>Bienvenue sur SHOPIA, ${fullName} !</h2>
              <p>Votre code de vérification :</p>
              <h1 style="color: #4CB050;">${otpCode}</h1>
              <p><i>Ce code expirera dans 10 minutes.</i></p>
            `
          }
        ]
      });

    await request;
    console.log(`[INFO] OTP envoyé à ${to}: ${otpCode}`);
  } catch (error) {
    console.error('[ERREUR EMAIL]', error);
    // L'inscription continue même si l'email échoue
  }
}

module.exports = {
  sendOTPEmail
};
