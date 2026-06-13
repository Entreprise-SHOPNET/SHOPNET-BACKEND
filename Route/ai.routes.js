


//Route/ai.routes

const express = require("express");
const router = express.Router();
const axios = require("axios");

// ======================
// IA GROQ - DESCRIPTION PRODUIT
// ======================
router.get("/description", async (req, res) => {
  try {
    const { title, category } = req.query;

    if (!title || !category) {
      return res.status(400).json({
        success: false,
        message: "title et category sont obligatoires"
      });
    }

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "Tu es un expert e-commerce professionnel. Tu écris des descriptions courtes (max 6 lignes), claires, structurées, sans exagération, adaptées à une marketplace comme Amazon ou Shopify. Tu mets en valeur les avantages du produit."
          },
          {
            role: "user",
            content: `Produit: ${title}\nCatégorie: ${category}\n\nGénère une description attractive et professionnelle.`
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const text = response.data.choices?.[0]?.message?.content;

    return res.json({
      success: true,
      description: text
    });

  } catch (error) {
    console.error("❌ GROQ ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "IA error"
    });
  }
});



// ======================
// IA GROQ - ASSISTANT SHOPNET (VENDEUR + ACHETEUR)
// ======================
router.post("/assistant", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "message est obligatoire"
      });
    }

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
Tu es SHOPNET AI Assistant, l'assistant officiel de la marketplace SHOPNET.

SHOPNET est une plateforme e-commerce où il y a des vendeurs et des acheteurs.

TON RÔLE :
- Aider les VENDEURS à vendre leurs produits
- Aider les ACHETEURS à acheter et comprendre SHOPNET
- Expliquer les fonctionnalités de SHOPNET (produits, commandes, paiements, boost, boutique premium)
- Répondre aux questions de manière simple, claire et professionnelle

INFORMATIONS SHOPNET :
- Les vendeurs peuvent publier des produits avec images et descriptions
- Les vendeurs peuvent booster leurs produits pour plus de visibilité
- SHOPNET a des boutiques premium pour les vendeurs avancés
- Les acheteurs peuvent commander des produits directement sur la plateforme
- Les commandes passent par un système de suivi

RÈGLES :
- Ne jamais inventer des fonctionnalités qui n'existent pas dans SHOPNET
- Toujours rester dans le contexte SHOPNET
- Répondre comme un assistant professionnel e-commerce
- Être court, clair et utile
- Si tu ne sais pas, dire de contacter le support SHOPNET
            `
          },
          {
            role: "user",
            content: message
          }
        ],
        temperature: 0.6
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const text = response.data.choices?.[0]?.message?.content;

    return res.json({
      success: true,
      response: text
    });

  } catch (error) {
    console.error("❌ SHOPNET ASSISTANT ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "assistant error"
    });
  }
});

router.post("/search", async (req, res) => {
  try {
    console.log("========== SHOPNET AI SEARCH ==========");

    const query = req.body?.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "query est obligatoire"
      });
    }

    console.log("QUERY =>", query);

    // ======================
    // 1. IA (EXTRACTION INTENTION)
    // ======================
    const groqResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
Tu es un moteur de recherche e-commerce.

Ton rôle :
- Comprendre l'intention utilisateur
- Extraire uniquement les mots utiles pour rechercher des produits

RÈGLES STRICTES :
- Retourne UNIQUEMENT du JSON valide
- Pas de texte
- Pas d'explication
- Pas de mots inutiles

IMPORTANT :
- garde seulement les mots importants produits (type produit, marque, catégorie)
- ignore les mots inutiles (je veux, cherche, un, de, avec)

EXEMPLES :

"je cherche un ordinateur puissant pour gaming"
→ ["ordinateur", "gaming", "puissant"]

"je veux un téléphone bonne batterie"
→ ["téléphone", "batterie"]

"chaussure de sport nike"
→ ["chaussure", "sport", "nike"]

FORMAT :
{
  "keywords": ["mot1", "mot2"]
}
            `
          },
          {
            role: "user",
            content: query
          }
        ],
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const content = groqResponse.data.choices?.[0]?.message?.content;

    console.log("🔥 GROQ RAW =>", content);

    // ======================
    // 2. PARSING SAFE
    // ======================
    let keywords = [];

    try {
      const cleaned = content
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const parsed = JSON.parse(cleaned);
      keywords = parsed.keywords || [];
    } catch (e) {
      console.log("❌ JSON ERROR => fallback");
      keywords = query.split(" ");
    }

    console.log("🔑 KEYWORDS =>", keywords);

    const db = require("../db");

    // ======================
    // 3. NETTOYAGE FINAL
    // ======================
    const cleanKeywords = keywords
      .map(k => k.toLowerCase())
      .filter(k => k.length > 2);

    console.log("🧹 CLEAN =>", cleanKeywords);

    // ======================
    // 4. FULLTEXT SEARCH (PRIORITY)
    // ======================
// ======================
// 4. FULLTEXT SEARCH (PRIORITY) + IMAGE
// ======================
const searchQuery = cleanKeywords.map(k => `+${k}`).join(" ");

let [products] = await db.query(`
  SELECT 
    p.*,

    -- 🔥 AJOUT IMAGE PRINCIPALE
    (
      SELECT pi.absolute_url
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.id ASC
      LIMIT 1
    ) AS image_url,

    MATCH(p.title, p.description, p.category)
    AGAINST (? IN BOOLEAN MODE) AS score

  FROM products p
  WHERE MATCH(p.title, p.description, p.category)
  AGAINST (? IN BOOLEAN MODE)
  ORDER BY score DESC
  LIMIT 50
`, [searchQuery, searchQuery]);

// ======================
// 5. FALLBACK SI AUCUN RÉSULTAT + IMAGE
// ======================
if (!products || products.length === 0) {
  console.log("⚠️ FULLTEXT EMPTY → fallback LIKE");

  const likeQuery = `%${cleanKeywords.join(" ")}%`;

  [products] = await db.query(`
    SELECT 
      p.*,

      -- 🔥 IMAGE AUSSI ICI
      (
        SELECT pi.absolute_url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.id ASC
        LIMIT 1
      ) AS image_url

    FROM products p
    WHERE p.title LIKE ?
    OR p.description LIKE ?
    OR p.category LIKE ?
    LIMIT 50
  `, [likeQuery, likeQuery, likeQuery]);
}

    // ======================
    // 6. RESPONSE FINAL
    // ======================
    return res.json({
      success: true,
      query,
      keywords: cleanKeywords,
      count: products.length,
      products
    });

  } catch (error) {
    console.log("❌ SEARCH ERROR =>", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "search error"
    });
  }
});

module.exports = router;
