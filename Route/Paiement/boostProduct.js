
// routes/boosts.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../../db');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

// Configuration Lygos
const LYGOS_API_URL = 'https://api.lygosapp.com/v1/gateway';
const LYGOS_API_KEY = process.env.LYGOS_API_KEY || 'lygosapp-829a5d0c-6e46-4a01-9535-fc19980c1c63';
const SUCCESS_URL = process.env.LYGOS_SUCCESS_URL || 'https://shopnet.app/payment/success';
const FAILURE_URL = process.env.LYGOS_FAILURE_URL || 'https://shopnet.app/payment/failure';

// Rate limiter
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Trop de requêtes, réessaie plus tard' }
});

// Joi schema
const createSchema = Joi.object({
  productId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  userId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  budget: Joi.number().positive().required(),
  currency: Joi.string().valid('CDF', 'USD').required(),
  views: Joi.number().integer().min(0).default(1000),
  days: Joi.number().integer().min(1).default(1),
  country: Joi.string().allow('', null).default('RDC'),
  city: Joi.string().allow('', null).default('Kinshasa'),
  address: Joi.string().allow('', null).default('')
});

// Migration automatique
async function ensureColumns() {
  try {
    const dbNameRes = await db.query('SELECT DATABASE() as dbName');
    const dbName = dbNameRes[0]?.dbName || process.env.DB_NAME || process.env.DB_DATABASE;
    if (!dbName) return;

    const expectedCols = {
      original_amount: "DECIMAL(10,2) NOT NULL DEFAULT 0",
      currency: "VARCHAR(10) NOT NULL DEFAULT 'USD'",
      country: "VARCHAR(100) DEFAULT NULL",
      city: "VARCHAR(100) DEFAULT NULL",
      address: "VARCHAR(255) DEFAULT NULL",
      transaction_id: "VARCHAR(150) DEFAULT NULL",
      payment_url: "VARCHAR(512) DEFAULT NULL",
      views: "INT DEFAULT 0"
    };

    for (const [col, def] of Object.entries(expectedCols)) {
      const [rows] = await db.query(`
        SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_boosts' AND COLUMN_NAME = ?
      `, [dbName, col]);
      if (!rows[0].cnt) {
        await db.query(`ALTER TABLE product_boosts ADD COLUMN ${col} ${def}`);
      }
    }

    const [urows] = await db.query(`
      SELECT EXTRA FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_boosts' AND COLUMN_NAME = 'updated_at'
    `, [dbName]);

    if (!urows.length) {
      await db.query(`ALTER TABLE product_boosts ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    } else if (!urows[0].EXTRA.includes('on update CURRENT_TIMESTAMP')) {
      await db.query(`ALTER TABLE product_boosts MODIFY COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    }

    console.log('✅ Migration product_boosts : OK');
  } catch (err) {
    console.warn('⚠️ Migration automatique non terminée:', err.message);
  }
}

ensureColumns().catch(console.warn);

// CREATE PAYMENT avec Lygos
router.post('/create', createLimiter, async (req, res) => {
  try {
    console.log('📥 Requête reçue:', req.body);

    const { error, value } = createSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      console.log('❌ Erreur validation:', error.message);
      return res.status(400).json({ success: false, message: error.message });
    }

    const { productId, userId, budget, currency, views, days, country, city, address } = value;
    
    const minBudget = currency === 'CDF' ? 1000 : 1;
    if (budget < minBudget) {
      return res.status(400).json({
        success: false,
        message: currency === 'CDF' ? `Montant minimum: ${minBudget} CDF` : `Montant minimum: ${minBudget} USD`
      });
    }

    const boostId = `boost_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

    // Payload Lygos
    const paymentPayload = {
      amount: budget,
      currency,
      shop_name: "ShopNet",
      message: `Boost produit - ${views.toLocaleString()} vues - ${days} jour(s)`,
      success_url: SUCCESS_URL,
      failure_url: FAILURE_URL,
      order_id: boostId
    };

    console.log('🔄 Appel API Lygos:', JSON.stringify(paymentPayload, null, 2));

    const headers = {
      'Content-Type': 'application/json',
      'api-key': LYGOS_API_KEY
    };

    const lygosResp = await axios.post(LYGOS_API_URL, paymentPayload, { headers, timeout: 30000 });
    const data = lygosResp.data;

    if (!data.link) {
      console.log('❌ Pas de lien de paiement dans la réponse');
      return res.status(502).json({ success: false, message: 'Erreur: pas de lien de paiement généré', response: data });
    }

    const durationHours = Number(days) * 24;

    await db.query(`
      INSERT INTO product_boosts 
      (product_id, user_id, amount, original_amount, currency, duration_hours, views, country, city, address, status, boost_id, payment_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [productId, userId, budget, budget, currency, durationHours, views, country, city, address, 'pending', boostId, data.link]);

    console.log('✅ Boost enregistré en base avec ID:', boostId);

    return res.json({
      success: true,
      link: data.link,
      boostId,
      amount: budget,
      currency: currency,
      originalAmount: budget,
      originalCurrency: currency
    });

  } catch (err) {
    console.error('❌ Erreur création boost:', err.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur interne', error: err.message });
  }
});

// STATUS
router.get('/status/:boostId', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM product_boosts WHERE boost_id = ?', [req.params.boostId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Boost non trouvé' });
    return res.json({ success: true, boost: rows[0] });
  } catch (err) {
    console.error('Erreur status:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// HISTORY
router.get('/history/:userId', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT pb.*, p.title as product_title, p.image as product_image
      FROM product_boosts pb
      LEFT JOIN products p ON pb.product_id = p.id
      WHERE pb.user_id = ?
      ORDER BY pb.created_at DESC
      LIMIT 100
    `, [req.params.userId]);
    return res.json({ success: true, boosts: rows || [] });
  } catch (err) {
    console.error('Erreur history:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// WEBHOOK Lygos
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('🔄 Webhook Lygos reçu:', JSON.stringify(payload, null, 2));

    res.json({ success: true, received: true });

    setTimeout(async () => {
      try {
        const boostId = payload?.order_id;
        let status = 'pending';
        const transactionId = payload?.id || null;

        if (payload.status === 'SUCCESS' || payload.status === 'COMPLETED') status = 'active';
        else if (payload.status === 'FAILED' || payload.status === 'CANCELLED') status = 'failed';

        if (!boostId) return console.log('❌ Webhook: boost_id manquant');

        console.log(`🔄 Mise à jour boost ${boostId} -> statut: ${status}`);

        await db.query(
          'UPDATE product_boosts SET status = ?, transaction_id = ?, updated_at = NOW() WHERE boost_id = ?', 
          [status, transactionId, boostId]
        );

        if (status === 'active') {
          const [rows] = await db.query('SELECT * FROM product_boosts WHERE boost_id = ?', [boostId]);
          if (rows.length) {
            const boostEnd = new Date();
            boostEnd.setHours(boostEnd.getHours() + (rows[0].duration_hours || 24));
            await db.query(
              'UPDATE products SET is_boosted = 1, boost_end = ? WHERE id = ?', 
              [boostEnd, rows[0].product_id]
            );
            console.log(`✅ Boost activé pour le produit ${rows[0].product_id}`);
          }
        }

        console.log('✅ Webhook Lygos traité avec succès');
      } catch (webhookError) {
        console.error('❌ Erreur traitement webhook:', webhookError);
      }
    }, 100);

  } catch (err) {
    console.error('❌ Erreur webhook Lygos:', err);
    res.status(500).json({ success: false });
  }
});

// Endpoint test Lygos
router.get('/test-lygos', async (req, res) => {
  try {
    const testPayload = {
      amount: 1000,
      currency: 'CDF',
      shop_name: 'ShopNet',
      message: 'Test connexion Lygos',
      success_url: SUCCESS_URL,
      failure_url: FAILURE_URL,
      order_id: `test_${Date.now()}`
    };

    const headers = { 'Content-Type': 'application/json', 'api-key': LYGOS_API_KEY };

    const response = await axios.post(LYGOS_API_URL, testPayload, { headers, timeout: 15000 });

    return res.json({
      success: true,
      message: 'Connexion Lygos réussie',
      response: response.data
    });
  } catch (error) {
    console.error('❌ Test Lygos échoué:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Test Lygos échoué',
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;
