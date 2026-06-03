
/**
 * ASSISTANT VENDEUR V3 - SHOPNET (PRO)
 * 
 * Features :
 * - Scoring produit avancé (visibilité, engagement, récence, qualité fiche)
 * - Comparaison avec moyenne vendeur et plateforme
 * - Actions recommandées (boost, ajouter images, modifier titre, etc.)
 * - Money insights : estimation pertes, potentiel gain
 * - Prédiction ventes (modèle simplifié)
 * - Suggestions de prix intelligentes (basées sur concurrence)
 * - Recommandation de suppression pour produits morts
 * - 🆕 IA PRÉDICTIVE AVANCÉE (meilleur moment, action, probabilité conversion)
 * - 🆕 PRÉDICTIONS GLOBALES (tendances plateforme, conseils dynamiques)
 * - 🚀 Cache Redis pour optimiser les performances
 * 
 * Route unique :
 *   GET /api/assistant-vendeur/dashboard
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const authMiddleware = require('../../middlewares/authMiddleware');
const redisClient = require('../../ia_statique/redisClient'); // Chemin à adapter si besoin

// ==============================================
// 1. FONCTIONS DE SCORING & ANALYSE AVANCÉE (existantes)
// ==============================================

/**
 * Calcule le score de santé produit (0-100)
 */
function calculerScoreProduit(p, avgSellerViews, avgSellerLikes, platformAvgViews, platformAvgLikes) {
  let score = 0;
  
  // 1. Visibilité (0-35)
  let viewsScore = 0;
  if (p.views === 0) viewsScore = 0;
  else if (p.views < 10) viewsScore = 5;
  else if (p.views < 50) viewsScore = 12;
  else if (p.views < 200) viewsScore = 22;
  else if (p.views < 500) viewsScore = 30;
  else viewsScore = 35;
  
  if (avgSellerViews > 0) {
    const ratio = p.views / avgSellerViews;
    if (ratio >= 2) viewsScore += 8;
    else if (ratio <= 0.3) viewsScore -= 12;
    else if (ratio <= 0.5) viewsScore -= 6;
  }
  if (platformAvgViews > 0) {
    const ratioPlatform = p.views / platformAvgViews;
    if (ratioPlatform >= 1.5) viewsScore += 5;
    else if (ratioPlatform <= 0.2) viewsScore -= 8;
  }
  viewsScore = Math.min(35, Math.max(0, viewsScore));
  score += viewsScore;
  
  // 2. Engagement likes (0-30)
  let likesScore = 0;
  if (p.likes === 0) likesScore = 0;
  else if (p.likes < 3) likesScore = 3;
  else if (p.likes < 10) likesScore = 10;
  else if (p.likes < 30) likesScore = 18;
  else if (p.likes < 80) likesScore = 25;
  else likesScore = 30;
  
  if (avgSellerLikes > 0) {
    const ratioLikes = p.likes / avgSellerLikes;
    if (ratioLikes >= 2) likesScore += 7;
    else if (ratioLikes <= 0.3) likesScore -= 10;
  }
  if (platformAvgLikes > 0) {
    const ratioPlatformLikes = p.likes / platformAvgLikes;
    if (ratioPlatformLikes >= 1.5) likesScore += 4;
    else if (ratioPlatformLikes <= 0.2) likesScore -= 6;
  }
  likesScore = Math.min(30, Math.max(0, likesScore));
  score += likesScore;
  
  // 3. Récence (0-20)
  let recenceScore = 20;
  if (p.ageHeures > 720) recenceScore = 0;
  else if (p.ageHeures > 336) recenceScore = 5;
  else if (p.ageHeures > 168) recenceScore = 8;
  else if (p.ageHeures > 72) recenceScore = 12;
  else if (p.ageHeures > 24) recenceScore = 16;
  score += recenceScore;
  
  // 4. Qualité fiche (0-15)
  let qualiteScore = 0;
  if (p.nbImages >= 4) qualiteScore = 8;
  else if (p.nbImages === 3) qualiteScore = 6;
  else if (p.nbImages === 2) qualiteScore = 3;
  else if (p.nbImages === 1) qualiteScore = 1;
  if (p.title && p.title.length > 40) qualiteScore += 4;
  else if (p.title && p.title.length > 25) qualiteScore += 2;
  if (p.description && p.description.length > 100) qualiteScore += 3;
  qualiteScore = Math.min(15, qualiteScore);
  score += qualiteScore;
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

function getStatut(score, p) {
  if (p.views === 0 && p.likes === 0 && p.ageHeures > 336) return "🔴 Critique (mort-né)";
  if (score < 20) return "🔴 Critique";
  if (score < 40) return "🟠 Faible potentiel";
  if (score < 60) return "🟡 Potentiel moyen";
  if (score < 80) return "🟢 Bon produit";
  return "🔥 Produit star";
}

function getActionsRecommandees(p, score) {
  const actions = [];
  
  if (p.nbImages < 3) {
    actions.push({
      type: "ajouter_images",
      label: "📸 Ajouter 2 à 3 photos",
      description: "Les produits avec au moins 4 photos convertissent 35% mieux.",
      priority: "haute"
    });
  }
  
  if (p.title && p.title.length < 35) {
    actions.push({
      type: "optimiser_titre",
      label: "✏️ Optimiser le titre",
      description: "Ajoutez marque, modèle, couleur, taille – plus de mots-clés = plus de vues.",
      priority: "moyenne"
    });
  }
  
  if (p.views < 50 && score < 50) {
    actions.push({
      type: "booster",
      label: "🚀 Booster ce produit (publicité payante)",
      description: "Un boost à $5 peut augmenter les vues de +300% en 7 jours.",
      priority: "haute",
      cout_estime: 5,
      duree_jours: 7
    });
  }
  
  if (p.likes === 0 && p.views > 20) {
    actions.push({
      type: "appel_action",
      label: "💬 Ajouter un appel à l'action",
      description: "Terminez la description par 'Likez ce produit pour plus d'offres similaires'.",
      priority: "moyenne"
    });
  }
  
  if (p.stock === 0 && p.views > 10) {
    actions.push({
      type: "reapprovisionner",
      label: "📦 Réapprovisionner rapidement",
      description: "Produit en rupture mais demandé (vues). Réassort = ventes immédiates.",
      priority: "critique"
    });
  }
  
  if (p.ageHeures > 720 && p.views < 10) {
    actions.push({
      type: "supprimer",
      label: "🗑️ Envisager la suppression",
      description: "Produit inactif depuis plus de 30 jours sans aucune interaction. Libérez de l'espace.",
      priority: "basse"
    });
  }
  
  if (score >= 75 && p.price && p.price < 100) {
    actions.push({
      type: "augmenter_prix",
      label: "💰 Augmenter le prix de 10-15%",
      description: "Produit performant, la demande est là. Testez un prix plus élevé.",
      priority: "moyenne"
    });
  }
  
  if (actions.length === 0 && score >= 40 && score < 75) {
    actions.push({
      type: "partager_social",
      label: "📢 Partager sur les réseaux",
      description: "Un partage sur Facebook ou Instagram peut doubler les vues.",
      priority: "basse"
    });
  }
  
  return actions;
}

/**
 * Money Insights en USD
 */
function getMoneyInsights(p, score, avgPriceSimilar) {
  const insights = [];
  
  let ventesManquees = 0;
  let potentielGain = 0;
  
  if (p.views > 50 && p.likes < 5) {
    ventesManquees = Math.floor(p.views / 50);
    potentielGain = ventesManquees * (p.price || 20);
    if (ventesManquees > 0) {
      insights.push({
        type: "ventes_perdues",
        message: `📉 Vous avez probablement manqué environ ${ventesManquees} vente(s) sur ce produit (faible engagement malgré ${p.views} vues). Potentiel perdu : ~$${potentielGain.toFixed(2)}`,
        gravite: "moyenne"
      });
    }
  }
  
  if (p.views < 100 && score < 60) {
    const gainPotentielBoost = (p.price || 20) * 2.5;
    insights.push({
      type: "potentiel_boost",
      message: `🚀 Potentiel de gain si boost : environ $${gainPotentielBoost.toFixed(2)} supplémentaires (estimation basée sur trafic moyen).`,
      action: "booster",
      gain_estime: gainPotentielBoost
    });
  }
  
  if (avgPriceSimilar > 0 && p.price) {
    if (p.price > avgPriceSimilar * 1.2) {
      const tropCher = p.price - avgPriceSimilar;
      insights.push({
        type: "prix_trop_eleve",
        message: `💰 Prix ${((p.price / avgPriceSimilar) * 100 - 100).toFixed(0)}% au-dessus de la moyenne similaire. Réduire de $${tropCher.toFixed(2)} pourrait augmenter les ventes de 30%.`,
        action: "baisser_prix",
        new_price_suggestion: (avgPriceSimilar * 0.95).toFixed(2)
      });
    } else if (p.price < avgPriceSimilar * 0.7 && score > 60) {
      const underPrice = avgPriceSimilar - p.price;
      insights.push({
        type: "prix_trop_bas",
        message: `💎 Prix très attractif mais peut-être trop bas. Une augmentation de +$${(underPrice / 2).toFixed(2)} est possible sans perdre de ventes.`,
        action: "augmenter_prix",
        new_price_suggestion: (p.price + underPrice / 2).toFixed(2)
      });
    }
  }
  
  if (p.views === 0 && p.likes === 0 && p.ageHeures > 720) {
    insights.push({
      type: "produit_mort",
      message: `⚠️ Ce produit n'a jamais généré d'interaction en ${Math.floor(p.ageHeures / 24)} jours. Supprimez-le ou remplacez-le par un article plus tendance.`,
      action: "supprimer",
      gravite: "haute"
    });
  }
  
  if (insights.length === 0 && p.views > 0) {
    insights.push({
      type: "neutre",
      message: "✅ Pas d'alerte financière majeure. Surveillez simplement l'évolution.",
      gravite: "basse"
    });
  }
  
  return insights;
}

function predictionVentes(p) {
  const tauxConversion = 0.0125;
  let ventesBase = Math.floor(p.views * tauxConversion);
  const month = new Date().getMonth();
  const saison = (month >= 10 || month <= 2) ? 1.3 : (month >= 5 && month <= 8 ? 0.8 : 1.0);
  let ventesPredites = Math.floor(ventesBase * saison);
  if (p.isBoosted) ventesPredites = Math.floor(ventesPredites * 1.5);
  
  return {
    ventes_estimees_30j: ventesPredites,
    chiffre_affaires_estime: `$${(ventesPredites * (p.price || 0)).toFixed(2)}`,
    niveau_confiance: p.views > 100 ? "élevé" : (p.views > 30 ? "moyen" : "faible")
  };
}

function suggererPrixOptimal(p, avgPriceSimilar, platformAvgPriceCategory) {
  let currentPrice = parseFloat(p.price) || 0;
  if (currentPrice === 0) return null;
  
  let suggestion = null;
  let raison = "";
  
  if (avgPriceSimilar > 0) {
    if (currentPrice > avgPriceSimilar * 1.2) {
      suggestion = (avgPriceSimilar * 0.95).toFixed(2);
      raison = "Prix supérieur à la concurrence similaire. Baisser pour rester compétitif.";
    } else if (currentPrice < avgPriceSimilar * 0.7 && p.score > 60) {
      suggestion = (currentPrice * 1.1).toFixed(2);
      raison = "Prix très bas alors que le produit performe bien. Vous pouvez augmenter la marge.";
    } else {
      suggestion = currentPrice.toFixed(2);
      raison = "Prix cohérent avec le marché.";
    }
  } else if (platformAvgPriceCategory > 0) {
    if (currentPrice > platformAvgPriceCategory * 1.3) {
      suggestion = (platformAvgPriceCategory * 1.05).toFixed(2);
      raison = "Prix élevé par rapport à la catégorie. Réduire pour attirer plus d'acheteurs.";
    } else {
      suggestion = currentPrice.toFixed(2);
      raison = "Prix dans la moyenne de la catégorie.";
    }
  } else {
    suggestion = currentPrice.toFixed(2);
    raison = "Aucune donnée concurrentielle disponible.";
  }
  
  return { 
    prix_actuel: `$${currentPrice.toFixed(2)}`, 
    prix_suggere: `$${parseFloat(suggestion).toFixed(2)}`, 
    raison 
  };
}

async function getConcurrenceData(category, productPrice, productTitle) {
  try {
    const [rows] = await pool.query(
      `SELECT AVG(price) AS avg_price, COUNT(*) AS nb_produits 
       FROM products 
       WHERE category = ? AND is_active = 1 AND price > 0`,
      [category]
    );
    const avgPriceCategory = rows[0]?.avg_price || 0;
    const nbCompetitors = rows[0]?.nb_produits || 0;
    
    const motsCles = productTitle.split(' ').filter(m => m.length > 3).slice(0, 3);
    let avgPriceSimilar = 0;
    let nbSimilar = 0;
    if (motsCles.length > 0) {
      const likeConditions = motsCles.map(() => 'title LIKE ?').join(' OR ');
      const queryParams = motsCles.map(m => `%${m}%`);
      const [similars] = await pool.query(
        `SELECT price FROM products 
         WHERE category = ? AND is_active = 1 AND price > 0 
         AND (${likeConditions}) LIMIT 20`,
        [category, ...queryParams]
      );
      nbSimilar = similars.length;
      if (similars.length > 0) {
        const sum = similars.reduce((acc, s) => acc + parseFloat(s.price), 0);
        avgPriceSimilar = sum / similars.length;
      }
    }
    
    return {
      avg_price_category: `$${parseFloat(avgPriceCategory).toFixed(2)}`,
      nb_competitors_category: nbCompetitors,
      avg_price_similar_products: `$${parseFloat(avgPriceSimilar).toFixed(2)}`,
      nb_similar_products: nbSimilar
    };
  } catch (error) {
    console.error("Erreur récupération concurrence:", error);
    return { 
      avg_price_category: "$0.00", 
      nb_competitors_category: 0, 
      avg_price_similar_products: "$0.00", 
      nb_similar_products: 0 
    };
  }
}

// ==============================================
// 1.1 NOUVELLES FONCTIONS IA PRÉDICTIVE (produit) AVEC CACHE REDIS
// ==============================================

/**
 * Récupère les tendances horaires par catégorie (depuis les commandes et likes)
 * Avec cache Redis (TTL 5 minutes)
 */
async function getCategoryActivityPattern(category) {
  const cacheKey = `assistant:activity_pattern:${category}`;
  
  // Tentative de lecture du cache
  if (redisClient && redisClient.isReady) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('Redis get error:', err.message);
    }
  }

  try {
    // 🔧 CORRECTION : utilisation de c.date_commande au lieu de c.created_at
    const [orders] = await pool.query(`
      SELECT HOUR(c.date_commande) AS hour, COUNT(*) AS count
      FROM commandes c
      JOIN commande_produits cp ON c.id = cp.commande_id
      JOIN products p ON cp.produit_id = p.id
      WHERE p.category = ? AND c.date_commande > DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY HOUR(c.date_commande)
      ORDER BY count DESC
      LIMIT 1
    `, [category]);

    let peakHour = 18; // défaut 18h
    let confidence = "moyenne";

    if (orders.length > 0 && orders[0].count > 5) {
      peakHour = orders[0].hour;
      confidence = "élevée";
    } else {
      const [likes] = await pool.query(`
        SELECT HOUR(pl.created_at) AS hour, COUNT(*) AS count
        FROM product_likes pl
        JOIN products p ON pl.product_id = p.id
        WHERE p.category = ? AND pl.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY HOUR(pl.created_at)
        ORDER BY count DESC
        LIMIT 1
      `, [category]);
      if (likes.length > 0 && likes[0].count > 3) {
        peakHour = likes[0].hour;
        confidence = "moyenne";
      }
    }

    let startHour = peakHour;
    let endHour = peakHour + 2;
    if (endHour > 23) {
      endHour = 23;
      startHour = peakHour - 1;
    }
    if (startHour < 0) startHour = 0;

    const result = { bestHourStart: startHour, bestHourEnd: endHour, confidence };
    
    // Sauvegarde en cache (5 minutes)
    if (redisClient && redisClient.isReady) {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
    }
    
    return result;
  } catch (error) {
    console.error("Erreur getCategoryActivityPattern:", error);
    return { bestHourStart: 18, bestHourEnd: 20, confidence: "faible" };
  }
}

/**
 * Prédit le meilleur moment pour publier (ou mettre en avant) un produit
 */
async function predictBestTime(category, historicalData = null) {
  const pattern = await getCategoryActivityPattern(category);
  const start = pattern.bestHourStart;
  const end = pattern.bestHourEnd;
  const now = new Date();
  const currentHour = now.getHours();

  let message = "";
  if (currentHour >= start && currentHour < end) {
    message = `Maintenant (entre ${start}h et ${end}h) est une période d'activité élevée dans cette catégorie.`;
  } else {
    message = `Plage horaire recommandée : ${start}h - ${end}h. L'activité des acheteurs est généralement maximale à cette période.`;
  }
  return {
    best_time_to_post: `${start}h00 - ${end}h00`,
    reason: message,
    confidence: pattern.confidence
  };
}

/**
 * Calcule la probabilité de conversion (achat) d'un produit
 * (Ne nécessite pas de cache car dépend du produit spécifique)
 */
async function predictConversionProbability(product, sellerStats, platformStats) {
  const categoryBenchmark = {
    'electronics': 0.035,
    'mode': 0.028,
    'home': 0.022,
    'beauty': 0.04,
    'auto': 0.018,
    'default': 0.025
  };
  const benchmark = categoryBenchmark[product.category] || categoryBenchmark.default;

  let probability = benchmark;

  const scoreFactor = 0.5 + (product.score / 100) * 0.8;
  probability *= scoreFactor;

  if (product.nb_images >= 4) probability *= 1.2;
  else if (product.nb_images >= 2) probability *= 1.05;

  if (product.price < 20) probability *= 1.1;
  else if (product.price > 200) probability *= 0.85;

  if (sellerStats && sellerStats.avg_views_per_product > 200) probability *= 1.1;

  probability = Math.min(0.65, Math.max(0.02, probability));
  return Math.round(probability * 100);
}

/**
 * Détermine la meilleure action à recommander (publier, booster, attendre...)
 */
async function predictBestAction(product, sellerStats, platformStats) {
  const score = product.score;
  const views = product.views;
  const ageHours = product.age_heures;
  const price = product.price;

  if (views === 0 && ageHours > 336) {
    return {
      action: "delete",
      label: "🗑️ Supprimez ce produit",
      description: "Aucune interaction depuis plus de 14 jours. Libérez de l'espace pour des articles plus prometteurs."
    };
  }

  if (views < 30 && ageHours < 72 && score < 50) {
    return {
      action: "boost",
      label: "🚀 Boostez ce produit maintenant",
      description: "Produit récent mais peu visible. Un boost peut déclencher l'effet de réseau.",
      expected_boost: "+200% à +300% de visibilité"
    };
  }

  if (score > 70 && price < 50) {
    return {
      action: "share",
      label: "📢 Partagez sur les réseaux sociaux",
      description: "Ce produit a un excellent potentiel. Un partage peut générer des ventes rapides."
    };
  }

  if (views > 100 && product.likes < 10 && product.nb_images < 3) {
    return {
      action: "optimize",
      label: "✏️ Améliorez la fiche produit",
      description: "Beaucoup de vues mais peu d'interactions. Ajoutez des photos et un appel à l'action."
    };
  }

  const bestTime = await predictBestTime(product.category);
  return {
    action: "wait",
    label: `⏳ Attendez ${bestTime.best_time_to_post}`,
    description: `Le taux de conversion actuel est sous-optimal. ${bestTime.reason}`
  };
}

/**
 * Génère une recommandation complète en langage naturel pour un produit
 */
async function generateAIRecommendation(product, sellerStats, platformStats) {
  const conversionProb = await predictConversionProbability(product, sellerStats, platformStats);
  const bestTime = await predictBestTime(product.category);
  const bestAction = await predictBestAction(product, sellerStats, platformStats);
  
  let message = "";
  let expectedBoost = "";

  if (bestAction.action === "boost") {
    message = `📊 Selon les données récentes, publier vers ${bestTime.best_time_to_post} pourrait augmenter la visibilité de votre annonce. Probabilité de conversion estimée à ${conversionProb}%.`;
    expectedBoost = "+200% à +300% de visibilité";
  } else if (bestAction.action === "share") {
    message = `🔥 Votre produit "${product.title}" a un bon potentiel. Partagez-le maintenant sur vos réseaux. Probabilité de vente : ${conversionProb}%.`;
    expectedBoost = "+$" + Math.round(product.price * 1.5) + " en 7 jours";
  } else if (bestAction.action === "optimize") {
    message = `📝 Améliorez la fiche produit : ajoutez des photos et un titre plus accrocheur. Probabilité de conversion actuelle : ${conversionProb}%.`;
    expectedBoost = "+50% de conversion";
  } else if (bestAction.action === "delete") {
    message = `⚠️ Ce produit n'a généré aucune interaction depuis ${Math.floor(product.age_heures/24)} jours. Supprimez-le pour vous concentrer sur des articles plus rentables.`;
    expectedBoost = "0$ (gain par libération d'espace)";
  } else {
    message = `📈 Probabilité élevée d'obtenir plus d'interactions entre ${bestTime.best_time_to_post}. Taux de conversion estimé à ${conversionProb}%.`;
    expectedBoost = "+30% d'engagement";
  }

  return {
    best_time_to_post: bestTime.best_time_to_post,
    action_recommendation: message,
    conversion_probability: conversionProb,
    expected_boost: expectedBoost,
    raw_action: bestAction.label
  };
}

// ==============================================
// 1.2 NOUVELLES FONCTIONS IA PRÉDICTIVES GLOBALES AVEC CACHE REDIS
// ==============================================

/**
 * Analyse les tendances globales de la plateforme (avec cache Redis)
 */
async function getPlatformTrends() {
  const cacheKey = 'assistant:platform_trends';
  
  if (redisClient && redisClient.isReady) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('Redis get error:', err.message);
    }
  }

  try {
    const [hotCategories] = await pool.query(`
      SELECT p.category, COUNT(*) AS activity
      FROM product_likes pl
      JOIN products p ON pl.product_id = p.id
      WHERE pl.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY p.category
      ORDER BY activity DESC
      LIMIT 3
    `);

    const [peakHourRow] = await pool.query(`
      SELECT HOUR(created_at) AS hour, COUNT(*) AS total
      FROM product_likes
      WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY hour
      ORDER BY total DESC
      LIMIT 1
    `);
    const globalPeakHour = peakHourRow.length > 0 ? peakHourRow[0].hour : 18;

    const [trendingKeywords] = await pool.query(`
      SELECT p.title
      FROM product_likes pl
      JOIN products p ON pl.product_id = p.id
      WHERE pl.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY p.id
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    let keywords = [];
    for (const row of trendingKeywords) {
      const words = row.title.split(' ').filter(w => w.length > 3);
      keywords.push(...words);
    }
    const freq = {};
    keywords.forEach(k => { freq[k.toLowerCase()] = (freq[k.toLowerCase()] || 0) + 1; });
    const topKeywords = Object.entries(freq)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 5)
      .map(k => k[0]);

    const result = {
      hotCategories: hotCategories.map(c => c.category),
      globalPeakHour,
      trendingKeywords: topKeywords
    };

    if (redisClient && redisClient.isReady) {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
    }

    return result;
  } catch (error) {
    console.error("Erreur getPlatformTrends:", error);
    return { hotCategories: [], globalPeakHour: 18, trendingKeywords: [] };
  }
}

/**
 * Analyse les performances récentes du vendeur (avec cache Redis, TTL 2 minutes)
 */
async function getSellerPerformanceTrends(sellerId) {
  const cacheKey = `assistant:seller_perf:${sellerId}`;
  
  if (redisClient && redisClient.isReady) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('Redis get error:', err.message);
    }
  }

  try {
    const [recent] = await pool.query(`
      SELECT 
        COALESCE(SUM(views_count), 0) AS total_views,
        COALESCE(SUM(likes_count), 0) AS total_likes
      FROM products
      WHERE seller_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
    `, [sellerId]);

    const [previous] = await pool.query(`
      SELECT 
        COALESCE(SUM(views_count), 0) AS total_views,
        COALESCE(SUM(likes_count), 0) AS total_likes
      FROM products
      WHERE seller_id = ? AND created_at BETWEEN DATE_SUB(NOW(), INTERVAL 60 DAY) AND DATE_SUB(NOW(), INTERVAL 30 DAY)
    `, [sellerId]);

    const viewTrend = recent.total_views - previous.total_views;
    const likeTrend = recent.total_likes - previous.total_likes;

    let trendMessage = "";
    if (viewTrend > 50) trendMessage = "📈 Forte augmentation de vos vues récemment !";
    else if (viewTrend < -50) trendMessage = "📉 Vos vues ont diminué. Vérifiez la qualité de vos publications.";
    else trendMessage = "📊 Activité stable, continuez ainsi.";

    const result = { viewTrend, likeTrend, trendMessage };

    if (redisClient && redisClient.isReady) {
      await redisClient.setEx(cacheKey, 120, JSON.stringify(result));
    }

    return result;
  } catch (error) {
    console.error("Erreur getSellerPerformanceTrends:", error);
    return { viewTrend: 0, likeTrend: 0, trendMessage: "Données insuffisantes pour analyser la tendance." };
  }
}

/**
 * Génère 1 à 2 prédictions globales intelligentes pour le vendeur
 */
async function generateGlobalPredictions(sellerId, weakProductsCount, topProductsCount, sellerAvgViews) {
  const trends = await getPlatformTrends();
  const sellerPerf = await getSellerPerformanceTrends(sellerId);
  const predictions = [];

  if (trends.hotCategories.length > 0) {
    const hotCat = trends.hotCategories[0];
    predictions.push({
      type: "trending_category",
      message: `🔥 Les produits de la catégorie "${hotCat}" sont actuellement très recherchés. Ajoutez des articles dans cette catégorie pour augmenter vos chances de vente.`,
      priority: "haute"
    });
  }

  const peakHour = trends.globalPeakHour;
  const peakStart = peakHour;
  const peakEnd = peakHour + 2 <= 23 ? peakHour + 2 : 23;
  predictions.push({
    type: "best_time_global",
    message: `⏰ D'après l'activité globale de la plateforme, vos publications ont le plus de chances d'être vues entre ${peakStart}h et ${peakEnd}h. Programmez vos publications pendant cette période.`,
    priority: "moyenne"
  });

  if (weakProductsCount > 3) {
    predictions.push({
      type: "quality_audit",
      message: `🔍 Vous avez ${weakProductsCount} produit(s) à faible score. Revoyez les photos et descriptions de ces articles pour améliorer leur attractivité.`,
      priority: "haute"
    });
  }

  if (topProductsCount === 0 && sellerAvgViews < 100) {
    predictions.push({
      type: "boost_suggestion",
      message: `🚀 Aucun produit star détecté. Lancez un petit boost (5$) sur votre meilleur article pour tester l'impact sur vos ventes.`,
      priority: "moyenne"
    });
  }

  if (trends.trendingKeywords.length >= 3) {
    const keywords = trends.trendingKeywords.slice(0,3).join(', ');
    predictions.push({
      type: "keyword_trend",
      message: `📢 Les mots-clés "${keywords}" sont tendance en ce moment. Pensez à les intégrer dans vos titres et descriptions.`,
      priority: "basse"
    });
  }

  if (sellerPerf.viewTrend > 50) {
    predictions.push({
      type: "positive_trend",
      message: `${sellerPerf.trendMessage} Profitez de cette dynamique pour ajouter plus de produits.`,
      priority: "basse"
    });
  } else if (sellerPerf.viewTrend < -50) {
    predictions.push({
      type: "negative_trend",
      message: `${sellerPerf.trendMessage} Essayez de partager vos produits sur les réseaux sociaux ou utilisez un boost.`,
      priority: "haute"
    });
  }

  const sorted = predictions.sort((a,b) => {
    const order = { haute: 3, moyenne: 2, basse: 1 };
    return order[b.priority] - order[a.priority];
  });
  return sorted.slice(0, 2);
}

// ==============================================
// 2. ROUTE PRINCIPALE
// ==============================================

router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const vendeur_id = req.userId;
    
    // MODIFICATION : Ajout de la récupération de l'image principale (main_image)
    const [products] = await pool.query(`
      SELECT 
        p.id,
        p.title,
        p.description,
        p.price,
        p.stock,
        p.views_count,
        p.likes_count,
        p.category,
        p.is_boosted,
        p.created_at,
        TIMESTAMPDIFF(HOUR, p.created_at, NOW()) AS age_heures,
        (SELECT COUNT(*) FROM product_images WHERE product_id = p.id) AS nb_images,
        IFNULL((SELECT JSON_ARRAYAGG(absolute_url) FROM product_images WHERE product_id = p.id), JSON_ARRAY()) AS images,
        (SELECT absolute_url FROM product_images WHERE product_id = p.id ORDER BY id LIMIT 1) AS main_image
      FROM products p
      WHERE p.seller_id = ?
        AND p.is_active = 1
      ORDER BY p.created_at DESC
    `, [vendeur_id]);
    
    if (!products.length) {
      return res.json({
        success: true,
        dashboard: {
          stats: { total_products: 0, total_views: 0, total_likes: 0, avg_views: 0, avg_likes: 0 },
          products: [],
          top_products: [],
          weak_products: [],
          recommandations_globales: ["📦 Aucun produit. Commencez par ajouter vos premiers articles pour activer l'assistant pro."],
          produits_a_supprimer: [],
          global_ai_predictions: []
        }
      });
    }
    
    const totalViews = products.reduce((s, p) => s + (p.views_count || 0), 0);
    const totalLikes = products.reduce((s, p) => s + (p.likes_count || 0), 0);
    const nbProducts = products.length;
    const avgSellerViews = totalViews / nbProducts;
    const avgSellerLikes = totalLikes / nbProducts;
    
    const [platformStats] = await pool.query(`
      SELECT AVG(views_count) AS avg_views, AVG(likes_count) AS avg_likes 
      FROM products WHERE is_active = 1
    `);
    const platformAvgViews = platformStats[0]?.avg_views || 40;
    const platformAvgLikes = platformStats[0]?.avg_likes || 8;
    
    const analyzedProducts = [];
    const weakProducts = [];
    const topProducts = [];
    const productsToDelete = [];
    
    for (const p of products) {
      const concurrence = await getConcurrenceData(p.category, p.price, p.title);
      const avgPriceSimilarNum = parseFloat(concurrence.avg_price_similar_products.replace('$', ''));
      
      const score = calculerScoreProduit(
        { views: p.views_count, likes: p.likes_count, ageHeures: p.age_heures, nbImages: p.nb_images, title: p.title, description: p.description },
        avgSellerViews, avgSellerLikes, platformAvgViews, platformAvgLikes
      );
      
      const statut = getStatut(score, { views: p.views_count, likes: p.likes_count, ageHeures: p.age_heures });
      const actions = getActionsRecommandees(
        { nbImages: p.nb_images, title: p.title, views: p.views_count, likes: p.likes_count, stock: p.stock, ageHeures: p.age_heures, price: p.price },
        score
      );
      const moneyInsights = getMoneyInsights(
        { views: p.views_count, likes: p.likes_count, price: p.price, ageHeures: p.age_heures, score },
        score,
        avgPriceSimilarNum
      );
      const prediction = predictionVentes({ views: p.views_count, price: p.price, isBoosted: p.is_boosted });
      const prixSuggestion = suggererPrixOptimal(p, avgPriceSimilarNum, parseFloat(concurrence.avg_price_category.replace('$', '')));
      
      const sellerStatsForAI = {
        avg_views_per_product: avgSellerViews,
        avg_likes_per_product: avgSellerLikes,
        total_products: nbProducts
      };
      const platformStatsForAI = {
        avg_views: platformAvgViews,
        avg_likes: platformAvgLikes
      };
      const aiPredictions = await generateAIRecommendation(
        {
          id: p.id,
          title: p.title,
          category: p.category,
          price: p.price,
          views: p.views_count,
          likes: p.likes_count,
          nb_images: p.nb_images,
          age_heures: p.age_heures,
          score: score
        },
        sellerStatsForAI,
        platformStatsForAI
      );
      
      const produitDetail = {
        id: p.id,
        title: p.title,
        price: `$${parseFloat(p.price).toFixed(2)}`,
        stock: p.stock,
        views: p.views_count || 0,
        likes: p.likes_count || 0,
        age_heures: p.age_heures,
        nb_images: p.nb_images,
        images: p.images || [],
        main_image: p.main_image || null, // ✅ Ajout de l'image principale
        category: p.category,
        is_boosted: p.is_boosted === 1,
        score: score,
        statut: statut,
        actions_recommandees: actions,
        money_insights: moneyInsights,
        prediction_ventes: prediction,
        suggestion_prix: prixSuggestion,
        concurrence: concurrence,
        ai_predictions: aiPredictions
      };
      
      analyzedProducts.push(produitDetail);
      if (score >= 75) topProducts.push(produitDetail);
      if (score < 35) weakProducts.push(produitDetail);
      if (p.views_count === 0 && p.likes_count === 0 && p.age_heures > 720) {
        productsToDelete.push({
          id: p.id,
          title: p.title,
          raison: "Aucune interaction depuis plus de 30 jours. Supprimez ou remplacez.",
          score: score,
          main_image: p.main_image || null
        });
      }
    }
    
    const globalRecommendations = [];
    if (totalViews === 0) {
      globalRecommendations.push("📢 Zéro vue sur tous vos produits. Activez le partage automatique et vérifiez la publication.");
    } else if (totalViews < 200 && nbProducts > 0) {
      globalRecommendations.push("📊 Faible visibilité globale. Lancez une campagne de boost groupée (promotion -10% sur 3 produits).");
    }
    if (weakProducts.length > Math.floor(nbProducts / 2)) {
      globalRecommendations.push(`🔍 ${weakProducts.length} produit(s) en zone critique. Priorisez les actions recommandées pour les sauver.`);
    }
    if (topProducts.length > 0) {
      globalRecommendations.push(`🏆 ${topProducts.length} produit(s) star ! Mettez-les en avant et créez des bundles.`);
    }
    if (productsToDelete.length > 0) {
      globalRecommendations.push(`🗑️ ${productsToDelete.length} produit(s) mort(s) identifié(s). Supprimez-les pour améliorer la qualité perçue de votre boutique.`);
    }
    if (globalRecommendations.length === 0 && nbProducts > 0) {
      globalRecommendations.push("✅ Bonne santé générale. Surveillez l'évolution chaque semaine.");
    }
    
    const globalAIPredictions = await generateGlobalPredictions(vendeur_id, weakProducts.length, topProducts.length, avgSellerViews);
    
    return res.json({
      success: true,
      dashboard: {
        stats: {
          total_products: nbProducts,
          total_views: totalViews,
          total_likes: totalLikes,
          avg_views_per_product: Math.round(avgSellerViews * 10) / 10,
          avg_likes_per_product: Math.round(avgSellerLikes * 10) / 10,
          platform_avg_views: Math.round(platformAvgViews),
          platform_avg_likes: Math.round(platformAvgLikes)
        },
        products: analyzedProducts,
        top_products: topProducts,
        weak_products: weakProducts,
        produits_a_supprimer: productsToDelete,
        recommandations_globales: globalRecommendations,
        global_ai_predictions: globalAIPredictions
      }
    });
    
  } catch (error) {
    console.error("❌ Assistant Vendeur Pro Error:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur technique. Veuillez réessayer."
    });
  }
});

module.exports = router;