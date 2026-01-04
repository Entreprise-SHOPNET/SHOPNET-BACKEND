

// C:\Users\ENTREPRISES TRM\Desktop\APK\SHOPNET-BACKEND\Route\admin\CommandesPayeAdmin.js
const express = require('express');
const router = express.Router();
const db = require('../../db'); // mysql2/promise

// =====================
// Dashboard Commandes (toutes commandes = paiement)
// =====================
router.get('/dashboard/commandes', async (req, res) => {
  try {
    // Nombre total de commandes
    const [[{ totalOrders }]] = await db.query(
      `SELECT COUNT(*) AS totalOrders FROM commandes`
    );

    // Total payé = toutes les commandes
    const [[{ totalPaidOrders }]] = await db.query(
      `SELECT COUNT(*) AS totalPaidOrders FROM commandes`
    );

    const [[{ totalAmount }]] = await db.query(
      `SELECT COALESCE(SUM(total), 0) AS totalAmount FROM commandes`
    );

    const [[{ totalPaidAmount }]] = await db.query(
      `SELECT COALESCE(SUM(total), 0) AS totalPaidAmount FROM commandes`
    );

    return res.json({
      success: true,
      stats: {
        totalOrders,
        totalPaidOrders,
        totalAmount,
        totalPaidAmount
      }
    });

  } catch (err) {
    console.error('❌ Erreur GET /dashboard/commandes:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
