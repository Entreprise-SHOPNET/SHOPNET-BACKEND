

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authenticateToken = require('../../middlewares/authMiddleware');
const sendPushNotification = require('../../utils/sendPushNotification');

const EXPIRATION_DELAY = 30 * 24 * 60 * 60 * 1000;

// -----------------------------------------------------
// GET /api/commandes/:id
// -----------------------------------------------------
router.get('/:id', authenticateToken, async (req, res) => {
  const commandeId = req.params.id;

  try {
    const [commandeRows] = await db.query(`
      SELECT 
        c.id AS commandeId,
        c.date_commande,
        c.status,
        c.total,
        c.mode_paiement,
        c.numero_commande,
        u.id AS clientId,
        u.fullName AS clientNom,
        u.phone AS clientTel,
        u.email AS clientEmail,
        u.address AS clientAdresse
      FROM commandes c
      JOIN utilisateurs u ON c.acheteur_id = u.id
      WHERE c.id = ?
      LIMIT 1
    `, [commandeId]);

    if (commandeRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Commande non trouvée' });
    }

    const commande = commandeRows[0];

    const dateCommande = new Date(commande.date_commande);
    const now = new Date();

    if (commande.status !== 'expirée' && now - dateCommande > EXPIRATION_DELAY) {
      await db.query(`UPDATE commandes SET status = 'expirée' WHERE id = ?`, [commandeId]);
      commande.status = 'expirée';
    }

    const [produits] = await db.query(`
      SELECT 
        p.id,
        p.title,
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

    res.json({
      success: true,
      commande: {
        ...commande,
        produits
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});


// -----------------------------------------------------
// PUT /api/commandes/:id/status
// -----------------------------------------------------
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const commandeId = req.params.id;
    const { status } = req.body;

    const validStatuses = ['en_attente', 'confirmee', 'annulee', 'livree'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Statut invalide' });
    }

    // -------------------------------------------------
    // 1️⃣ UPDATE STATUS
    // -------------------------------------------------
    const [updateResult] = await db.query(
      'UPDATE commandes SET status = ? WHERE id = ?',
      [status, commandeId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Commande non trouvée' });
    }

    // -------------------------------------------------
    // 2️⃣ INFOS CLIENT + VENDEUR
    // -------------------------------------------------
    const [rows] = await db.query(`
      SELECT 
        c.numero_commande,
        c.id,
        u.id AS clientId,
        u.fullName,
        u.phone,
        (
          SELECT p.id
          FROM commande_produits cp
          JOIN products p ON cp.produit_id = p.id
          WHERE cp.commande_id = c.id
          LIMIT 1
        ) AS productId
      FROM commandes c
      JOIN utilisateurs u ON c.acheteur_id = u.id
      WHERE c.id = ?
    `, [commandeId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false });
    }

    const data = rows[0];

    // -------------------------------------------------
    // 3️⃣ IMAGE PRODUIT
    // -------------------------------------------------
    const [imageRows] = await db.query(`
      SELECT image_path
      FROM product_images
      WHERE product_id = ?
      LIMIT 1
    `, [data.productId]);

    let imageUrl = null;

    if (imageRows.length > 0) {
      const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

      imageUrl = imageRows[0].image_path.startsWith('http')
        ? imageRows[0].image_path
        : CLOUDINARY_BASE + imageRows[0].image_path;
    }

    // -------------------------------------------------
    // 4️⃣ MESSAGE NOTIFICATION
    // -------------------------------------------------
    let title = '';
    let body = '';

    if (status === 'confirmee') {
      title = '✅ Commande acceptée';
      body = `Votre commande #${data.numero_commande} a été acceptée 🎉`;
    }

    if (status === 'annulee') {
      title = '❌ Commande refusée';
      body = `Votre commande #${data.numero_commande} a été refusée.`;
    }

    if (status === 'livree') {
      title = '📦 Commande livrée';
      body = `Votre commande #${data.numero_commande} a été livrée.`;
    }

    // -------------------------------------------------
    // 5️⃣ WHATSAPP + CALL LINK VENDEUR
    // -------------------------------------------------
    const phone = '243' + data.phone.replace(/^0/, '');
    const whatsappLink = `https://wa.me/${phone}`;

    const callLink = `tel:${phone}`;

    // -------------------------------------------------
    // 6️⃣ PUSH NOTIFICATION ACHETEUR
    // -------------------------------------------------
    const [tokenRows] = await db.query(
      'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
      [data.clientId]
    );

    if (tokenRows.length > 0 && tokenRows[0].fcm_token) {
      await sendPushNotification(
        tokenRows[0].fcm_token,
        title,
        body,
        {
          commandeId,
          status,
          image: imageUrl,
          whatsapp: whatsappLink,
          call: callLink
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
    console.error('Erreur status commande:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
