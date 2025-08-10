

const express = require('express');
const router = express.Router();

// Route de vérification
router.post('/verify-otp', (req, res) => {
  res.json({ 
    success: true,
    message: 'Vérification OTP réussie' 
  });
});

// Route de renvoi
router.post('/resend-otp', (req, res) => {
  res.json({ 
    success: true,
    message: '123456' 
  });
});

module.exports = router;