


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











// ======================
// IA - AUTO CREATION PRODUIT SHOPNET
// ======================
// ======================
// IA - AUTO CREATION PRODUIT SHOPNET (CATÉGORIES FIXES)
// ======================
router.post("/generate-product", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: "prompt est obligatoire"
      });
    }

    console.log("🚀 AI PRODUCT GENERATION =>", prompt);

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
Tu es SHOPNET AI PRODUCT CREATOR.

Ton rôle :
Transformer une idée utilisateur en fiche produit e-commerce.
Un fichier correct pour le profesionel pour un humain
IMPORTANT RULES :
- Retourne UNIQUEMENT du JSON valide
- Aucun texte
- Aucun commentaire

CATÉGORIES AUTORISÉES (OBLIGATOIRE) :
- mode
- home
- books
- auto
- electronics
- Tech
- fashion
- Tendance
- beauty
- Beauté
- Maison
- sports

RÈGLES IMPORTANTES :
- Tu DOIS choisir UNE catégorie EXACTEMENT dans la liste ci-dessus
- Ne jamais inventer une nouvelle catégorie
- Si incertain → choisir "Tendance"

FORMAT OBLIGATOIRE :
{
  "title": "string",
  "description": "string",
  "category": "string (must be from allowed list)",
  "price": number,
  "tags": ["tag1", "tag2", "tag3"],
  "confidence": number
}

STYLE :
- e-commerce professionnel
- description courte et vendeuse
- prix réaliste
            `
          },
          {
            role: "user",
            content: prompt
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

    const content = response.data.choices?.[0]?.message?.content;

    let product;

    try {
      const cleaned = content
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      product = JSON.parse(cleaned);

      // 🔥 VALIDATION BACKEND (SECURITÉ FINALE)
      const allowedCategories = [
        "mode",
        "home",
        "books",
        "auto",
        "electronics",
        "Tech",
        "fashion",
        "Tendance",
        "beauty",
        "Beauté",
        "Maison",
        "sports"
      ];

      if (!allowedCategories.includes(product.category)) {
        product.category = "Tendance";
      }

    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "IA JSON parsing failed"
      });
    }

    return res.json({
      success: true,
      prompt,
      product
    });

  } catch (error) {
    console.log("❌ GENERATE PRODUCT ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "generate product error"
    });
  }
});






// ======================
// IA - AUTO CREATION PRODUIT SHOPNET
// ======================
// ======================
// IA - AUTO CREATION PRODUIT SHOPNET (CATÉGORIES FIXES)
// ======================

router.post("/help-center", async (req, res) => {
  try {
    const { message, userContext } = req.body;

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
Tu es SHOPNET HELP CENTER AI.

Ton rôle :
- Répondre UNIQUEMENT aux questions d'aide
- Aider les utilisateurs SHOPNET (vendeurs et acheteurs)
- Expliquer comment utiliser l'application

CONTEXTE SHOPNET :
- Marketplace e-commerce
- Acheteurs commandent des produits
- Vendeurs publient et vendent des produits
- Livraison gérée par vendeurs ou partenaires
- Paiements et commandes intégrés

RÈGLES STRICTES :
- Ne jamais parler de produits spécifiques
- Ne jamais inventer des fonctionnalités
- Ne jamais sortir de SHOPNET
- Réponse courte, simple, claire
- Si tu ne sais pas → dire "Contactez le support SHOPNET"

STYLE :
- professionnel
- simple
- direct
- 5 à 10 lignes maximum
            `
          },
          {
            role: "user",
            content: `
Question utilisateur : ${message}

${userContext ? "Contexte utilisateur : " + JSON.stringify(userContext) : ""}
            `
          }
        ],
        temperature: 0.4
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
    console.error("❌ HELP CENTER AI ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "help center AI error"
    });
  }
});






// ======================================================
// SHOPNET AI MARKETING CAMPAIGN GENERATOR
// Génération complète de campagne marketing vendeur
//
// POST /api/ai/marketing-campaign
// ======================================================


router.post("/marketing-campaign", async (req, res) => {

  try {


    const {
      productName,
      category,
      price,
      oldPrice,
      discount,
      productDescription,
      targetCustomer,
      objective
    } = req.body;



    if(!productName){

      return res.status(400).json({

        success:false,

        message:"productName obligatoire"

      });

    }




    const response = await axios.post(

      "https://api.groq.com/openai/v1/chat/completions",


      {

        model:"llama-3.1-8b-instant",


        messages:[


          {

            role:"system",

            content:`

Tu es SHOPNET MARKETING AI PRO.

Tu es un expert international en marketing digital e-commerce avec une expérience similaire aux équipes marketing de Amazon, Shopify et grandes marketplaces.

Ton rôle est de créer une campagne marketing professionnelle pour un vendeur SHOPNET.

Tu dois comprendre :
- Le comportement des acheteurs en ligne.
- La psychologie d'achat.
- Comment créer de la confiance.
- Comment donner envie de cliquer sur une notification.
- Comment augmenter les ventes sans exagération.


OBJECTIF :

Créer une notification marketing humaine, naturelle et convaincante qui ressemble à un message écrit par un vrai vendeur professionnel.


IMPORTANT :

- Ne jamais écrire comme un robot.
- Utiliser un langage simple et chaleureux.
- Mettre en avant la valeur du produit.
- Créer une connexion émotionnelle avec le client.
- Donner envie de découvrir le produit.
- Ne jamais inventer des caractéristiques inexistantes.
- Ne jamais promettre des résultats impossibles.


LA REPONSE DOIT ETRE UNIQUEMENT UN JSON VALIDE.


FORMAT OBLIGATOIRE :


{
 "title":"",
 "short_message":"",
 "long_description":"",
 "advantages":[
    "",
    "",
    ""
 ],
 "marketing_strategy":"",
 "call_to_action":"",
 "type":"promotion"
}



EXPLICATION DES CHAMPS :


title :
Titre court très attirant maximum 60 caractères.
Exemple:
🔥 Offre spéciale sur votre nouveau style


short_message :
Message notification mobile maximum 200 caractères.


long_description :
Description marketing longue entre 5 et 10 lignes.
Elle doit expliquer :
- pourquoi acheter ce produit
- pour quel type de client
- quels problèmes il résout
- pourquoi maintenant


advantages :
Liste de 3 à 5 avantages réels du produit.


marketing_strategy :
Explique la stratégie utilisée :
(exemple : urgence, nouveauté, confiance, économie)


call_to_action :
Action claire :
- Découvrir maintenant
- Commander aujourd'hui
- Voir le produit


STYLE :
Professionnel.
Humain.
Confiant.
Comme une grande marque e-commerce.



`

          },


          {


            role:"user",


            content:`

Voici les informations du produit :


Nom :
${productName}


Catégorie :
${category || "Non définie"}


Prix actuel :
${price || "Non défini"}


Ancien prix :
${oldPrice || "Non défini"}


Réduction :
${discount || "Aucune"}


Description existante :
${productDescription || "Aucune description"}


Client cible :
${targetCustomer || "Tous les clients SHOPNET"}


Objectif :
${objective || "Augmenter les ventes"}


Crée une campagne marketing complète.


`

          }


        ],


        temperature:0.7


      },


      {


        headers:{


          Authorization:
          `Bearer ${process.env.GROQ_API_KEY}`,


          "Content-Type":"application/json"


        }


      }


    );




    const content =
      response.data.choices?.[0]?.message?.content;




    let campaign;



    try{


      const clean = content

      .replace(/```json/g,"")

      .replace(/```/g,"")

      .trim();



      campaign = JSON.parse(clean);



    }catch(error){


      console.log("JSON AI ERROR:",content);



      return res.status(500).json({

        success:false,

        message:"Format IA invalide"

      });


    }





    return res.json({


      success:true,


      campaign



    });





  }catch(error){


    console.error(

      "❌ MARKETING CAMPAIGN AI ERROR:",

      error.response?.data || error.message

    );



    res.status(500).json({

      success:false,

      message:"Erreur génération campagne IA"

    });


  }


});

module.exports = router;
