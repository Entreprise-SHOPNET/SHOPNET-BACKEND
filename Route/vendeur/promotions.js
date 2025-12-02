


// Route/vendeur/promotions.js
const express = require('express');
const router = express.Router();
const db = require('../../db'); 
const authMiddleware = require('../../middlewares/authMiddleware');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// Sécurisation
router.use(authMiddleware);

// -------------------------------------------------------------
// 🔥 Fonction d’envoi de notification Expo via Axios
// -------------------------------------------------------------
const sendExpoNotification = async (expoPushToken, title, body, data = {}) => {
  if (!expoPushToken) return;

  try {
    await axios.post('https://exp.host/--/api/v2/push/send', {
      to: expoPushToken,
      title,
      body,
      data,
      sound: 'default',
    });
  } catch (err) {
    console.error('Erreur envoi notification Expo:', err.message);
  }
};

// -------------------------------------------------------------
// 🔥 ROUTE POST : Créer une promotion + Notifications Expo
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
    // 1️⃣ Enregistrer la promotion
    const [result] = await db.query(
      `INSERT INTO promotions 
        (product_id, creator_id, product_title, original_price, promo_price, description, duration_days, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [productId, userId, productTitle, price, promoPrice, description, duration]
    );

    const promotionId = result.insertId;

    const message = `${productTitle} est maintenant à ${promoPrice}$ pendant ${duration} jours !`;

    // 2️⃣ Notifier uniquement les followers (option)
    if (notify_followers) {
      const [followers] = await db.query(
        `SELECT u.expoPushToken 
         FROM followers f 
         JOIN utilisateurs u ON f.follower_id = u.id
         WHERE f.user_id = ? AND u.expoPushToken IS NOT NULL`,
        [userId]
      );

      for (const follower of followers) {
        await sendExpoNotification(
          follower.expoPushToken,
          "Nouvelle Promotion!",
          message,
          { promotionId }
        );
      }
    }

    // 3️⃣ Notifier tous les utilisateurs (option)
    if (notify_all_users) {
      const [allUsers] = await db.query(
        `SELECT expoPushToken FROM utilisateurs 
         WHERE expoPushToken IS NOT NULL AND id != ?`,
        [userId]
      );

      for (const u of allUsers) {
        await sendExpoNotification(
          u.expoPushToken,
          "Promotion disponible !",
          message,
          { promotionId }
        );
      }
    }

    return res.json({
      success: true,
      message: "Promotion créée avec succès",
      promotionId
    });

  } catch (error) {
    console.error("Erreur création promotion:", error.message);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      details: error.message
    });
  }
});

// -------------------------------------------------------------
// 🔥 ROUTE GET : récupérer les promotions + images Cloudinary
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

    // 🔥 Générer les URLs Cloudinary complètes
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
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      details: err.message
    });
  }
});

module.exports = router;
