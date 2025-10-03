

require("dotenv").config();

// Infobip configuration
const INFOSBIP_API_KEY = process.env.INFOSBIP_API_KEY;
const INFOSBIP_BASE_URL = process.env.INFOSBIP_BASE_URL || "https://m3nwx6.api.infobip.com";

// Fonction pour envoyer un email via Infobip
async function sendEmail(toEmail, subject, htmlContent) {
  try {
    const response = await fetch(`${INFOSBIP_BASE_URL}/email/3/send`, {
      method: "POST",
      headers: {
        "Authorization": `App ${INFOSBIP_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "no-reply@shopnet.com",
        to: [{ email: toEmail }],
        subject: subject,
        html: htmlContent
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("[ERREUR INFOSBIP EMAIL]", errorData);
      throw new Error(errorData);
    }

    return await response.json();
  } catch (error) {
    console.error("[ERREUR INFOSBIP EMAIL]", error.message);
    throw error;
  }
}

module.exports = sendEmail;

