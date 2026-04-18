




// utils/notificationTemplates.js
// utils/notificationTemplates.js

const templates = {
  cart_abandoned: [
    {
      title: "🛒 Tu as oublié quelque chose",
      message: (p) => `Ton produit "${p}" t’attend toujours dans ton panier. Finalise ta commande avant qu’il ne disparaisse.`,
    },
    {
      title: "⏳ Toujours disponible",
      message: (p) => `"${p}" est encore disponible, mais les stocks peuvent changer rapidement.`,
    },
    {
      title: "🔥 Dernier rappel",
      message: (p) => `Attention ! "${p}" pourrait être épuisé bientôt.`,
    },
    {
      title: "💡 On te le garde",
      message: (p) => `Tu avais ajouté "${p}" au panier. On l’a gardé pour toi.`,
    },
  ],

  new_product: [
    {
      title: "🆕 Nouveau produit",
      message: (p) => `Découvre "${p}" maintenant sur SHOPNET.`,
    },
    {
      title: "✨ Nouveauté",
      message: (p) => `"${p}" vient d’arriver. Sois parmi les premiers à le tester.`,
    },
    {
      title: "🚀 Fraîchement arrivé",
      message: (p) => `Nouveau sur SHOPNET : "${p}" est disponible dès maintenant.`,
    },
  ],

  trend: [
    {
      title: "🔥 Tendance du moment",
      message: (p) => `"${p}" est en train de devenir viral sur SHOPNET.`,
    },
    {
      title: "📈 Très populaire",
      message: (p) => `Beaucoup d’utilisateurs consultent "${p}" en ce moment.`,
    },
    {
      title: "👀 Produit viral",
      message: (p) => `"${p}" attire fortement les acheteurs aujourd’hui.`,
    },
  ],

  price_drop: [
    {
      title: "📉 Baisse de prix",
      message: (p) => `Bonne nouvelle : "${p}" vient de baisser de prix.`,
    },
    {
      title: "💸 Offre limitée",
      message: (p) => `"${p}" est maintenant disponible à un meilleur prix.`,
    },
  ],

  back_in_stock: [
    {
      title: "🔄 Retour en stock",
      message: (p) => `"${p}" est de nouveau disponible.`,
    },
    {
      title: "🎉 Disponible à nouveau",
      message: (p) => `Bonne nouvelle : "${p}" est revenu en stock.`,
    },
  ],

  order_confirmed: [
    {
      title: "✅ Commande confirmée",
      message: (p) => `Ta commande pour "${p}" a été validée avec succès.`,
    },
    {
      title: "🎉 Merci !",
      message: (p) => `Nous préparons "${p}" pour l’expédition.`,
    },
  ],

  shipping: [
    {
      title: "🚚 En route",
      message: (p) => `"${p}" est en cours de livraison.`,
    },
    {
      title: "📦 Expédié",
      message: (p) => `Ton colis contenant "${p}" a quitté notre entrepôt.`,
    },
  ],

  delivered: [
    {
      title: "🎁 Livré",
      message: (p) => `"${p}" a bien été livré.`,
    },
    {
      title: "🏠 Arrivé chez toi",
      message: (p) => `Ton produit "${p}" est arrivé chez toi.`,
    },
  ],

  review_request: [
    {
      title: "⭐ Ton avis",
      message: (p) => `Que penses-tu de "${p}" ? Donne ton avis pour aider les autres utilisateurs.`,
    },
    {
      title: "📝 Évaluation",
      message: (p) => `Partage ton expérience avec "${p}".`,
    },
  ],

  flash_sale: [
    {
      title: "⚡ Vente flash",
      message: (p) => `"${p}" est en promotion pour une durée très limitée.`,
    },
    {
      title: "🔥 Offre rapide",
      message: (p) => `Ne rate pas la réduction sur "${p}" maintenant.`,
    },
  ],
};

module.exports = templates;
