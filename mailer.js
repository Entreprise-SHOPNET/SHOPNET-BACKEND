

require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');

/**
 * Envoyer un OTP via Gmail API
 * @param {string} to - Email du destinataire
 * @param {string} fullName - Nom complet de l'utilisateur
 * @param {string} otpCode - Code OTP
 */
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    // Lire les credentials OAuth2
    const credentials = JSON.parse(fs.readFileSync('./credentials.json'));
    const token = JSON.parse(fs.readFileSync('./token.json'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    // Configurer l’authentification OAuth2
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Construire le message HTML
    const messageParts = [
      `To: ${to}`,
      'Subject: Votre code de confirmation SHOPNET',
      'Content-Type: text/html; charset=utf-8',
      '',
      `<div style="font-family: Arial, sans-serif; padding: 20px;">
         <h2>Bienvenue sur SHOPNET, ${fullName} !</h2>
         <p>Voici votre code de vérification :</p>
         <h1 style="color: #4CB050;">${otpCode}</h1>
         <p><i>Ce code expirera dans 10 minutes.</i></p>
       </div>`
    ];

    const encodedMessage = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Envoyer l’email
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    console.log(`[INFO] ✅ OTP envoyé à ${to}`);
    return true;
  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

// Exporter la fonction pour les autres fichiers
module.exports = { sendOTPEmail };
