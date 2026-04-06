

const express = require('express');
const router = express.Router();

const pool = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const sendPushNotification = require('../../utils/sendPushNotification');

router.use(authMiddleware);


// ----------------- CRÉER UNE COMMANDE -----------------
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const acheteur_id = req.userId;
    const { produits, adresse_livraison, mode_paiement, commentaire } = req.body;

    if (!produits || !Array.isArray(produits) || produits.length === 0 || !adresse_livraison) {
      return res.status(400).json({
        success: false,
        error: 'Données manquantes ou invalides'
      });
    }

    await conn.beginTransaction();

    // -------------------------------------------------
    // 1️⃣ VENDEUR + PRODUIT PRINCIPAL
    // -------------------------------------------------
    const [prodRow] = await conn.query(
      'SELECT seller_id, title FROM products WHERE id = ?',
      [produits[0].produit_id]
    );

    if (prodRow.length === 0) {
      throw new Error('Produit non trouvé');
    }

    const vendeur_id = prodRow[0].seller_id;
    const produit_nom = prodRow[0].title;

    // -------------------------------------------------
    // 2️⃣ CALCUL TOTAL
    // -------------------------------------------------
    let totalCommande = 0;

    for (const p of produits) {
      const [pRow] = await conn.query(
        'SELECT price FROM products WHERE id = ?',
        [p.produit_id]
      );

      if (pRow.length === 0) {
        throw new Error(`Produit ${p.produit_id} introuvable`);
      }

      totalCommande += pRow[0].price * p.quantite;
    }

    // -------------------------------------------------
    // 3️⃣ NUMERO COMMANDE
    // -------------------------------------------------
    const [rows] = await conn.query(
      'SELECT MAX(numero_commande) AS dernier FROM commandes WHERE vendeur_id = ?',
      [vendeur_id]
    );

    const numero_commande = (rows[0].dernier || 0) + 1;

    // -------------------------------------------------
    // 4️⃣ INSERT COMMANDE
    // -------------------------------------------------
    const [result] = await conn.query(
      `INSERT INTO commandes 
        (acheteur_id, vendeur_id, numero_commande, status, total, mode_paiement, adresse_livraison, commentaire, date_commande)
       VALUES (?, ?, ?, 'en_attente', ?, ?, ?, ?, NOW())`,
      [
        acheteur_id,
        vendeur_id,
        numero_commande,
        totalCommande,
        mode_paiement || 'especes',
        adresse_livraison,
        commentaire || null
      ]
    );

    const commandeId = result.insertId;

    // -------------------------------------------------
    // 5️⃣ PRODUITS COMMANDE
    // -------------------------------------------------
    for (const p of produits) {
      const [pRow] = await conn.query(
        'SELECT price FROM products WHERE id = ?',
        [p.produit_id]
      );

      await conn.query(
        `INSERT INTO commande_produits (commande_id, produit_id, quantite, prix_unitaire)
         VALUES (?, ?, ?, ?)`,
        [commandeId, p.produit_id, p.quantite, pRow[0].price]
      );
    }

    // -------------------------------------------------
    // 🖼️ 6️⃣ IMAGE PRODUIT PRINCIPAL
    // -------------------------------------------------
    const [imgRows] = await conn.query(
      'SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1',
      [produits[0].produit_id]
    );

    let imageUrl = null;

    if (imgRows.length > 0) {
      const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

      imageUrl = imgRows[0].image_path.startsWith("http")
        ? imgRows[0].image_path
        : `${CLOUDINARY_BASE}${imgRows[0].image_path}`;
    }

    // -------------------------------------------------
    // 7️⃣ NOTIFICATION DB
    // -------------------------------------------------
    const notifContenu = `📦 Nouvelle commande pour "${produit_nom}" (#${numero_commande}).`;

    await conn.query(
      `INSERT INTO notifications (utilisateur_id, type, contenu, date_notification)
       VALUES (?, ?, ?, NOW())`,
      [vendeur_id, 'commande', notifContenu]
    );

    // -------------------------------------------------
    // 8️⃣ COMMIT
    // -------------------------------------------------
    await conn.commit();

    // -------------------------------------------------
    // 🔔 9️⃣ PUSH NOTIFICATION FCM
    // -------------------------------------------------
    const [tokenRows] = await pool.query(
      'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
      [vendeur_id]
    );

    const token = tokenRows[0]?.fcm_token;

    if (token) {
      try {
        await sendPushNotification(
          token,
          '🛒 Nouvelle commande SHOPNET',
          notifContenu,
          {
            commandeId,
            produit_nom,
            numero_commande,
            type: 'commande',
            image: imageUrl
          }
        );

        console.log('🔔 Notification commande envoyée');
      } catch (err) {
        console.error('❌ FCM ERROR:', err.message);
      }
    } else {
      console.warn('⚠️ Aucun token FCM vendeur');
    }

    return res.json({
      success: true,
      commandeId,
      numero_commande
    });

  } catch (err) {
    await conn.rollback();
    console.error('❌ Erreur /commandes:', err.message);

    return res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      details: err.message
    });

  } finally {
    conn.release();
  }
});


// ----------------- GET COMMANDES -----------------
router.get('/', async (req, res) => {
  try {
    const utilisateur_id = req.userId;
    const { role } = req.query;

    let query = `
      SELECT c.*, u1.fullName AS acheteur_nom, u2.fullName AS vendeur_nom
      FROM commandes c
      JOIN utilisateurs u1 ON c.acheteur_id = u1.id
      JOIN utilisateurs u2 ON c.vendeur_id = u2.id
    `;

    const params = [];

    if (role === 'vendeur') {
      query += ' WHERE c.vendeur_id = ? ORDER BY c.date_commande DESC';
      params.push(utilisateur_id);
    } else {
      query += ' WHERE c.acheteur_id = ? ORDER BY c.date_commande DESC';
      params.push(utilisateur_id);
    }

    const [rows] = await pool.query(query, params);

    return res.json({
      success: true,
      commandes: rows
    });

  } catch (err) {
    console.error('❌ GET /commandes:', err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});


// ----------------- UPDATE STATUS -----------------
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['en_attente', 'confirmee', 'en_cours', 'livree', 'annulee'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Statut invalide'
      });
    }

    const [result] = await pool.query(
      'UPDATE commandes SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Commande non trouvée'
      });
    }

    return res.json({
      success: true,
      message: 'Statut mis à jour'
    });

  } catch (err) {
    console.error('❌ PATCH /commandes:', err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});

module.exports = router;
