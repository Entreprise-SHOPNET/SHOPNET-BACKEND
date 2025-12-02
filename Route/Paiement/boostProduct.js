
// routes/boosts.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../../db');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

// Configuration PawaPay
const PAWAPAY_API_URL = process.env.PAWAPAY_API_URL || 'https://api.pawapay.cloud';
const PAWAPAY_PAYMENTS_PATH = process.env.PAWAPAY_PAYMENTS_PATH || '/api/v1/payments';
const PAWAPAY_API_KEY = process.env.PAWAPAY_API_KEY || 'eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJ0dCI6IkFBVCIsInN1YiI6IjEzMzE0IiwibWF2IjoiMSIsImV4cCI6MjA3OTcxNTc5OCwiaWF0IjoxNzY0MTgyOTk4LCJwbSI6IkRBRixQQUYiLCJqdGkiOiIwYjIxMDUzMS03ZjRjLTQ4ZGQtODU5My04YTBkN2I2NDBlZGUifQ.yNs0_swY2vXA9a7OmuVYa4kRESswcxptU_5mWkldfEBxbkIovvzP-fQsLnG8E1fRqaymBzhHW5VFWMGk-Shj2A';
const SUCCESS_URL = process.env.PAWAPAY_SUCCESS_URL || 'https://shopnet.app/payment/success';
const FAILURE_URL = process.env.PAWAPAY_FAILURE_URL || 'https://shopnet.app/payment/failure';
const EXCHANGE_RATE = Number(process.env.EXCHANGE_RATE || 2500);

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

// Convertit budget -> unités PawaPay
function convertToPawaPayAmount(budget, currency) {
  if (currency === 'CDF') {
    // Pour CDF, utiliser la valeur directement (en centimes)
    return { amount: Math.round(Number(budget) * 100), currency: 'CDF' };
  } else {
    // Pour USD, convertir en CDF pour PawaPay (en centimes)
    return { amount: Math.round(Number(budget) * EXCHANGE_RATE * 100), currency: 'CDF' };
  }
}

// CREATE PAYMENT avec PawaPay - VERSION CORRIGÉE
router.post('/create', createLimiter, async (req, res) => {
  try {
    console.log('📥 Requête reçue:', req.body);

    const { error, value } = createSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      console.log('❌ Erreur validation:', error.message);
      return res.status(400).json({ success: false, message: error.message });
    }

    const { productId, userId, budget, currency, views, days, country, city, address } = value;
    
    // Vérification du montant minimum
    const minBudget = currency === 'CDF' ? 1000 : 1;
    if (budget < minBudget) {
      return res.status(400).json({
        success: false,
        message: currency === 'CDF' ? `Montant minimum: ${minBudget} CDF` : `Montant minimum: ${minBudget} USD`
      });
    }

    const { amount, currency: pawaPayCurrency } = convertToPawaPayAmount(budget, currency);
    console.log(`💰 Conversion: ${budget} ${currency} -> ${amount} ${pawaPayCurrency}`);

    const boostId = `boost_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

    // Payload CORRIGÉ pour PawaPay selon la documentation
    const paymentPayload = {
      amount: {
        value: amount.toString(),
        currency: pawaPayCurrency
      },
      description: `Boost ShopNet - ${views.toLocaleString()} vues - ${days} jour(s)`,
      merchantReference: boostId,
      callbackUrl: `${process.env.APP_URL || 'https://your-app-url.com'}/api/boost/webhook`,
      returnUrl: SUCCESS_URL,
      cancelUrl: FAILURE_URL,
      metadata: {
        productId: String(productId),
        userId: String(userId),
        boostId: boostId,
        originalCurrency: currency,
        originalAmount: budget,
        views: views,
        days: days,
        country: country,
        city: city,
        address: address
      }
    };

    console.log('🔄 Appel API PawaPay:', JSON.stringify(paymentPayload, null, 2));

    const paymentsEndpoint = `${PAWAPAY_API_URL}${PAWAPAY_PAYMENTS_PATH}`;
    console.log('🔗 Endpoint:', paymentsEndpoint);

    // Headers CORRIGÉS pour PawaPay
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PAWAPAY_API_KEY}`,
      'X-API-Version': '2021-11-01',
      'User-Agent': 'ShopNet/1.0.0'
    };

    console.log('🔑 Headers:', headers);

    const pawaPayResp = await axios.post(paymentsEndpoint, paymentPayload, {
      headers: headers,
      timeout: 30000,
      validateStatus: function (status) {
        return status < 500; // Resolve seulement si le code de statut est inférieur à 500
      }
    });

    const data = pawaPayResp.data;
    console.log('✅ Réponse PawaPay:', JSON.stringify(data, null, 2));

    // Vérification de la réponse
    if (pawaPayResp.status !== 200 && pawaPayResp.status !== 201) {
      console.log('❌ Statut HTTP non réussie:', pawaPayResp.status);
      return res.status(pawaPayResp.status).json({
        success: false,
        message: `Erreur PawaPay: ${data.failureReason?.failureMessage || 'Erreur inconnue'}`,
        details: data
      });
    }

    const paymentUrl = data.paymentUrl || data.url || data.checkoutUrl || data.payment_url;

    if (!paymentUrl) {
      console.log('❌ Pas de lien de paiement dans la réponse');
      return res.status(502).json({ 
        success: false, 
        message: 'Erreur: pas de lien de paiement généré',
        response: data
      });
    }

    const durationHours = Number(days) * 24;
    
    // Insertion dans la base de données
    await db.query(`
      INSERT INTO product_boosts 
      (product_id, user_id, amount, original_amount, currency, duration_hours, views, country, city, address, status, boost_id, payment_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [productId, userId, budget, budget, currency, durationHours, views, country, city, address, 'pending', boostId, paymentUrl]);

    console.log('✅ Boost enregistré en base avec ID:', boostId);

    return res.json({
      success: true,
      link: paymentUrl,
      boostId,
      amount: budget,
      currency: currency,
      originalAmount: budget,
      originalCurrency: currency
    });

  } catch (err) {
    console.error('❌ Erreur création boost:', err.message);
    
    if (err.response) {
      console.error('📊 Détails erreur PawaPay:');
      console.error('Status:', err.response.status);
      console.error('Headers:', err.response.headers);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
      
      return res.status(err.response.status).json({ 
        success: false, 
        message: `Erreur PawaPay (${err.response.status}): ${err.response.data?.failureReason?.failureMessage || err.message}`,
        details: err.response.data,
        status: err.response.status
      });
    } else if (err.request) {
      console.error('❌ Aucune réponse reçue:', err.request);
      return res.status(503).json({ 
        success: false, 
        message: 'Service PawaPay indisponible',
        error: err.message
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur interne',
      error: err.message 
    });
  }
});

// STATUS
router.get('/status/:boostId', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM product_boosts WHERE boost_id = ?', [req.params.boostId]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Boost non trouvé' });
    }
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

// WEBHOOK PawaPay - VERSION SIMPLIFIÉE POUR TEST
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('🔄 Webhook PawaPay reçu:', JSON.stringify(payload, null, 2));

    // Répondre immédiatement à PawaPay
    res.json({ success: true, received: true });

    // Traitement asynchrone
    setTimeout(async () => {
      try {
        let boostId = payload?.merchantReference || payload?.metadata?.boostId;
        let status = 'pending';
        let transactionId = payload?.transactionId || payload?.id;

        if (payload.status === 'SUCCESS' || payload.status === 'COMPLETED') {
          status = 'active';
        } else if (payload.status === 'FAILED' || payload.status === 'CANCELLED') {
          status = 'failed';
        }

        if (!boostId) {
          console.log('❌ Webhook: boost_id manquant');
          return;
        }

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

        console.log('✅ Webhook PawaPay traité avec succès');
      } catch (webhookError) {
        console.error('❌ Erreur traitement webhook:', webhookError);
      }
    }, 100);

  } catch (err) {
    console.error('❌ Erreur webhook PawaPay:', err);
    res.status(500).json({ success: false });
  }
});

// Endpoint de test PawaPay
router.get('/test-pawapay', async (req, res) => {
  try {
    // Test simple de connexion à l'API PawaPay
    const testPayload = {
      amount: {
        value: "1000", // 10 CDF en centimes
        currency: "CDF"
      },
      description: "Test de connexion ShopNet",
      merchantReference: `test_${Date.now()}`,
      callbackUrl: `${process.env.APP_URL || 'https://your-app-url.com'}/api/boost/webhook`,
      returnUrl: SUCCESS_URL,
      cancelUrl: FAILURE_URL,
      metadata: {
        test: true,
        timestamp: new Date().toISOString()
      }
    };

    const paymentsEndpoint = `${PAWAPAY_API_URL}${PAWAPAY_PAYMENTS_PATH}`;
    
    const response = await axios.post(paymentsEndpoint, testPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAWAPAY_API_KEY}`,
        'X-API-Version': '2021-11-01'
      },
      timeout: 10000
    });

    return res.json({
      success: true,
      message: 'Connexion PawaPay réussie',
      response: response.data
    });

  } catch (error) {
    console.error('❌ Test PawaPay échoué:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Test PawaPay échoué',
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;