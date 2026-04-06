

// Route/vendeur/promotions.js
const express = require('express');
const router = express.Router();

const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const sendPushNotification = require('../../utils/sendPushNotification');

router.use(authMiddleware);

// -------------------------------------------------------------
// 🔥 ROUTE POST : Créer une promotion + Notifications FCM
// -------------------------------------------------------------
router.post('/', async (req, res) => {
  const {
    id: productId,
    title: productTitle,
    price,
    promoPrice,
    description,
    duration,
    notify_followers = false,
    notify_all_users = true
  } = req.body;

  const userId = req.userId;

  if (!productId || !promoPrice || !duration) {
    return res.status(400).json({
      success: false,
      message: 'Champs requis manquants'
    });
  }

  try {
    // 1️⃣ INSERT promotion
    const [result] = await db.query(
      `INSERT INTO promotions 
        (product_id, creator_id, product_title, original_price, promo_price, description, duration_days, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [productId, userId, productTitle, price, promoPrice, description, duration]
    );

    const promotionId = result.insertId;

    const message = `${productTitle} est maintenant à ${promoPrice}$ pendant ${duration} jours !`;

    // ---------------------------------------------------------
    // 🖼️ 2️⃣ RÉCUPÉRER IMAGE PRODUIT
    // ---------------------------------------------------------
    const [images] = await db.query(
      `SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1`,
      [productId]
    );

    let imageUrl = null;

    if (images.length > 0) {
      const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

      imageUrl = images[0].image_path.startsWith("http")
        ? images[0].image_path
        : `${CLOUDINARY_BASE}${images[0].image_path}`;
    }

    // ---------------------------------------------------------
    // 🔔 3️⃣ NOTIFICATION FOLLOWERS
    // ---------------------------------------------------------
    if (notify_followers) {
      const [followers] = await db.query(
        `SELECT ft.fcm_token
         FROM followers f
         JOIN fcm_tokens ft ON ft.user_id = f.follower_id
         WHERE f.user_id = ?`,
        [userId]
      );

      for (const f of followers) {
        if (f.fcm_token) {
          try {
            await sendPushNotification(
              f.fcm_token,
              "🔥 Nouvelle Promotion!",
              message,
              {
                promotionId,
                image: imageUrl
              }
            );
          } catch (err) {
            console.error("FCM follower error:", err.message);
          }
        }
      }
    }

    // ---------------------------------------------------------
    // 🔔 4️⃣ NOTIFICATION TOUS LES USERS
    // ---------------------------------------------------------
    if (notify_all_users) {
      const [users] = await db.query(
        `SELECT fcm_token 
         FROM fcm_tokens 
         WHERE user_id != ?`,
        [userId]
      );

      for (const u of users) {
        if (u.fcm_token) {
          try {
            await sendPushNotification(
              u.fcm_token,
              "📢 Promotion disponible !",
              message,
              {
                promotionId,
                image: imageUrl
              }
            );
          } catch (err) {
            console.error("FCM all users error:", err.message);
          }
        }
      }
    }

    return res.json({
      success: true,
      message: "Promotion créée avec succès",
      promotionId
    });

  } catch (error) {
    console.error("Erreur création promotion:", error.message);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
      details: error.message
    });
  }
});

// -------------------------------------------------------------
// 🔥 ROUTE GET
// -------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const [promotions] = await db.query(`
      SELECT 
        p.id AS promotionId,
        p.product_id,
        p.product_title,
        p.original_price,
        p.promo_price,
        p.description,
        p.duration_days,
        p.created_at,

        IFNULL(
          (SELECT JSON_ARRAYAGG(pi.image_path)
             FROM product_images pi
             WHERE pi.product_id = p.product_id),
          JSON_ARRAY()
        ) AS images

      FROM promotions p
      WHERE DATE_ADD(p.created_at, INTERVAL p.duration_days DAY) >= NOW()
      ORDER BY p.created_at DESC
      LIMIT 50;
    `);

    const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

    const formattedPromotions = promotions.map(promo => ({
      ...promo,
      images: promo.images.map(img =>
        img.startsWith("http")
          ? img
          : `${CLOUDINARY_BASE}${img}`
      )
    }));

    return res.status(200).json({
      success: true,
      promotions: formattedPromotions
    });

  } catch (err) {
    console.error("Erreur récupération promotions:", err.message);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
      details: err.message
    });
  }
});

module.exports = router;
