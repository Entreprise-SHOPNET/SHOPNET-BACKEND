

require('dotenv').config();
const nodemailer = require('nodemailer');

async function sendOTPEmail(to, fullName, otpCode) {
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,            // TLS sécurisé
      secure: true,         // true = port 465
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      },
      connectionTimeout: 10000 // 10s
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.MAIL_USER,
      to,
      subject: 'Votre code de confirmation SHOPNET',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Bienvenue sur SHOPNET, ${fullName} !</h2>
          <p>Voici votre code de vérification :</p>
          <h1 style="color: #4CB050;">${otpCode}</h1>
          <p><i>Ce code expirera dans 10 minutes.</i></p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[INFO] ✅ OTP envoyé à ${to}`);
    return true;

  } catch (err) {
    console.error('[ERREUR EMAIL]', err.message);
    return false;
  }
}

module.exports = { sendOTPEmail };
