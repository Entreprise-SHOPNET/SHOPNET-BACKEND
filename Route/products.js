
const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const db = require('../db');
const authMiddleware = require('../middlewares/authMiddleware');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const redisClient = require('../ia_statique/redisClient'); // adapte ton chemin

router.use(cors({
  origin: [
    'http://100.64.134.89:5000', 
    'http://100.64.134.89',
    'https://100.64.134.89:5000' // Ajoutez votre URL Render ici
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Multer en mémoire (pas de fichier local)
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (validTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Seules les images JPEG/PNG/WEBP sont acceptées'), false);
};
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter
}).array('images', 5);

// Fonction utilitaire : upload buffer vers Cloudinary en Promise
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

// Fonctions utilitaires existantes pour GET routes (reste inchangé)
const safeJsonParse = (str) => {
  try {
    return str ? JSON.parse(str) : [];
  } catch {
    return [];
  }
};




// ----------------------------
// // GET /products — Récupère le feed principal des produits actifs avec
// pagination, tri par boost/priorité/date, jointure vendeur, images Cloudinary
// et statut like utilisateur.
// ----------------------------
router.get('/electronics/advanced', async (req, res) => {
  try {
    const userId = req.headers.authorization ? req.userId : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // 📍 GPS utilisateur (envoyé depuis le frontend)
    const userLat = parseFloat(req.query.lat) || null;
    const userLon = parseFloat(req.query.lon) || null;

    // 🔑 CACHE
    const cacheKey = `electronics:adv:${userId || 'guest'}:${page}:${userLat}:${userLon}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("⚡ CACHE ADVANCED HIT");
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. Récupérer catégories aimées
    // ============================
    let likedCategories = [];

    if (userId) {
      const [likes] = await db.query(`
        SELECT DISTINCT p.category
        FROM product_likes pl
        JOIN products p ON pl.product_id = p.id
        WHERE pl.user_id = ?
        LIMIT 5
      `, [userId]);

      likedCategories = likes.map(l => l.category);
    }

    // ============================
    // 🧠 2. PRODUITS ELECTRONICS
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,

        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id

      WHERE p.category = 'electronics'
      AND p.is_active = 1

      LIMIT 150
    `);

    // ============================
    // 🧠 3. SCORING IA (JS)
    // ============================
    const scored = products.map(p => {

      let score = 0;

      // 🔥 boost
      if (p.is_boosted) score += 60;
      if (p.is_featured) score += 30;

      // 📊 engagement
      score += (p.likes_count || 0) * 3;
      score += (p.shares_count || 0) * 4;
      score += (p.comments_count || 0) * 2;
      score += (p.views_count || 0) * 1.5;
      score += (p.sales || 0) * 5;

      // 🎯 préférences utilisateur
      if (likedCategories.includes(p.category)) {
        score += 40;
      }

      // 📍 DISTANCE GPS
      let distance = null;

      if (userLat && userLon && p.latitude && p.longitude) {
        const R = 6371;

        const dLat = (p.latitude - userLat) * Math.PI / 180;
        const dLon = (p.longitude - userLon) * Math.PI / 180;

        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(userLat * Math.PI / 180) *
          Math.cos(p.latitude * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distance = R * c;

        if (distance < 5) score += 50;
        else if (distance < 20) score += 30;
        else if (distance < 50) score += 10;
      }

      // 🧠 popularité globale
      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score,
        distance_km: distance
      };
    });

    // ============================
    // 🔥 TRI FINAL
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      score: p.score,
      distance: p.distance_km,

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      products: result
    };

    // ============================
    // ⚡ CACHE SAVE
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    console.error("❌ ADVANCED ELECTRONICS ERROR:", error);
    res.status(500).json({ success: false });
  }
});





// ==============================
// GET /mode/ai — FEED INTELLIGENT IA MODE (COMPLET)
// ==============================
router.get('/mode/ai', async (req, res) => {
  try {
    const userId = req.headers.authorization ? req.userId : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const userLat = parseFloat(req.query.lat) || null;
    const userLon = parseFloat(req.query.lon) || null;

    // ============================
    // ⚡ CACHE
    // ============================
    const cacheKey = `mode:ai:${userId || 'guest'}:${page}:${userLat}:${userLon}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. Préférences utilisateur
    // ============================
    let likedCategories = [];

    if (userId) {
      const [likes] = await db.query(`
        SELECT DISTINCT p.category
        FROM product_likes pl
        JOIN products p ON pl.product_id = p.id
        WHERE pl.user_id = ?
        LIMIT 10
      `, [userId]);

      likedCategories = likes.map(l => l.category);
    }

    // ============================
    // 🧠 2. Produits MODE
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id

      WHERE p.category = 'mode'
      AND p.is_active = 1
      LIMIT 200
    `);

    // ============================
    // 🧠 3. IA SCORING
    // ============================
    const scored = products.map(p => {
      let score = 0;

      // 🔥 Boost
      if (p.is_boosted) score += 70;
      if (p.is_featured) score += 35;

      // 📊 engagement
      score += (p.likes_count || 0) * 4;
      score += (p.shares_count || 0) * 3;
      score += (p.comments_count || 0) * 2;
      score += (p.views_count || 0) * 1.2;
      score += (p.sales || 0) * 6;

      // 🎯 préférences utilisateur
      if (likedCategories.includes(p.category)) {
        score += 50;
      }

      // 📍 distance
      let distance = null;

      if (userLat && userLon && p.latitude && p.longitude) {
        const R = 6371;

        const dLat = (p.latitude - userLat) * Math.PI / 180;
        const dLon = (p.longitude - userLon) * Math.PI / 180;

        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(userLat * Math.PI / 180) *
          Math.cos(p.latitude * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distance = R * c;

        if (distance < 5) score += 60;
        else if (distance < 20) score += 35;
        else if (distance < 50) score += 15;
      }

      // 🧠 popularité globale
      score += (p.popularity_score || 0) * 2.5;

      // 💎 tendances mode
      if (p.trending === 1) score += 40;
      if (p.seasonal === 1) score += 20;

      return {
        ...p,
        score,
        distance_km: distance
      };
    });

    // ============================
    // 🔥 TRI IA
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT FINAL
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      score: p.score,
      distance: p.distance_km,
      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      ai_mode: true,
      products: result
    };

    // ============================
    // ⚡ CACHE SAVE
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    console.error("❌ MODE AI ERROR:", error);
    res.status(500).json({ success: false });
  }
});








// ==============================
// GET /maison/ai — FEED INTELLIGENT IA MAISON MEUBLE (COMPLET)
// ==============================
router.get('/maison/ai', async (req, res) => {
  try {
    const userId = req.headers.authorization ? req.userId : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const userLat = parseFloat(req.query.lat) || null;
    const userLon = parseFloat(req.query.lon) || null;

    // ============================
    // ⚡ CACHE
    // ============================
    const cacheKey = `maison:ai:${userId || 'guest'}:${page}:${userLat}:${userLon}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("⚡ CACHE MAISON HIT");
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. Préférences utilisateur
    // ============================
    let likedCategories = [];

    if (userId) {
      const [likes] = await db.query(`
        SELECT DISTINCT p.category
        FROM product_likes pl
        JOIN products p ON pl.product_id = p.id
        WHERE pl.user_id = ?
        LIMIT 10
      `, [userId]);

      likedCategories = likes.map(l => l.category);
    }

    // ============================
    // 🧠 2. PRODUITS MAISON (FIX ICI 🔥)
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id

      WHERE LOWER(TRIM(p.category)) = 'home'
      AND p.is_active = 1

      LIMIT 200
    `);

    // ============================
    // 🧠 3. IA SCORING MAISON
    // ============================
    const scored = products.map(p => {
      let score = 0;

      // 🔥 Boost prioritaire
      if (p.is_boosted) score += 80;
      if (p.is_featured) score += 40;

      // 📊 Engagement
      score += (p.likes_count || 0) * 2;
      score += (p.shares_count || 0) * 2;
      score += (p.comments_count || 0) * 1.5;
      score += (p.views_count || 0) * 1;

      // 💰 Ventes
      score += (p.sales || 0) * 8;

      // 🎯 Préférences utilisateur
      if (likedCategories.includes(p.category)) {
        score += 30;
      }

      // 📍 Distance
      let distance = null;

      if (userLat && userLon && p.latitude && p.longitude) {
        const R = 6371;

        const dLat = (p.latitude - userLat) * Math.PI / 180;
        const dLon = (p.longitude - userLon) * Math.PI / 180;

        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(userLat * Math.PI / 180) *
          Math.cos(p.latitude * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distance = R * c;

        if (distance < 5) score += 100;
        else if (distance < 20) score += 60;
        else if (distance < 50) score += 30;
        else score -= 10;
      }

      // 💸 Prix intelligent
      if (p.price) {
        if (p.price < 20) score += 20;
        else if (p.price < 100) score += 10;
      }

      // 🧠 Popularité
      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score,
        distance_km: distance
      };
    });

    // ============================
    // 🔥 TRI IA
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT FINAL
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      score: p.score,
      distance: p.distance_km,
      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      ai_maison: true,
      products: result
    };

    // ============================
    // ⚡ CACHE SAVE
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    console.error("❌ MAISON AI ERROR:", error);
    res.status(500).json({ success: false });
  }
});



// ==============================
// GET /ai/computers — FEED IA ORDINATEURS (PRO SHOPNET)
// ==============================
router.get('/ai/computers', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `ai:computers:${page}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. GET PRODUCTS
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
    `);

    // ============================
    // 🧠 2. IA CATEGORY DETECTION
    // ============================
    function detectCategory(title, description) {
      const text = `${title} ${description}`.toLowerCase();

      if (
        text.includes('pc') ||
        text.includes('ordinateur') ||
        text.includes('laptop') ||
        text.includes('portable') ||
        text.includes('macbook') ||
        text.includes('desktop') ||
        text.includes('gaming') ||
        text.includes('hp') ||
        text.includes('dell') ||
        text.includes('lenovo') ||
        text.includes('asus') ||
        text.includes('msi') ||
        text.includes('acer')
      ) {
        return 'computers';
      }

      return 'other';
    }

    // ============================
    // 🧠 3. FILTER STRICT IA
    // ============================
    const filtered = products.filter(p => {
      const cat = detectCategory(p.title, p.description);
      return cat === 'computers';
    });

    // ============================
    // 🧠 4. SCORING IA
    // ============================
    const scored = filtered.map(p => {
      const text = `${p.title} ${p.description}`.toLowerCase();

      let score = 0;

      // 🔥 Boost system
      if (p.is_boosted) score += 80;
      if (p.is_featured) score += 40;

      // 📊 Engagement
      score += (p.likes_count || 0) * 3;
      score += (p.views_count || 0) * 1.5;
      score += (p.comments_count || 0) * 2;
      score += (p.sales || 0) * 6;

      // 💻 BONUS ORDINATEUR PUR
      if (text.includes('gaming')) score += 30;
      if (text.includes('laptop')) score += 20;
      if (text.includes('macbook')) score += 40;

      // 💰 Prix attractif
      if (p.price < 300) score += 30;
      else if (p.price < 800) score += 15;

      // 🧠 Popularité
      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score,
        ai_category: 'computers'
      };
    });

    // ============================
    // 🔥 5. SORT BY IA SCORE
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 6. PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 7. FORMAT RESPONSE
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      condition: p.condition,
      stock: p.stock,
      score: p.score,
      ai_category: p.ai_category,

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      category: "computers",
      ai_mode: true,
      products: result
    };

    // ============================
    // ⚡ CACHE 5 MIN
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    return res.json(response);

  } catch (error) {
    console.error("❌ AI COMPUTERS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});






    // ============================
    // 🧠 1. GET BEAUTY PRODUCTS ONLY
    // ============================
router.get('/ai/beauty', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `ai:beauty:${page}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. GET BEAUTY PRODUCTS ONLY
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.category = 'beauty'
      AND p.is_active = 1
    `);

    // ============================
    // 🧠 2. IA SCORING BEAUTY
    // ============================
    const scored = products.map(p => {
      const text = `${p.title} ${p.description}`.toLowerCase();

      let score = 0;

      // 🔥 boost
      if (p.is_boosted) score += 80;
      if (p.is_featured) score += 40;

      // 📊 engagement
      score += (p.likes_count || 0) * 3;
      score += (p.views_count || 0) * 1.5;
      score += (p.comments_count || 0) * 2;
      score += (p.sales || 0) * 6;

      // 💄 BEAUTY TREND BONUS
      if (
        text.includes('crème') ||
        text.includes('cream') ||
        text.includes('maquillage') ||
        text.includes('makeup') ||
        text.includes('fond de teint') ||
        text.includes('rouge à lèvres') ||
        text.includes('shampooing') ||
        text.includes('perruque') ||
        text.includes('cheveux')
      ) {
        score += 50;
      }

      // 💰 prix attractif
      if (p.price < 20) score += 30;
      else if (p.price < 50) score += 15;

      // 🧠 popularité globale
      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score,
        ai_category: 'beauty'
      };
    });

    // ============================
    // 🔥 3. SORT IA
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 4. PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 5. FORMAT RESPONSE
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      condition: p.condition,
      stock: p.stock,
      score: p.score,
      ai_category: 'beauty',

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      category: "beauty",
      ai_mode: true,
      products: result
    };

    // ============================
    // ⚡ CACHE
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    return res.json(response);

  } catch (error) {
    console.error("❌ AI BEAUTY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});





// ==============================
// GET /ai/auto-moto — AUTO + FILTRE IA
// ==============================
router.get('/ai/auto-moto', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `ai:auto-moto:${page}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. RÉCUPÉRATION PRODUITS (AUTO + GLOBAL)
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id

      WHERE p.is_active = 1
      AND (
        LOWER(TRIM(p.category)) = 'auto'
        OR LOWER(p.title) LIKE '%auto%'
        OR LOWER(p.title) LIKE '%voiture%'
        OR LOWER(p.title) LIKE '%moto%'
        OR LOWER(p.description) LIKE '%auto%'
        OR LOWER(p.description) LIKE '%voiture%'
        OR LOWER(p.description) LIKE '%moto%'
      )

      LIMIT 300
    `);

    // ============================
    // 🧠 2. FILTRE IA (ANTI FAUX POSITIF)
    // ============================
    const filtered = products.filter(p => {
      const text = `${p.title} ${p.description}`.toLowerCase();

      return (
        text.includes('voiture') ||
        text.includes('auto') ||
        text.includes('car') ||
        text.includes('véhicule') ||
        text.includes('moto') ||
        text.includes('motor') ||
        text.includes('bike') ||
        text.includes('scooter') ||
        text.includes('yamaha') ||
        text.includes('honda') ||
        text.includes('toyota') ||
        text.includes('nissan') ||
        text.includes('bmw') ||
        text.includes('mercedes')
      ) || p.category.toLowerCase().trim() === 'auto';
    });

    // ============================
    // 🧠 3. SCORING IA
    // ============================
    const scored = filtered.map(p => {
      let score = 0;

      if (p.is_boosted) score += 80;
      if (p.is_featured) score += 40;

      score += (p.likes_count || 0) * 3;
      score += (p.views_count || 0) * 1.5;
      score += (p.comments_count || 0) * 2;
      score += (p.sales || 0) * 6;

      if (p.price > 500) score += 20;
      if (p.price > 1000) score += 30;

      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score
      };
    });

    // ============================
    // 🔥 TRI
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT FINAL
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      condition: p.condition,
      stock: p.stock,
      score: p.score,
      ai_category: "auto-moto",

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      category: "auto-moto",
      ai_mode: true,
      products: result
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    return res.json(response);

  } catch (error) {
    console.error("❌ AUTO MOTO ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});





// ==============================
// GET /ai/food — FEED ALIMENTAIRE (IA PRO)
// ==============================
router.get('/ai/food', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `ai:food:${page}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("⚡ CACHE FOOD HIT");
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. RÉCUPÉRATION PRODUITS
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
    `);

    // ============================
    // 🧠 2. FILTRE ALIMENTAIRE (ULTRA IA)
    // ============================
    const filtered = products.filter(p => {
      const text = `${p.title} ${p.description}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // supprime accents

      return (
        // 🍽️ général
        text.includes('manger') ||
        text.includes('nourriture') ||
        text.includes('aliment') ||
        text.includes('repas') ||
        text.includes('plat') ||

        // 🍞 boulangerie
        text.includes('pain') ||
        text.includes('pains') ||
        text.includes('baguette') ||
        text.includes('croissant') ||

        // 🍊 fruits
        text.includes('orange') ||
        text.includes('pomme') ||
        text.includes('banane') ||
        text.includes('mangue') ||
        text.includes('ananas') ||
        text.includes('citron') ||
        text.includes('avocat') ||

        // 🥦 légumes
        text.includes('legume') ||
        text.includes('legumes') ||
        text.includes('carotte') ||
        text.includes('tomate') ||
        text.includes('oignon') ||
        text.includes('chou') ||
        text.includes('salade') ||

        // 🌾 base
        text.includes('farine') ||
        text.includes('riz') ||
        text.includes('haricot') ||
        text.includes('mais') ||
        text.includes('semoule') ||

        // 🥩 protéines
        text.includes('viande') ||
        text.includes('poisson') ||
        text.includes('poulet') ||
        text.includes('boeuf') ||
        text.includes('porc') ||

        // 🥛 lait
        text.includes('lait') ||
        text.includes('fromage') ||
        text.includes('yaourt') ||
        text.includes('beurre') ||

        // 🍰 sucré
        text.includes('gateau') ||
        text.includes('biscuit') ||
        text.includes('chocolat') ||
        text.includes('sucre') ||

        // 🥤 boissons
        text.includes('boisson') ||
        text.includes('jus') ||
        text.includes('eau') ||
        text.includes('coca') ||
        text.includes('fanta') ||
        text.includes('sprite') ||
        text.includes('biere') ||
        text.includes('vin') ||

        // 🍔 fast food
        text.includes('pizza') ||
        text.includes('burger') ||
        text.includes('sandwich') ||
        text.includes('shawarma') ||
        text.includes('fast food') ||

        // 🍽️ restaurant
        text.includes('restaurant') ||
        text.includes('menu') ||
        text.includes('cuisine')
      );
    });

    // ============================
    // 🧠 3. SCORING IA
    // ============================
    const scored = filtered.map(p => {
      let score = 0;

      // 🔥 boost
      if (p.is_boosted) score += 80;
      if (p.is_featured) score += 40;

      // 📊 engagement
      score += (p.likes_count || 0) * 3;
      score += (p.views_count || 0) * 1.5;
      score += (p.comments_count || 0) * 2;
      score += (p.sales || 0) * 6;

      // 💰 prix
      if (p.price < 10) score += 30;
      else if (p.price < 50) score += 15;

      // 🧠 popularité
      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score
      };
    });

    // ============================
    // 🔥 TRI
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT FINAL
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      condition: p.condition,
      stock: p.stock,
      score: p.score,
      ai_category: "food",

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      category: "food",
      ai_mode: true,
      products: result
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    console.error("❌ FOOD AI ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});




// ==============================
// GET /ai/services — FEED SERVICES (IA ULTRA INTELLIGENT)
// ==============================
router.get('/ai/services', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `ai:services:${page}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("⚡ CACHE SERVICES HIT");
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. RÉCUPÉRATION PRODUITS
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
      LIMIT 300
    `);

    // ============================
    // 🧠 2. FILTRE IA SERVICES (TRÈS PUISSANT)
    // ============================
    const filtered = products.filter(p => {
      const text = `${p.title} ${p.description}`.toLowerCase();

      return (
        // 🔧 SERVICES GÉNÉRAUX
        text.includes('service') ||
        text.includes('prestation') ||
        text.includes('travail') ||
        text.includes('mission') ||

        // 🛠️ TECHNIQUE
        text.includes('réparation') ||
        text.includes('reparation') ||
        text.includes('maintenance') ||
        text.includes('installation') ||
        text.includes('electricien') ||
        text.includes('plombier') ||
        text.includes('mecanicien') ||
        text.includes('garage') ||

        // 💻 DIGITAL
        text.includes('développement') ||
        text.includes('developpement') ||
        text.includes('site web') ||
        text.includes('application') ||
        text.includes('design') ||
        text.includes('graphisme') ||
        text.includes('marketing') ||
        text.includes('seo') ||
        text.includes('community manager') ||

        // 🚚 LOGISTIQUE
        text.includes('livraison') ||
        text.includes('transport') ||
        text.includes('chauffeur') ||
        text.includes('demenagement') ||
        text.includes('déménagement') ||

        // 🏠 MAISON
        text.includes('ménage') ||
        text.includes('nettoyage') ||
        text.includes('gardien') ||
        text.includes('sécurité') ||

        // 💇 BEAUTÉ SERVICES
        text.includes('coiffure') ||
        text.includes('coiffeur') ||
        text.includes('salon') ||
        text.includes('maquillage') ||
        text.includes('esthétique') ||

        // 📚 FORMATION
        text.includes('formation') ||
        text.includes('cours') ||
        text.includes('coach') ||
        text.includes('consultation') ||

        // 🍽️ RESTAURATION (SERVICE)
        text.includes('restaurant') ||
        text.includes('traiteur') ||
        text.includes('cuisine') ||

        // 🧑‍💼 BUSINESS
        text.includes('consultant') ||
        text.includes('expert') ||
        text.includes('freelance') ||
        text.includes('agence')
      );
    });

    // ============================
    // 🧠 3. SCORING IA SERVICES
    // ============================
    const scored = filtered.map(p => {
      let score = 0;

      // 🔥 boost
      if (p.is_boosted) score += 100;
      if (p.is_featured) score += 50;

      // 📊 engagement
      score += (p.likes_count || 0) * 3;
      score += (p.views_count || 0) * 2;
      score += (p.comments_count || 0) * 2;
      score += (p.sales || 0) * 5;

      // 💼 BONUS SERVICE (si mot fort)
      const text = `${p.title} ${p.description}`.toLowerCase();

      if (text.includes('service')) score += 40;
      if (text.includes('réparation') || text.includes('reparation')) score += 30;
      if (text.includes('livraison')) score += 25;
      if (text.includes('développement') || text.includes('developpement')) score += 35;

      // 🧠 popularité
      score += (p.popularity_score || 0) * 2;

      return {
        ...p,
        score
      };
    });

    // ============================
    // 🔥 TRI
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT FINAL
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      score: p.score,
      ai_category: "services",

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      category: "services",
      ai_mode: true,
      products: result
    };

    // ============================
    // ⚡ CACHE
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    console.error("❌ SERVICES AI ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});





// ==============================
// GET /ai/global — FEED GLOBAL IA (ULTRA INTELLIGENT)
// ==============================
router.get('/ai/global', async (req, res) => {
  try {
    const userId = req.headers.authorization ? req.userId : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const cacheKey = `ai:global:${userId || 'guest'}:${page}`;
    const cached = await redisClient.get(cacheKey);

    if (cached) {
      console.log("⚡ CACHE GLOBAL HIT");
      return res.json(JSON.parse(cached));
    }

    // ============================
    // 🧠 1. PRODUITS (TOUT)
    // ============================
    const [products] = await db.query(`
      SELECT 
        p.*,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,

        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
      LIMIT 300
    `);

    // ============================
    // 🧠 2. SCORING IA ULTRA
    // ============================
    const scored = products.map(p => {
      let score = 0;

      // 🔥 BOOST = priorité maximale
      if (p.is_boosted) score += 150;
      if (p.boost_priority) score += 80;

      // ⭐ FEATURED
      if (p.is_featured) score += 60;

      // 📊 ENGAGEMENT
      score += (p.likes_count || 0) * 4;
      score += (p.shares_count || 0) * 5;
      score += (p.comments_count || 0) * 3;
      score += (p.views_count || 0) * 1.5;

      // 💰 VENTES (TRÈS IMPORTANT)
      score += (p.sales || 0) * 10;

      // 🧠 POPULARITÉ GLOBALE
      score += (p.popularity_score || 0) * 3;

      // ⏱️ RÉCENCE (ULTRA IMPORTANT)
      const now = new Date();
      const createdAt = new Date(p.created_at);
      const hours = (now - createdAt) / (1000 * 60 * 60);

      if (hours < 1) score += 100;
      else if (hours < 24) score += 80;
      else if (hours < 72) score += 50;
      else if (hours < 168) score += 30; // 7 jours
      else score += 5;

      // 💸 PRIX INTELLIGENT
      if (p.price) {
        if (p.price < 20) score += 20;
        else if (p.price < 100) score += 10;
      }

      return {
        ...p,
        score
      };
    });

    // ============================
    // 🔥 TRI GLOBAL IA
    // ============================
    const sorted = scored.sort((a, b) => b.score - a.score);

    // ============================
    // 📄 PAGINATION
    // ============================
    const paginated = sorted.slice(offset, offset + limit);

    // ============================
    // 📦 FORMAT FINAL CLEAN
    // ============================
    const result = paginated.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price),
      image: p.image_url,
      location: p.location,
      score: p.score,
      boost: p.is_boosted ? true : false,
      created_at: p.created_at,

      seller: {
        name: p.seller_name,
        avatar: p.seller_avatar
      }
    }));

    const response = {
      success: true,
      page,
      count: result.length,
      has_more: offset + limit < sorted.length,
      ai_global: true,
      products: result
    };

    // ============================
    // ⚡ CACHE
    // ============================
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    console.error("❌ GLOBAL AI ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});





// ----------------------------
// GET /products — FEED PUBLIC
// ----------------------------
router.get('/', async (req, res) => {
  try {
    const userId = req.headers.authorization ? req.userId : null;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const parseJson = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value;
      try { return JSON.parse(value); } catch { return []; }
    };

    // Récupération des produits depuis la base
    const [products] = await db.query(`
      SELECT 
        p.*,
        (SELECT COUNT(*) FROM product_comments pc WHERE pc.product_id = p.id) AS comments_count,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.profile_photo AS seller_avatar,
        (SELECT JSON_ARRAYAGG(
            CASE
              WHEN pi.absolute_url IS NOT NULL AND pi.absolute_url != ''
              THEN pi.absolute_url
              ELSE pi.image_path
            END
          )
          FROM product_images pi
          WHERE pi.product_id = p.id
        ) AS image_urls,
        p.likes_count,
        p.shares_count,
        ${userId ? `EXISTS (
          SELECT 1 FROM product_likes pl
          WHERE pl.product_id = p.id AND pl.user_id = ${db.escape(userId)}
        )` : '0'} AS isLiked
      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
      ORDER BY 
        p.is_boosted DESC,
        p.boost_priority DESC,
        p.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM products WHERE is_active = 1`
    );

    const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

    // Formatage final pour le frontend
    const formatted = products.map(p => {
      const parsedImages = parseJson(p.image_urls).map(img =>
        img.startsWith("http") ? img : `${CLOUDINARY_BASE}${img}`
      );

      return {
        id: p.id.toString(),
        title: p.title,
        description: p.description,
        price: Number(p.price),
        original_price: p.original_price ? Number(p.original_price) : null,
        images: parsedImages,      // affichage front
        image_urls: parsedImages,  // communique correctement avec le frontend
        likes: p.likes_count || 0,
        shares: p.shares_count || 0,
        comments: p.comments_count || 0,
        isLiked: Boolean(p.isLiked),
        isPromotion: Boolean(p.is_boosted),
        seller: {
          id: p.seller_id?.toString(),
          name: p.seller_name || 'Vendeur inconnu',
          avatar: p.seller_avatar
            ? p.seller_avatar.startsWith('http')
              ? p.seller_avatar
              : `${req.protocol}://${req.get('host')}${p.seller_avatar}`
            : 'https://via.placeholder.com/40'
        }
      };
    });

    res.json({
      success: true,
      page,
      totalPages: Math.ceil(total / limit),
      products: formatted
    });

  } catch (err) {
    console.error('GET /products error:', err);
    res.status(500).json({ success: false });
  }
});




// ----------------------------
// POST /products — Création produit avec Cloudinary et boost auto pour Premium
// ----------------------------
router.post('/', authMiddleware, (req, res) => {
  upload(req, res, async (err) => {
    let connection;
    try {
      if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }

      const {
        title,
        price,
        original_price,
        category,
        condition,
        stock,
        location,
        description
      } = req.body;

      if (!title || title.trim().length < 3) throw new Error('Titre trop court');

      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice)) throw new Error('Prix invalide');

      const sellerId = req.userId;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // ------------------
      // Créer le produit
      // ------------------
      const productData = {
        title: title.trim(),
        description: description?.trim() || null,
        price: parsedPrice,
        original_price: original_price ? parseFloat(original_price) : null,
        category: category || 'autre',
        condition: condition || 'neuf',
        stock: stock ? parseInt(stock) : 0,
        location: location?.trim() || null,
        seller_id: sellerId,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        views_count: 0,
        is_boosted: 0 // par défaut
      };

      const [productResult] = await connection.query(
        'INSERT INTO products SET ?',
        [productData]
      );
      const productId = productResult.insertId;

      // ------------------
      // Upload images Cloudinary
      // ------------------
      let uploadedImages = [];
      if (req.files?.length > 0) {
        for (const file of req.files) {
          const uploadResult = await uploadToCloudinary(file.buffer, {
            folder: 'shopnet',
            resource_type: 'image',
            public_id: `product_${Date.now()}_${Math.floor(Math.random() * 10000)}`
          });

          await connection.query(
            'INSERT INTO product_images (product_id, image_path, absolute_url, is_primary, created_at) VALUES (?, ?, ?, ?, NOW())',
            [productId, uploadResult.public_id, uploadResult.secure_url, 1]
          );

          uploadedImages.push({
            public_id: uploadResult.public_id,
            url: uploadResult.secure_url,
          });
        }
      }

      // ------------------
      // Vérifier si le vendeur a une boutique Premium
      // ------------------
      const [premiumRows] = await connection.query(
        'SELECT id FROM boutiques_premium WHERE utilisateur_id = ? AND statut IN (?, ?)',
        [sellerId, 'validé', 'active']
      );

      if (premiumRows.length > 0) {
        // Auto-boost produit Premium
        const boostId = `BOOST_${Date.now()}_${Math.floor(Math.random()*10000)}`;
        const now = new Date();
        const endDate = new Date(now.getTime() + 24*60*60*1000); // boost 24h

        await connection.query(
          `INSERT INTO product_boosts
            (product_id, user_id, amount, duration_hours, start_date, end_date, status, boost_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [productId, sellerId, 0, 24, now, endDate, 'active', boostId, now]
        );

        await connection.query(
          'UPDATE products SET is_boosted = 1 WHERE id = ?',
          [productId]
        );
      }

      await connection.commit();
      connection.release();

      res.status(201).json({
        success: true,
        productId,
        images: uploadedImages,
        message: 'Produit créé avec succès' + (premiumRows.length > 0 ? ' et boosté automatiquement' : '')
      });

    } catch (error) {
      if (connection) {
        await connection.rollback();
        connection.release();
      }
      console.error('Erreur création produit:', error.message);
      res.status(400).json({ success: false, error: error.message });
    }
  });
});


// ===============================================
// ✅ DISCOVER - PAGE BOUTIQUE PUBLIQUE PAGINÉE  CETTE PAGE CE POUR LES DONNER DE BOUTIQUE COTER ACHETEUR
// ===============================================
// ===============================================
// ✅ DISCOVER - BOUTIQUE PUBLIQUE COMPLETE (TOUS PRODUITS)
/// ===============================================

router.get('/discover/shop/:id', async (req, res) => {
  try {
    const boutiqueId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;

    if (!boutiqueId || isNaN(boutiqueId)) {
      return res.status(400).json({
        success: false,
        message: "ID boutique invalide"
      });
    }

    // =========================
    // 1️⃣ BOUTIQUE + VENDEUR
    // =========================
    const [boutiqueRows] = await db.query(`
      SELECT 
        bp.*,
        u.id AS seller_id,
        u.fullName,
        u.email AS seller_email,
        u.phone AS seller_phone,
        u.profile_photo,
        u.rating,
        u.is_verified
      FROM boutiques_premium bp
      JOIN utilisateurs u ON bp.utilisateur_id = u.id
      WHERE bp.id = ?
      LIMIT 1
    `, [boutiqueId]);

    if (!boutiqueRows.length) {
      return res.status(404).json({
        success: false,
        message: "Boutique introuvable"
      });
    }

    const boutique = boutiqueRows[0];

    // =========================
    // 2️⃣ TOTAL PRODUITS (SANS FILTRE)
    // =========================
    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM products
      WHERE seller_id = ?
    `, [boutique.seller_id]);

    // =========================
    // 3️⃣ PRODUITS PAGINÉS
    // =========================
    const [products] = await db.query(`
      SELECT 
        p.*,
        COALESCE(
          (SELECT absolute_url 
           FROM product_images 
           WHERE product_id = p.id AND is_primary = 1 
           LIMIT 1),
          (SELECT absolute_url 
           FROM product_images 
           WHERE product_id = p.id 
           LIMIT 1),
          p.image_url
        ) AS primary_image
      FROM products p
      WHERE p.seller_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [boutique.seller_id, limit, offset]);

    const formattedProducts = products.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price) || 0,
      original_price: p.original_price
        ? parseFloat(p.original_price)
        : null,
      image: p.primary_image || null,
      stock: p.stock,
      condition: p.condition,
      likes: p.likes_count || 0,
      views: p.views_count || p.views || 0,
      sales: p.sales || 0,
      created_at: p.created_at
    }));

    // =========================
    // 4️⃣ RESPONSE
    // =========================
    res.json({
      success: true,
      boutique: {
        id: boutique.id,
        nom: boutique.nom,
        description: boutique.description,
        logo: boutique.logo,
        ville: boutique.ville,
        latitude: boutique.latitude,
        longitude: boutique.longitude
      },
      seller: {
        id: boutique.seller_id,
        nom: boutique.fullName,
        email: boutique.seller_email,
        phone: boutique.seller_phone,
        avatar: boutique.profile_photo,
        rating: boutique.rating || 0,
        verified: Boolean(boutique.is_verified)
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      products: formattedProducts
    });

  } catch (error) {
    console.error("Erreur boutique publique:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur"
    });
  }
});




// ===============================
// ✅ DISCOVER - DÉTAIL PRODUIT PUBLIC (CORRIGÉ)
// ===============================

router.get('/discover/product/:id', async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    if (!productId || isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID produit invalide'
      });
    }

    // =========================
    // 1️⃣ PRODUIT + VENDEUR + BOUTIQUE ACTIVE
    // =========================
    const [rows] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.phone AS seller_phone,
        u.email AS seller_email,
        u.address AS seller_address,
        u.latitude AS seller_latitude,
        u.longitude AS seller_longitude,

        bp.id AS boutique_id,
        bp.nom AS boutique_nom,
        bp.adresse AS boutique_adresse,
        bp.ville AS boutique_ville,
        bp.latitude AS boutique_latitude,
        bp.longitude AS boutique_longitude

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      LEFT JOIN boutiques_premium bp 
        ON bp.utilisateur_id = u.id 
        AND bp.statut IN ('validé','active')

      WHERE p.id = ?
      AND (p.is_active = 1 OR p.is_active IS NULL)
      LIMIT 1
    `, [productId]);

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Produit introuvable'
      });
    }

    const product = rows[0];

    // =========================
    // 2️⃣ IMAGES PRODUIT
    // =========================
    const [imagesRows] = await db.query(`
      SELECT absolute_url 
      FROM product_images
      WHERE product_id = ?
    `, [productId]);

    const images = imagesRows
      .filter(img => img.absolute_url)
      .map(img => img.absolute_url);

    // =========================
    // 3️⃣ PRODUITS SIMILAIRES (même catégorie)
    // =========================
    const [similarRaw] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url
      FROM products p
      WHERE p.category = ?
      AND p.id != ?
      AND (p.is_active = 1 OR p.is_active IS NULL)
      ORDER BY p.created_at DESC
      LIMIT 6
    `, [product.category, productId]);

    const similar = similarRaw.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price) || 0,
      image_url: p.image_url || null
    }));

    // =========================
    // 4️⃣ PRODUITS DU MÊME VENDEUR
    // =========================
    const [sameSellerRaw] = await db.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        (
          SELECT pi.absolute_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          LIMIT 1
        ) AS image_url
      FROM products p
      WHERE p.seller_id = ?
      AND p.id != ?
      AND (p.is_active = 1 OR p.is_active IS NULL)
      ORDER BY p.created_at DESC
      LIMIT 6
    `, [product.seller_id, productId]);

    const sameSeller = sameSellerRaw.map(p => ({
      id: p.id,
      title: p.title,
      price: parseFloat(p.price) || 0,
      image_url: p.image_url || null
    }));

    // =========================
    // 5️⃣ FORMATAGE FINAL
    // =========================
    res.json({
      success: true,
      product: {
        id: product.id,
        title: product.title,
        description: product.description,
        price: parseFloat(product.price) || 0,
        original_price: product.original_price
          ? parseFloat(product.original_price)
          : null,
        category: product.category,
        condition: product.condition,
        stock: parseInt(product.stock) || 0,
        location: product.location,
        created_at: product.created_at,
        latitude: product.latitude,
        longitude: product.longitude,
        images
      },
      boutique: product.boutique_id ? {
        id: product.boutique_id,
        nom: product.boutique_nom,
        adresse: product.boutique_adresse,
        ville: product.boutique_ville,
        latitude: product.boutique_latitude,
        longitude: product.boutique_longitude
      } : null,
      seller: {
        id: product.seller_id,
        nom: product.seller_name,
        phone: product.seller_phone,
        email: product.seller_email,
        adresse: product.seller_address,
        latitude: product.seller_latitude,
        longitude: product.seller_longitude
      },
      similar_products: similar,
      same_seller_products: sameSeller
    });

  } catch (error) {
    console.error('❌ Erreur GET /discover/product/:id:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
});





// Page de ID 




// ----------------------------
// DELETE /products/:id — Supprimer un produit
// ----------------------------// ----------------------------
// DELETE /products/:id — Supprimer un produit
// ----------------------------
router.delete('/:id', authMiddleware, async (req, res) => {
  const productId = req.params.id;       // ID du produit à supprimer
  const userId = req.userId;             // ID du vendeur depuis le token JWT
  let connection;

  try {
    connection = await db.getConnection();   // Connexion à la base
    await connection.beginTransaction();     // Démarrer une transaction pour sécurité

    // -------------------------
    // 1️⃣ Vérifier que le produit appartient bien à l’utilisateur
    // -------------------------
    const [rows] = await connection.query(
      'SELECT id FROM products WHERE id = ? AND seller_id = ? LIMIT 1',
      [productId, userId]
    );

    if (rows.length === 0) {
      await connection.release();
      return res.status(403).json({ success: false, error: "Vous n'êtes pas autorisé à supprimer ce produit" });
    }

    // -------------------------
    // 2️⃣ Supprimer toutes les entrées dans commande_produits
    // pour éviter les erreurs de foreign key
    // -------------------------
    await connection.query('DELETE FROM commande_produits WHERE produit_id = ?', [productId]);

    // -------------------------
    // 3️⃣ Supprimer toutes les images Cloudinary liées au produit
    // -------------------------
    const [images] = await connection.query(
      'SELECT image_path FROM product_images WHERE product_id = ?',
      [productId]
    );

    for (const img of images) {
      try {
        await cloudinary.uploader.destroy(img.image_path);
      } catch (err) {
        console.warn(`⚠️ Impossible de supprimer ${img.image_path} de Cloudinary :`, err.message);
      }
    }

    // -------------------------
    // 4️⃣ Supprimer les images en base
    // -------------------------
    await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId]);

    // -------------------------
    // 5️⃣ Enregistrer le produit supprimé dans la table log
    // -------------------------
    await connection.query(
      'INSERT INTO products_deleted_logs (product_id, seller_id) VALUES (?, ?)',
      [productId, userId]
    );

    // -------------------------
    // 6️⃣ Supprimer physiquement le produit
    // -------------------------
    await connection.query('DELETE FROM products WHERE id = ?', [productId]);

    // -------------------------
    // 7️⃣ Valider la transaction
    // -------------------------
    await connection.commit();
    connection.release();

    // -------------------------
    // 8️⃣ Réponse au frontend
    // -------------------------
    res.json({ success: true, message: 'Produit supprimé avec succès' });

  } catch (error) {
    // -------------------------
    // 9️⃣ Gestion des erreurs et rollback
    // -------------------------
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('Erreur DELETE /products/:id:', error.message);
    res.status(500).json({ success: false, error: "Erreur lors de la suppression du produit" });
  }
});



// Route pour le ID Proteger des produits de SHOPNET Deals
// ----------------------------
// GET /products/:id — Détail d’un produit (PROTÉGÉ)
// ----------------------------
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const productId = req.params.id;
    const userId = req.userId;

    const [rows] = await db.query(`
      SELECT 
        p.*,
        u.id AS seller_id,
        u.fullName AS seller_name,
        u.phone AS seller_phone,
        u.email AS seller_email,
        u.address AS seller_address,
        u.profile_photo AS seller_avatar,

        (SELECT COUNT(*) 
         FROM product_comments pc 
         WHERE pc.product_id = p.id) AS comments_count,

        (SELECT COUNT(*) 
         FROM product_likes pl 
         WHERE pl.product_id = p.id) AS likes_count,

        EXISTS (
          SELECT 1 
          FROM product_likes pl 
          WHERE pl.product_id = p.id 
          AND pl.user_id = ?
        ) AS isLiked,

        IFNULL(
          (SELECT JSON_ARRAYAGG(pi.image_path) 
           FROM product_images pi 
           WHERE pi.product_id = p.id),
        JSON_ARRAY()) AS images,

        IFNULL(
          (SELECT JSON_ARRAYAGG(pi.absolute_url) 
           FROM product_images pi 
           WHERE pi.product_id = p.id),
        JSON_ARRAY()) AS image_urls

      FROM products p
      LEFT JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.id = ?
      LIMIT 1
    `, [userId, productId]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Produit introuvable'
      });
    }

    const product = rows[0];

    const formatted = {
      id: product.id,
      title: product.title,
      description: product.description || null,
      price: parseFloat(product.price) || 0,
      original_price: product.original_price 
        ? parseFloat(product.original_price) 
        : null,
      category: product.category,
      condition: product.condition,
      stock: parseInt(product.stock) || 0,
      location: product.location,
      created_at: product.created_at,
      updated_at: product.updated_at,
      likes: product.likes_count || 0,
      comments: product.comments_count || 0,
      isLiked: Boolean(product.isLiked),
      images: product.images || [],
      image_urls: product.image_urls || [],
      seller: {
        id: product.seller_id?.toString() || null,
        name: product.seller_name || null,
        phone: product.seller_phone || null,
        email: product.seller_email || null,
        address: product.seller_address || null,
        avatar: product.seller_avatar
          ? (product.seller_avatar.startsWith('http')
              ? product.seller_avatar
              : `${req.protocol}://${req.get('host')}${product.seller_avatar}`)
          : null,
      }
    };

    res.json({
      success: true,
      product: formatted
    });

  } catch (error) {
    console.error('Erreur GET /products/:id:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur'
    });
  }
});





// =============================================================================
// ROUTE GET /api/products/:id/similar
// Description: Produits similaires (titre + catégorie + prix + GPS + popularité)
// =============================================================================
// =============================================================================
// ROUTE GET /api/products/:id/similar (PAGINATION + REDIS)
// =============================================================================

router.get('/:id/similar', authMiddleware, async (req, res) => {
  try {
    const productId = parseInt(req.params.id);

    // 📦 pagination
    const page = parseInt(req.query.page) || 1;
    const limit = 8;
    const offset = (page - 1) * limit;

    console.log(`📥 Similar request product=${productId} page=${page}`);

    // ================================
    // 🔥 CACHE REDIS CHECK
    // ================================
    const cacheKey = `similar:${productId}:page:${page}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("⚡ CACHE HIT Redis");
      return res.json(JSON.parse(cached));
    }

    // ================================
    // 1️⃣ PRODUIT ACTUEL
    // ================================
    const [currentRows] = await db.query(
      `SELECT * FROM products WHERE id = ? AND is_active = 1`,
      [productId]
    );

    if (!currentRows.length) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable"
      });
    }

    const product = currentRows[0];

    const title = (product.title || "").toLowerCase();
    const category = product.category;
    const price = parseFloat(product.price);

    const lat = product.latitude;
    const lon = product.longitude;

    // ================================
    // 2️⃣ KEYWORDS
    // ================================
    const keywords = title
      .split(" ")
      .filter(w => w.length > 2)
      .slice(0, 3);

    // ================================
    // 3️⃣ CANDIDATS PRODUITS
    // ================================
    const [candidates] = await db.query(
      `
      SELECT *
      FROM products
      WHERE id != ?
        AND is_active = 1
        AND category = ?
      LIMIT 120
      `,
      [productId, category]
    );

    // ================================
    // 4️⃣ SCORE + IMAGE MAP OPTIMISÉ
    // ================================
    const productIds = candidates.map(p => p.id);

    const [imgRows] = await db.query(
      `SELECT product_id, absolute_url 
       FROM product_images 
       WHERE product_id IN (?)`,
      [productIds]
    );

    const imageMap = {};
    imgRows.forEach(img => {
      if (!imageMap[img.product_id]) {
        imageMap[img.product_id] = img.absolute_url;
      }
    });

    const scored = candidates.map(p => {

      let score = 0;

      const pTitle = (p.title || "").toLowerCase();

      // 🧠 titre match
      keywords.forEach(k => {
        if (pTitle.includes(k)) score += 35;
      });

      // 🏷️ catégorie
      score += 20;

      // 💰 prix
      const diff = Math.abs(price - parseFloat(p.price));
      if (diff <= price * 0.15) score += 30;
      else if (diff <= price * 0.30) score += 15;
      else if (diff <= price * 0.50) score += 5;

      // 📍 distance GPS
      let distance = null;

      if (lat && lon && p.latitude && p.longitude) {
        const R = 6371;

        const dLat = (p.latitude - lat) * Math.PI / 180;
        const dLon = (p.longitude - lon) * Math.PI / 180;

        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(lat * Math.PI / 180) *
          Math.cos(p.latitude * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        distance = R * c;

        if (distance < 3) score += 40;
        else if (distance < 10) score += 25;
        else if (distance < 30) score += 10;
      }

      // 🔥 popularité
      score += (p.popularity_score || 0) * 2;

      // 🚀 boost
      if (p.is_boosted) score += 50;
      if (p.is_featured) score += 25;

      // 👀 ventes
      if (p.sales > 0) score += Math.min(p.sales * 2, 20);

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        price: parseFloat(p.price),
        category: p.category,
        location: p.location,
        image_url: imageMap[p.id] || null,
        latitude: p.latitude,
        longitude: p.longitude,
        popularity_score: p.popularity_score,
        is_boosted: p.is_boosted,
        is_featured: p.is_featured,
        sales: p.sales || 0,
        similarity_score: score,
        distance_km: distance
      };
    });

    // ================================
    // 5️⃣ TRI
    // ================================
    const sorted = scored
      .sort((a, b) => b.similarity_score - a.similarity_score);

    // ================================
    // 6️⃣ PAGINATION (8 PRODUITS)
    // ================================
    const paginated = sorted.slice(offset, offset + limit);

    // ================================
    // 7️⃣ RESPONSE
    // ================================
    const response = {
      success: true,
      product_id: productId,
      page,
      limit,
      has_more: offset + limit < sorted.length,
      count: paginated.length,
      total: sorted.length,
      keywords,
      products: paginated
    };

    // ================================
    // 8️⃣ CACHE REDIS SAVE (10 min)
    // ================================
    await redisClient.setEx(cacheKey, 600, JSON.stringify(response));

    return res.json(response);

  } catch (error) {
    console.error("❌ Similar error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur"
    });
  }
});

module.exports = router;

