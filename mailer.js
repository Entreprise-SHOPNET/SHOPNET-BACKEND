
require("dotenv").config();
const nodemailer = require("nodemailer");

// Création du transporteur SMTP pour Gmail
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,        // TLS
  secure: false,    // true si port 465
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS, // clé d'application Gmail recommandée
  },
});

// Fonction pour envoyer un OTP
async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const mailOptions = {
      from: `"SHOPIA" <${process.env.MAIL_USER}>`,
      to,
      subject: 'Votre code de confirmation SHOPIA',
      html: `
        <h2>Bienvenue sur SHOPIA, ${fullName} !</h2>
        <p>Votre code de vérification :</p>
        <h1 style="color: #4CB050;">${otpCode}</h1>
        <p><i>Ce code expirera dans 10 minutes.</i></p>
      `
    };

    await transporter.sendMail(mailOptions);

    // Log pour test
    console.log(`[INFO] OTP envoyé à ${to}: ${otpCode}`);

  } catch (err) {
    console.error('[ERREUR EMAIL]', err);
    // Ne bloque pas l'inscription si l'email échoue
  }
}

module.exports = {
  transporter,
  sendOTPEmail
};
