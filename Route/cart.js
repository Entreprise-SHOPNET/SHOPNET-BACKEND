


const express = require('express');
const router = express.Router();

const db = require('../db');
const authenticateToken = require('../middlewares/authMiddleware');
const sendPushNotification = require('../utils/sendPushNotification');


// -----------------------------------------------------
// 🛒 AJOUT AU PANIER + NOTIFICATION VENDEUR (AVEC IMAGE)
// -----------------------------------------------------
router.post('/', authenticateToken, async (req, res) => {
  const userId = Number(req.userId);
  const body = req.body || {};

  const {
    product_id,
    title,
    description,
    price,
    original_price,
    category,
    condition,
    quantity,
    stock,
    location,
    delivery_options,
    images,
    seller_id,
    seller_name,
    seller_rating
  } = body;

  if (!product_id || !title || !price) {
    return res.status(400).json({
      success: false,
      message: 'Champs obligatoires manquants'
    });
  }

  try {
    // -------------------------------------------------
    // 1️⃣ AJOUT / UPDATE PANIER
    // -------------------------------------------------
    const [existing] = await db.query(
      'SELECT * FROM carts WHERE user_id = ? AND product_id = ?',
      [userId, product_id]
    );

    if (existing.length > 0) {
      await db.query(
        'UPDATE carts SET quantity = quantity + ?, updated_at = NOW() WHERE user_id = ? AND product_id = ?',
        [quantity || 1, userId, product_id]
      );
    } else {
      await db.query(
        `INSERT INTO carts 
        (user_id, product_id, title, description, price, original_price, category, \`condition\`, quantity, stock, location, delivery_options, images, seller_id, seller_name, seller_rating, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          userId,
          product_id,
          title || '',
          description || '',
          price,
          original_price || price,
          category || '',
          condition || 'new',
          quantity || 1,
          stock || 0,
          location || '',
          JSON.stringify(delivery_options || {}),
          JSON.stringify(images || []),
          seller_id || null,
          seller_name || '',
          seller_rating || 0
        ]
      );
    }

    // -------------------------------------------------
    // 🖼️ EXTRACTION IMAGE PRODUIT
    // -------------------------------------------------
    let productImage = null;
    try {
      const parsedImages = JSON.parse(images || '[]');
      productImage = parsedImages.length > 0 ? parsedImages[0] : null;
    } catch (e) {
      productImage = null;
    }

    // -------------------------------------------------
    // 🔔 2️⃣ NOTIFICATION VENDEUR (FCM + IMAGE)
    // -------------------------------------------------
    if (seller_id) {
      const [sellerRows] = await db.query(
        'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
        [seller_id]
      );

      if (sellerRows.length > 0 && sellerRows[0].fcm_token) {
        try {
          await sendPushNotification(
            sellerRows[0].fcm_token,
            '🛒 Nouveau client intéressé',
            `Quelqu’un s’intéresse à "${title}" 👀`,
            {
              productId: product_id,
              buyerId: userId
            },
            productImage // ✅ IMAGE ICI
          );

          console.log('🔔 Notification panier envoyée au vendeur:', seller_id);
        } catch (err) {
          console.error('❌ FCM cart error:', err.message);
        }
      } else {
        console.warn('⚠️ Aucun token FCM vendeur:', seller_id);
      }
    }

    return res.json({
      success: true,
      message: 'Produit ajouté au panier avec succès',
      userId
    });

  } catch (err) {
    console.error('❌ Erreur ajout panier :', err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});


// -----------------------------------------------------
// 📦 RÉCUPÉRER PANIER
// -----------------------------------------------------
router.get('/', authenticateToken, async (req, res) => {
  const userId = Number(req.userId);

  try {
    const [rows] = await db.query(
      'SELECT * FROM carts WHERE user_id = ?',
      [userId]
    );

    return res.json({
      success: true,
      cart: rows
    });

  } catch (err) {
    console.error('❌ Erreur récupération panier :', err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});


// -----------------------------------------------------
// 🗑️ SUPPRIMER PANIER
// -----------------------------------------------------
router.delete('/:cart_id', authenticateToken, async (req, res) => {
  const userId = Number(req.userId);
  const cart_id = Number(req.params.cart_id);

  if (!cart_id) {
    return res.status(400).json({
      success: false,
      message: 'cart_id invalide'
    });
  }

  try {
    const [result] = await db.query(
      'DELETE FROM carts WHERE user_id = ? AND cart_id = ?',
      [userId, cart_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé dans le panier'
      });
    }

    return res.json({
      success: true,
      message: 'Produit supprimé du panier'
    });

  } catch (err) {
    console.error('❌ Erreur suppression panier :', err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});

module.exports = router;
