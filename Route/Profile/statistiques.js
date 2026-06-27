
// routes/profile/statistiques.js
// routes/profile/statistiques.js

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// Remplace <cloud_name> par ton nom Cloudinary
const CLOUDINARY_URL_PREFIX = 'https://res.cloudinary.com/dddr7gb6w/image/upload/';



// ==============================
// 🚨 CREATE REPORT
// ==============================

router.post('/report', authMiddleware, async (req, res) => {
  const reporter_id = req.userId;

  try {
    const {
      type,
      title,
      description,
      reported_user_id,
      product_id
    } = req.body;

    if (!type || !title || !description) {
      return res.status(400).json({
        success: false,
        error: 'type, title et description sont obligatoires'
      });
    }

    // ==============================
    // TYPES DE SIGNALEMENT SHOPNET
    // ==============================
    const allowedTypes = [
      // Produits
      'fake_product',          // Produit contrefait
      'wrong_product',         // Mauvais produit
      'damaged_product',       // Produit endommagé
      'prohibited_product',    // Produit interdit
      'misleading_description',// Description trompeuse
      'counterfeit',           // Contrefaçon
      'expired_product',       // Produit expiré

      // Livraison
      'delivery_delay',        // Retard de livraison
      'product_not_received',  // Produit non reçu
      'delivery_problem',      // Problème de livraison

      // Paiement
      'payment_issue',         // Problème de paiement
      'refund_issue',          // Problème de remboursement

      // Utilisateur
      'scam',                  // Arnaque
      'abuse',                 // Comportement abusif
      'harassment',            // Harcèlement
      'spam',                  // Spam
      'fake_account',          // Faux compte
      'impersonation',         // Usurpation d'identité

      // Technique
      'bug',                   // Bug
      'security_issue',        // Problème de sécurité
      'app_problem',           // Dysfonctionnement application

      // Général
      'other'                  // Autre
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Type de signalement invalide'
      });
    }

    if (!reported_user_id && !product_id) {
      return res.status(400).json({
        success: false,
        error: 'Vous devez signaler un utilisateur ou un produit'
      });
    }

    if (reported_user_id && product_id) {
      return res.status(400).json({
        success: false,
        error: 'Vous ne pouvez pas signaler un utilisateur et un produit en même temps'
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO reports (
        reporter_id,
        reported_user_id,
        product_id,
        type,
        title,
        description,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        reporter_id,
        reported_user_id || null,
        product_id || null,
        type,
        title,
        description
      ]
    );

    return res.json({
      success: true,
      message: 'Signalement envoyé avec succès',
      report_id: result.insertId
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});






///----------------------------------------------------
///----------------------------------------------------
// ==============================
// 📄 GET MY REPORTS
// ==============================
router.get('/reports/my', authMiddleware, async (req, res) => {
  const reporter_id = req.userId;

  try {

    const [reports] = await db.query(
      `
      SELECT
        id,
        type,
        title,
        description,
        status,
        created_at
      FROM reports
      WHERE reporter_id = ?
      ORDER BY created_at DESC
      `,
      [reporter_id]
    );

    const data = reports.map(report => {

      let status_message = '';

      if (report.status === 'pending') {
        status_message = "Votre signalement est en cours de traitement par l'équipe SHOPNET.";
      }

      if (report.status === 'resolved') {
        status_message = "Votre signalement a été traité avec succès.";
      }

      if (report.status === 'rejected') {
        status_message = "Votre signalement a été rejeté après vérification.";
      }

      return {
        ...report,
        status_message
      };

    });

    return res.json({
      success: true,
      reports: data
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });

  }

});



///----------------------------------------------------
///----------------------------------------------------
// ==============================
// 📄 ARPUVER OU REJETED
// ==============================
// ==============================
// 🛠 UPDATE REPORT STATUS
// ==============================

router.put('/admin/report/:id', async (req, res) => {

  const reportId = req.params.id;
  const { status } = req.body;

  try {

    const allowedStatus = [
      'pending',
      'resolved',
      'rejected'
    ];

    if (!allowedStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Statut invalide'
      });
    }

    const [result] = await db.query(
      `
      UPDATE reports
      SET status = ?
      WHERE id = ?
      `,
      [
        status,
        reportId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Signalement introuvable'
      });
    }

    return res.json({
      success: true,
      message: 'Statut mis à jour avec succès',
      report_id: Number(reportId),
      status
    });

  } catch (error) {

    console.error('UPDATE REPORT ERROR:', error);

    return res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });

  }

});



// GET /api/profile/statistiques
router.get('/', authMiddleware, async (req, res) => {
  const vendeurId = req.userId;

  if (!vendeurId) {
    return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
  }

  try {
    // 1. Total produits vendus + revenu total
    const [[ventesStats]] = await db.query(
      `
      SELECT 
        IFNULL(SUM(cp.quantite), 0) AS total_ventes,
        IFNULL(SUM(cp.quantite * cp.prix_unitaire), 0) AS revenu_total
      FROM commande_produits cp
      INNER JOIN products p ON cp.produit_id = p.id
      WHERE p.seller_id = ?
    `,
      [vendeurId]
    );

    // 2. Revenu mensuel (mois en cours)
    const [[revenuMois]] = await db.query(
      `
      SELECT 
        IFNULL(SUM(cp.quantite * cp.prix_unitaire), 0) AS revenu_mensuel
      FROM commande_produits cp
      INNER JOIN products p ON cp.produit_id = p.id
      WHERE p.seller_id = ?
        AND MONTH(cp.created_at) = MONTH(NOW())
        AND YEAR(cp.created_at) = YEAR(NOW())
    `,
      [vendeurId]
    );

    // 3. Nombre total de produits en vente
    const [[produitsStats]] = await db.query(
      `SELECT COUNT(*) AS total_produits FROM products WHERE seller_id = ?`,
      [vendeurId]
    );

    // 4. Top 3 produits vendus
    const [topVendus] = await db.query(
      `
      SELECT 
        p.id, 
        p.title, 
        SUM(cp.quantite) AS total_ventes,
        MIN(pi.image_path) AS image_path
      FROM commande_produits cp
      INNER JOIN products p ON cp.produit_id = p.id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      WHERE p.seller_id = ?
      GROUP BY p.id, p.title
      ORDER BY total_ventes DESC
      LIMIT 3
    `,
      [vendeurId]
    );

    // 5. Top 3 produits vus
    const [topVus] = await db.query(
      `
      SELECT 
        p.id, 
        p.title, 
        p.views,
        MIN(pi.image_path) AS image_path
      FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id
      WHERE p.seller_id = ?
      GROUP BY p.id, p.title, p.views
      ORDER BY p.views DESC
      LIMIT 3
    `,
      [vendeurId]
    );

    // 6. Total des vues
    const [[vueStats]] = await db.query(
      `SELECT IFNULL(SUM(views), 0) AS total_vues FROM products WHERE seller_id = ?`,
      [vendeurId]
    );

    // 7. Total de likes
    const [[likesStats]] = await db.query(
      `
      SELECT COUNT(*) AS total_likes
      FROM product_likes pl
      INNER JOIN products p ON pl.product_id = p.id
      WHERE p.seller_id = ?
    `,
      [vendeurId]
    );

    // 8. Total de partages
    const [[sharesStats]] = await db.query(
      `
      SELECT COUNT(*) AS total_shares
      FROM product_shares ps
      INNER JOIN products p ON ps.product_id = p.id
      WHERE p.seller_id = ?
    `,
      [vendeurId]
    );

    // 9. Total commentaires
    const [[commentsStats]] = await db.query(
      `
      SELECT COUNT(*) AS total_comments
      FROM product_comments pc
      INNER JOIN products p ON pc.product_id = p.id
      WHERE p.seller_id = ?
    `,
      [vendeurId]
    );

    // Construction réponse
    const responsePayload = {
      success: true,
      statistiques: {
        ventes: {
          total_produits_vendus: Number(ventesStats.total_ventes) || 0,
          revenu_total: parseFloat(ventesStats.revenu_total) || 0,
          revenu_mensuel: parseFloat(revenuMois.revenu_mensuel) || 0,
        },
        produits: {
          total_produits_en_vente: Number(produitsStats.total_produits) || 0,
          top_vendus: topVendus.map((p) => ({
            id: p.id,
            title: p.title,
            ventes: Number(p.total_ventes) || 0,
            image: p.image_path
              ? p.image_path.startsWith('http')
                ? p.image_path
                : `${CLOUDINARY_URL_PREFIX}${p.image_path}`
              : null,
          })),
          top_vus: topVus.map((p) => ({
            id: p.id,
            title: p.title,
            vues: Number(p.views) || 0,
            image: p.image_path
              ? p.image_path.startsWith('http')
                ? p.image_path
                : `${CLOUDINARY_URL_PREFIX}${p.image_path}`
              : null,
          })),
        },
        vues: {
          total: Number(vueStats.total_vues) || 0,
        },
        interactions: {
          likes: Number(likesStats.total_likes) || 0,
          partages: Number(sharesStats.total_shares) || 0,
          commentaires: Number(commentsStats.total_comments) || 0,
        },
      },
    };

    return res.json(responsePayload);
  } catch (error) {
    console.error('Erreur /api/profile/statistiques', error);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
