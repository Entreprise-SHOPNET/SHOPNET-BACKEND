


// routes/profile/statistiques.js

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');

// GET /api/profile/statistiques
router.get('/', authMiddleware, async (req, res) => {
  const vendeurId = req.userId;

  if (!vendeurId) {
    return res.status(401).json({ success: false, error: 'Utilisateur non authentifié' });
  }

  try {
    // 1. Total produits vendus + revenu total (toutes périodes)
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
      `
      SELECT COUNT(*) AS total_produits
      FROM products
      WHERE seller_id = ?
    `,
      [vendeurId]
    );

    // 4. Top 3 produits les plus vendus (avec une image minimale)
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

    // 5. Top 3 produits les plus vus (avec image)
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
      `
      SELECT IFNULL(SUM(views), 0) AS total_vues
      FROM products
      WHERE seller_id = ?
    `,
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

    // Construction réponse avec cast propre
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
                : `${req.protocol}://${req.get('host')}${p.image_path}`
              : null,
          })),
          top_vus: topVus.map((p) => ({
            id: p.id,
            title: p.title,
            vues: Number(p.views) || 0,
            image: p.image_path
              ? p.image_path.startsWith('http')
                ? p.image_path
                : `${req.protocol}://${req.get('host')}${p.image_path}`
              : null,
          })),
        },
        vues: {
          total: Number(vueStats.total_vues) || 0,
        },
        interactions: {
          likes: Number(likesStats.total_likes) || 0,
          partages: Number(sharesStats.total_shares) || 0,
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
