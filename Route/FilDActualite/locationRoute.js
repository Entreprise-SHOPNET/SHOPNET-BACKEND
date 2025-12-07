

// routes/location/locationRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../db'); // ta connexion existante (mysql2/promise recommandé)
const authMiddleware = require('../../middlewares/authMiddleware');

/**
 * Utilitaires
 */
function getUserIdFromReq(req) {
  // support req.user.id or req.userId
  return (req.user && req.user.id) || req.userId || null;
}


/**
 * NOTE: on utilise ST_PointFromText / ST_Distance_Sphere pour calcul côté DB (beaucoup plus rapide si index spatial présent).
 * Si ta version MySQL ne supporte pas ST_Distance_Sphere, on peut basculer sur calcul Haversine en JS.
 */

/**
 * Endpoint: enregistrer / mettre à jour la position d'un vendeur
 * POST /api/location/vendeur
 * Body: { latitude: number, longitude: number }
 * Auth required
 */
router.post('/vendeur', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'latitude and longitude required as numbers' });
    }

    // Upsert into vendeur_locations (latitude, longitude, location POINT)
    const sql = `
      INSERT INTO vendeur_locations (user_id, latitude, longitude, location, updated_at)
      VALUES (?, ?, ?, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')')), NOW())
      ON DUPLICATE KEY UPDATE
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        location = VALUES(location),
        updated_at = NOW()
    `;
    await db.execute(sql, [userId, latitude, longitude, longitude, latitude]); // note: WKT POINT expects "X Y" -> lon lat

    return res.json({ success: true, message: 'Vendeur position saved' });
  } catch (err) {
    console.error('Error /location/vendeur', err);
    return res.status(500).json({ success: false, message: 'Server error', details: err.message });
  }
});

/**
 * Endpoint: enregistrer / mettre à jour la position d'un client
 * POST /api/location/client
 * Body: { latitude, longitude }
 * Auth required
 */
router.post('/client', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'latitude and longitude required as numbers' });
    }

    const sql = `
      INSERT INTO client_locations (user_id, latitude, longitude, location, updated_at)
      VALUES (?, ?, ?, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')')), NOW())
      ON DUPLICATE KEY UPDATE
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        location = VALUES(location),
        updated_at = NOW()
    `;
    await db.execute(sql, [userId, latitude, longitude, longitude, latitude]);

    return res.json({ success: true, message: 'Client position saved' });
  } catch (err) {
    console.error('Error /location/client', err);
    return res.status(500).json({ success: false, message: 'Server error', details: err.message });
  }
});

/**
 * Endpoint: vendeurs proches (option: category filter, limit, page, rayon_km)
 * POST /api/location/vendeurs-proches
 * Body: { latitude, longitude, rayon_km = 10, limit = 20, page = 1, category? }
 * Public or Auth (no auth required here, but you can add authMiddleware if desired)
 */
router.post('/vendeurs-proches', async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      rayon_km = 10,
      limit = 20,
      page = 1,
      category = null, // optional: only show sellers offering a category
    } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'latitude and longitude required' });
    }

    const offset = (page - 1) * limit;

    // We calculate distance in meters using ST_Distance_Sphere (returns meters)
    // Filter sellers where distance <= rayon_km * 1000
    // Optionally join products/categories to filter sellers who have products in the category
    let baseSql = `
      SELECT v.user_id AS seller_id, v.latitude, v.longitude,
        ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) AS distance_m,
        u.fullName AS seller_name, u.profile_photo
      FROM vendeur_locations v
      JOIN utilisateurs u ON u.id = v.user_id
    `;
    const params = [longitude, latitude]; // WKT POINT(lon lat)

    if (category) {
      baseSql += `
        JOIN products p ON p.seller_id = v.user_id AND p.category = ?
      `;
      params.push(category);
    }

    baseSql += `
      WHERE ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) <= ?
      GROUP BY v.user_id
      ORDER BY distance_m ASC
      LIMIT ? OFFSET ?
    `;
    params.push(longitude, latitude, rayon_km * 1000, limit, offset);

    const [rows] = await db.execute(baseSql, params);

    // map to user-friendly structure, convert meters -> km
    const result = rows.map((r) => ({
      seller_id: r.seller_id,
      seller_name: r.seller_name,
      profile_photo: r.profile_photo,
      latitude: r.latitude,
      longitude: r.longitude,
      distance_km: Number((r.distance_m / 1000).toFixed(3)),
    }));

    return res.json({ success: true, count: result.length, page, limit, sellers: result });
  } catch (err) {
    console.error('Error /location/vendeurs-proches', err);
    return res.status(500).json({ success: false, message: 'Server error', details: err.message });
  }
});

/**
 * Endpoint: produits proches
 * POST /api/location/produits-proches
 * Body: { latitude, longitude, rayon_km = 10, limit = 20, page = 1, category?, min_price?, max_price?, q? }
 */
router.post('/produits-proches', async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      rayon_km = 10,
      limit = 20,
      page = 1,
      category = null,
      min_price = null,
      max_price = null,
      q = null, // search query
    } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'latitude and longitude required' });
    }

    const offset = (page - 1) * limit;

    // Build SQL with optional filters
    let sql = `
      SELECT p.id AS product_id, p.title, p.price, p.category, p.stock, p.seller_id,
        v.latitude, v.longitude,
        ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) AS distance_m,
        u.fullName AS seller_name, u.profile_photo AS seller_avatar
      FROM products p
      JOIN vendeur_locations v ON v.user_id = p.seller_id
      JOIN utilisateurs u ON u.id = p.seller_id
      WHERE ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) <= ?
    `;
    const params = [longitude, latitude, longitude, latitude, rayon_km * 1000];

    if (category) {
      sql += ' AND p.category = ? ';
      params.push(category);
    }
    if (min_price !== null) {
      sql += ' AND p.price >= ? ';
      params.push(min_price);
    }
    if (max_price !== null) {
      sql += ' AND p.price <= ? ';
      params.push(max_price);
    }
    if (q) {
      sql += ' AND (p.title LIKE ? OR p.description LIKE ?) ';
      params.push(`%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY distance_m ASC, p.created_at DESC LIMIT ? OFFSET ? ';
    params.push(limit, offset);

    const [rows] = await db.execute(sql, params);

    const products = rows.map((r) => ({
      product_id: r.product_id,
      title: r.title,
      price: r.price,
      category: r.category,
      stock: r.stock,
      seller: {
        id: r.seller_id,
        name: r.seller_name,
        avatar: r.seller_avatar,
      },
      location: { latitude: r.latitude, longitude: r.longitude },
      distance_km: Number((r.distance_m / 1000).toFixed(3)),
    }));

    return res.json({ success: true, count: products.length, page, limit, products });
  } catch (err) {
    console.error('Error /location/produits-proches', err);
    return res.status(500).json({ success: false, message: 'Server error', details: err.message });
  }
});

/**
 * Endpoint: amis proches (réseau social) — renvoie amis qui sont géolocalisés et proches
 * POST /api/location/amis-proches
 * Body: { latitude, longitude, rayon_km = 5, limit = 50 }
 * Auth required
 */
router.post('/amis-proches', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { latitude, longitude, rayon_km = 5, limit = 50, page = 1 } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'latitude and longitude required' });
    }
    const offset = (page - 1) * limit;

    // Suppose you have a friends table with (user_id, friend_id, status = 'accepted')
    const sql = `
      SELECT u.id AS friend_id, u.fullName AS friend_name, ul.latitude, ul.longitude,
        ST_Distance_Sphere(ul.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) AS distance_m,
        u.profile_photo
      FROM friendships f
      JOIN utilisateurs u ON u.id = f.friend_id
      JOIN utilisateur_locations ul ON ul.user_id = u.id
      WHERE f.user_id = ? AND f.status = 'accepted'
        AND ST_Distance_Sphere(ul.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) <= ?
      ORDER BY distance_m ASC
      LIMIT ? OFFSET ?
    `;
    const params = [longitude, latitude, userId, longitude, latitude, rayon_km * 1000, limit, offset];

    const [rows] = await db.execute(sql, params);

    const friends = rows.map((r) => ({
      id: r.friend_id,
      name: r.friend_name,
      avatar: r.profile_photo,
      location: { latitude: r.latitude, longitude: r.longitude },
      distance_km: Number((r.distance_m / 1000).toFixed(3)),
    }));

    return res.json({ success: true, count: friends.length, friends, page, limit });
  } catch (err) {
    console.error('Error /location/amis-proches', err);
    return res.status(500).json({ success: false, message: 'Server error', details: err.message });
  }
});

/**
 * Endpoint: feed géographique (produits & vendeurs mixtes) — propose contenu proche et pertinent
 * POST /api/location/geofeed
 * Body: { latitude, longitude, rayon_km=20, limit=30, page=1, category? }
 */
router.post('/geofeed', async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      rayon_km = 20,
      limit = 30,
      page = 1,
      category = null
    } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ success: false, message: 'latitude and longitude required' });
    }
    const offset = (page - 1) * limit;

    // Example: union produits proches + vendeurs populaires proches
    // 1) produits
    let prodSql = `
      SELECT 'product' AS type, p.id AS id, p.title AS title, p.price AS price,
        p.seller_id AS owner_id,
        ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) AS distance_m,
        p.created_at AS created_at
      FROM products p
      JOIN vendeur_locations v ON v.user_id = p.seller_id
      WHERE ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) <= ?
    `;
    const prodParams = [longitude, latitude, longitude, latitude, rayon_km * 1000];
    if (category) {
      prodSql += ' AND p.category = ? ';
      prodParams.push(category);
    }

    // 2) vendeurs populaires
    const sellerSql = `
      SELECT 'seller' AS type, u.id AS id, u.fullName AS title, NULL AS price,
        u.id AS owner_id,
        ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) AS distance_m,
        u.updated_at AS created_at
      FROM vendeur_locations v
      JOIN utilisateurs u ON u.id = v.user_id
      WHERE ST_Distance_Sphere(v.location, ST_GeomFromText(CONCAT('POINT(', ?, ' ', ?, ')'))) <= ?
    `;
    const sellerParams = [longitude, latitude, longitude, latitude, rayon_km * 1000];

    // Run both queries and merge in JS (simple approach)
    const [prodRows] = await db.execute(prodSql + ' ORDER BY distance_m ASC LIMIT ? OFFSET ?', [...prodParams, limit, offset]);
    const [sellerRows] = await db.execute(sellerSql + ' ORDER BY distance_m ASC LIMIT ? OFFSET ?', [...sellerParams, limit, offset]);

    const merged = [
      ...prodRows.map(r => ({ ...r, distance_km: Number((r.distance_m / 1000).toFixed(3)) })),
      ...sellerRows.map(r => ({ ...r, distance_km: Number((r.distance_m / 1000).toFixed(3)) }))
    ];

    // sort merged by distance and limit final results
    merged.sort((a,b) => a.distance_m - b.distance_m);
    const final = merged.slice(0, limit);

    return res.json({ success: true, count: final.length, page, limit, items: final });
  } catch (err) {
    console.error('Error /location/geofeed', err);
    return res.status(500).json({ success: false, message: 'Server error', details: err.message });
  }
});

module.exports = router;
