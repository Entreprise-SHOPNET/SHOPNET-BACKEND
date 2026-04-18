


const fs = require('fs');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const { Expo } = require('expo-server-sdk');

// 🔹 FIREBASE ADMIN INIT 🔹
const admin = require('firebase-admin');

// Render stocke ton fichier secret dans /etc/secrets/firebaseKey.json
const serviceAccountPath = path.resolve('/etc/secrets/firebaseKey.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log('✅ Firebase Admin initialisé avec succès');
//const { exportDB } = require('./exportDB'); // Chemin vers ton fichier exportDB.js
const expo = new Expo();
const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Socket.IO pour notifications temps réel
const connectedUsers = new Map(); // Map<userId, Set<Socket>>

io.on('connection', (socket) => {
  console.log(`📡 Nouveau client connecté : ${socket.id}`);

  socket.on('registerUser', (userId) => {
    console.log(`🔹 Utilisateur enregistré côté serveur: ${userId}`);
    if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
    connectedUsers.get(userId).add(socket);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client déconnecté : ${socket.id}`);
    for (const [userId, sockets] of connectedUsers.entries()) {
      if (sockets.has(socket)) {
        sockets.delete(socket);
        if (sockets.size === 0) connectedUsers.delete(userId);
        break;
      }
    }
  });
});



// Notification ciblée (Socket.IO)
app.set('notifyUser', (userId, message) => {
  const sockets = connectedUsers.get(userId);
  if (sockets) {
    sockets.forEach(socket => socket.emit('newOrder', message));
    console.log(`📢 Notification envoyée à l'utilisateur ${userId} (${sockets.size} appareils)`);
  } else {
    console.log(`⚠️ Utilisateur ${userId} non connecté`);
  }
});

// Notification globale via FCM + Socket
// Notification globale via FCM + Socket
app.set('notifyAll', async (title, message) => {
  const db = require('./db');
  const dateNow = new Date();

  try {
    // 🔹 récupérer utilisateurs
    const [users] = await db.query(`
      SELECT id FROM utilisateurs WHERE role IN ('vendeur', 'acheteur')
    `);

    if (!users || users.length === 0) {
      return console.log('⚠️ Aucun utilisateur pour notification globale');
    }

    const messagesExpo = [];

    for (const user of users) {

      // 🔹 sauvegarde notification
      await db.query(
        `INSERT INTO notifications 
          (utilisateur_id, cible, type, titre, contenu, lu, priorite, date_envoi, date_notification)
          VALUES (?, 'tous', 'info', ?, ?, 0, 'normale', ?, ?)`,
        [user.id, title, message, dateNow, dateNow]
      );

      // 🔥 récupérer token FCM
      const [tokens] = await db.query(
        'SELECT fcm_token FROM fcm_tokens WHERE user_id = ?',
        [user.id]
      );

      if (tokens.length > 0 && tokens[0].fcm_token) {
        messagesExpo.push({
          to: tokens[0].fcm_token,
          title,
          body: message,
          data: { title, message },
        });
      }
    }

    // 🔹 Socket.IO broadcast
    io.emit('globalNotification', {
      titre: title,
      contenu: message,
      date_notification: dateNow.toISOString(),
      type: 'info',
      priorite: 'normale'
    });

    // 🔥 ENVOI FCM (IMPORTANT)
    const admin = require('firebase-admin');

    for (const msg of messagesExpo) {
      try {
        await admin.messaging().send({
          token: msg.to,
          notification: {
            title: msg.title,
            body: msg.body
          },
          data: Object.keys(msg.data || {}).reduce((acc, key) => {
            acc[key] = String(msg.data[key]);
            return acc;
          }, {})
        });
      } catch (err) {
        console.error('❌ Erreur FCM:', err.message);
      }
    }

    console.log(`📢 Notifications envoyées à ${users.length} utilisateurs`);

  } catch (err) {
    console.error('❌ Erreur notification globale:', err);
  }
});

// Envoi automatique aléatoire de notifications
const messagesTypes = require('./Route/Notifications/messagesTypes');

async function sendRandomNotifications() {
  try {
    const count = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < count; i++) {
      const randomMsg = messagesTypes[Math.floor(Math.random() * messagesTypes.length)];
      await app.get('notifyAll')(randomMsg.titre, randomMsg.contenu);
    }
    console.log(`🕒 ${count} notifications automatiques envoyées`);
  } catch (err) {
    console.error('❌ Erreur envoi automatique:', err);
  }
}

function scheduleNextNotification() {
  const delay = 2 * 60 * 60 * 1000;

  console.log("⏰ Notifications automatiques ACTIVÉES");

  setInterval(async () => {
    try {
      await sendRandomNotifications();
    } catch (err) {
      console.log("❌ AUTO NOTIF ERROR:", err.message);
    }
  }, delay);
}
setTimeout(() => {
  console.log('🔔 Notifications automatiques activées');
  scheduleNextNotification();
}, 5000);



// ======================================================
// 🛒 CART ABANDONED AUTO NOTIFICATION (CRON)
// ======================================================

function startCartAbandonedCron() {
  console.log("⏰ Cart Abandoned CRON activé (1h)");

  setInterval(async () => {
    try {
      const [rows] = await db.query(`
        SELECT 
          c.user_id,
          c.product_id,
          c.updated_at,
          f.fcm_token
        FROM carts c
        JOIN fcm_tokens f ON f.user_id = c.user_id
        WHERE c.updated_at BETWEEN NOW() - INTERVAL 24 HOUR AND NOW() - INTERVAL 2 HOUR
      `);

      const sent = new Set();

      for (const item of rows) {
        try {
          if (!item.fcm_token) continue;

          const key = `${item.user_id}-${item.product_id}`;
          if (sent.has(key)) continue;
          sent.add(key);

          const [productRows] = await db.query(
            'SELECT title FROM products WHERE id = ?',
            [item.product_id]
          );

          const title = productRows[0]?.title || 'ce produit';

          const [imageRows] = await db.query(
            'SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1',
            [item.product_id]
          );

          let imageUrl = '';

          if (imageRows.length > 0) {
            const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

            imageUrl = imageRows[0].image_path.startsWith("http")
              ? imageRows[0].image_path
              : `${CLOUDINARY_BASE}${imageRows[0].image_path}`;
          }

          const hours = Math.floor(
            (Date.now() - new Date(item.updated_at)) / (1000 * 60 * 60)
          );

          let notifTitle = '';
          let message = '';

          if (hours >= 2 && hours < 6) {
            notifTitle = '🛒 Ton panier t’attend';
            message = `Tu as laissé "${title}" dans ton panier 🔥`;
          } else if (hours >= 6 && hours < 12) {
            notifTitle = '⏳ Toujours disponible';
            message = `"${title}" est encore dans ton panier 💡`;
          } else {
            notifTitle = '🔥 Dernier rappel';
            message = `"${title}" risque de disparaître 🛒`;
          }

          await sendPushNotification(
            item.fcm_token,
            notifTitle,
            message,
            {
              type: 'cart_abandoned',
              productId: item.product_id,
              image: imageUrl
            }
          );

        } catch (err) {
          console.log("❌ item error:", err.message);
        }
      }

      console.log(`🛒 Cart CRON exécuté: ${rows.length} items`);

    } catch (err) {
      console.log("❌ Cart cron error:", err.message);
    }

  }, 60 * 60 * 1000);
}

// 🚀 LANCEMENT UNIQUE AU DÉMARRAGE
setTimeout(() => {
  startCartAbandonedCron();
}, 5000);








// 🔹 Middlewares, sécurité, uploads (inchangés)
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));

// ... reste du code serveur (uploads, db, routes)

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', apiLimiter);

const configureUploadsDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

const UPLOADS_DIR = configureUploadsDir(path.resolve(__dirname, 'uploads'));
const PRODUCTS_DIR = configureUploadsDir(path.join(UPLOADS_DIR, 'products'));
const PROFILE_DIR = configureUploadsDir(path.join(UPLOADS_DIR, 'profile'));
const COVER_DIR = configureUploadsDir(path.join(UPLOADS_DIR, 'cover'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = UPLOADS_DIR;
    if (file.fieldname === 'products') uploadPath = PRODUCTS_DIR;
    else if (file.fieldname === 'profile') uploadPath = PROFILE_DIR;
    else if (file.fieldname === 'cover') uploadPath = COVER_DIR;
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only JPEG, PNG and WEBP are allowed!'), false);
};

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter
});

app.use((req, res, next) => {
  if (req.headers['content-type']?.startsWith('multipart/form-data')) next();
  else express.json({ limit: '10mb' })(req, res, next);
});

app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cache-Control', 'public, max-age=31536000');
  }
}));

const db = require('./db');
app.use((req, res, next) => {
  req.db = db;
  next();
});
const errorHandler = require('./middlewares/errorHandler');
 const sendPushNotification = require('./utils/sendPushNotification');

// ======================================================
// 🔥 AUTO TREND PUSH (TOUTES LES 30 MINUTES)
// ======================================================
// ======================================================
// 🔥 AUTO TREND PUSH (PROPRE + STABLE)
// ======================================================

const sendTrendPush = async () => {
  try {
    console.log("⏱ [TREND] Début récupération données...");

    // 🔥 1. Produits populaires
    const [products] = await db.query(`
      SELECT 
        p.id,
        p.title,
        COUNT(DISTINCT l.id) AS likes,
        COUNT(DISTINCT v.id) AS views,
        COUNT(DISTINCT c.user_id) AS carts
      FROM products p
      LEFT JOIN product_likes l ON l.product_id = p.id
      LEFT JOIN product_views v ON v.product_id = p.id
      LEFT JOIN carts c ON c.product_id = p.id
      GROUP BY p.id
      ORDER BY (
        COUNT(DISTINCT l.id)*3 + 
        COUNT(DISTINCT v.id) + 
        COUNT(DISTINCT c.user_id)*2
      ) DESC
      LIMIT 20
    `);

    if (!products || products.length === 0) {
      console.log("⚠️ Aucun produit trend trouvé");
      return;
    }

    console.log(`📦 Produits trouvés: ${products.length}`);

    // 👥 2. Utilisateurs avec token
    const [users] = await db.query(`
      SELECT user_id, fcm_token 
      FROM fcm_tokens 
      WHERE fcm_token IS NOT NULL
    `);

    if (!users || users.length === 0) {
      console.log("⚠️ Aucun utilisateur avec FCM token");
      return;
    }

    console.log(`👥 Utilisateurs trouvés: ${users.length}`);

    let success = 0;
    let failed = 0;

    // 🎯 Titres dynamiques
    const titles = [
      "🔥 Ça explose sur SHOPNET !",
      "🚀 Tout le monde regarde ça",
      "💥 Produit en forte demande",
      "🛒 Ne rate pas cette offre",
      "🔥 Tendance actuelle"
    ];

    const bodies = [
      (title) => `${title} attire beaucoup d’acheteurs 👀`,
      (title) => `${title} est très demandé en ce moment 🔥`,
      (title) => `Les utilisateurs consultent ${title} en ce moment`,
      (title) => `${title} fait partie des plus populaires`,
      (title) => `Découvre pourquoi ${title} est tendance 👀`
    ];

    // 🔁 3. Envoi notifications
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const product = products[i % products.length];

      if (!product) continue;

      try {
        // 🖼 IMAGE
        const [imageRows] = await db.query(
          'SELECT image_path FROM product_images WHERE product_id = ? LIMIT 1',
          [product.id]
        );

        let imageUrl = '';

        if (imageRows.length > 0) {
          const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUD_NAME}/image/upload/`;

          imageUrl = imageRows[0].image_path.startsWith('http')
            ? imageRows[0].image_path
            : CLOUDINARY_BASE + imageRows[0].image_path;
        }

        // 🎲 message random
        const randomTitle = titles[Math.floor(Math.random() * titles.length)];
        const randomBodyFunc = bodies[Math.floor(Math.random() * bodies.length)];
        const randomBody = randomBodyFunc(product.title);

        // 🔥 ENVOI PUSH
        await sendPushNotification(
          user.fcm_token,
          randomTitle,
          randomBody,
          {
            productId: String(product.id),
            type: 'trend',
            image: imageUrl
          }
        );

        success++;

      } catch (err) {
        failed++;
        console.log(`❌ Push error user ${user.user_id}:`, err.message);
      }
    }

    console.log(`✅ TREND terminé: ${success} succès / ${failed} échecs`);

  } catch (error) {
    console.error('❌ TREND GLOBAL ERROR:', error.message);
  }
};



// ==========================================
// 🚀 LANCEMENT AUTOMATIQUE
// ==========================================

const startTrendPush = async () => {
  try {
    console.log("🚀 Lancement TREND PUSH...");
    await sendTrendPush();
  } catch (err) {
    console.error("❌ START TREND ERROR:", err.message);
  }
};

// 🔹 1. Au démarrage
setTimeout(() => {
  startTrendPush();
}, 5000);

// 🔹 2. Toutes les 1 heure
setInterval(() => {
  startTrendPush();
}, 60 * 60 * 1000);



// … tes routes restent inchangées
// Routes
const productsRoutes = require('./Route/products');
const authConnexionRoutes = require('./Route/Connexion');
const authRegisterRoutes = require('./Route/Inscription');
const cartRoutes = require('./Route/cart');
const verifyOtpRoute = require('./Route/verifyOtp');
const userRoutes = require('./Route/vendeur/user');
const searchRoute = require('./ia_statique/search');
const commandesRouter = require('./Route/vendeur/commandes');
const commandesDetailsRouter = require('./Route/vendeur/commandesDetails'); // Détail d'une commande
const likesRoutes = require('./Route/Interactions/likes');
const shareRoutes = require('./Route/Interactions/share');
const commentsRoutes = require('./Route/Interactions/comments'); // 💬 COMMENTAIRES
const sellersRoutes = require('./Route/Profile/publicSellerProfile'); // Route pour voir les infos de vendeurs
const statistiquesRoute = require('./Route/Profile/statistiques');
const uploadCloudinaryRoute = require('./Route/uploadCloudinary');
const allProductsRoutes = require('./Route/allProducts');
const boutiquesGratuitRoutes = require('./Route/Profile/boutiquesGratuit');
const publierProduitsRouter = require('./Route/Boutique/Standard/publierProduits'); //Publier un produits sur la boutique standard  POST GET STANDARD
// const globalNotificationRoute = require('./Route/Notifications/globalNotification'); // Ici on parle des routes pour la notification
const compteurNonLusRoutes = require('./Route/Notifications/compteurNonLus'); //SYSTEME DES NOTIFICATION ENE TEMPS REEL
const notificationsRoute = require('./Route/Notifications/notificationsRoute'); // ROUTES POUR  RECUPERER TOUTES LE NOTIFICATION 
const saveExpoTokenRoute = require('./Route/Notifications/saveExpoToken');  //SYSTEME DE NOTIFICATION QUAND L'APPLICATION ET FERMER OU EN ARRIERE PLAN
const latestRouter = require('./Route/FilDActualite/latest'); /// SYSTEME D AFFICHARGE DE PRODUITS SELONS LES DATE PRODUITS RECENTS
//const backupRoutes = require('./backupRoutes'); // Chemin vers backupRoutes.js
const boostProductRoutes = require('./Route/Paiement/boostProduct');
const editProductRoutes = require('./Route/vendeur/EditProduits');
const promotionsRoutes = require('./Route/vendeur/promotions'); // Route pour gérer les promotions
const locationRoutes = require('./Route/FilDActualite/locationRoute.js');
const dashboardRoutes = require('./Route/admin/dashboard');
const dashboardProduitsRouter = require('./Route/admin/DashboardProduits');
const manualPaymentRoutes = require('./Route/Paiement/manual-payment'); // Systeme de paiement
const boutiquePremiumRoutes = require('./Route/BoutiquePremium/BoutiquePremium');
const analyticsRoutes = require('./Route/BoutiquePremium/Analytics');  // Analytics Boutique Premium
const commandesAdminRouter = require('./Route/admin/CommandesPayeAdmin');  //Route pour les Tableau de bord de commandePaye



app.use('/api/products', productsRoutes);       // d'abord le routeur principal des produits
app.use('/api/auth', authConnexionRoutes);
app.use('/api/auth', authRegisterRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api', verifyOtpRoute);
app.use('/api/search', searchRoute);
app.use('/api/user', userRoutes);
app.use('/api/commandes', commandesRouter);
app.use('/api/commandes', commandesDetailsRouter)
app.use('/api/products', likesRoutes);
app.use('/api/products', shareRoutes);
app.use('/api/interactions', likesRoutes);
app.use('/api/products', commentsRoutes); // ✅ COMMENTAIRES PRODUITS
app.use('/api', sellersRoutes);   // Route pour voir les infos de vendeurs
app.use('/api/Profile/statistiques', statistiquesRoute);  // Route pour les statistic
app.use('/api/upload', uploadCloudinaryRoute);
app.use('/api/all-products', allProductsRoutes);
app.use('/api/boutiques', boutiquesGratuitRoutes);
app.use('/api/boutique/products', publierProduitsRouter); //Publier un produits sur la boutique standard  POST GET STANDARD
// app.use('/api/notify', globalNotificationRoute);// Ici on parle des routes pour la notification
app.use('/api/notifications', compteurNonLusRoutes); //SYSTEME DES NOTIFICATION ENE TEMPS REEL
app.use('/api/notifications', notificationsRoute);  // ROUTES POUR  RECUPERER TOUTES LE NOTIFICATION 
app.use('/api', saveExpoTokenRoute);  //SYSTEME DE NOTIFICATION QUAND L'APPLICATION ET FERMER OU EN ARRIERE PLAN
app.use('/api/latest', latestRouter); // chemin exact // SYSTEME D AFFICHARGE DE PRODUITS SELONS LES DATE PRODUITS RECENTS
//app.use('/', backupRoutes); // Tu peux aussi mettre un préfixe comme '/api/backup'
app.use('/api/boost', boostProductRoutes);
app.use('/api/products/edit', editProductRoutes); 
 // ... plus bas dans tes app.use
app.use('/api/promotions', promotionsRoutes);  // Création et notification des promotions
app.use('/api/location', locationRoutes);
app.use('/api/admin/dashboard', dashboardRoutes);
app.use('/api/admin/DashboardProduits', dashboardProduitsRouter);
app.use('/api/manual-payment', manualPaymentRoutes); // Systeme de paiement
app.use('/api/boutique/premium', boutiquePremiumRoutes);
app.use('/api/analytics', analyticsRoutes);    // Analytics Boutique Premium
app.use('/admin', commandesAdminRouter);   //Route pour les Tableau de bord de commandePaye





app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Lancement serveur
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📁 Dossier uploads: ${UPLOADS_DIR}`);
  console.log(`🔗 Socket.IO actif`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

module.exports = server;




