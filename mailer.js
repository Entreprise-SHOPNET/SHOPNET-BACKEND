


// mailer.js
require('dotenv').config();
const nodemailer = require('nodemailer');

// Transporter SMTP Brevo (pool pour réduire timeouts)
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: Number(process.env.MAIL_PORT || 587),
  secure: false, // TLS will be used with port 587 via STARTTLS
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  },
  pool: true,                // réutiliser la connexion, évite timeouts
  maxConnections: 5,
  maxMessages: 100,
  connectionTimeout: 15000,  // 15s
  greetingTimeout: 10000,
  socketTimeout: 15000
});

/**
 * Envoie un OTP
 * @param {string} to
 * @param {string} fullName
 * @param {string} otpCode
 */
async function sendOTPEmail(to, fullName, otpCode) {
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.MAIL_USER,
    to,
    subject: 'Votre code de vérification SHOPNET',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 12px;">
        <h2>Bienvenue sur <span style="color:#4CB050;">SHOPNET</span>, ${fullName} !</h2>
        <p>Votre code de vérification :</p>
        <h1 style="color:#4CB050; letter-spacing: 3px;">${otpCode}</h1>
        <p style="color:#666; font-size:13px;"><i>Ce code expirera dans 10 minutes.</i></p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[INFO] OTP envoyé à ${to} — messageId: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('[ERREUR EMAIL]', err);
    return false;
  }
}

module.exports = { sendOTPEmail };
