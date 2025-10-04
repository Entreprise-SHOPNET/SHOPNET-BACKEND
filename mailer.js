

require('dotenv').config();
const Mailjet = require('node-mailjet');

// Connexion Mailjet avec les bonnes variables
const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY_PUBLIC,
  process.env.MAILJET_API_KEY_PRIVATE
);

// Fonction pour envoyer OTP
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const request = mailjet.post("send", { version: 'v3.1' }).request({
      Messages: [
        {
          From: {
            Email: process.env.EMAIL_FROM || "no-reply@shopnet.com",
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
  } catch (err) {
    console.error('[ERREUR EMAIL]', err);
  }
}

module.exports = {
  sendOTPEmail
};
