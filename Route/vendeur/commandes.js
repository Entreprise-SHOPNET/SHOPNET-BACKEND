

// backend/routes/commandes.js
const express = require('express');
const router = express.Router();
const pool = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const sendPushNotification = require('../../utils/sendPushNotification'); // ✅ Import centralisé

// Middleware d’authentification
router.use(authMiddleware);

// ----------------- CRÉER UNE COMMANDE -----------------
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const acheteur_id = req.userId;
    const { produits, adresse_livraison, mode_paiement, commentaire } = req.body;

    if (!produits || !Array.isArray(produits) || produits.length === 0 || !adresse_livraison) {
      return res.status(400).json({ success: false, error: 'Données manquantes ou invalides' });
    }

    // ✅ Récupérer le vendeur du premier produit
    const [prodRow] = await pool.query(
      'SELECT seller_id, title FROM products WHERE id = ?',
      [produits[0].produit_id]
    );

    if (prodRow.length === 0) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }

    const vendeur_id = prodRow[0].seller_id;
    const produit_nom = prodRow[0].title;

    await conn.beginTransaction();

    // ✅ Calculer le total de la commande
    let totalCommande = 0;
    for (const p of produits) {
      const [pRow] = await conn.query('SELECT price FROM products WHERE id = ?', [p.produit_id]);
      if (pRow.length === 0) {
        await conn.rollback();
        return res.status(404).json({ success: false, error: `Produit ${p.produit_id} introuvable` });
      }
      totalCommande += pRow[0].price * p.quantite;
    }

    // ✅ Numéro de commande séquentiel par vendeur
    const [rows] = await conn.query(
      'SELECT MAX(numero_commande) AS dernier FROM commandes WHERE vendeur_id = ?',
      [vendeur_id]
    );
    const numero_commande = (rows[0].dernier || 0) + 1;

    // ✅ Insertion dans `commandes`
    const [result] = await conn.query(
      `INSERT INTO commandes 
        (acheteur_id, vendeur_id, numero_commande, status, total, mode_paiement, adresse_livraison, commentaire, date_commande)
       VALUES (?, ?, ?, 'en_attente', ?, ?, ?, ?, NOW())`,
      [acheteur_id, vendeur_id, numero_commande, totalCommande, mode_paiement || 'especes', adresse_livraison, commentaire || null]
    );

    const commandeId = result.insertId;

    // ✅ Lier les produits à la commande
    for (const p of produits) {
      const [pRow] = await conn.query('SELECT price FROM products WHERE id = ?', [p.produit_id]);
      await conn.query(
        `INSERT INTO commande_produits (commande_id, produit_id, quantite, prix_unitaire)
         VALUES (?, ?, ?, ?)`,
        [commandeId, p.produit_id, p.quantite, pRow[0].price]
      );
    }

    // ✅ Notification BDD
    const notifContenu = `📦 Nouvelle commande pour "${produit_nom}" (#${numero_commande}).`;
    await conn.query(
      `INSERT INTO notifications (utilisateur_id, type, contenu, date_notification)
       VALUES (?, ?, ?, NOW())`,
      [vendeur_id, 'commande', notifContenu]
    );

    await conn.commit();

    // ✅ Envoi de la notification push via Expo
    const [vendeurRow] = await pool.query(
      'SELECT expoPushToken FROM utilisateurs WHERE id = ?',
      [vendeur_id]
    );

    const vendeurToken = vendeurRow[0]?.expoPushToken;
    await sendPushNotification(
      vendeurToken,
      'Nouvelle commande SHOPNET',
      notifContenu,
      { commandeId, produit_nom, numero_commande, type: 'commande' }
    );

    // ✅ (Optionnel) Socket.io temps réel
    if (req.notifyVendor) {
      req.notifyVendor(vendeur_id, {
        commandeId,
        numero_commande,
        produit_nom,
        message: notifContenu,
        date: new Date(),
      });
    }

    return res.json({ success: true, commandeId, numero_commande });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('❌ Erreur /commandes:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  } finally {
    conn.release();
  }
});

// ----------------- LISTER LES COMMANDES -----------------
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
    return res.json({ success: true, commandes: rows });
  } catch (err) {
    console.error('❌ Erreur GET /commandes:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

// ----------------- CHANGER LE STATUT D’UNE COMMANDE -----------------
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['en_attente', 'confirmee', 'en_cours', 'livree', 'annulee'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Statut invalide' });
    }

    const [result] = await pool.query(
      'UPDATE commandes SET status = ? WHERE id = ?',
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Commande non trouvée' });
    }

    return res.json({ success: true, message: 'Statut mis à jour' });
  } catch (err) {
    console.error('❌ Erreur PATCH /commandes/:id:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
