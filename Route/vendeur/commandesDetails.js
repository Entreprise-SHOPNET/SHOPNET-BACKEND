

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authenticateToken = require('../../middlewares/authMiddleware');
const sendPushNotification = require('../../utils/sendPushNotification');

const EXPIRATION_DELAY = 30 * 24 * 60 * 60 * 1000;

// =====================================================
// 📦 GET DETAIL COMMANDE
// =====================================================
router.get('/:id', authenticateToken, async (req, res) => {
  const commandeId = req.params.id;

  try {
    const [rows] = await db.query(`
      SELECT 
        c.id AS commandeId,
        c.date_commande,
        c.status,
        c.total,
        c.mode_paiement,
        c.numero_commande,
        u.id AS clientId,
        u.fullName,
        u.phone,
        u.email,
        u.address
      FROM commandes c
      JOIN utilisateurs u ON c.acheteur_id = u.id
      WHERE c.id = ?
      LIMIT 1
    `, [commandeId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Commande non trouvée'
      });
    }

    const c = rows[0];

    const client = {
      nom: c.fullName,
      telephone: c.phone,
      email: c.email,
      adresse: c.address
    };

    const [produits] = await db.query(`
      SELECT 
        p.id,
        p.title AS nom,
        cp.quantite,
        cp.prix_unitaire,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS image
      FROM commande_produits cp
      JOIN products p ON cp.produit_id = p.id
      WHERE cp.commande_id = ?
    `, [commandeId]);

    return res.json({
      success: true,
      commande: {
        commandeId: c.commandeId,
        date_commande: c.date_commande,
        statut: c.status,
        total: c.total,
        mode_paiement: c.mode_paiement,
        client,
        produits
      }
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});


// =====================================================
// 🔥 UPDATE STATUS + PUSH SIMPLE CONTACT
// =====================================================
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const commandeId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['en_attente', 'confirmee', 'annulee', 'livree'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Statut invalide'
      });
    }

    // -------------------------------------------------
    // 1️⃣ UPDATE STATUS
    // -------------------------------------------------
    const [update] = await db.query(
      'UPDATE commandes SET status = ? WHERE id = ?',
      [status, commandeId]
    );

    if (update.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Commande introuvable'
      });
    }

    // -------------------------------------------------
    // 2️⃣ GET DATA CLIENT + VENDEUR
    // -------------------------------------------------
    const [rows] = await db.query(`
      SELECT 
        c.numero_commande,
        u.id AS clientId,
        u.fullName,
        u.phone
      FROM commandes c
      JOIN utilisateurs u ON c.acheteur_id = u.id
      WHERE c.id = ?
    `, [commandeId]);

    const data = rows[0];

    // -------------------------------------------------
    // 3️⃣ IMAGE PRODUIT
    // -------------------------------------------------
    const [img] = await db.query(`
      SELECT image_path
      FROM product_images
      WHERE product_id = (
        SELECT produit_id
        FROM commande_produits
        WHERE commande_id = ?
        LIMIT 1
      )
      LIMIT 1
    `, [commandeId]);

    let imageUrl = null;

    if (img.length > 0) {
      const CLOUD = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

      imageUrl = img[0].image_path.startsWith('http')
        ? img[0].image_path
        : CLOUD + img[0].image_path;
    }

    // -------------------------------------------------
    // 4️⃣ NOTIFICATION SIMPLE
    // -------------------------------------------------
    let title = '';
    let body = '';

    if (status === 'confirmee') {
      title = '✅ Commande acceptée';
      body = `Commande #${data.numero_commande} acceptée 🎉`;
    }

    if (status === 'annulee') {
      title = '❌ Commande refusée';
      body = `Commande #${data.numero_commande} refusée`;
    }

    if (status === 'livree') {
      title = '📦 Commande livrée';
      body = `Commande #${data.numero_commande} livrée`;
    }

    // -------------------------------------------------
    // 5️⃣ CONTACT VENDEUR (SIMPLE TEXT ACTION)
    // -------------------------------------------------
    const phone = '243' + data.phone.replace(/^0/, '');
    const whatsappLink = `https://wa.me/${phone}`;
    const callLink = `tel:${phone}`;

    // -------------------------------------------------
    // 6️⃣ PUSH NOTIFICATION (SIMPLE + CLEAN)
    // -------------------------------------------------
    const [tokens] = await db.query(
      'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
      [data.clientId]
    );

    if (tokens.length > 0 && tokens[0].fcm_token) {
      await sendPushNotification(
        tokens[0].fcm_token,
        title,
        body,
        {
          commandeId,
          status,

          // 🔥 UNE SEULE ACTION
          actionText: "Contacter le vendeur",
          whatsapp: whatsappLink,
          call: callLink,

          image: imageUrl
        },
        imageUrl
      );
    }

    return res.json({
      success: true,
      message: 'Statut mis à jour + notification envoyée',
      whatsappLink,
      callLink
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});

module.exports = router;
