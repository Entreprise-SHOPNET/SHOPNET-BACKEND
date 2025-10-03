


require("dotenv").config();
const axios = require("axios");

// Infobip configuration
const INFOSBIP_API_KEY = process.env.INFOSBIP_API_KEY; // Mets ta clé API dans le .env
const INFOSBIP_BASE_URL = process.env.INFOSBIP_BASE_URL || "https://m3nwx6.api.infobip.com";

// Fonction pour envoyer un email via Infobip
async function sendEmail(toEmail, subject, htmlContent) {
  try {
    const response = await axios.post(
      `${INFOSBIP_BASE_URL}/email/3/send`, // Endpoint Infobip pour envoyer un email
      {
        from: process.env.EMAIL_FROM || "no-reply@shopnet.com", // Email vérifié sur Infobip
        to: [{ email: toEmail }],
        subject: subject,
        html: htmlContent
      },
      {
        headers: {
          "Authorization": `App ${INFOSBIP_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error("[ERREUR INFOSBIP EMAIL]", error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = sendEmail;
