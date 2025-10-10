

// testMail.js
require('dotenv').config();
const { sendOTPEmail } = require('./mailer');

(async () => {
  console.log('--- 🔍 TEST D\'ENVOI EMAIL SHOPNET ---');

  try {
    const success = await sendOTPEmail(
      'tegramatondo001@gmail.com', // adresse de test
      'SHOPNET',                   // nom d’expéditeur
      '123456'                     // code OTP de test
    );

    if (success) {
      console.log('✅ Email envoyé avec succès !');
    } else {
      console.log('❌ Échec de l’envoi de l’email.');
    }
  } catch (error) {
    console.error('⚠️ Erreur lors du test d’envoi :', error.message);
  }

  console.log('---------------------------------------');
})();
