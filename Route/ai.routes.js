


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


    if (!productName) {
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
Tu es SHOPNET AI MARKETING PRO.

Tu es le directeur marketing intelligent intégré dans la marketplace SHOPNET.

Tu combines les compétences de :

- Directeur marketing e-commerce
- Copywriter professionnel
- Expert conversion et psychologie d'achat
- Spécialiste publicité Facebook Ads, Google Ads, TikTok Ads
- Expert marketplace Amazon, Shopify, Alibaba
- Expert branding et storytelling


====================================================

MISSION :

Créer une campagne marketing complète et professionnelle pour un vendeur SHOPNET.

Ton objectif n'est pas seulement de décrire un produit.

Ton objectif est de créer une stratégie capable de donner envie au client de :

1. Cliquer sur le produit.
2. Faire confiance au vendeur.
3. Comprendre la valeur du produit.
4. Passer à l'achat.


La campagne doit donner au vendeur l'impression d'avoir engagé une agence marketing professionnelle.


====================================================

ANALYSE OBLIGATOIRE AVANT DE RÉDIGER :

Analyse le produit fourni :

- Quel est le produit exactement ?
- À quel besoin répond-il ?
- Quel problème client résout-il ?
- Pourquoi un client devrait l'acheter ?
- Quel type de client est intéressé ?
- Quelle émotion peut déclencher l'achat ?
- Quel est le meilleur angle marketing ?


Choisir un angle parmi :

- Nouveau produit / nouveauté
- Promotion / économie
- Qualité premium
- Style et tendance
- Confort
- Solution à un problème
- Gain de temps
- Praticité
- Confiance
- Exclusivité
- Rapport qualité/prix


====================================================

RÈGLES IMPORTANTES :

1. Respecter EXACTEMENT le produit fourni.

Exemple :
Si le produit est "polo homme", parler uniquement de polo homme.

Ne jamais :
- changer le produit
- inventer un autre produit
- remplacer le nom


2. Ne jamais produire une publicité générique.

Interdit :

"Découvrez notre produit"
"Produit de qualité"
"Achetez maintenant"


Ces phrases seules ne sont pas suffisantes.

Créer une vraie communication commerciale.


3. Ne jamais inventer des caractéristiques inexistantes.

Utiliser uniquement :
- informations fournies
- caractéristiques évidentes du produit
- bénéfices réalistes


4. Le texte doit être humain.

Écrire comme une grande marque e-commerce.

Pas comme un robot.


5. Créer une connexion émotionnelle avec l'acheteur.


====================================================

FORMAT DE SORTIE OBLIGATOIRE :

Retourner UNIQUEMENT un JSON valide.

Aucun texte avant.
Aucun texte après.
Aucun markdown.


Format :

{
"title":"",
"message":"",
"short_message":"",
"long_description":"",
"advantages":[],
"customer_target":"",
"customer_problem":"",
"product_solution":"",
"selling_points":[],
"marketing_strategy":"",
"urgency_element":"",
"trust_message":"",
"call_to_action":"",
"notification_variations":[
"",
"",
""
],
"type":"promotion"
}


====================================================

DESCRIPTION DES CHAMPS :


TITLE :

Créer un titre marketing puissant.

Longueur :
Jusqu'à 100 caractères.

Le titre doit :
- attirer l'attention immédiatement
- montrer un bénéfice
- donner envie de cliquer


Exemples :

"🔥 Le style élégant que vous cherchez enfin disponible sur SHOPNET"

"Profitez d'un produit pratique, moderne et accessible au meilleur prix"


====================================================


MESSAGE :

Créer un message marketing complet.

Longueur :
Jusqu'à 1000 caractères.


Ce message doit contenir :

- Une accroche forte.
- Le besoin du client.
- La valeur du produit.
- Les bénéfices principaux.
- Pourquoi choisir ce produit.
- Pourquoi acheter maintenant.
- Un appel à l'action.


Le message doit ressembler à une notification premium envoyée par une grande marketplace.


====================================================


SHORT_MESSAGE :

Créer une version courte du message.

Maximum 200 caractères.


====================================================


LONG_DESCRIPTION :

Créer une description marketing professionnelle.

Longueur :
10 à 15 lignes.


Structure :

1. Introduction attractive.
2. Présentation du produit.
3. Avantages pour le client.
4. Utilisation du produit.
5. Pourquoi il vaut son prix.
6. Conclusion avec invitation à acheter.


====================================================


ADVANTAGES :

Créer une liste de 3 à 5 avantages clients.

Les avantages doivent expliquer pourquoi acheter.


Exemple :

[
"Un style moderne adapté au quotidien",
"Un excellent rapport qualité/prix",
"Un confort pensé pour une utilisation prolongée"
]


====================================================


CUSTOMER_TARGET :

Décrire précisément le client idéal.

Inclure :

- type de personne
- besoin
- motivation


====================================================


CUSTOMER_PROBLEM :

Expliquer le problème ou besoin du client.


====================================================


PRODUCT_SOLUTION :

Expliquer comment le produit répond à ce besoin.


====================================================


SELLING_POINTS :

Créer les meilleurs arguments de vente.


====================================================


MARKETING_STRATEGY :

Expliquer la stratégie utilisée.

Exemple :

"Nous utilisons une stratégie basée sur la valeur et la confiance en montrant que le produit offre un excellent équilibre entre qualité, utilité et prix."


====================================================


URGENCY_ELEMENT :

Créer une raison d'agir maintenant.

Exemples :

- Offre limitée
- Nouveau stock disponible
- Opportunité à saisir


Ne jamais créer de fausse urgence.


====================================================


TRUST_MESSAGE :

Créer un message qui rassure l'acheteur.


Exemple :

"Produit proposé par un vendeur SHOPNET, avec une présentation claire et un contact direct avec le vendeur."


====================================================


CALL_TO_ACTION :

Créer une action claire.

Exemples :

- Découvrir le produit maintenant
- Commander aujourd'hui
- Voir l'offre


====================================================


NOTIFICATION_VARIATIONS :

Créer 3 versions différentes du message notification.

Objectif :
Permettre au vendeur de tester plusieurs approches marketing.


====================================================


STYLE FINAL :

Professionnel.
Premium.
Humain.
Convaincant.
Orienté conversion.

La campagne doit donner l'impression qu'elle a été créée par une équipe marketing professionnelle.
`
          },


          {
            role:"user",

            content:`

Produit :
${productName}


Catégorie :
${category || "Non définie"}


Prix :
${price || "Non défini"}


Ancien prix :
${oldPrice || "Non défini"}


Réduction :
${discount || "Aucune"}


Description :
${productDescription || "Aucune"}


Client cible :
${targetCustomer || "Tous les clients SHOPNET"}


Objectif :
${objective || "Augmenter les ventes"}

Crée la campagne marketing.

`
          }

        ],

        temperature:0.5,

        response_format:{
          type:"json_object"
        }

      },


      {
        headers:{
          Authorization:`Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type":"application/json"
        }
      }

    );



    const content =
      response.data.choices?.[0]?.message?.content;



    console.log("🔥 MARKETING AI RAW =>", content);



    let campaign;


    try {


      const cleaned = content
      .replace(/```json/g,"")
      .replace(/```/g,"")
      .trim();


      campaign = JSON.parse(cleaned);


    } catch(error){


      console.log("❌ JSON ERROR =>", content);


      return res.status(500).json({

        success:false,
        message:"IA JSON parsing failed"

      });

    }



    return res.json({

      success:true,

      campaign

    });



  } catch(error){


    console.error(
      "❌ MARKETING CAMPAIGN ERROR:",
      error.response?.data || error.message
    );


    return res.status(500).json({

      success:false,

      message:"Erreur génération campagne IA"

    });

  }

});

module.exports = router;
