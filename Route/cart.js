





const express = require('express');
const router = express.Router();

const db = require('../db');
const authenticateToken = require('../middlewares/authMiddleware');
const sendPushNotification = require('../utils/sendPushNotification');


router.get('/cron/cart-abandoned', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.user_id,
        c.product_id,
        c.updated_at,
        f.fcm_token
      FROM carts c
      JOIN fcm_tokens f ON f.user_id = c.user_id
      WHERE c.updated_at BETWEEN NOW() - INTERVAL 24 HOUR AND NOW() - INTERVAL 2 HOUR
    `);

    const sent = new Set();

    for (const item of rows) {
      try {
        if (!item.fcm_token) continue;

        const key = `${item.user_id}-${item.product_id}`;
        if (sent.has(key)) continue;
        sent.add(key);

        // -----------------------------------------------------
        // 🔹 GET PRODUCT INFO (COMME LIKE)
        // -----------------------------------------------------
        const [productRows] = await db.query(
          'SELECT title FROM products WHERE id = ?',
          [item.product_id]
        );

        const title = productRows.length > 0
          ? productRows[0].title
          : 'ce produit';

        // -----------------------------------------------------
        // 🖼 IMAGE (SAME LOGIC LIKE)
        // -----------------------------------------------------
        const [imageRows] = await db.query(
          'SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1',
          [item.product_id]
        );

        let imageUrl = null;

        if (imageRows.length > 0) {
          const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

          imageUrl = imageRows[0].image_path.startsWith("http")
            ? imageRows[0].image_path
            : `${CLOUDINARY_BASE}${imageRows[0].image_path}`;
        }

        // -----------------------------------------------------
        // ⏱ LOGIQUE TEMPS
        // -----------------------------------------------------
        const hours = Math.floor(
          (Date.now() - new Date(item.updated_at)) / (1000 * 60 * 60)
        );

        let notifTitle = '';
        let message = '';

        if (hours >= 2 && hours < 6) {
          notifTitle = '🛒 Ton panier t’attend';
          message = `Tu as laissé "${title}" dans ton panier 🔥`;
        } 
        else if (hours >= 6 && hours < 12) {
          notifTitle = '⏳ Toujours disponible';
          message = `"${title}" est encore dans ton panier 💡`;
        } 
        else {
          notifTitle = '🔥 Dernier rappel';
          message = `"${title}" risque de disparaître 🛒`;
        }

        // -----------------------------------------------------
        // 🔔 SEND PUSH (SAME LIKE STRUCTURE)
        // -----------------------------------------------------
        console.log('📲 Sending push to:', item.fcm_token);

        await sendPushNotification(
          item.fcm_token,
          notifTitle,
          message,
          {
            type: 'cart_abandoned',
            productId: item.product_id,
            image: imageUrl
          }
        );

        console.log('✅ Push sent user:', item.user_id);

      } catch (err) {
        console.error('❌ item error:', err.message);
      }
    }

    return res.json({
      success: true,
      message: 'Cart abandoned notifications sent',
      count: rows.length
    });

  } catch (err) {
    console.error('❌ cart-abandoned error:', err.message);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});



// -----------------------------------------------------
// 🛒 AJOUT AU PANIER + NOTIFICATION VENDEUR
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
        'UPDATE carts SET quantity = quantity + ? WHERE user_id = ? AND product_id = ?',
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
    // 🔔 2️⃣ NOTIFICATION VENDEUR (FCM)
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
            '🛒 Nouveau ajout au panier',
            `"${title}" a été ajouté au panier.`,
            {
              productId: product_id,
              buyerId: userId
            }
          );

          console.log('🔔 Notification panier envoyée au vendeur:', seller_id);
        } catch (err) {
          console.error('FCM cart error:', err.message);
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

