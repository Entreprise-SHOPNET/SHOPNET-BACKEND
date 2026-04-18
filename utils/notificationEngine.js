

// utils/notificationEngine.js
// utils/notificationEngine.js

const templates = require("./notificationTemplates");

/**
 * Génère une notification intelligente
 * @param {string} type - ex: cart_abandoned, trend, etc.
 * @param {string} product - nom du produit (string)
 * @param {string|null} image - image du produit (optionnel)
 */
function generateNotification(type, product, image = null) {
  const category = templates[type];

  if (!category || category.length === 0) {
    return {
      title: "📢 Notification",
      message: "Nouvelle activité sur SHOPNET.",
      image: image,
    };
  }

  // Choisir un template aléatoire
  const randomIndex = Math.floor(Math.random() * category.length);
  const template = category[randomIndex];

  return {
    title: template.title,
    message: template.message(product),
    image: image, // 🔥 AJOUT IMPORTANT
  };
}

module.exports = {
  generateNotification,
};
