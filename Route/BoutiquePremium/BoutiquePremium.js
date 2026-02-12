

// routes/boutiques-premium.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('../../config/cloudinary');
const jwt = require('jsonwebtoken');

// ======================
// 1. CONFIGURATION MULTER
// ======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/boutiques/premium');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'boutique-logo-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      cb(null, true);
    } else {
      cb(new Error('Format d\'image non supporté'));
    }
  }
});

// ======================
// 2. LOGGER STRUCTURÉ
// ======================
const logger = {
  info: (message, data = {}) => {
    console.log(`[${new Date().toISOString()}] [BOUTIQUE-PREMIUM] INFO: ${message}`, data);
  },
  error: (message, error, context = {}) => {
    console.error(`[${new Date().toISOString()}] [BOUTIQUE-PREMIUM] ERROR: ${message}`, {
      error: error?.message || error,
      stack: error?.stack,
      ...context
    });
  },
  warn: (message, data = {}) => {
    console.warn(`[${new Date().toISOString()}] [BOUTIQUE-PREMIUM] WARN: ${message}`, data);
  }
};

// ======================
// 3. MIDDLEWARE UTILISATEUR
// ======================
const authenticateUser = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token manquant ou invalide' 
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    logger.error('Erreur authentification', error);
    return res.status(401).json({
      success: false,
      message: 'Token invalide ou expiré'
    });
  }
};

// ======================
// 4. FONCTIONS UTILITAIRES
// ======================
function convertirEnCdf(montant, devise) {
  try {
    const montantNettoye = parseFloat(String(montant).replace(/[^\d.,]/g, '').replace(',', '.'));
    
    if (isNaN(montantNettoye) || montantNettoye <= 0) {
      throw new Error('Montant invalide pour conversion CDF');
    }
    
    const tauxCdf = 2000;
    if (devise.toUpperCase() === 'USD') {
      return Math.round(montantNettoye * tauxCdf);
    } else if (devise.toUpperCase() === 'CDF') {
      return Math.round(montantNettoye);
    } else {
      throw new Error(`Devise non supportée: ${devise}`);
    }
  } catch (error) {
    logger.error('Erreur conversion CDF', error, { montant, devise });
    throw error;
  }
}

function genererReference() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 6);
  return `SHOPNET-${timestamp}-${random}`.toUpperCase();
}

async function creerNotification(db, type, titre, message, destinataireType, destinataireId = null, data = null) {
  try {
    await db.query(
      `INSERT INTO notifications_systeme 
       (type, titre, message, destinataire_type, destinataire_id, data, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [type, titre, message, destinataireType, destinataireId, data ? JSON.stringify(data) : null]
    );
  } catch (error) {
    logger.error('Erreur création notification', error);
  }
}

// ======================
// 5. ROUTES UTILISATEUR (AVEC AUTH)
// ======================

// ✅ VÉRIFIER BOUTIQUE UTILISATEUR
router.get('/check', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;

    logger.info('Vérification boutique utilisateur', { userId });

    const [boutiques] = await db.query(
      `SELECT bp.*, 
              DATEDIFF(bp.date_expiration, CURDATE()) as jours_restants
       FROM boutiques_premium bp
       WHERE bp.utilisateur_id = ? 
       AND bp.statut IN ('pending_payment', 'pending_validation', 'validé', 'active')
       ORDER BY bp.date_creation DESC LIMIT 1`,
      [userId]
    );

    if (boutiques.length === 0) {
      logger.info('Aucune boutique trouvée pour utilisateur', { userId });
      return res.json({
        success: true,
        hasBoutique: false
      });
    }

    const boutique = boutiques[0];
    
    logger.info('Boutique trouvée pour utilisateur', {
      userId,
      boutiqueId: boutique.id,
      statut: boutique.statut
    });
    
    return res.json({
      success: true,
      hasBoutique: true,
      boutique: {
        id: boutique.id,
        nom: boutique.nom,
        type: boutique.type,
        type_boutique: boutique.type_boutique,
        categorie: boutique.categorie,
        description: boutique.description,
        logo: boutique.logo,
        statut: boutique.statut,
        prix: boutique.prix,
        devise: boutique.devise,
        date_creation: boutique.date_creation,
        date_expiration: boutique.date_expiration,
        jours_restants: boutique.jours_restants
      }
    });

  } catch (error) {
    logger.error('Erreur vérification boutique', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification'
    });
  }
});

// ✅ CRÉATION BOUTIQUE PREMIUM
router.post('/create', authenticateUser, upload.single('logo'), async (req, res) => {
  let uploadedFile = null;
  const startTime = Date.now();
  
  try {
    const db = req.db;
    const userId = req.userId;
    
    logger.info('Début création boutique premium', {
      userId,
      hasFile: !!req.file,
      bodyFields: Object.keys(req.body)
    });

    // VALIDATION DES CHAMPS OBLIGATOIRES
    const requiredFields = ['nom', 'categorie', 'description', 'email', 'phone', 'adresse', 'ville'];
    const missingFields = requiredFields.filter(field => !req.body[field]?.trim());
    
    if (missingFields.length > 0) {
      logger.warn('Champs obligatoires manquants', { missingFields });
      return res.status(400).json({
        success: false,
        message: `Champs obligatoires manquants: ${missingFields.join(', ')}`,
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    // VÉRIFIER SI L'UTILISATEUR A DÉJÀ UNE BOUTIQUE ACTIVE
    const [existing] = await db.query(
      `SELECT id, statut FROM boutiques_premium 
       WHERE utilisateur_id = ? 
       AND statut IN ('pending_payment', 'pending_validation', 'validé', 'active')`,
      [userId]
    );

    if (existing.length > 0) {
      const boutiqueExistante = existing[0];
      let message = 'Vous avez déjà une boutique premium';
      
      if (boutiqueExistante.statut === 'pending_payment') {
        message = 'Vous avez déjà une boutique premium en attente de paiement';
      } else if (boutiqueExistante.statut === 'pending_validation') {
        message = 'Vous avez déjà une boutique premium en attente de validation';
      } else if (boutiqueExistante.statut === 'validé') {
        message = 'Vous avez déjà une boutique premium active';
      }
      
      logger.warn('Utilisateur a déjà une boutique', { userId });
      
      return res.status(400).json({
        success: false,
        message: message,
        boutiqueId: boutiqueExistante.id,
        statut: boutiqueExistante.statut,
        code: 'ALREADY_HAS_BOUTIQUE'
      });
    }

    // UPLOAD DU LOGO
    let logoUrl = null;
    if (req.file) {
      uploadedFile = req.file;
      
      try {
        const uploadResult = await cloudinary.uploader.upload(uploadedFile.path, {
          folder: 'shopnet/boutiques/premium/logos',
          resource_type: 'image',
          transformation: [
            { width: 800, height: 450, crop: 'fill' },
            { quality: 'auto:best', fetch_format: 'auto' }
          ]
        });
        
        logoUrl = uploadResult.secure_url;
      } catch (uploadError) {
        logger.error('Erreur upload Cloudinary', uploadError);
        logoUrl = `/uploads/boutiques/premium/${uploadedFile.filename}`;
      }
    }

    // DÉMARRER TRANSACTION
    await db.query('START TRANSACTION');
    
    try {
      // PRÉPARATION DES DONNÉES
      const boutiqueData = {
        utilisateur_id: userId,
        nom: req.body.nom.trim(),
        type: 'premium',
        type_boutique: req.body.type || 'general',
        categorie: req.body.categorie,
        description: req.body.description.trim(),
        logo: logoUrl,
        email: req.body.email.trim().toLowerCase(),
        phone: req.body.phone.trim(),
        adresse: req.body.adresse.trim(),
        ville: req.body.ville.trim(),
        pays: req.body.pays || 'RDC',
        codePostal: req.body.codePostal || null,
        latitude: req.body.latitude ? parseFloat(req.body.latitude) : null,
        longitude: req.body.longitude ? parseFloat(req.body.longitude) : null,
        statut: 'pending_payment',
        prix: 9.99,
        montant_abonnement: 9.99,
        devise: 'USD',
        date_creation: new Date(),
        updated_at: new Date()
      };

      // INSERTION
      const [result] = await db.query(
        `INSERT INTO boutiques_premium SET ?`,
        [boutiqueData]
      );

      const boutiqueId = result.insertId;
      
      // INSÉRER DANS L'HISTORIQUE
      await db.query(
        `INSERT INTO historique_boutique_premium 
         (boutique_id, ancien_statut, nouveau_statut, notes, created_at)
         VALUES (?, NULL, 'pending_payment', 'Création de la boutique premium', NOW())`,
        [boutiqueId]
      );

      // NOTIFICATION
      await creerNotification(
        db,
        'info',
        '🏪 Boutique Premium créée',
        `Votre boutique premium "${boutiqueData.nom}" a été créée. Statut: En attente de paiement (9.99 USD).`,
        'user',
        userId,
        { 
          boutique_id: boutiqueId, 
          action: 'creation',
          nom_boutique: boutiqueData.nom,
          prix: 9.99,
          devise: 'USD'
        }
      );

      // METTRE À JOUR LE RÔLE
      await db.query(
        `UPDATE utilisateurs 
         SET role = 'vendeur', updated_at = NOW() 
         WHERE id = ? AND (role IS NULL OR role = 'acheteur')`,
        [userId]
      );

      await db.query('COMMIT');
      
      // RÉPONSE
      res.status(201).json({
        success: true,
        message: 'Boutique premium créée avec succès',
        boutiqueId: boutiqueId,
        boutique: {
          id: boutiqueId,
          nom: boutiqueData.nom,
          statut: 'pending_payment',
          type: 'premium',
          type_boutique: boutiqueData.type_boutique,
          prix: 9.99,
          devise: 'USD',
          logo_url: logoUrl,
          date_creation: new Date().toISOString()
        }
      });

    } catch (transactionError) {
      await db.query('ROLLBACK');
      logger.error('Erreur transaction boutique', transactionError);
      throw transactionError;
    }

  } catch (error) {
    logger.error('Erreur création boutique premium', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la création de la boutique premium',
      error_code: 'BOUTIQUE_CREATION_FAILED'
    });
  } finally {
    if (uploadedFile && fs.existsSync(uploadedFile.path)) {
      try {
        fs.unlinkSync(uploadedFile.path);
      } catch (cleanupError) {
        logger.error('Erreur nettoyage fichier', cleanupError);
      }
    }
  }
});

// ✅ RÉCUPÉRER DÉTAILS BOUTIQUE
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;

    logger.info('Récupération détails boutique', { boutiqueId, userId });

    const [boutiques] = await db.query(
      `SELECT 
        bp.*,
        u.fullName, u.email as user_email, u.phone as user_phone,
        DATEDIFF(bp.date_expiration, CURDATE()) as jours_restants
       FROM boutiques_premium bp
       JOIN utilisateurs u ON bp.utilisateur_id = u.id
       WHERE bp.id = ? AND bp.utilisateur_id = ?`,
      [boutiqueId, userId]
    );

    if (boutiques.length === 0) {
      logger.warn('Boutique non trouvée', { boutiqueId, userId });
      return res.status(404).json({
        success: false,
        message: 'Boutique non trouvée'
      });
    }

    const boutique = boutiques[0];
    
    res.json({
      success: true,
      boutique: {
        id: boutique.id,
        nom: boutique.nom,
        type: boutique.type,
        type_boutique: boutique.type_boutique,
        categorie: boutique.categorie,
        description: boutique.description,
        logo: boutique.logo,
        email: boutique.email,
        phone: boutique.phone,
        adresse: boutique.adresse,
        ville: boutique.ville,
        pays: boutique.pays,
        codePostal: boutique.codePostal,
        statut: boutique.statut,
        prix: boutique.prix,
        devise: boutique.devise,
        date_creation: boutique.date_creation,
        date_expiration: boutique.date_expiration,
        jours_restants: boutique.jours_restants,
        proprietaire: {
          nom: boutique.fullName,
          email: boutique.user_email,
          phone: boutique.user_phone
        }
      }
    });

  } catch (error) {
    logger.error('Erreur récupération boutique', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la boutique'
    });
  }
});// ✅ PRODUITS DE LA BOUTIQUE
router.get('/:id/products', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;

    // Vérifier que l'utilisateur est propriétaire de la boutique
    const [boutique] = await db.query(
      `SELECT id, utilisateur_id FROM boutiques_premium WHERE id = ? AND utilisateur_id = ?`,
      [boutiqueId, userId]
    );

    if (boutique.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé ou boutique non trouvée'
      });
    }

    // Récupérer les produits de l'utilisateur (seller_id) et joindre les images
    const [products] = await db.query(
      `SELECT 
         p.*,
         COALESCE(
           (SELECT absolute_url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1),
           (SELECT absolute_url FROM product_images WHERE product_id = p.id LIMIT 1)
         ) AS primary_image,
         COALESCE(
           (SELECT image_path FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1),
           (SELECT image_path FROM product_images WHERE product_id = p.id LIMIT 1)
         ) AS primary_image_path
       FROM products p
       WHERE p.seller_id = ?
       AND (p.is_active = 1 OR p.is_active IS NULL)
       ORDER BY p.created_at DESC
       LIMIT 200`,
      [userId]
    );

    // Base URL pour générer les images si seulement image_path est disponible
    const BASE_URL = 'https://ton-domaine.com'; // <-- Remplace par ton domaine réel

    // Formater les produits pour correspondre au frontend
    const formattedProducts = products.map(product => {
      const imageUrl = product.primary_image || (product.primary_image_path ? `${BASE_URL}/${product.primary_image_path}` : null);
      return {
        id: product.id,
        nom: product.title,
        name: product.title,
        prix: product.price,
        price: product.price,
        description: product.description,
        image: imageUrl,
        image_url: imageUrl,
        images: imageUrl ? [imageUrl] : [],
        categorie: product.category,
        stock: product.stock,
        location: product.location,
        condition: product.condition,
        created_at: product.created_at,
        updated_at: product.updated_at,
        seller_id: product.seller_id,
        boutique_id: boutiqueId,
        likes_count: product.likes_count || 0,
        views_count: product.views_count || product.views || 0,
        sales: product.sales || 0,
        is_featured: product.is_featured || 0,
        is_boosted: product.is_boosted || 0
      };
    });

    logger.info('Produits récupérés', {
      boutiqueId,
      userId,
      count: formattedProducts.length
    });

    res.json({
      success: true,
      count: formattedProducts.length,
      products: formattedProducts
    });

  } catch (error) {
    logger.error('Erreur récupération produits', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits'
    });
  }
});


// ✅ STATISTIQUES BOUTIQUE PREMIUM (Commandes, Revenu, Vues)
router.get('/:id/stats', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;

    // Vérifier que l'utilisateur est propriétaire de la boutique
    const [boutique] = await db.query(
      `SELECT id, utilisateur_id FROM boutiques_premium 
       WHERE id = ? AND utilisateur_id = ?`,
      [boutiqueId, userId]
    );

    if (boutique.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé ou boutique non trouvée'
      });
    }

    // Récupérer tous les produits de cette boutique
    const [produits] = await db.query(
      `SELECT id, views_count, likes_count, shares_count, comments_count, sales
       FROM products WHERE seller_id = ?`,
      [userId]
    );

    if (produits.length === 0) {
      return res.json({ 
        success: true, 
        totalCommandes: 0, 
        totalRevenu: 0,
        totalVues: 0
      });
    }

    const productIds = produits.map(p => p.id);

    // Récupérer le nombre total de commandes et le revenu
    const [result] = await db.query(
      `SELECT 
         COUNT(DISTINCT c.id) AS totalCommandes,
         IFNULL(SUM(c.total), 0) AS totalRevenu
       FROM commandes c
       JOIN commande_produits cp ON c.id = cp.commande_id
       WHERE cp.produit_id IN (?)`,
      [productIds]
    );

    // Calculer toutes les vues : views_count + likes + comments + shares + ventes
    const totalVuesBrutes = produits.reduce((sum, p) => {
      return sum +
        (p.views_count || 0) +       // vues directes
        (p.likes_count || 0) +       // likes comptés comme vues
        (p.comments_count || 0) +    // commentaires comptés comme vues
        (p.shares_count || 0) +      // partages comptés comme vues
        (p.sales || 0);              // ventes comptées comme vues
    }, 0);

    // Fonction pour formater les nombres en K, M, Md
    const formatViews = (number) => {
      if (number >= 1_000_000_000) return (number / 1_000_000_000).toFixed(1) + ' Md';
      if (number >= 1_000_000) return (number / 1_000_000).toFixed(1) + ' M';
      if (number >= 1_000) return (number / 1_000).toFixed(1) + ' K';
      return number.toString();
    };

    res.json({
      success: true,
      totalCommandes: result[0].totalCommandes,
      totalRevenu: result[0].totalRevenu,
      totalVues: formatViews(totalVuesBrutes)
    });

  } catch (error) {
    console.error('❌ Erreur GET /:id/stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des statistiques'
    });
  }
});



// ======================
// ✅ RÉCUPÉRER INFOS UTILISATEUR BOUTIQUE PREMIUM
// ======================
router.get('/:id/user', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;

    logger.info('Récupération infos utilisateur boutique', { boutiqueId, userId });

    const [rows] = await db.query(
      `
      SELECT 
        u.id AS user_id,
        u.fullName,
        u.email,
        u.phone,
        u.address,
        u.ville
      FROM boutiques_premium bp
      JOIN utilisateurs u ON bp.utilisateur_id = u.id
      WHERE bp.id = ? AND bp.utilisateur_id = ?
      `,
      [boutiqueId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Boutique ou utilisateur non trouvé'
      });
    }

    const user = rows[0];

    res.json({
      success: true,
      user: {
        id: user.user_id,
        nom: user.fullName,      // ✅ mapping
        postnom: '',
        prenom: '',
        email: user.email,
        numero: user.phone,
        adresse: user.address,
        ville: user.ville,
        pays: '',
        codePostal: ''
      }
    });

  } catch (error) {
    logger.error('Erreur récupération infos utilisateur boutique', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});



// ======================
// ✅ MODIFIER INFOS UTILISATEUR BOUTIQUE PREMIUM
// ======================
router.put('/:id/user/update', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;

    const {
      nom,
      email,
      numero,
      adresse,
      ville
    } = req.body || {};

    // Vérifier boutique
    const [boutique] = await db.query(
      `SELECT utilisateur_id FROM boutiques_premium WHERE id = ? AND utilisateur_id = ?`,
      [boutiqueId, userId]
    );

    if (boutique.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      });
    }

    if (!nom && !email && !numero && !adresse && !ville) {
      return res.status(400).json({
        success: false,
        message: 'Aucun champ à mettre à jour'
      });
    }

    await db.query(
      `
      UPDATE utilisateurs SET
        fullName = COALESCE(?, fullName),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        ville = COALESCE(?, ville),
        updated_at = NOW()
      WHERE id = ?
      `,
      [nom, email, numero, adresse, ville, userId]
    );

    const [updated] = await db.query(
      `SELECT id, fullName, email, phone, address, ville FROM utilisateurs WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Informations utilisateur mises à jour avec succès',
      user: {
        id: updated[0].id,
        nom: updated[0].fullName,
        email: updated[0].email,
        numero: updated[0].phone,
        adresse: updated[0].address,
        ville: updated[0].ville
      }
    });

  } catch (error) {
    logger.error('Erreur mise à jour infos utilisateur boutique', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});



// ======================
// ✅ MODIFIER INFOS BOUTIQUE PREMIUM
// ======================
router.put('/:id/update', authenticateUser, async (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;

    const {
      nom,
      description,
      email,
      phone,
      adresse,
      ville,
      pays,
      codePostal
    } = req.body || {};

    // Vérifier que la boutique appartient à l'utilisateur
    const [rows] = await db.query(
      `SELECT id FROM boutiques_premium WHERE id = ? AND utilisateur_id = ?`,
      [boutiqueId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé ou boutique introuvable'
      });
    }

    // Vérifier qu’il y a au moins un champ
    if (
      !nom && !description && !email &&
      !phone && !adresse && !ville &&
      !pays && !codePostal
    ) {
      return res.status(400).json({
        success: false,
        message: 'Aucun champ à mettre à jour'
      });
    }

    await db.query(
      `
      UPDATE boutiques_premium SET
        nom = COALESCE(?, nom),
        description = COALESCE(?, description),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        adresse = COALESCE(?, adresse),
        ville = COALESCE(?, ville),
        pays = COALESCE(?, pays),
        codePostal = COALESCE(?, codePostal),
        updated_at = NOW()
      WHERE id = ?
      `,
      [
        nom,
        description,
        email,
        phone,
        adresse,
        ville,
        pays,
        codePostal,
        boutiqueId
      ]
    );

    const [updated] = await db.query(
      `SELECT * FROM boutiques_premium WHERE id = ?`,
      [boutiqueId]
    );

    res.json({
      success: true,
      message: 'Boutique mise à jour avec succès',
      boutique: updated[0]
    });

  } catch (error) {
    console.error('Erreur update boutique premium:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la mise à jour'
    });
  }
});





// ✅ SOUMETTRE PREUVE DE PAIEMENT
router.post('/:id/paiement', authenticateUser, upload.single('preuve'), async (req, res) => {
  let uploadedFile = null;
  
  try {
    const db = req.db;
    const userId = req.userId;
    const boutiqueId = req.params.id;
    
    const { operateur, transaction_id, montant = '9.99', devise = 'USD' } = req.body;
    
    if (!operateur || !transaction_id || !req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont requis'
      });
    }

    // Récupérer la boutique sans filtrer sur le statut
    const [boutiques] = await db.query(
      `SELECT * FROM boutiques_premium 
       WHERE id = ? AND utilisateur_id = ?`,
      [boutiqueId, userId]
    );

    if (boutiques.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Boutique non trouvée'
      });
    }

    // UPLOAD PREUVE
    let preuveUrl = null;
    try {
      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: 'shopnet/boutiques/premium/paiements',
        resource_type: 'image'
      });
      preuveUrl = uploadResult.secure_url;
    } catch (uploadError) {
      logger.error('Erreur upload preuve', uploadError);
      return res.status(500).json({
        success: false,
        message: 'Erreur upload preuve'
      });
    }

    const reference = genererReference();
    const montantCdf = convertirEnCdf(montant, devise);

    // TRANSACTION
    await db.query('START TRANSACTION');
    
    try {
      // ENREGISTRER PAIEMENT
      const [paiementResult] = await db.query(
        `INSERT INTO paiements_premium SET ?`,
        {
          boutique_id: boutiqueId,
          utilisateur_id: userId,
          reference: reference,
          operateur: operateur,
          transaction_id: transaction_id,
          montant: parseFloat(montant),
          devise: devise,
          montant_cdf: montantCdf,
          preuve_url: preuveUrl,
          statut: 'pending',
          created_at: new Date()
        }
      );

      // METTRE À JOUR STATUT BOUTIQUE uniquement si la boutique n'est pas déjà en pending_validation
      await db.query(
        `UPDATE boutiques_premium 
         SET statut = 'pending_validation', updated_at = NOW()
         WHERE id = ? AND statut != 'pending_validation'`,
        [boutiqueId]
      );

      // HISTORIQUE
      await db.query(
        `INSERT INTO historique_boutique_premium 
         (boutique_id, ancien_statut, nouveau_statut, notes, created_at)
         VALUES (?, ?, 'pending_validation', 'Preuve paiement soumise', NOW())`,
        [boutiqueId, boutiques[0].statut]
      );

      // NOTIFICATIONS
      await creerNotification(
        db,
        'success',
        '💳 Paiement soumis',
        'Votre preuve de paiement a été envoyée. Attente validation.',
        'user',
        userId,
        { 
          boutique_id: boutiqueId,
          reference: reference,
          montant: montant,
          devise: devise
        }
      );

      await db.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Preuve soumise avec succès',
        data: {
          paiement_id: paiementResult.insertId,
          reference: reference,
          statut: 'pending_validation'
        }
      });

    } catch (transactionError) {
      await db.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    logger.error('Erreur soumission paiement', error);
    res.status(500).json({
      success: false,
      message: 'Erreur soumission paiement'
    });
  } finally {
    if (uploadedFile && fs.existsSync(uploadedFile.path)) {
      fs.unlinkSync(uploadedFile.path);
    }
  }
});









// ======================
// ✅ DISCOVER - BOUTIQUES PROCHES (Haversine)
// ======================
router.get('/discover/nearby', async (req, res) => {
  try {
    const db = req.db;

    const {
      latitude,
      longitude,
      radius = 20, // rayon en km (par défaut 20km)
      page = 1,
      limit = 20
    } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude et longitude sont requises'
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const rayon = parseFloat(radius);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Formule Haversine en SQL
    const [shops] = await db.query(
      `
      SELECT 
        bp.id,
        bp.nom,
        bp.logo,
        bp.description,
        bp.ville,
        bp.pays,
        bp.latitude,
        bp.longitude,
        bp.type_boutique,
        bp.date_activation,
        (
          6371 * ACOS(
            COS(RADIANS(?)) *
            COS(RADIANS(bp.latitude)) *
            COS(RADIANS(bp.longitude) - RADIANS(?)) +
            SIN(RADIANS(?)) *
            SIN(RADIANS(bp.latitude))
          )
        ) AS distance
      FROM boutiques_premium bp
      WHERE bp.statut = 'active'
      AND bp.latitude IS NOT NULL
      AND bp.longitude IS NOT NULL
      HAVING distance <= ?
      ORDER BY distance ASC
      LIMIT ? OFFSET ?
      `,
      [
        lat,
        lng,
        lat,
        rayon,
        parseInt(limit),
        offset
      ]
    );

    res.json({
      success: true,
      count: shops.length,
      page: parseInt(page),
      radius_km: rayon,
      shops
    });

  } catch (error) {
    console.error('❌ Erreur GET /discover/nearby:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});


// ======================
// 6. ROUTES ADMIN (SANS MIDDLEWARE - À PROTÉGER EN PRODUCTION)
// ======================

// ✅ LISTER BOUTIQUES EN ATTENTE
router.get('/admin/en-attente', async (req, res) => {
  try {
    const db = req.db;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [boutiques] = await db.query(
      `SELECT 
        bp.*,
        u.fullName, u.email, u.phone,
        pp.operateur, pp.transaction_id, pp.montant, pp.devise,
        pp.preuve_url, pp.created_at as date_paiement
       FROM boutiques_premium bp
       JOIN utilisateurs u ON bp.utilisateur_id = u.id
       LEFT JOIN paiements_premium pp ON bp.id = pp.boutique_id AND pp.statut = 'pending'
       WHERE bp.statut = 'pending_validation'
       ORDER BY bp.date_creation DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM boutiques_premium WHERE statut = 'pending_validation'`
    );

    res.json({
      success: true,
      count: boutiques.length,
      total,
      page: parseInt(page),
      boutiques
    });

  } catch (error) {
    logger.error('Erreur récupération boutiques', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// ✅ CHANGER STATUT BOUTIQUE
router.put('/admin/:id/changer-statut', async (req, res) => {
  try {
    const db = req.db;
    const boutiqueId = req.params.id;
    const { action, notes } = req.body;

    if (!['valider', 'rejeter'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action invalide'
      });
    }

    // RÉCUPÉRER BOUTIQUE
    const [boutique] = await db.query(
      `SELECT * FROM boutiques_premium WHERE id = ?`,
      [boutiqueId]
    );

    if (boutique.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Boutique non trouvée'
      });
    }

    const ancienStatut = boutique[0].statut;
    const utilisateurId = boutique[0].utilisateur_id;
    const nomBoutique = boutique[0].nom;

    // DATE EXPIRATION
    let dateExpiration = null;
    if (action === 'valider') {
      dateExpiration = new Date();
      dateExpiration.setDate(dateExpiration.getDate() + 30);
    }

    // TRANSACTION
    await db.query('START TRANSACTION');
    
    try {
      // METTRE À JOUR BOUTIQUE
      const updateQuery = action === 'valider' 
        ? `UPDATE boutiques_premium 
           SET statut = 'validé', date_expiration = ?, updated_at = NOW()
           WHERE id = ?`
        : `UPDATE boutiques_premium 
           SET statut = 'rejeté', updated_at = NOW()
           WHERE id = ?`;
      
      const updateParams = action === 'valider' ? [dateExpiration, boutiqueId] : [boutiqueId];
      await db.query(updateQuery, updateParams);

      // METTRE À JOUR PAIEMENT
      const newStatutPaiement = action === 'valider' ? 'validated' : 'rejected';
      await db.query(
        `UPDATE paiements_premium 
         SET statut = ?, date_validation = NOW()
         WHERE boutique_id = ? AND statut = 'pending'`,
        [newStatutPaiement, boutiqueId]
      );

      // HISTORIQUE
      await db.query(
        `INSERT INTO historique_boutique_premium 
         (boutique_id, ancien_statut, nouveau_statut, notes, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [boutiqueId, ancienStatut, action === 'valider' ? 'validé' : 'rejeté', notes || null]
      );

      // NOTIFICATION UTILISATEUR
      const titre = action === 'valider' 
        ? '✅ Boutique Premium validée' 
        : '❌ Boutique Premium rejetée';
      
      const message = action === 'valider'
        ? `Félicitations ! Votre boutique "${nomBoutique}" a été validée.`
        : `Votre boutique "${nomBoutique}" a été rejetée.${notes ? ' Raison: ' + notes : ''}`;

      await creerNotification(
        db,
        action === 'valider' ? 'success' : 'error',
        titre,
        message,
        'user',
        utilisateurId,
        { 
          boutique_id: boutiqueId, 
          nouveau_statut: action === 'valider' ? 'validé' : 'rejeté',
          date_expiration: dateExpiration
        }
      );

      await db.query('COMMIT');
      
      res.json({
        success: true,
        message: `Boutique ${action === 'valider' ? 'validée' : 'rejetée'}`,
        boutique: {
          id: boutiqueId,
          nom: nomBoutique,
          nouveau_statut: action === 'valider' ? 'validé' : 'rejeté',
          date_expiration: dateExpiration
        }
      });

    } catch (transactionError) {
      await db.query('ROLLBACK');
      throw transactionError;
    }

  } catch (error) {
    logger.error('Erreur changement statut', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// ✅ LISTER TOUTES LES BOUTIQUES VALIDÉES (ADMIN)
router.get('/admin/all-validees', async (req, res) => {
  try {
    const db = req.db;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [boutiques] = await db.query(
      `SELECT 
        bp.*,
        u.fullName, u.email, u.phone,
        DATEDIFF(bp.date_expiration, CURDATE()) as jours_restants
       FROM boutiques_premium bp
       JOIN utilisateurs u ON bp.utilisateur_id = u.id
       WHERE bp.statut = 'validé'
       ORDER BY bp.date_creation DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM boutiques_premium WHERE statut = 'validé'`
    );

    res.json({
      success: true,
      count: boutiques.length,
      total,
      page: parseInt(page),
      boutiques
    });

  } catch (error) {
    logger.error('Erreur récupération boutiques validées', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// ======================
// 7. ROUTES PUBLIQUES
// ======================

// ✅ LISTE PUBLIQUE BOUTIQUES VALIDÉES
router.get('/liste', async (req, res) => {
  try {
    const db = req.db;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [boutiques] = await db.query(
      `SELECT 
        bp.id, bp.nom, bp.type_boutique, bp.categorie, bp.description,
        bp.logo, bp.email, bp.phone, bp.adresse, bp.ville, bp.pays,
        u.fullName as proprietaire,
        DATEDIFF(bp.date_expiration, CURDATE()) as jours_restants
       FROM boutiques_premium bp
       JOIN utilisateurs u ON bp.utilisateur_id = u.id
       WHERE bp.statut = 'validé'
       ORDER BY bp.date_creation DESC
       LIMIT ? OFFSET ?`,
      [parseInt(limit), offset]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM boutiques_premium WHERE statut = 'validé'`
    );

    res.json({
      success: true,
      count: boutiques.length,
      total,
      page: parseInt(page),
      boutiques
    });

  } catch (error) {
    logger.error('Erreur liste boutiques', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});

// ✅ HEALTH CHECK
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Service boutique premium opérationnel',
    timestamp: new Date().toISOString()
  });
});

// ======================
// 8. GESTION ERREURS
// ======================
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: `Erreur upload: ${err.message}`
    });
  }
  
  logger.error('Erreur non gérée', err);
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur'
  });
});

module.exports = router;
