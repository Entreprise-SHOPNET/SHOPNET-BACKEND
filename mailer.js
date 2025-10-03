

require("dotenv").config();
const nodemailer = require("nodemailer");

// Configuration du transporteur Nodemailer avec Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER, // Ton email dans .env
    pass: process.env.MAIL_PASS, // Ton mot de passe dans .env
  },
});

module.exports = transporter;
