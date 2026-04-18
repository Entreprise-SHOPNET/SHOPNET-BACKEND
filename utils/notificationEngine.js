

// utils/notificationEngine.js

const templates = require("./notificationTemplates");

/**
 * Génère une notification intelligente
 * @param {string} type - ex: cart_abandoned, trend, etc.
 * @param {string} product - nom du produit
 */
function generateNotification(type, product) {
  const category = templates[type];

  if (!category || category.length === 0) {
    return {
      title: "📢 Notification",
      message: "Nouvelle activité sur SHOPNET.",
    };
  }

  // Choisir un message aléatoire
  const randomIndex = Math.floor(Math.random() * category.length);
  const template = category[randomIndex];

  return {
    title: template.title,
    message: template.message(product),
  };
}

module.exports = {
  generateNotification,
};


