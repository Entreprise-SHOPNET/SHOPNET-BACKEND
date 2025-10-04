

require('dotenv').config();
const mailjet = require('node-mailjet')
  .connect(process.env.MJ_APIKEY_PUBLIC, process.env.MJ_APIKEY_PRIVATE);

// Fonction pour envoyer l'OTP
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const request = mailjet
      .post('send', { version: 'v3.1' })
      .request({
        Messages: [
          {
            From: {
              Email: process.env.MAIL_FROM || 'no-reply@shopia.com',
              Name: 'SHOPIA'
            },
            To: [
              {
                Email: to,
                Name: fullName
              }
            ],
            Subject: 'Votre code de confirmation SHOPIA',
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
    console.error('[ERREUR EMAIL]', err.message);
    // Ne bloque pas l'inscription si l'email échoue
  }
}

module.exports = {
  sendOTPEmail
};
