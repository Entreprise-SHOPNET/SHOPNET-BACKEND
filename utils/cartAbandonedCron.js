

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

        await triggerCartAbandoned(
          {
            id: item.user_id,
            fcm_token: item.fcm_token,
          },
          {
            id: item.product_id,
            title: item.title,
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
