

// utils/cartAbandonedCron.js
const db = require("../db");
const { triggerCartAbandoned } = require("./notificationTriggers");

/**
 * 🛒 PANIER ABANDONNÉ AUTO
 */
async function cartAbandonedCron() {
  try {
    console.log("🛒 Scan paniers abandonnés...");

    const [rows] = await db.query(`
      SELECT 
        c.user_id,
        c.product_id,
        c.updated_at,
        f.fcm_token,
        p.title
      FROM carts c
      JOIN fcm_tokens f ON f.user_id = c.user_id
      JOIN products p ON p.id = c.product_id
      WHERE c.updated_at < NOW() - INTERVAL 2 HOUR
    `);

    const sent = new Set();

    for (const item of rows) {
      try {
        if (!item.fcm_token) continue;

        const key = `${item.user_id}-${item.product_id}`;
        if (sent.has(key)) continue;
        sent.add(key);

        // 🔥 AJOUT IMPORTANT : IMAGE PRODUIT
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

        await triggerCartAbandoned(
          {
            id: item.user_id,
            fcm_token: item.fcm_token,
          },
          {
            id: item.product_id,
            title: item.title,
            image: imageUrl   // 🔥 IMPORTANT
          }
        );

        console.log(`✅ Notif envoyée: ${item.title}`);

      } catch (err) {
        console.log("❌ erreur item:", err.message);
      }
    }

    console.log(`🛒 Scan terminé: ${rows.length} lignes`);

  } catch (error) {
    console.error("❌ CRON ERROR:", error.message);
  }
}

module.exports = cartAbandonedCron;
