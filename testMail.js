

require('dotenv').config();
const { sendOTPEmail } = require('./mailer');

sendOTPEmail('tegramatondo001@gmail.com', 'SHOPNET', '123456')
  .then(sent => console.log('Email envoyé ?', sent))
  .catch(err => console.error(err));
