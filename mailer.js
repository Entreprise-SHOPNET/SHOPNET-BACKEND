

require('dotenv').config();
import fs from 'fs';
import { google } from 'googleapis';

// Fonction pour envoyer OTP via Gmail API
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    // Lire les credentials et token
    const credentials = JSON.parse(fs.readFileSync('./credentials.json'));
    const token = JSON.parse(fs.readFileSync('./token.json'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    // Authentification OAuth2
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(token);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Construire le message
    const message = [
      `To: ${to}`,
      `Subject: Votre code de confirmation SHOPNET`,
      'Content-Type: text/html; charset=utf-8',
      '',
      `<div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Bienvenue sur SHOPNET, ${fullName} !</h2>
          <p>Voici votre code de vérification :</p>
          <h1 style="color: #4CB050;">${otpCode}</h1>
          <p><i>Ce code expirera dans 10 minutes.</i></p>
        </div>`
    ].join('\n');

    // Encoder en base64url
    const encodedMessage = Buffer.from(message)
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

export { sendOTPEmail };
