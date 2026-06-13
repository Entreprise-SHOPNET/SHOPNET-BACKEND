


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



// ======================
// IA GROQ - SEARCH INTELLIGENTE SHOPNET (PRO)
// ======================
router.post("/search", async (req, res) => {
  try {
    console.log("========== AI SEARCH HIT ==========");

    const query = req.body?.query;

    console.log("QUERY =>", query);

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "query est obligatoire"
      });
    }

    console.log("🚀 ENVOI VERS GROQ...");

    // ======================
    // 1. IA INTELLIGENTE (PROMPT OPTIMISÉ)
    // ======================
    const groqResponse = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
Tu es SHOPNET AI SEARCH ENGINE, un moteur de recherche e-commerce ultra intelligent.

TON OBJECTIF :
Comprendre l'intention réelle de l'utilisateur et générer des mots-clés utiles pour trouver des produits.

RÈGLES IMPORTANTES :
- Retourne UNIQUEMENT du JSON valide
- Aucun texte, aucune explication
- Ajoute des synonymes et intentions
- Ajoute des caractéristiques produits possibles

EXEMPLES :

"téléphone batterie longue durée"
→ ["téléphone", "batterie", "6000mAh", "autonomie", "longue durée"]

"iphone pas cher"
→ ["iphone", "apple", "budget", "pas cher", "occasion"]

"ordinateur gaming puissant"
→ ["ordinateur", "gaming", "RTX", "puissant", "ram", "carte graphique"]

FORMAT OBLIGATOIRE :
{
  "keywords": ["mot1", "mot2", "mot3"]
}
            `
          },
          {
            role: "user",
            content: query
          }
        ],
        temperature: 0.3
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
    // 2. PARSING ROBUSTE JSON
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
      console.log("❌ JSON PARSE ERROR =>", e.message);
      keywords = query.split(" ");
    }

    console.log("🔑 KEYWORDS =>", keywords);

    // ======================
    // 3. SEARCH MYSQL (FULLTEXT + BOOLEAN MODE)
    // ======================
    const db = require("../db");

    const searchQuery = keywords.map(k => `+${k}`).join(" ");

    console.log("SQL SEARCH =>", searchQuery);

    const [products] = await db.query(`
      SELECT *,
      MATCH(title, description, category)
      AGAINST (? IN BOOLEAN MODE) AS score
      FROM products
      WHERE MATCH(title, description, category)
      AGAINST (? IN BOOLEAN MODE)
      ORDER BY score DESC
      LIMIT 50
    `, [searchQuery, searchQuery]);

    console.log("📦 PRODUCTS FOUND =>", products.length);

    // ======================
    // 4. RESPONSE FINAL
    // ======================
    return res.json({
      success: true,
      query,
      keywords,
      count: products.length,
      products
    });

  } catch (error) {
    console.log("❌ SEARCH ERROR FULL =>", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "search error"
    });
  }
});

module.exports = router;
