const express = require("express");
const router = express.Router();

const db = require("../../db");
const authMiddleware = require("../../middlewares/authMiddleware");
const sendPushNotification = require("../../utils/sendPushNotification");

// ======================================================
// SUIVRE UN VENDEUR
// POST /api/followers/:sellerId
// ======================================================
router.post("/:sellerId", authMiddleware, async (req, res) => {
  try {
    const sellerId = req.params.sellerId;
    const followerId = req.userId;

    // Empêcher de se suivre soi-même
    if (sellerId == followerId) {
      return res.status(400).json({
        success: false,
        message: "Vous ne pouvez pas vous suivre vous-même",
      });
    }

    // Vérifier que le vendeur existe
    const [seller] = await db.query(
      `SELECT id FROM utilisateurs WHERE id = ?`,
      [sellerId]
    );
    if (seller.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur introuvable",
      });
    }

    // Insérer le follow
    await db.query(
      `INSERT INTO followers (user_id, follower_id) VALUES (?, ?)`,
      [sellerId, followerId]
    );

    // ======================================================
    // RÉCUPÉRER LES INFOS DU NOUVEL ABONNÉ
    // ======================================================
    const [followerRows] = await db.query(
      `
      SELECT 
        id,
        fullName,
        profile_photo,
        avatar
      FROM utilisateurs
      WHERE id = ?
      `,
      [followerId]
    );

    if (followerRows.length > 0) {
      const follower = followerRows[0];
      const followerImage = follower.profile_photo || follower.avatar || null;

      // ======================================================
      // 🆕 CRÉER LA NOTIFICATION POUR LE VENDEUR
      // ======================================================
      try {
        await db.query(
          `
          INSERT INTO notifications
          (
            utilisateur_id,
            actor_id,
            type,
            entity_type,
            entity_id,
            destinataire_type,
            cible,
            screen,
            action,
            image_url,
            titre,
            contenu,
            priorite,
            lu
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            sellerId,                     // utilisateur_id
            followerId,                   // actor_id
            "new_follower",               // type
            "user",                       // entity_type
            followerId,                   // entity_id
            "user",                       // destinataire_type
            sellerId,                     // cible
            "Notifications",              // screen
            "view_notification",          // action
            followerImage,                // image_url
            "⭐ Un nouvel abonné pour votre boutique", // titre
            `${follower.fullName} suit maintenant votre boutique.`, // contenu
            "normale",                    // priorite
            0                             // lu
          ]
        );
      } catch (notifError) {
        console.error("Erreur création notification:", notifError);
      }

      // ======================================================
      // 🔔 ENVOI PUSH FCM AU VENDEUR
      // ======================================================
      const [sellerTokenRows] = await db.query(
        `
        SELECT fcm_token 
        FROM fcm_tokens 
        WHERE user_id = ?
        `,
        [sellerId]
      );

      if (
        sellerTokenRows.length > 0 &&
        sellerTokenRows[0].fcm_token
      ) {
        await sendPushNotification(
          sellerTokenRows[0].fcm_token,
          "⭐ Un nouvel abonné pour votre boutique",
          `${follower.fullName} suit maintenant votre boutique. Consultez vos notifications pour en savoir plus.`,
          {
            type: "new_follower",
            entityType: "user",
            entityId: String(followerId),
            screen: "Notifications",
            action: "view_notification",
            followerId: String(followerId),
            image: followerImage || ""
          }
        );
      } else {
        console.log("⚠️ Aucun token FCM trouvé pour le vendeur:", sellerId);
      }
    }

    res.json({
      success: true,
      message: "Vous suivez maintenant ce vendeur",
    });
  } catch (error) {
    // doublon unique_follow
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Vous suivez déjà ce vendeur",
      });
    }

    console.error("FOLLOW ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ======================================================
// NE PLUS SUIVRE
// DELETE /api/followers/:sellerId
// ======================================================
router.delete("/:sellerId", authMiddleware, async (req, res) => {
  try {
    const sellerId = req.params.sellerId;
    const followerId = req.userId;

    await db.query(
      `DELETE FROM followers WHERE user_id = ? AND follower_id = ?`,
      [sellerId, followerId]
    );

    res.json({
      success: true,
      message: "Vous ne suivez plus ce vendeur",
    });
  } catch (error) {
    console.error("UNFOLLOW ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ======================================================
// VERIFIER SI L'UTILISATEUR SUIT LE VENDEUR
// GET /api/followers/check/:sellerId
// ======================================================
router.get("/check/:sellerId", authMiddleware, async (req, res) => {
  try {
    const sellerId = req.params.sellerId;
    const followerId = req.userId;

    const [rows] = await db.query(
      `
      SELECT id 
      FROM followers 
      WHERE user_id = ? 
      AND follower_id = ? 
      LIMIT 1
      `,
      [sellerId, followerId]
    );

    res.json({
      success: true,
      following: rows.length > 0,
    });
  } catch (error) {
    console.error("CHECK FOLLOW ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ======================================================
// NOMBRE DE FOLLOWERS D'UN VENDEUR
// ======================================================
router.get("/count/:sellerId", async (req, res) => {
  try {
    const sellerId = req.params.sellerId;

    const [rows] = await db.query(
      `SELECT COUNT(*) AS followersCount 
       FROM followers 
       WHERE user_id=?`,
      [sellerId]
    );

    res.json({
      success: true,
      followersCount: rows[0].followersCount,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ======================================================
// LISTE DES ABONNÉS DU VENDEUR CONNECTÉ
// ======================================================
router.get("/list", authMiddleware, async (req, res) => {
  try {
    const sellerId = req.userId;

    const [followers] = await db.query(
      `
      SELECT
        u.id,
        u.fullName,
        u.phone,
        u.profile_photo,
        u.avatar,
        u.role,
        f.created_at
      FROM followers f
      INNER JOIN utilisateurs u 
        ON f.follower_id = u.id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
      `,
      [sellerId]
    );

    const formattedFollowers = followers.map((follower) => ({
      id: follower.id,
      fullName: follower.fullName,
      phone: follower.phone,
      profilePhoto: follower.profile_photo || follower.avatar || null,
      role: follower.role,
      followedAt: follower.created_at,
    }));

    res.json({
      success: true,
      followersCount: followers.length,
      followers: formattedFollowers,
    });
  } catch (error) {
    console.error("FOLLOWERS LIST ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ======================================================
// NOUVELLES ROUTES : GESTION D'UNE NOTIFICATION PRÉCISE
// ======================================================

// GET /api/followers/notifications/:notificationId
router.get("/notifications/:notificationId", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    const [rows] = await db.query(
      `SELECT * FROM notifications WHERE id = ? AND utilisateur_id = ?`,
      [notificationId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification introuvable",
      });
    }

    res.json({
      success: true,
      notification: rows[0],
    });
  } catch (error) {
    console.error("GET NOTIFICATION ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// GET /api/followers/notifications/:notificationId/follower
router.get("/notifications/:notificationId/follower", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    // Vérifier que la notification existe et appartient à l'utilisateur
    const [notifRows] = await db.query(
      `SELECT * FROM notifications WHERE id = ? AND utilisateur_id = ?`,
      [notificationId, userId]
    );

    if (notifRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification introuvable",
      });
    }

    const notification = notifRows[0];

    // Seules les notifications de type "new_follower" sont supportées
    if (notification.type !== "new_follower") {
      return res.status(400).json({
        success: false,
        message: "Ce type de notification ne correspond pas à un nouvel abonné",
      });
    }

    // L'identifiant du follower est dans actor_id (ou entity_id)
    const followerId = notification.actor_id || notification.entity_id;

    const [userRows] = await db.query(
      `SELECT id, fullName, phone, profile_photo, avatar, role
       FROM utilisateurs WHERE id = ?`,
      [followerId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Abonné introuvable",
      });
    }

    const user = userRows[0];
    const follower = {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      profilePhoto: user.profile_photo || user.avatar || null,
      role: user.role,
    };

    res.json({
      success: true,
      follower,
    });
  } catch (error) {
    console.error("GET FOLLOWER FROM NOTIFICATION ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// PATCH /api/followers/notifications/:notificationId/read
router.patch("/notifications/:notificationId/read", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    // Vérifier appartenance
    const [notifRows] = await db.query(
      `SELECT id FROM notifications WHERE id = ? AND utilisateur_id = ?`,
      [notificationId, userId]
    );

    if (notifRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification introuvable",
      });
    }

    await db.query(
      `UPDATE notifications SET lu = 1 WHERE id = ? AND utilisateur_id = ?`,
      [notificationId, userId]
    );

    res.json({
      success: true,
      message: "Notification marquée comme lue",
    });
  } catch (error) {
    console.error("MARK READ ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// DELETE /api/followers/notifications/:notificationId
router.delete("/notifications/:notificationId", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { notificationId } = req.params;

    // Vérifier appartenance
    const [notifRows] = await db.query(
      `SELECT id FROM notifications WHERE id = ? AND utilisateur_id = ?`,
      [notificationId, userId]
    );

    if (notifRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification introuvable",
      });
    }

    await db.query(
      `DELETE FROM notifications WHERE id = ? AND utilisateur_id = ?`,
      [notificationId, userId]
    );

    res.json({
      success: true,
      message: "Notification supprimée",
    });
  } catch (error) {
    console.error("DELETE NOTIFICATION ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

module.exports = router;
