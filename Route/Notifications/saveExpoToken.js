

/// Route/Notifications/saveExpoToken.js
// Route/Notifications/saveExpoToken.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken"); // npm i jsonwebtoken

// POST /api/save-expo-token
router.post("/save-expo-token", async (req, res) => {
  try {
    console.log("🔹 Requête reçue pour enregistrer un Expo Push Token");
    console.log("🔹 Body reçu:", req.body);

    const db = req.db; // déjà attaché dans server.js
    let { userId, expoPushToken } = req.body;

    // Vérification des données reçues
    if (!userId || !expoPushToken) {
      console.warn("⚠️ userId ou expoPushToken manquant");
      return res.status(400).json({
        message: "userId et expoPushToken sont requis.",
        receivedBody: req.body,
      });
    }

    // 🔹 Décodage JWT si nécessaire
    if (typeof userId === "string" && userId.includes(".")) {
      try {
        const decoded = jwt.verify(userId, process.env.JWT_SECRET);
        userId = decoded.id;
        console.log("🔹 userId décodé depuis JWT:", userId);
      } catch (err) {
        console.error("❌ JWT invalide:", err);
        return res.status(400).json({ message: "JWT invalide." });
      }
    }

    // Vérifier que userId est maintenant bien un nombre
    userId = Number(userId);
    if (isNaN(userId)) {
      console.error("❌ userId invalide après décodage:", userId);
      return res.status(400).json({ message: "userId invalide." });
    }

    console.log(`🔹 Tentative d'enregistrement du token pour userId: ${userId}`);
    console.log(`🔹 Token reçu: ${expoPushToken}`);

    // Mettre à jour l'utilisateur avec son token Expo
    const [result] = await db.query(
      "UPDATE utilisateurs SET expoPushToken = ? WHERE id = ?",
      [expoPushToken, userId]
    );

    console.log("🔹 Résultat de la requête UPDATE:", result);

    if (result.affectedRows === 0) {
      console.warn(`⚠️ Aucun utilisateur trouvé avec l'id: ${userId}`);
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    console.log(`✅ Expo Push Token enregistré pour l’utilisateur ${userId}`);
    return res.status(200).json({
      message: "Token Expo enregistré avec succès.",
      token: expoPushToken,
      userId,
    });
  } catch (error) {
    console.error("❌ Erreur serveur lors de la sauvegarde du token Expo:", error);
    return res.status(500).json({
      message: "Erreur serveur.",
      error: error.message,
    });
  }
});




// POST /api/save-fcm-token
router.post("/save-fcm-token", async (req, res) => {
  try {
    console.log("🔹 Requête reçue pour enregistrer un FCM Token");
    console.log("🔹 Body reçu:", req.body);

    const db = req.db;
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        message: "fcmToken est requis.",
      });
    }

    // Insérer le token si il n'existe pas déjà
    await db.query(
      "INSERT IGNORE INTO deals_devices (fcmToken) VALUES (?)",
      [fcmToken]
    );

    console.log("✅ FCM Token enregistré dans deals_devices");

    return res.status(200).json({
      message: "FCM token enregistré avec succès.",
    });

  } catch (error) {
    console.error("❌ Erreur serveur save-fcm-token:", error);
    return res.status(500).json({
      message: "Erreur serveur.",
      error: error.message,
    });
  }
});




module.exports = router;
