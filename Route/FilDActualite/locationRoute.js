

const express = require('express');
const router = express.Router();
const db = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const redis = require('redis');
const geoLib = require('geolib');
const { v4: uuidv4 } = require('uuid');

// Configuration Redis
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect();

/**
 * Fonctions utilitaires
 */
function getUserIdFromReq(req) {
  return (req.user && req.user.id) || req.userId || null;
}

function validateCoordinates(lat, lng) {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function calculateBoundingBox(lat, lng, radiusKm) {
  const earthRadius = 6371;
  const latDelta = (radiusKm / earthRadius) * (180 / Math.PI);
  const lngDelta = (radiusKm / (earthRadius * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI);
  
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta
  };
}

// Cache middleware
async function cacheLocationData(req, res, next) {
  const cacheKey = `geoloc:${req.originalUrl}:${JSON.stringify(req.body)}`;
  
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    res.locals.cacheKey = cacheKey;
    next();
  } catch (err) {
    console.error('Redis cache error:', err);
    next();
  }
}

/**
 * 1. Mise à jour position utilisateur
 */
router.post('/update-position', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { latitude, longitude, accuracy = 0, speed = 0, timestamp = Date.now() } = req.body;
    
    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    // Mettre à jour la position dans utilisateurs
    const updateSql = `
      UPDATE utilisateurs 
      SET latitude = ?, longitude = ?, updated_at = NOW()
      WHERE id = ?
    `;
    
    await db.execute(updateSql, [latitude, longitude, userId]);

    // Enregistrer dans l'historique des positions
    const insertHistory = `
      INSERT INTO user_locations_history 
        (user_id, latitude, longitude, accuracy, speed, recorded_at)
      VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(?))
    `;
    
    await db.execute(insertHistory, [
      userId, latitude, longitude, accuracy, speed, timestamp / 1000
    ]);

    // Mettre à jour le cache Redis
    await redisClient.geoAdd('locations:all_users', {
      longitude,
      latitude,
      member: `user:${userId}`
    });

    return res.json({ 
      success: true, 
      message: 'Position mise à jour',
      timestamp 
    });
  } catch (err) {
    console.error('Error updating position:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 2. Produits les plus proches
 */
router.post('/nearby-products', cacheLocationData, async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      radius_km = 5,
      limit = 20,
      page = 1,
      category = null,
      min_price = null,
      max_price = null,
      condition = null,
      sort_by = 'distance', // distance, newest, price_asc, price_desc, popular
      min_rating = 0,
      only_featured = false,
      only_boosted = false
    } = req.body;

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    const offset = (page - 1) * limit;
    const bbox = calculateBoundingBox(latitude, longitude, radius_km);

    let sql = `
      SELECT 
        p.*,
        u.fullName as seller_name,
        u.avatar as seller_avatar,
        u.rating as seller_rating,
        u.is_verified as seller_verified,
        (
          SELECT pi.absolute_url 
          FROM product_images pi 
          WHERE pi.product_id = p.id AND pi.is_primary = 1 
          LIMIT 1
        ) as primary_image,
        (
          SELECT COUNT(*) 
          FROM product_likes pl 
          WHERE pl.product_id = p.id
        ) as total_likes,
        (
          SELECT COUNT(*) 
          FROM product_comments pc 
          WHERE pc.product_id = p.id
        ) as total_comments,
        (
          6371 * ACOS(
            COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
            COS(RADIANS(p.longitude) - RADIANS(?)) + 
            SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
          )
        ) as distance_km
      FROM products p
      JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
        AND p.latitude IS NOT NULL
        AND p.longitude IS NOT NULL
        AND p.latitude BETWEEN ? AND ?
        AND p.longitude BETWEEN ? AND ?
    `;

    const params = [
      latitude, longitude, latitude,
      bbox.minLat, bbox.maxLat,
      bbox.minLng, bbox.maxLng
    ];

    // Filtres
    if (category) {
      sql += ' AND p.category = ?';
      params.push(category);
    }
    
    if (min_price !== null) {
      sql += ' AND p.price >= ?';
      params.push(min_price);
    }
    
    if (max_price !== null) {
      sql += ' AND p.price <= ?';
      params.push(max_price);
    }
    
    if (condition) {
      sql += ' AND p.condition = ?';
      params.push(condition);
    }
    
    if (min_rating > 0) {
      sql += ' AND u.rating >= ?';
      params.push(min_rating);
    }
    
    if (only_featured) {
      sql += ' AND p.is_featured = 1';
    }
    
    if (only_boosted) {
      sql += ' AND p.is_boosted = 1 AND p.boost_end > NOW()';
    }

    // Filtre par distance
    sql += ' HAVING distance_km <= ?';
    params.push(radius_km);

    // Tri
    switch (sort_by) {
      case 'distance':
        sql += ' ORDER BY distance_km ASC';
        break;
      case 'newest':
        sql += ' ORDER BY p.created_at DESC';
        break;
      case 'price_asc':
        sql += ' ORDER BY p.price ASC';
        break;
      case 'price_desc':
        sql += ' ORDER BY p.price DESC';
        break;
      case 'popular':
        sql += ' ORDER BY p.popularity_score DESC';
        break;
      default:
        sql += ' ORDER BY distance_km ASC';
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [products] = await db.execute(sql, params);

    // Enrichir les données
    const enrichedProducts = await Promise.all(products.map(async product => {
      // Récupérer toutes les images
      const [images] = await db.execute(
        'SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC',
        [product.id]
      );

      // Récupérer les tags
      const [tags] = await db.execute(`
        SELECT t.name 
        FROM tags t
        JOIN product_tags pt ON t.id = pt.tag_id
        WHERE pt.product_id = ?
      `, [product.id]);

      // Récupérer la boutique
      const [boutique] = await db.execute(
        'SELECT * FROM boutiques WHERE proprietaire_id = ? LIMIT 1',
        [product.seller_id]
      );

      return {
        ...product,
        images,
        tags: tags.map(t => t.name),
        boutique: boutique[0] || null,
        discount_percent: product.original_price ? 
          Math.round((1 - product.price / product.original_price) * 100) : 0,
        is_super_near: product.distance_km <= 1,
        is_near: product.distance_km <= 3
      };
    }));

    // Calculer les métriques
    const totalInRadius = await db.execute(`
      SELECT COUNT(*) as count
      FROM products p
      WHERE p.is_active = 1
        AND p.latitude BETWEEN ? AND ?
        AND p.longitude BETWEEN ? AND ?
        AND (6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
          COS(RADIANS(p.longitude) - RADIANS(?)) + 
          SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
        )) <= ?
    `, [
      bbox.minLat, bbox.maxLat,
      bbox.minLng, bbox.maxLng,
      latitude, longitude, latitude,
      radius_km
    ]);

    const response = {
      success: true,
      count: enrichedProducts.length,
      page,
      limit,
      total_in_radius: totalInRadius[0][0].count,
      radius_km,
      location: { latitude, longitude },
      products: enrichedProducts
    };

    // Mettre en cache
    if (res.locals.cacheKey) {
      await redisClient.setEx(res.locals.cacheKey, 30, JSON.stringify(response));
    }

    return res.json(response);
  } catch (err) {
    console.error('Nearby products error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 3. Nouveaux produits proches (24h)
 */
router.post('/new-products-nearby', cacheLocationData, async (req, res) => {
  try {
    const { latitude, longitude, radius_km = 5, limit = 15 } = req.body;
    
    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    const bbox = calculateBoundingBox(latitude, longitude, radius_km);

    const sql = `
      SELECT 
        p.*,
        u.fullName as seller_name,
        u.avatar as seller_avatar,
        (
          SELECT pi.absolute_url 
          FROM product_images pi 
          WHERE pi.product_id = p.id AND pi.is_primary = 1 
          LIMIT 1
        ) as primary_image,
        (
          6371 * ACOS(
            COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
            COS(RADIANS(p.longitude) - RADIANS(?)) + 
            SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
          )
        ) as distance_km,
        TIMESTAMPDIFF(HOUR, p.created_at, NOW()) as hours_ago
      FROM products p
      JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.is_active = 1
        AND p.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND p.latitude BETWEEN ? AND ?
        AND p.longitude BETWEEN ? AND ?
      HAVING distance_km <= ?
      ORDER BY p.created_at DESC, distance_km ASC
      LIMIT ?
    `;

    const [products] = await db.execute(sql, [
      latitude, longitude, latitude,
      bbox.minLat, bbox.maxLat,
      bbox.minLng, bbox.maxLng,
      radius_km,
      limit
    ]);

    return res.json({
      success: true,
      count: products.length,
      products: products.map(p => ({
        ...p,
        is_super_new: p.hours_ago < 2,
        is_today: p.hours_ago < 24
      }))
    });
  } catch (err) {
    console.error('New products error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 4. Vendeurs proches
 */
router.post('/nearby-sellers', cacheLocationData, async (req, res) => {
  try {
    const { 
      latitude, 
      longitude, 
      radius_km = 10,
      min_rating = 0,
      category = null,
      only_verified = false
    } = req.body;

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    const bbox = calculateBoundingBox(latitude, longitude, radius_km);

    let sql = `
      SELECT 
        u.id,
        u.fullName,
        u.avatar,
        u.rating,
        u.is_verified,
        u.description,
        u.ville,
        u.latitude,
        u.longitude,
        (
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.seller_id = u.id 
            AND p.is_active = 1
        ) as total_products,
        (
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.seller_id = u.id 
            AND p.is_active = 1
            AND p.is_featured = 1
        ) as featured_products,
        (
          SELECT AVG(p.price) 
          FROM products p 
          WHERE p.seller_id = u.id 
            AND p.is_active = 1
        ) as avg_price,
        (
          6371 * ACOS(
            COS(RADIANS(?)) * COS(RADIANS(u.latitude)) * 
            COS(RADIANS(u.longitude) - RADIANS(?)) + 
            SIN(RADIANS(?)) * SIN(RADIANS(u.latitude))
          )
        ) as distance_km,
        (
          SELECT b.nom 
          FROM boutiques b 
          WHERE b.proprietaire_id = u.id 
          LIMIT 1
        ) as boutique_nom
      FROM utilisateurs u
      WHERE u.role = 'vendeur'
        AND u.latitude IS NOT NULL
        AND u.longitude IS NOT NULL
        AND u.latitude BETWEEN ? AND ?
        AND u.longitude BETWEEN ? AND ?
    `;

    const params = [
      latitude, longitude, latitude,
      bbox.minLat, bbox.maxLat,
      bbox.minLng, bbox.maxLng
    ];

    if (min_rating > 0) {
      sql += ' AND u.rating >= ?';
      params.push(min_rating);
    }

    if (only_verified) {
      sql += ' AND u.is_verified = 1';
    }

    sql += ' HAVING distance_km <= ? ORDER BY distance_km ASC';
    params.push(radius_km);

    const [sellers] = await db.execute(sql, params);

    // Enrichir avec les catégories
    const enrichedSellers = await Promise.all(sellers.map(async seller => {
      // Catégories des produits du vendeur
      const [categories] = await db.execute(`
        SELECT DISTINCT p.category, COUNT(*) as product_count
        FROM products p
        WHERE p.seller_id = ? AND p.is_active = 1
        GROUP BY p.category
        ORDER BY product_count DESC
        LIMIT 5
      `, [seller.id]);

      // Produits récents
      const [recentProducts] = await db.execute(`
        SELECT p.id, p.title, p.price, p.created_at
        FROM products p
        WHERE p.seller_id = ? AND p.is_active = 1
        ORDER BY p.created_at DESC
        LIMIT 3
      `, [seller.id]);

      // Statistiques de commandes
      const [ordersStats] = await db.execute(`
        SELECT 
          COUNT(*) as total_orders,
          AVG(total) as avg_order_value,
          SUM(total) as total_revenue
        FROM commandes
        WHERE vendeur_id = ? 
          AND status IN ('confirmee', 'en_cours', 'livree')
      `, [seller.id]);

      return {
        ...seller,
        categories,
        recent_products: recentProducts,
        orders_stats: ordersStats[0] || { total_orders: 0, avg_order_value: 0, total_revenue: 0 },
        response_time: calculateResponseTime(seller.rating, seller.total_products),
        activity_status: getSellerActivityStatus(seller.id)
      };
    }));

    return res.json({
      success: true,
      count: enrichedSellers.length,
      radius_km,
      sellers: enrichedSellers
    });
  } catch (err) {
    console.error('Nearby sellers error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 5. Clients/Acheteurs proches (pour vendeurs)
 */
router.post('/nearby-buyers', authMiddleware, async (req, res) => {
  try {
    const sellerId = getUserIdFromReq(req);
    const { 
      latitude, 
      longitude, 
      radius_km = 5,
      min_orders = 0
    } = req.body;

    // Vérifier que c'est un vendeur
    const [userCheck] = await db.execute(
      'SELECT role FROM utilisateurs WHERE id = ?',
      [sellerId]
    );

    if (userCheck[0].role !== 'vendeur') {
      return res.status(403).json({ success: false, message: 'Accès réservé aux vendeurs' });
    }

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    const bbox = calculateBoundingBox(latitude, longitude, radius_km);

    const sql = `
      SELECT 
        u.id,
        u.fullName,
        u.avatar,
        u.rating,
        u.ville,
        u.latitude,
        u.longitude,
        (
          SELECT COUNT(*) 
          FROM commandes c 
          WHERE c.acheteur_id = u.id 
            AND c.vendeur_id = ?
            AND c.status IN ('confirmee', 'en_cours', 'livree')
        ) as orders_with_you,
        (
          SELECT SUM(total) 
          FROM commandes c 
          WHERE c.acheteur_id = u.id 
            AND c.vendeur_id = ?
        ) as total_spent_with_you,
        (
          6371 * ACOS(
            COS(RADIANS(?)) * COS(RADIANS(u.latitude)) * 
            COS(RADIANS(u.longitude) - RADIANS(?)) + 
            SIN(RADIANS(?)) * SIN(RADIANS(u.latitude))
          )
        ) as distance_km,
        (
          SELECT COUNT(*) 
          FROM product_views pv
          JOIN products p ON pv.product_id = p.id
          WHERE pv.user_id = u.id 
            AND p.seller_id = ?
            AND pv.viewed_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        ) as recent_views
      FROM utilisateurs u
      WHERE u.role = 'acheteur'
        AND u.latitude IS NOT NULL
        AND u.longitude IS NOT NULL
        AND u.latitude BETWEEN ? AND ?
        AND u.longitude BETWEEN ? AND ?
      HAVING distance_km <= ? AND orders_with_you >= ?
      ORDER BY recent_views DESC, distance_km ASC
    `;

    const [buyers] = await db.execute(sql, [
      sellerId, sellerId,
      latitude, longitude, latitude,
      sellerId,
      bbox.minLat, bbox.maxLat,
      bbox.minLng, bbox.maxLng,
      radius_km, min_orders
    ]);

    // Enrichir avec les intérêts
    const enrichedBuyers = await Promise.all(buyers.map(async buyer => {
      // Catégories d'intérêt
      const [interestCategories] = await db.execute(`
        SELECT DISTINCT p.category, COUNT(*) as view_count
        FROM product_views pv
        JOIN products p ON pv.product_id = p.id
        WHERE pv.user_id = ? 
          AND pv.viewed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY p.category
        ORDER BY view_count DESC
        LIMIT 3
      `, [buyer.id]);

      // Dernières commandes
      const [recentOrders] = await db.execute(`
        SELECT c.id, c.total, c.date_commande, c.status
        FROM commandes c
        WHERE c.acheteur_id = ? 
          AND c.vendeur_id = ?
        ORDER BY c.date_commande DESC
        LIMIT 5
      `, [buyer.id, sellerId]);

      // Produits recommandés pour cet acheteur
      const [recommendedProducts] = await db.execute(`
        SELECT p.id, p.title, p.price, p.category
        FROM products p
        WHERE p.seller_id = ? 
          AND p.is_active = 1
          AND p.stock > 0
          AND p.category IN (
            SELECT DISTINCT p2.category 
            FROM product_views pv2
            JOIN products p2 ON pv2.product_id = p2.id
            WHERE pv2.user_id = ?
          )
        ORDER BY p.popularity_score DESC
        LIMIT 5
      `, [sellerId, buyer.id]);

      return {
        ...buyer,
        interest_categories: interestCategories,
        recent_orders: recentOrders,
        recommended_products: recommendedProducts,
        buyer_score: calculateBuyerScore(buyer),
        last_interaction: await getLastInteraction(buyer.id, sellerId)
      };
    }));

    return res.json({
      success: true,
      count: enrichedBuyers.length,
      radius_km,
      buyers: enrichedBuyers,
      analytics: {
        total_potential: enrichedBuyers.length,
        avg_distance: enrichedBuyers.reduce((sum, b) => sum + b.distance_km, 0) / enrichedBuyers.length,
        repeat_customers: enrichedBuyers.filter(b => b.orders_with_you > 1).length
      }
    });
  } catch (err) {
    console.error('Nearby buyers error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 6. Itinéraire vers un produit/vendeur
 */
router.post('/navigation', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const {
      start_latitude,
      start_longitude,
      end_latitude,
      end_longitude,
      product_id = null,
      seller_id = null,
      mode = 'driving' // driving, walking, cycling
    } = req.body;

    if (!validateCoordinates(start_latitude, start_longitude) || 
        !validateCoordinates(end_latitude, end_longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    // Calculer la distance
    const distance = geoLib.getDistance(
      { latitude: start_latitude, longitude: start_longitude },
      { latitude: end_latitude, longitude: end_longitude }
    );

    // Temps estimé basé sur le mode
    const modeSpeeds = {
      walking: 5,
      driving: 40,
      cycling: 15
    };

    const speed = modeSpeeds[mode] || modeSpeeds.driving;
    const estimatedMinutes = (distance / 1000 / speed) * 60;

    // Récupérer les informations
    let destinationInfo = null;
    
    if (product_id) {
      const [product] = await db.execute(`
        SELECT p.*, u.fullName as seller_name, u.phone as seller_phone
        FROM products p
        JOIN utilisateurs u ON p.seller_id = u.id
        WHERE p.id = ?
      `, [product_id]);
      
      if (product[0]) {
        destinationInfo = {
          type: 'product',
          title: product[0].title,
          seller_name: product[0].seller_name,
          seller_phone: product[0].seller_phone,
          price: product[0].price,
          address: product[0].location
        };
      }
    } else if (seller_id) {
      const [seller] = await db.execute(`
        SELECT u.*, b.nom as boutique_nom, b.adresse as boutique_adresse
        FROM utilisateurs u
        LEFT JOIN boutiques b ON u.id = b.proprietaire_id
        WHERE u.id = ?
      `, [seller_id]);
      
      if (seller[0]) {
        destinationInfo = {
          type: 'seller',
          name: seller[0].fullName,
          boutique: seller[0].boutique_nom,
          address: seller[0].boutique_adresse || seller[0].address,
          phone: seller[0].phone
        };
      }
    }

    // Générer des instructions simples
    const instructions = generateSimpleInstructions(
      { lat: start_latitude, lng: start_longitude },
      { lat: end_latitude, lng: end_longitude },
      distance
    );

    // Sauvegarder la navigation
    const routeId = uuidv4();
    await db.execute(`
      INSERT INTO navigation_history 
        (user_id, route_id, start_lat, start_lng, end_lat, end_lng, 
         distance_m, estimated_minutes, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      userId, routeId,
      start_latitude, start_longitude,
      end_latitude, end_longitude,
      distance, Math.ceil(estimatedMinutes),
      mode
    ]);

    return res.json({
      success: true,
      route_id: routeId,
      distance: {
        meters: distance,
        kilometers: (distance / 1000).toFixed(2),
        miles: (distance / 1609.34).toFixed(2)
      },
      estimated_time: {
        minutes: Math.ceil(estimatedMinutes),
        formatted: formatDuration(Math.ceil(estimatedMinutes))
      },
      navigation: {
        mode,
        instructions,
        start: { lat: start_latitude, lng: start_longitude },
        end: { lat: end_latitude, lng: end_longitude }
      },
      destination: destinationInfo,
      safety_tips: generateSafetyTips(mode, estimatedMinutes)
    });
  } catch (err) {
    console.error('Navigation error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 7. Localisation précise avec géofencing
 */
router.post('/precise-location', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { 
      latitude, 
      longitude, 
      accuracy,
      altitude = null,
      heading = null,
      speed = null,
      activity = 'unknown'
    } = req.body;

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Coordonnées invalides' 
      });
    }

    if (accuracy > 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Précision insuffisante',
        current_accuracy: accuracy,
        required_accuracy: '≤ 100m'
      });
    }

    // Enregistrer la position précise
    await db.execute(`
      INSERT INTO precise_locations 
        (user_id, latitude, longitude, accuracy, altitude, 
         heading, speed, activity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [userId, latitude, longitude, accuracy, altitude, heading, speed, activity]);

    // Vérifier les géofences
    const triggeredGeofences = await checkGeofences(userId, latitude, longitude);

    // Mettre à jour la position principale
    await db.execute(`
      UPDATE utilisateurs 
      SET latitude = ?, longitude = ?, updated_at = NOW()
      WHERE id = ?
    `, [latitude, longitude, userId]);

    // Suggestions contextuelles
    const suggestions = await getContextualSuggestions(userId, latitude, longitude);

    return res.json({
      success: true,
      precision: {
        level: accuracy < 20 ? 'high' : accuracy < 50 ? 'medium' : 'low',
        meters: accuracy,
        confidence: calculateConfidence(accuracy)
      },
      context: {
        activity,
        speed_kmh: speed ? (speed * 3.6).toFixed(1) : null,
        altitude_m: altitude,
        heading_degrees: heading
      },
      triggered_geofences: triggeredGeofences,
      suggestions,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Precise location error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 8. Statistiques de zone
 */
router.post('/area-stats', cacheLocationData, async (req, res) => {
  try {
    const { 
      latitude, 
      longitude, 
      radius_km = 2
    } = req.body;

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    const bbox = calculateBoundingBox(latitude, longitude, radius_km);

    // Statistiques produits
    const [productStats] = await db.execute(`
      SELECT 
        COUNT(*) as total_products,
        AVG(price) as avg_price,
        MIN(price) as min_price,
        MAX(price) as max_price,
        SUM(stock) as total_stock,
        COUNT(DISTINCT seller_id) as unique_sellers,
        (
          SELECT COUNT(*) 
          FROM products p2 
          WHERE p2.is_featured = 1 
            AND p2.latitude BETWEEN ? AND ?
            AND p2.longitude BETWEEN ? AND ?
            AND (6371 * ACOS(
              COS(RADIANS(?)) * COS(RADIANS(p2.latitude)) * 
              COS(RADIANS(p2.longitude) - RADIANS(?)) + 
              SIN(RADIANS(?)) * SIN(RADIANS(p2.latitude))
            )) <= ?
        ) as featured_products
      FROM products p
      WHERE p.is_active = 1
        AND p.latitude BETWEEN ? AND ?
        AND p.longitude BETWEEN ? AND ?
        AND (6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
          COS(RADIANS(p.longitude) - RADIANS(?)) + 
          SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
        )) <= ?
    `, [
      bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
      latitude, longitude, latitude, radius_km,
      bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
      latitude, longitude, latitude, radius_km
    ]);

    // Statistiques vendeurs
    const [sellerStats] = await db.execute(`
      SELECT 
        COUNT(*) as total_sellers,
        AVG(rating) as avg_rating,
        COUNT(CASE WHEN is_verified = 1 THEN 1 END) as verified_sellers,
        COUNT(CASE WHEN rating >= 4.5 THEN 1 END) as top_rated_sellers
      FROM utilisateurs u
      WHERE u.role = 'vendeur'
        AND u.latitude BETWEEN ? AND ?
        AND u.longitude BETWEEN ? AND ?
        AND (6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(u.latitude)) * 
          COS(RADIANS(u.longitude) - RADIANS(?)) + 
          SIN(RADIANS(?)) * SIN(RADIANS(u.latitude))
        )) <= ?
    `, [
      bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
      latitude, longitude, latitude, radius_km
    ]);

    // Catégories populaires
    const [popularCategories] = await db.execute(`
      SELECT 
        p.category,
        COUNT(*) as product_count,
        AVG(p.price) as avg_price,
        SUM(p.views_count) as total_views,
        SUM(p.likes_count) as total_likes
      FROM products p
      WHERE p.is_active = 1
        AND p.latitude BETWEEN ? AND ?
        AND p.longitude BETWEEN ? AND ?
        AND (6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
          COS(RADIANS(p.longitude) - RADIANS(?)) + 
          SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
        )) <= ?
      GROUP BY p.category
      ORDER BY product_count DESC
      LIMIT 5
    `, [
      bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
      latitude, longitude, latitude, radius_km
    ]);

    // Activité récente
    const [recentActivity] = await db.execute(`
      SELECT 
        'new_products' as type,
        COUNT(*) as count
      FROM products p
      WHERE p.is_active = 1
        AND p.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND p.latitude BETWEEN ? AND ?
        AND p.longitude BETWEEN ? AND ?
      UNION ALL
      SELECT 
        'recent_orders' as type,
        COUNT(*) as count
      FROM commandes c
      JOIN utilisateurs u ON c.vendeur_id = u.id
      WHERE c.date_commande > DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND u.latitude BETWEEN ? AND ?
        AND u.longitude BETWEEN ? AND ?
    `, [
      bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng,
      bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng
    ]);

    const response = {
      success: true,
      radius_km,
      center: { latitude, longitude },
      stats: {
        products: productStats[0],
        sellers: sellerStats[0],
        recent_activity: recentActivity.reduce((acc, curr) => {
          acc[curr.type] = curr.count;
          return acc;
        }, {})
      },
      popular_categories: popularCategories,
      market_density: {
        products_per_km2: (productStats[0].total_products / (Math.PI * radius_km * radius_km)).toFixed(2),
        sellers_per_km2: (sellerStats[0].total_sellers / (Math.PI * radius_km * radius_km)).toFixed(2)
      },
      recommendations: generateAreaRecommendations(productStats[0], sellerStats[0])
    };

    if (res.locals.cacheKey) {
      await redisClient.setEx(res.locals.cacheKey, 60, JSON.stringify(response));
    }

    return res.json(response);
  } catch (err) {
    console.error('Area stats error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 9. Système de boost géolocalisé
 */
router.post('/geo-boost', authMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const {
      product_id,
      duration_hours = 24,
      target_radius_km = 5,
      target_city = null,
      budget_amount
    } = req.body;

    // Vérifier la propriété
    const [productCheck] = await db.execute(
      'SELECT seller_id, title, price FROM products WHERE id = ?',
      [product_id]
    );

    if (productCheck.length === 0 || productCheck[0].seller_id !== userId) {
      return res.status(403).json({ success: false, message: 'Produit non trouvé ou non autorisé' });
    }

    const product = productCheck[0];

    // Calculer le prix du boost
    const boostPrice = calculateBoostPrice(duration_hours, target_radius_km, product.price);
    
    if (budget_amount && budget_amount < boostPrice) {
      return res.status(400).json({
        success: false,
        message: 'Budget insuffisant',
        required: boostPrice,
        provided: budget_amount
      });
    }

    // Générer l'ID de boost
    const boostId = `boost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Récupérer la position du produit
    const [productLocation] = await db.execute(
      'SELECT latitude, longitude, location FROM products WHERE id = ?',
      [product_id]
    );

    // Créer le boost
    const boostSql = `
      INSERT INTO product_boosts 
        (product_id, user_id, amount, original_amount, duration_hours, 
         status, boost_id, currency, country, city, address, 
         views, estimated_reach, start_time, end_time)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, 'USD', ?, ?, ?, 
              0, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? HOUR))
    `;

    const estimatedReach = await estimateBoostReach(
      productLocation[0].latitude,
      productLocation[0].longitude,
      target_radius_km
    );

    await db.execute(boostSql, [
      product_id,
      userId,
      boostPrice,
      budget_amount || boostPrice,
      duration_hours,
      boostId,
      'DRC', // À adapter
      target_city || productLocation[0].location,
      productLocation[0].location,
      estimatedReach,
      duration_hours
    ]);

    // Générer l'URL de paiement (simulé)
    const paymentUrl = `${process.env.APP_URL}/payment/boost/${boostId}`;

    // Mettre à jour le produit
    await db.execute(`
      UPDATE products 
      SET is_boosted = 1, 
          boost_end = DATE_ADD(NOW(), INTERVAL ? HOUR),
          popularity_score = popularity_score + 50
      WHERE id = ?
    `, [duration_hours, product_id]);

    return res.json({
      success: true,
      boost_id: boostId,
      payment: {
        amount: boostPrice,
        currency: 'USD',
        payment_url: paymentUrl,
        expires_in: '30 minutes'
      },
      boost_details: {
        product_title: product.title,
        duration_hours,
        target_radius_km,
        estimated_reach: estimatedReach,
        start_time: new Date(),
        end_time: new Date(Date.now() + duration_hours * 60 * 60 * 1000)
      },
      performance_metrics: {
        expected_views: Math.round(estimatedReach * 0.3),
        expected_clicks: Math.round(estimatedReach * 0.1),
        expected_conversions: Math.round(estimatedReach * 0.02)
      }
    });
  } catch (err) {
    console.error('Geo boost error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * 10. Recommandations personnalisées
 */
router.post('/personalized-recommendations', authMiddleware, cacheLocationData, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { 
      latitude, 
      longitude, 
      limit = 10
    } = req.body;

    if (!validateCoordinates(latitude, longitude)) {
      return res.status(400).json({ success: false, message: 'Coordonnées invalides' });
    }

    // Historique de l'utilisateur
    const [userHistory] = await db.execute(`
      SELECT 
        pv.product_id,
        COUNT(*) as view_count,
        MAX(pv.viewed_at) as last_viewed,
        AVG(uts.time_spent) as avg_time_spent
      FROM product_views pv
      LEFT JOIN user_time_spent uts ON pv.product_id = uts.product_id AND uts.user_id = pv.user_id
      WHERE pv.user_id = ?
        AND pv.viewed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY pv.product_id
      ORDER BY view_count DESC
      LIMIT 20
    `, [userId]);

    // Catégories préférées
    const [preferredCategories] = await db.execute(`
      SELECT 
        p.category,
        COUNT(*) as view_count,
        SUM(IFNULL(uts.time_spent, 0)) as total_time_spent
      FROM product_views pv
      JOIN products p ON pv.product_id = p.id
      LEFT JOIN user_time_spent uts ON pv.product_id = uts.product_id AND uts.user_id = pv.user_id
      WHERE pv.user_id = ?
        AND pv.viewed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY p.category
      ORDER BY total_time_spent DESC
      LIMIT 5
    `, [userId]);

    // Recherches fréquentes
    const [frequentSearches] = await db.execute(`
      SELECT 
        query,
        COUNT(*) as search_count,
        MAX(created_at) as last_searched
      FROM search_logs
      WHERE user_id = ?
        AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY query
      ORDER BY search_count DESC
      LIMIT 5
    `, [userId]);

    // Produits likés
    const [likedProducts] = await db.execute(`
      SELECT product_id
      FROM product_likes
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    // Générer des recommandations
    const recommendations = await generateRecommendations(
      userId,
      latitude,
      longitude,
      userHistory,
      preferredCategories,
      frequentSearches,
      likedProducts,
      limit
    );

    return res.json({
      success: true,
      user_preferences: {
        preferred_categories: preferredCategories,
        frequent_searches: frequentSearches,
        total_views: userHistory.reduce((sum, item) => sum + item.view_count, 0)
      },
      recommendations: {
        based_on_history: recommendations.historyBased,
        based_on_location: recommendations.locationBased,
        trending_nearby: recommendations.trendingNearby,
        similar_users: recommendations.similarUsers
      },
      personalization_score: calculatePersonalizationScore(userHistory, recommendations)
    });
  } catch (err) {
    console.error('Recommendations error:', err);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

/**
 * Fonctions utilitaires
 */

function calculateResponseTime(rating, productCount) {
  if (rating >= 4.5 && productCount > 20) return 'immédiat (< 30min)';
  if (rating >= 4.0) return 'rapide (1-2h)';
  if (rating >= 3.5) return 'standard (24h)';
  return 'variable';
}

function getSellerActivityStatus(sellerId) {
  // Vérifier l'activité récente
  return 'active'; // Simplifié pour l'exemple
}

function calculateBuyerScore(buyer) {
  let score = 50;
  if (buyer.rating >= 4) score += 20;
  if (buyer.rating >= 4.5) score += 10;
  if (buyer.orders_with_you > 0) score += 20;
  if (buyer.orders_with_you > 5) score += 10;
  if (buyer.recent_views > 0) score += 10;
  return Math.min(score, 100);
}

async function getLastInteraction(buyerId, sellerId) {
  const [interaction] = await db.execute(`
    SELECT 
      MAX(viewed_at) as last_view,
      MAX(date_commande) as last_order
    FROM (
      SELECT viewed_at, NULL as date_commande
      FROM product_views pv
      JOIN products p ON pv.product_id = p.id
      WHERE pv.user_id = ? AND p.seller_id = ?
      UNION ALL
      SELECT NULL as viewed_at, date_commande
      FROM commandes
      WHERE acheteur_id = ? AND vendeur_id = ?
    ) as interactions
  `, [buyerId, sellerId, buyerId, sellerId]);
  
  return interaction[0] || { last_view: null, last_order: null };
}

function generateSimpleInstructions(start, end, distance) {
  const instructions = [];
  
  instructions.push({
    step: 1,
    instruction: 'Départ depuis votre position actuelle',
    distance: '0m',
    type: 'depart'
  });

  if (distance > 1000) {
    instructions.push({
      step: 2,
      instruction: 'Continuez tout droit',
      distance: `${Math.round(distance * 0.7)}m`,
      type: 'continue'
    });
  }

  instructions.push({
    step: instructions.length + 1,
    instruction: `Destination à ${Math.round(distance)}m`,
    distance: `${Math.round(distance)}m`,
    type: 'arrival'
  });

  return instructions;
}

function formatDuration(minutes) {
  if (minutes < 60) {
    return `${minutes} minutes`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h${remainingMinutes > 0 ? ` ${remainingMinutes}min` : ''}`;
  }
}

function generateSafetyTips(mode, estimatedMinutes) {
  const tips = [];
  
  if (mode === 'walking') {
    tips.push('Utilisez les passages piétons');
    tips.push('Restez visible');
  } else if (mode === 'cycling') {
    tips.push('Portez un casque');
    tips.push('Utilisez les pistes cyclables');
  } else if (mode === 'driving') {
    tips.push('Conduisez prudemment');
    tips.push('Ne téléphonez pas au volant');
  }
  
  if (estimatedMinutes > 60) {
    tips.push('Prévoyez des pauses');
  }
  
  return tips;
}

async function checkGeofences(userId, lat, lng) {
  // Vérifier les géofences (simplifié)
  return [];
}

async function getContextualSuggestions(userId, lat, lng) {
  // Suggestions basées sur la localisation
  const suggestions = [];
  
  // Produits proches en promotion
  const [promotions] = await db.execute(`
    SELECT p.*, pr.promo_price
    FROM promotions pr
    JOIN products p ON pr.product_id = p.id
    WHERE p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND (6371 * ACOS(
        COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
        COS(RADIANS(p.longitude) - RADIANS(?)) + 
        SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
      )) <= 2
    LIMIT 3
  `, [lat, lng, lat]);
  
  if (promotions.length > 0) {
    suggestions.push({
      type: 'promotions_nearby',
      title: 'Promotions à proximité',
      items: promotions
    });
  }
  
  return suggestions;
}

function calculateConfidence(accuracy) {
  if (accuracy < 10) return 'très élevée';
  if (accuracy < 30) return 'élevée';
  if (accuracy < 50) return 'moyenne';
  return 'faible';
}

function generateAreaRecommendations(productStats, sellerStats) {
  const recommendations = [];
  
  if (productStats.total_products < 10) {
    recommendations.push('Zone peu fournie - Opportunité de marché');
  }
  
  if (sellerStats.avg_rating > 4.5) {
    recommendations.push('Vendeurs bien notés dans la zone');
  }
  
  if (productStats.featured_products > 0) {
    recommendations.push('Produits en vedette disponibles');
  }
  
  return recommendations;
}

function calculateBoostPrice(duration, radius, productPrice) {
  const basePrice = 10;
  const durationMultiplier = duration / 24;
  const radiusMultiplier = radius / 5;
  const priceMultiplier = Math.min(productPrice / 100, 5);
  
  return Math.round(basePrice * durationMultiplier * radiusMultiplier * priceMultiplier);
}

async function estimateBoostReach(lat, lng, radius) {
  // Estimation simplifiée du nombre d'utilisateurs dans la zone
  const [userCount] = await db.execute(`
    SELECT COUNT(*) as count
    FROM utilisateurs
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND (6371 * ACOS(
        COS(RADIANS(?)) * COS(RADIANS(latitude)) * 
        COS(RADIANS(longitude) - RADIANS(?)) + 
        SIN(RADIANS(?)) * SIN(RADIANS(latitude))
      )) <= ?
  `, [lat, lng, lat, radius]);
  
  return Math.round(userCount[0].count * 0.3); // 30% de visibilité estimée
}

async function generateRecommendations(userId, lat, lng, history, categories, searches, likes, limit) {
  const recommendations = {
    historyBased: [],
    locationBased: [],
    trendingNearby: [],
    similarUsers: []
  };

  // Basé sur l'historique
  if (history.length > 0) {
    const historyIds = history.map(h => h.product_id);
    const [similarProducts] = await db.execute(`
      SELECT DISTINCT p.*
      FROM products p
      WHERE p.category IN (
        SELECT DISTINCT category 
        FROM products 
        WHERE id IN (${historyIds.join(',')})
      )
        AND p.id NOT IN (${historyIds.join(',')})
        AND p.is_active = 1
      ORDER BY p.popularity_score DESC
      LIMIT ?
    `, [limit]);
    
    recommendations.historyBased = similarProducts;
  }

  // Basé sur la localisation
  const [locationProducts] = await db.execute(`
    SELECT p.*,
      (6371 * ACOS(
        COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
        COS(RADIANS(p.longitude) - RADIANS(?)) + 
        SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
      )) as distance_km
    FROM products p
    WHERE p.is_active = 1
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
    HAVING distance_km <= 5
    ORDER BY distance_km ASC, p.popularity_score DESC
    LIMIT ?
  `, [lat, lng, lat, limit]);
  
  recommendations.locationBased = locationProducts;

  // Tendances locales
  const [trendingProducts] = await db.execute(`
    SELECT p.*,
      (p.views_count * 0.3 + p.likes_count * 0.5 + p.comments_count * 0.2) as trend_score
    FROM products p
    WHERE p.is_active = 1
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND (6371 * ACOS(
        COS(RADIANS(?)) * COS(RADIANS(p.latitude)) * 
        COS(RADIANS(p.longitude) - RADIANS(?)) + 
        SIN(RADIANS(?)) * SIN(RADIANS(p.latitude))
      )) <= 10
      AND p.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
    ORDER BY trend_score DESC
    LIMIT ?
  `, [lat, lng, lat, limit]);
  
  recommendations.trendingNearby = trendingProducts;

  return recommendations;
}

function calculatePersonalizationScore(history, recommendations) {
  const totalRecommendations = 
    recommendations.historyBased.length +
    recommendations.locationBased.length +
    recommendations.trendingNearby.length +
    recommendations.similarUsers.length;
  
  if (totalRecommendations === 0) return 0;
  
  const personalizedCount = recommendations.historyBased.length + recommendations.similarUsers.length;
  return Math.round((personalizedCount / totalRecommendations) * 100);
}

module.exports = router;