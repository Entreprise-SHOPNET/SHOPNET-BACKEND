


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

module.exports = router;
