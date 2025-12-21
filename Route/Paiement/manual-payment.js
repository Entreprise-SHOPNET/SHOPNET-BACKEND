


const axios = require('axios');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('../../config/cloudinary');
const fs = require('fs');
const path = require('path');

// ✅ Middleware d'authentification
const authMiddleware = require('../../middlewares/authMiddleware');

// ✅ Configuration Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.resolve(__dirname, '../../uploads/payment-proofs');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'payment-proof-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non supporté. Seuls les images sont autorisées.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// ✅ Fonction pour convertir USD → CDF
function convertToCdf(amount, currency) {
  const cleanedAmount = parseFloat(String(amount).replace(/[^\d.,]/g, '').replace(',', '.'));
  
  if (isNaN(cleanedAmount) || cleanedAmount <= 0) {
    throw new Error('Montant invalide');
  }
  
  const usdToCdf = 2000; // Taux de conversion fixe
  if (currency.toUpperCase() === 'USD') {
    return Math.round(cleanedAmount * usdToCdf);
  } else if (currency.toUpperCase() === 'CDF') {
    return Math.round(cleanedAmount);
  } else {
    throw new Error('Devise non supportée');
  }
}

// ============================================
// ✅ ROUTES UTILISATEURS (Authentifiées)
// ============================================

// ✅ POST /api/manual-payment/create-boost - Créer un boost
router.post('/create-boost', authMiddleware, async (req, res) => {
  const db = req.db;
  const userId = req.userId;
  const { productId, amount, duration_hours = 24, views, location } = req.body;

  if (!productId || !amount) {
    return res.status(400).json({ 
      success: false, 
      message: 'productId et amount requis' 
    });
  }

  try {
    // Vérifier si le produit existe
    const [productRows] = await db.query(
      'SELECT id, seller_id FROM products WHERE id = ?',
      [productId]
    );
    
    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      });
    }

    const product = productRows[0];
    
    // Vérifier que l'utilisateur est le propriétaire du produit
    if (product.seller_id != userId) {
      return res.status(403).json({
        success: false,
        message: 'Vous n\'êtes pas autorisé à booster ce produit'
      });
    }

    // Générer un ID unique pour le boost
    const boostId = `boost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const now = new Date();
    const startDate = now.toISOString().slice(0, 19).replace('T', ' ');
    const endDate = new Date(now.getTime() + (duration_hours * 60 * 60 * 1000))
      .toISOString().slice(0, 19).replace('T', ' ');

    // Créer le boost avec status 'pending_payment'
const [result] = await db.query(`
  INSERT INTO product_boosts 
    (product_id, user_id, amount, duration_hours, start_date, end_date, 
     status, boost_id, views, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
`, [
  productId, 
  userId, 
  amount, 
  duration_hours || 24,
  startDate, 
  endDate,
  'pending',  // ✅ string correcte
  boostId,
  views || 1000
]);

    return res.json({ 
      success: true, 
      message: 'Boost créé avec succès', 
      data: { 
        id: result.insertId, 
        boostId, 
        status: 'pending_payment',
        product_id: productId,
        amount: amount,
        start_date: startDate,
        end_date: endDate
      } 
    });

  } catch (err) {
    console.error('❌ Erreur création boost:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la création du boost' 
    });
  }
});

// ✅ POST /api/manual-payment/submit-proof - Soumettre une preuve
router.post('/submit-proof', authMiddleware, upload.single('payment_url'), async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const { boostId, amount, currency, operator, transaction_id, product_id } = req.body;

    // Validation des champs requis
    if (!boostId || !amount || !currency || !operator || !transaction_id || !product_id) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont requis'
      });
    }

    // 1️⃣ Vérifier que le boost existe et appartient à l'utilisateur
    const [boostRows] = await db.query(
      `SELECT * FROM product_boosts 
       WHERE boost_id = ? AND user_id = ?`,
      [boostId, userId]
    );

    if (boostRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Boost non trouvé ou non autorisé'
      });
    }

    const boost = boostRows[0];

    // 2️⃣ Upload de l'image vers Cloudinary
    let proofUrl = null;
    if (req.file) {
      try {
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: 'shopnet/payment-proofs',
          resource_type: 'image'
        });
        proofUrl = uploadResult.secure_url;
        // Supprimer le fichier temporaire
        fs.unlinkSync(req.file.path);
      } catch (uploadError) {
        console.error('❌ Erreur Cloudinary:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Erreur lors du téléchargement de l\'image'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Image de preuve requise'
      });
    }

    // 3️⃣ Calculer le montant en CDF
    const montantCdf = convertToCdf(amount, currency);

    // 4️⃣ Enregistrer le paiement dans la table paiements
    const [paymentResult] = await db.query(`
      INSERT INTO paiements 
        (utilisateur_id, montant_paye, devise, montant_cdf, statut, 
         preuve_url, methode_paiement, operateur, code_transaction, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, 'mobile_money', ?, ?, NOW(), NOW())
    `, [
      userId,
      amount,
      currency,
      montantCdf,
      proofUrl,
      operator,
      transaction_id
    ]);

    const paymentId = paymentResult.insertId;

    // 5️⃣ Mettre à jour le boost avec les infos de paiement
    await db.query(`
      UPDATE product_boosts 
      SET 
        original_amount = ?,
        currency = ?,
        transaction_id = ?,
        payment_url = ?,
        status = 'pending',
        updated_at = NOW()
      WHERE boost_id = ?
    `, [amount, currency, transaction_id, proofUrl, boostId]);

    return res.json({
      success: true,
      message: 'Preuve de paiement envoyée avec succès',
      data: {
        paymentId: paymentId,
        boostId: boostId,
        status: 'pending',
        preuve_url: proofUrl,
        montant_cdf: montantCdf
      }
    });

  } catch (error) {
    console.error('❌ Erreur submit-proof:', error);
    
    // Nettoyer le fichier temporaire en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'envoi de la preuve'
    });
  }
});

// ✅ GET /api/manual-payment/user-last-boost - Dernier boost de l'utilisateur
router.get('/user-last-boost', authMiddleware, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;

    const [boosts] = await db.query(
      `SELECT pb.*, p.title as product_title 
       FROM product_boosts pb
       LEFT JOIN products p ON pb.product_id = p.id
       WHERE pb.user_id = ? 
       ORDER BY pb.created_at DESC LIMIT 1`,
      [userId]
    );

    if (boosts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucun boost trouvé'
      });
    }

    const boost = boosts[0];
    return res.json({
      success: true,
      boostId: boost.boost_id,
      productId: boost.product_id,
      productTitle: boost.product_title,
      amount: boost.amount,
      status: boost.status,
      payment_url: boost.payment_url
    });

  } catch (error) {
    console.error('❌ Erreur récupération dernier boost:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du boost'
    });
  }
});

// ============================================
// ✅ ROUTES ADMIN (Sans authentification pour dashboard)
// ============================================

// ✅ GET /api/manual-payment/all - Tous les paiements
router.get('/all', async (req, res) => {
  try {
    const db = req.db;

    const [payments] = await db.query(`
      SELECT 
        p.*,
        u.fullName,
        u.email,
        u.phone,
        u.companyName,
        pb.boost_id,
        pb.product_id,
        pr.title as product_title,
        pb.amount as boost_amount,
        pb.status as boost_status,
        pb.payment_url as boost_payment_url
      FROM paiements p
      LEFT JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
      LEFT JOIN products pr ON pb.product_id = pr.id
      ORDER BY p.created_at DESC
    `);

    res.json({ 
      success: true, 
      count: payments.length,
      payments: payments
    });
  } catch (error) {
    console.error('❌ Erreur récupération tous paiements:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération' 
    });
  }
});

// ✅ GET /api/manual-payment/pending - Paiements en attente
router.get('/pending', async (req, res) => {
  try {
    const db = req.db;

    const [payments] = await db.query(`
      SELECT 
        p.*,
        u.fullName,
        u.email,
        u.phone,
        u.companyName,
        pb.boost_id,
        pb.product_id,
        pr.title as product_title,
        pb.amount as boost_amount
      FROM paiements p
      LEFT JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
      LEFT JOIN products pr ON pb.product_id = pr.id
      WHERE p.statut = 'pending'
      ORDER BY p.created_at DESC
    `);

    res.json({ 
      success: true, 
      count: payments.length,
      payments: payments
    });
  } catch (error) {
    console.error('❌ Erreur récupération paiements pending:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération' 
    });
  }
});

// ✅ GET /api/manual-payment/validated - Paiements validés
router.get('/validated', async (req, res) => {
  try {
    const db = req.db;

    const [payments] = await db.query(`
      SELECT 
        p.*,
        u.fullName,
        u.email,
        u.phone,
        u.companyName,
        pb.boost_id,
        pb.product_id,
        pr.title as product_title,
        pb.amount as boost_amount
      FROM paiements p
      LEFT JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
      LEFT JOIN products pr ON pb.product_id = pr.id
      WHERE p.statut = 'validated'
      ORDER BY p.created_at DESC
    `);

    res.json({ 
      success: true, 
      count: payments.length,
      payments: payments
    });
  } catch (error) {
    console.error('❌ Erreur récupération paiements validés:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération' 
    });
  }
});

// ✅ GET /api/manual-payment/rejected - Paiements rejetés
router.get('/rejected', async (req, res) => {
  try {
    const db = req.db;

    const [payments] = await db.query(`
      SELECT 
        p.*,
        u.fullName,
        u.email,
        u.phone,
        u.companyName,
        pb.boost_id,
        pb.product_id,
        pr.title as product_title,
        pb.amount as boost_amount
      FROM paiements p
      LEFT JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
      LEFT JOIN products pr ON pb.product_id = pr.id
      WHERE p.statut = 'rejected'
      ORDER BY p.created_at DESC
    `);

    res.json({ 
      success: true, 
      count: payments.length,
      payments: payments
    });
  } catch (error) {
    console.error('❌ Erreur récupération paiements rejetés:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération' 
    });
  }
});

// ✅ GET /api/manual-payment/stats - Statistiques
router.get('/stats', async (req, res) => {
  try {
    const db = req.db;

    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN statut = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN statut = 'validated' THEN 1 ELSE 0 END) as validated,
        SUM(CASE WHEN statut = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(montant_cdf) as total_cdf,
        SUM(montant_paye) as total_original,
        AVG(montant_cdf) as avg_cdf
      FROM paiements
    `);

    res.json({
      success: true,
      stats: stats[0] || {
        total: 0,
        pending: 0,
        validated: 0,
        rejected: 0,
        total_cdf: 0,
        total_original: 0,
        avg_cdf: 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération' 
    });
  }
});

// ✅ GET /api/manual-payment/search - Recherche
router.get('/search', async (req, res) => {
  try {
    const db = req.db;
    const { query, status, operator } = req.query;

    let sql = `
      SELECT 
        p.*,
        u.fullName,
        u.email,
        u.phone,
        u.companyName,
        pb.boost_id,
        pb.product_id,
        pr.title as product_title
      FROM paiements p
      LEFT JOIN utilisateurs u ON p.utilisateur_id = u.id
      LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
      LEFT JOIN products pr ON pb.product_id = pr.id
      WHERE 1=1
    `;

    const params = [];

    if (query) {
      sql += ` AND (
        u.fullName LIKE ? OR 
        u.email LIKE ? OR 
        u.phone LIKE ? OR
        p.code_transaction LIKE ? OR
        pr.title LIKE ?
      )`;
      const searchParam = `%${query}%`;
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    if (status) {
      sql += ' AND p.statut = ?';
      params.push(status);
    }

    if (operator) {
      sql += ' AND p.operateur = ?';
      params.push(operator);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [payments] = await db.query(sql, params);

    res.json({
      success: true,
      count: payments.length,
      payments: payments
    });

  } catch (error) {
    console.error('❌ Erreur recherche:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la recherche' 
    });
  }
});



// ✅ PUT /api/manual-payment/update-status/:id - Mettre à jour statut
router.put('/update-status/:id', async (req, res) => {
  try {
    const db = req.db;
    const paymentId = req.params.id;
    const { status, adminComment } = req.body;

    const validStatuses = ['pending', 'validated', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide'
      });
    }

    // 1️⃣ Récupérer le paiement et le code de transaction
    const [payments] = await db.query(
      'SELECT code_transaction FROM paiements WHERE id = ?',
      [paymentId]
    );

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paiement non trouvé'
      });
    }

    const transactionCode = payments[0].code_transaction;

    // 2️⃣ Mettre à jour le statut du paiement
    const [updateResult] = await db.query(
      `UPDATE paiements 
       SET statut = ?, updated_at = NOW() 
       WHERE id = ?`,
      [status, paymentId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: 'Erreur mise à jour paiement'
      });
    }

    // 3️⃣ Mettre à jour le statut du boost associé
    let productId = null;
    let userExpoToken = null;

    if (transactionCode) {
      let boostStatus = 'pending';
      if (status === 'validated') boostStatus = 'active';
      if (status === 'rejected') boostStatus = 'failed';

      await db.query(
        `UPDATE product_boosts 
         SET status = ?, updated_at = NOW() 
         WHERE transaction_id = ?`,
        [boostStatus, transactionCode]
      );

      // 4️⃣ Infos boost + utilisateur
      const [boostInfo] = await db.query(`
        SELECT pb.product_id, pb.end_date, u.expoPushToken
        FROM product_boosts pb
        JOIN utilisateurs u ON pb.user_id = u.id
        WHERE pb.transaction_id = ?
      `, [transactionCode]);

      if (boostInfo.length > 0) {
        productId = boostInfo[0].product_id;
        userExpoToken = boostInfo[0].expoPushToken;

        // Activer le produit si validé
        if (status === 'validated') {
          await db.query(
            `UPDATE products 
             SET is_boosted = 1, boost_end = ? 
             WHERE id = ?`,
            [boostInfo[0].end_date, productId]
          );
        }
      }
    }

    // 5️⃣ ENVOI DE NOTIFICATION
    if (userExpoToken) {
      if (status === 'validated') {
        await sendExpoNotification(
          userExpoToken,
          '🚀 Boost activé !',
          'Votre produit est maintenant mis en avant sur SHOPNET 🔥',
          { type: 'BOOST_VALIDATED', productId }
        );
      }

      if (status === 'rejected') {
        await sendExpoNotification(
          userExpoToken,
          '❌ Boost rejeté',
          'Votre paiement a été rejeté. Veuillez contacter le support.',
          { type: 'BOOST_REJECTED', productId }
        );
      }
    }

    res.json({
      success: true,
      message: `Paiement ${status === 'validated' ? 'validé' : 'rejeté'} avec succès`
    });

  } catch (error) {
    console.error('❌ Erreur update-status:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour'
    });
  }
});



// ✅ PUT /api/manual-payment/activate-boost/:paymentId - Activer boost automatiquement
router.put('/activate-boost/:paymentId', async (req, res) => {
  try {
    const db = req.db;
    const paymentId = req.params.paymentId;

    // 1️⃣ Récupérer le paiement et le boost
    const [payments] = await db.query(
      `SELECT p.*, pb.product_id, pb.end_date, u.expoPushToken
       FROM paiements p
       LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
       LEFT JOIN utilisateurs u ON pb.user_id = u.id
       WHERE p.id = ? AND p.statut = 'validated'`,
      [paymentId]
    );

    if (payments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paiement non trouvé ou non validé'
      });
    }

    const payment = payments[0];

    if (!payment.product_id) {
      return res.status(400).json({
        success: false,
        message: 'Aucun boost associé à ce paiement'
      });
    }

    const productId = payment.product_id;
    const expoPushToken = payment.expoPushToken;

    // 2️⃣ Activer le boost dans product_boosts
    await db.query(
      `UPDATE product_boosts 
       SET status = 'active', updated_at = NOW() 
       WHERE transaction_id = ?`,
      [payment.code_transaction]
    );

    // 3️⃣ Activer le produit avec boost + priorité
    await db.query(
      `UPDATE products 
       SET is_boosted = 1, boost_end = ?, boost_priority = 1
       WHERE id = ?`,
      [payment.end_date, productId]
    );

    // 4️⃣ Augmenter légèrement les stats pour conforter l'utilisateur
    await db.query(
      `UPDATE products 
       SET views_count = views_count + ?, likes_count = likes_count + ?
       WHERE id = ?`,
      [Math.floor(Math.random() * 10 + 5), Math.floor(Math.random() * 3 + 1), productId]
    );

    // 5️⃣ Envoyer notification push à l'utilisateur
    if (expoPushToken) {
      await sendExpoNotification(
        expoPushToken,
        '🚀 Boost activé !',
        'Votre produit est maintenant mis en avant sur SHOPNET 🔥',
        { type: 'BOOST_VALIDATED', productId }
      );
    }

    res.json({
      success: true,
      message: 'Boost activé avec succès et produit mis en avant',
      product_id: productId
    });

  } catch (error) {
    console.error('❌ Erreur activation boost:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'activation du boost'
    });
  }
});






async function sendExpoNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) return;

  try {
    await axios.post('https://exp.host/--/api/v2/push/send', {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
    });
  } catch (error) {
    console.error(
      '❌ Erreur notification Expo:',
      error.response?.data || error.message
    );
  }
}




// ✅ POST /api/manual-payment/activate-shop/:userId - Activer boutique
router.post('/activate-shop/:userId', async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.userId;

    // Activer la boutique (ajouter une colonne shop_active si nécessaire)
    // Pour l'instant, on met à jour le rôle
    await db.query(
      `UPDATE utilisateurs 
       SET role = 'vendeur', updated_at = NOW() 
       WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Boutique activée avec succès',
      userId: userId
    });

  } catch (error) {
    console.error('❌ Erreur activation boutique:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'activation'
    });
  }
});

// ✅ DELETE /api/manual-payment/delete/:id - Supprimer paiement
router.delete('/delete/:id', async (req, res) => {
  try {
    const db = req.db;
    const paymentId = req.params.id;

    // Récupérer l'URL de la preuve
    const [payment] = await db.query(
      'SELECT preuve_url FROM paiements WHERE id = ?',
      [paymentId]
    );

    if (payment.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Paiement non trouvé' 
      });
    }

    // Supprimer de Cloudinary
    const preuveUrl = payment[0].preuve_url;
    if (preuveUrl && preuveUrl.includes('cloudinary')) {
      try {
        const publicId = preuveUrl.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`shopnet/payment-proofs/${publicId}`);
      } catch (cloudinaryError) {
        console.error('❌ Erreur suppression Cloudinary:', cloudinaryError);
      }
    }

    // Supprimer de la base
    await db.query('DELETE FROM paiements WHERE id = ?', [paymentId]);

    res.json({
      success: true,
      message: 'Paiement supprimé avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur suppression:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la suppression' 
    });
  }
});

// ✅ GET /api/manual-payment/user/:userId - Paiements d'un utilisateur
router.get('/user/:userId', async (req, res) => {
  try {
    const db = req.db;
    const userId = req.params.userId;

    const [userInfo] = await db.query(
      'SELECT id, fullName, email, phone, companyName, ville FROM utilisateurs WHERE id = ?',
      [userId]
    );

    const [payments] = await db.query(`
      SELECT 
        p.*,
        pb.boost_id,
        pb.product_id,
        pr.title as product_title
      FROM paiements p
      LEFT JOIN product_boosts pb ON p.code_transaction = pb.transaction_id
      LEFT JOIN products pr ON pb.product_id = pr.id
      WHERE p.utilisateur_id = ?
      ORDER BY p.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      count: payments.length,
      user: userInfo[0] || null,
      payments: payments
    });

  } catch (error) {
    console.error('❌ Erreur récupération utilisateur:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération' 
    });
  }
});










// ✅ GET /api/manual-payment/user-boosts - Tous les boosts de l'utilisateur
router.get('/user-boosts', authMiddleware, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;

    const [boosts] = await db.query(`
      SELECT 
        pb.*,
        p.title as product_title,
        p.image_url as product_image,
        p.price as product_price,
        u.fullName as user_name,
        u.email as user_email
      FROM product_boosts pb
      LEFT JOIN products p ON pb.product_id = p.id
      LEFT JOIN utilisateurs u ON pb.user_id = u.id
      WHERE pb.user_id = ? 
      ORDER BY pb.created_at DESC
    `, [userId]);

    // Formater les données
    const formattedBoosts = boosts.map(boost => ({
      id: boost.id,
      boost_id: boost.boost_id,
      product_id: boost.product_id,
      product_title: boost.product_title || 'Produit sans titre',
      product_image: boost.product_image || 'https://via.placeholder.com/400x300.png/0077FF/FFFFFF?text=Produit',
      product_price: boost.product_price || 0,
      amount: parseFloat(boost.amount) || 0,
      original_amount: parseFloat(boost.original_amount) || parseFloat(boost.amount) || 0,
      currency: boost.currency || 'CDF',
      status: boost.status || 'pending',
      views: boost.views || 0,
      duration_hours: boost.duration_hours || 24,
      start_date: boost.start_date,
      end_date: boost.end_date,
      country: boost.country,
      city: boost.city,
      address: boost.address,
      transaction_id: boost.transaction_id,
      payment_url: boost.payment_url,
      created_at: boost.created_at,
      updated_at: boost.updated_at,
      user_name: boost.user_name,
      user_email: boost.user_email
    }));

    return res.json({
      success: true,
      boosts: formattedBoosts
    });

  } catch (error) {
    console.error('❌ Erreur récupération boosts utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des boosts'
    });
  }
});



module.exports = router;