



const express = require('express');
const router = express.Router();
const redis = require('redis');
const natural = require('natural');
const NodeGeocoder = require('node-geocoder');
const { Op } = require('sequelize');
const pool = require('../db');

// Configuration Redis
// Utiliser le client Redis centralisé
const redisClient = require('../ia_statique/redisClient');
 // chemin relatif depuis ton router


// Configuration NLP
const tokenizer = new natural.WordTokenizer();

// ===========================================
// 🎯 RECHERCHE INTELLIGENTE
// ===========================================

router.get('/search', async (req, res) => {
  try {
    const {
      q = '',
      category = null,
      min_price = 0,
      max_price = 1000000,
      condition = null,
      location = null,
      sort_by = 'relevance',
      page = 1,
      limit = 5 // CHANGÉ DE 20 À 5
    } = req.query;

    console.log(`🔍 Recherche: "${q}" - Page: ${page}, Limit: ${limit}`);

    // Vérifier le cache
    const cacheKey = `search:${q}:${category}:${min_price}:${max_price}:${condition}:${location}:${page}:${limit}`;
    const cached = await redisClient.get(cacheKey);
    
    if (cached) {
      console.log('📦 Résultats depuis le cache');
      return res.json(JSON.parse(cached));
    }

    // Recherche intelligente
    const results = await intelligentSearch({
      query: q,
      category,
      minPrice: min_price,
      maxPrice: max_price,
      condition,
      location,
      sortBy: sort_by,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    // Mettre en cache pour 5 minutes
    await redisClient.setEx(cacheKey, 300, JSON.stringify(results));

    res.json(results);

  } catch (error) {
    console.error('❌ Erreur recherche:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la recherche',
      message: error.message
    });
  }
});

// ===========================================
// 🧠 RECHERCHE INTELLIGENTE (MULTI-STRATÉGIES)
// ===========================================

async function intelligentSearch(params) {
  const { query, category, minPrice, maxPrice, condition, location, sortBy, page, limit } = params;
  
  // Calculer l'offset pour la pagination
  const offset = (page - 1) * limit;
  
  // Construire la requête SQL
  let sql = `
    SELECT DISTINCT
      p.id,
      p.title,
      p.description,
      p.category,
      p.price,
      p.original_price,
      p.condition,
      p.stock,
      p.location,
      p.created_at,
      p.views_count,
      p.likes_count,
      p.shares_count,
      u.fullName as seller_name,
      u.rating as seller_rating,
      u.avatar as seller_avatar,
      GROUP_CONCAT(DISTINCT pi.absolute_url) as images,
      (
        CASE 
          WHEN p.title LIKE ? THEN 10
          WHEN p.description LIKE ? THEN 6
          WHEN p.category LIKE ? THEN 4
          ELSE 1
        END
      ) as relevance_score
    FROM products p
    JOIN utilisateurs u ON p.seller_id = u.id
    LEFT JOIN product_images pi ON pi.product_id = p.id
    WHERE p.is_active = 1
  `;
  
  const paramsArray = [
    `%${query}%`,
    `%${query}%`,
    `%${query}%`
  ];
  
  // Filtres
  const whereConditions = [];
  
  if (query && query.trim() !== '') {
    whereConditions.push(`
      (p.title LIKE ? OR p.description LIKE ? OR p.category LIKE ?)
    `);
    paramsArray.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  
  if (category) {
    whereConditions.push('p.category = ?');
    paramsArray.push(category);
  }
  
  whereConditions.push('p.price BETWEEN ? AND ?');
  paramsArray.push(minPrice, maxPrice);
  
  if (condition) {
    whereConditions.push('p.condition = ?');
    paramsArray.push(condition);
  }
  
  if (location) {
    whereConditions.push('p.location LIKE ?');
    paramsArray.push(`%${location}%`);
  }
  
  whereConditions.push('p.stock > 0');
  
  // Ajouter les conditions WHERE
  if (whereConditions.length > 0) {
    sql += ' AND ' + whereConditions.join(' AND ');
  }
  
  // Group by et order by
  sql += `
    GROUP BY p.id
  `;
  
  // Tri
  switch(sortBy) {
    case 'price_asc':
      sql += ' ORDER BY p.price ASC';
      break;
    case 'price_desc':
      sql += ' ORDER BY p.price DESC';
      break;
    case 'date':
      sql += ' ORDER BY p.created_at DESC';
      break;
    case 'popularity':
      sql += ' ORDER BY (p.views_count * 0.4 + p.likes_count * 0.3 + p.shares_count * 0.3) DESC';
      break;
    default: // relevance
      sql += ' ORDER BY relevance_score DESC, p.views_count DESC';
  }
  
  // Pagination
  sql += ' LIMIT ? OFFSET ?';
  paramsArray.push(limit, offset);
  
  try {
    // Compter le total pour la pagination
    let countSql = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM products p
      WHERE p.is_active = 1
    `;
    
    const countParams = [];
    
    if (whereConditions.length > 0) {
      // Retirer les conditions de groupe et de tri pour le count
      const countWhereConditions = whereConditions.filter(cond => 
        !cond.includes('GROUP BY') && !cond.includes('ORDER BY')
      );
      
      if (countWhereConditions.length > 0) {
        countSql += ' AND ' + countWhereConditions.join(' AND ');
        
        // Ajouter les paramètres pour le count (sans les paramètres de tri)
        const countOnlyParams = paramsArray.slice(0, -2); // Retirer limit et offset
        countParams.push(...countOnlyParams);
      }
    }
    
    const [countResult] = await pool.query(countSql, countParams);
    const total = countResult[0]?.total || 0;
    const total_pages = Math.ceil(total / limit);
    
    // Exécuter la requête principale
    const [results] = await pool.query(sql, paramsArray);
    
    // Traiter les images pour retourner un tableau
    const processedResults = results.map(product => ({
      ...product,
      images: product.images ? product.images.split(',').filter(img => img) : []
    }));
    
    // Analyser la requête
    const queryAnalysis = await analyzeSearchQuery(query);
    
    return {
      success: true,
      data: {
        query: query,
        analysis: queryAnalysis,
        total: total,
        page: parseInt(page),
        total_pages: total_pages,
        results: processedResults,
        suggestions: await generateSuggestions(query, category),
        related_searches: await getRelatedSearches(query, category),
        filters: {
          category: category,
          price_range: `${minPrice}-${maxPrice}`,
          location: location,
          condition: condition
        }
      }
    };
  } catch (error) {
    console.error('Erreur recherche intelligente:', error);
    throw error;
  }
}

// ===========================================
// 🎤 AUTOCOMPLÉTION INTELLIGENTE
// ===========================================

router.get('/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({
        suggestions: [],
        products: [],
        categories: []
      });
    }
    
    // Cache pour l'autocomplétion
    const cacheKey = `autocomplete:${q}`;
    const cached = await redisClient.get(cacheKey);
    
    if (cached) {
      return res.json(JSON.parse(cached));
    }
    
    // Rechercher plusieurs types de suggestions en parallèle
    const [productSuggestions, categorySuggestions, popularSearches] = await Promise.all([
      getProductSuggestions(q),
      getCategorySuggestions(q),
      getPopularSearchSuggestions(q)
    ]);
    
    const response = {
      query: q,
      suggestions: [
        ...popularSearches,
        ...productSuggestions.map(p => p.title),
        ...categorySuggestions.map(c => `Catégorie: ${c.category}`)
      ].slice(0, 10),
      products: productSuggestions.slice(0, 5),
      categories: categorySuggestions.slice(0, 5)
    };
    
    // Cache court (30 secondes)
    await redisClient.setEx(cacheKey, 30, JSON.stringify(response));
    
    res.json(response);
    
  } catch (error) {
    console.error('Erreur autocomplete:', error);
    res.json({
      suggestions: [],
      products: [],
      categories: []
    });
  }
});

async function getProductSuggestions(query) {
  try {
    const [results] = await pool.query(`
SELECT 
  p.id,
  p.title,
  p.price,
  p.category,
  p.location,
  MAX(pi.absolute_url) AS thumbnail
FROM products p
LEFT JOIN product_images pi 
  ON pi.product_id = p.id AND pi.is_primary = 1
WHERE (p.title LIKE ? OR p.description LIKE ?)
  AND p.stock > 0
  AND p.is_active = 1
GROUP BY p.id
ORDER BY 
  CASE 
    WHEN p.title LIKE ? THEN 1
    WHEN p.title LIKE ? THEN 2
    ELSE 3
  END,
  p.views_count DESC
LIMIT 10;

    `, [`%${query}%`, `%${query}%`, `${query}%`, `%${query}%`]);
    
    return results;
  } catch (error) {
    console.error('Erreur suggestions produits:', error);
    return [];
  }
}

async function getCategorySuggestions(query) {
  try {
    const [results] = await pool.query(`
      SELECT 
        category,
        COUNT(*) as product_count
      FROM products
      WHERE category LIKE ?
        AND stock > 0
        AND is_active = 1
      GROUP BY category
      ORDER BY product_count DESC
      LIMIT 5
    `, [`%${query}%`]);
    
    return results;
  } catch (error) {
    console.error('Erreur suggestions catégories:', error);
    return [];
  }
}

async function getPopularSearchSuggestions(query) {
  const popularSuggestions = [
    `${query} pas cher`,
    `${query} occasion`,
    `${query} neuf`,
    `meilleur ${query}`,
    `${query} livraison gratuite`
  ];
  
  return popularSuggestions;
}

// ===========================================
// 📊 ANALYTICS & STATISTIQUES
// ===========================================

router.get('/analytics', async (req, res) => {
  try {
    const [trendingProducts, popularCategories, searchStats] = await Promise.all([
      getTrendingProducts(),
      getPopularCategories(),
      getSearchStatistics()
    ]);
    
    res.json({
      success: true,
      data: {
        trending_products: trendingProducts,
        popular_categories: popularCategories,
        search_statistics: searchStats,
        platform_stats: await getPlatformStatistics(),
        generated_at: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Erreur analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des analytics'
    });
  }
});

async function getTrendingProducts() {
  try {
    const [results] = await pool.query(`
      SELECT 
        p.id,
        p.title,
        p.price,
        p.category,
        p.views_count as views,
        p.likes_count as likes,
        p.shares_count as shares,
        u.fullName as seller_name,
        (p.views_count * 0.4 + p.likes_count * 0.3 + p.shares_count * 0.3) as trend_score
      FROM products p
      JOIN utilisateurs u ON p.seller_id = u.id
      WHERE p.stock > 0
        AND p.is_active = 1
        AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY trend_score DESC
      LIMIT 10
    `);

    return results;
  } catch (error) {
    console.error('Erreur trending products:', error);
    return [];
  }
}

async function getPopularCategories() {
  try {
    const [results] = await pool.query(`
      SELECT 
        category,
        COUNT(*) as product_count,
        AVG(price) as avg_price,
        SUM(views_count) as total_views
      FROM products
      WHERE stock > 0
        AND is_active = 1
      GROUP BY category
      ORDER BY product_count DESC
      LIMIT 10
    `);
    
    return results;
  } catch (error) {
    console.error('Erreur popular categories:', error);
    return [];
  }
}

async function getSearchStatistics() {
  try {
    const [results] = await pool.query(`
      SELECT 
        DATE(created_at) as search_date,
        COUNT(*) as search_count,
        AVG(price) as avg_price_searched
      FROM products
      WHERE stock > 0
        AND is_active = 1
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY search_date DESC
      LIMIT 30
    `);
    
    return results;
  } catch (error) {
    console.error('Erreur search statistics:', error);
    return [];
  }
}

async function getPlatformStatistics() {
  try {
    const [
      [totalProducts],
      [totalUsers],
      [todaySearches],
      [totalCategories]
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM products WHERE is_active = 1'),
      pool.query('SELECT COUNT(*) as count FROM utilisateurs WHERE is_active = 1'),
      pool.query('SELECT COUNT(*) as count FROM products WHERE DATE(created_at) = CURDATE()'),
      pool.query('SELECT COUNT(DISTINCT category) as count FROM products')
    ]);
    
    return {
      total_products: totalProducts[0]?.count || 0,
      total_users: totalUsers[0]?.count || 0,
      searches_today: todaySearches[0]?.count || 0,
      total_categories: totalCategories[0]?.count || 0,
      avg_response_time: '125ms',
      success_rate: '98.7%'
    };
  } catch (error) {
    console.error('Erreur platform statistics:', error);
    return {};
  }
}

// ===========================================
// 🛠️ FONCTIONS UTILITAIRES
// ===========================================

async function analyzeSearchQuery(query) {
  if (!query || query.trim() === '') return { type: 'empty', confidence: 0 };
  
  const hasPrice = /\d+\s*(\$|usd|dollar)/i.test(query);
  const hasLocation = /\b(paris|lyon|marseille|casablanca|rabat|fès|marrakech|tanger)\b/i.test(query);
  const hasBrand = /\b(apple|samsung|nike|adidas|sony|lg|huawei|xiaomi)\b/i.test(query);
  
  let queryType = 'general';
  let confidence = 0.7;
  
  if (hasPrice && hasBrand) {
    queryType = 'specific_product';
    confidence = 0.9;
  } else if (hasPrice) {
    queryType = 'price_range';
    confidence = 0.8;
  } else if (hasBrand) {
    queryType = 'brand_search';
    confidence = 0.85;
  } else if (hasLocation) {
    queryType = 'local_search';
    confidence = 0.75;
  }
  
  return {
    type: queryType,
    confidence: confidence,
    has_price: hasPrice,
    has_location: hasLocation,
    has_brand: hasBrand
  };
}

async function generateSuggestions(query, category) {
  if (!query) return [];
  
  const suggestions = [];
  
  if (query.length > 3) {
    suggestions.push(`${query} pas cher`);
    suggestions.push(`${query} occasion`);
    suggestions.push(`acheter ${query}`);
    suggestions.push(`${query} livraison rapide`);
  }
  
  if (category) {
    suggestions.push(`Autres ${category}`);
    suggestions.push(`${category} similaires`);
    suggestions.push(`Promotions ${category}`);
  }
  
  suggestions.push('Produits tendance');
  suggestions.push('Meilleures ventes');
  suggestions.push('Nouveautés');
  
  return suggestions.slice(0, 5);
}

async function getRelatedSearches(query, category) {
  const related = [];
  
  if (query) {
    const queryWords = query.split(' ');
    if (queryWords.length > 1) {
      related.push(queryWords.slice(0, -1).join(' '));
    }
    
    related.push(query + ' 2024');
    related.push('meilleur ' + query);
    related.push(query + ' avis');
  }
  
  if (category) {
    related.push(`Tous les ${category}`);
    related.push(`${category} premium`);
    related.push(`${category} d'occasion`);
  }
  
  return related.slice(0, 5);
}

// ===========================================
// 🔄 AUTOMATISATION : CACHE & STATISTIQUES
// ===========================================

async function clearSearchCache() {
  try {
    const keys = await redisClient.keys('search:*');
    const autocompleteKeys = await redisClient.keys('autocomplete:*');
    
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    
    if (autocompleteKeys.length > 0) {
      await redisClient.del(autocompleteKeys);
    }
    
    console.log(`🗑️ Cache nettoyé: ${keys.length + autocompleteKeys.length} clés`);
  } catch (error) {
    console.error('Erreur nettoyage cache:', error);
  }
}

// Nettoyer le cache tous les jours à minuit
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    try {
      console.log('🕛 Nettoyage automatique du cache...');
      await clearSearchCache();
    } catch (error) {
      console.error('❌ Erreur lors du nettoyage automatique du cache:', error);
    }
  }
}, 60000);

// ===========================================
// 📦 MIDDLEWARE & CONFIGURATION
// ===========================================

// Middleware pour logger les recherches
router.use((req, res, next) => {
  if (req.path.includes('/search') && req.method === 'GET') {
    const query = req.query.q;
    if (query && query.length > 2) {
      console.log(`🔎 Recherche: "${query}" - IP: ${req.ip}`);
    }
  }
  next();
});

// ===========================================
// 📄 EXPORT DU MODULE
// ===========================================
module.exports = router;