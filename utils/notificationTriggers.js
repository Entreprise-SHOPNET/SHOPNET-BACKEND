

// utils/notificationTriggers.js

const sendSmartNotification = require("./sendSmartNotification");

/**
 * 🛒 PANIER ABANDONNÉ
 */
async function triggerCartAbandoned(user, product) {
  return sendSmartNotification(
    user.fcm_token,
    "cart_abandoned",
    product.title,
    {
      userId: user.id,
      productId: product.id,
      image: product.image || null, // 🔥 AJOUT IMPORTANT
    }
  );
}

/**
 * 🆕 NOUVEAU PRODUIT
 */
async function triggerNewProduct(users, product) {
  for (const user of users) {
    await sendSmartNotification(
      user.fcm_token,
      "new_product",
      product.title,
      {
        productId: product.id,
        image: product.image || null, // 🔥 AJOUT
      }
    );
  }
}

/**
 * 📉 BAISSE DE PRIX
 */
async function triggerPriceDrop(users, product) {
  for (const user of users) {
    await sendSmartNotification(
      user.fcm_token,
      "price_drop",
      product.title,
      {
        oldPrice: product.old_price,
        newPrice: product.new_price,
        image: product.image || null, // 🔥 AJOUT
      }
    );
  }
}

/**
 * 🧾 COMMANDE CONFIRMÉE
 */
async function triggerOrderConfirmed(user, product) {
  return sendSmartNotification(
    user.fcm_token,
    "order_confirmed",
    product.title,
    {
      orderId: product.order_id,
      image: product.image || null, // 🔥 AJOUT
    }
  );
}

module.exports = {
  triggerCartAbandoned,
  triggerNewProduct,
  triggerPriceDrop,
  triggerOrderConfirmed,
};
