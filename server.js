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

// Notification globale via Expo Push (fonctionne même si app fermée)
app.set('notifyAll', async (title, message) => {
  try {
    const db = require('./db');
    const dateNow = new Date();

    const [users] = await db.query(`
      SELECT id, expoPushToken FROM utilisateurs WHERE role IN ('vendeur', 'acheteur')
    `);

    if (!users || users.length === 0) return console.log('⚠️ Aucun utilisateur pour notification globale');

    const messagesExpo = [];

    for (const user of users) {
      // Sauvegarde dans la DB
      await db.query(
        `INSERT INTO notifications 
          (utilisateur_id, cible, type, titre, contenu, lu, priorite, date_envoi, date_notification)
         VALUES (?, 'tous', 'info', ?, ?, 0, 'normale', ?, ?)`,
        [user.id, title, message, dateNow, dateNow]
      );

      // Préparer le message Expo Push
      if (user.expoPushToken && Expo.isExpoPushToken(user.expoPushToken)) {
        messagesExpo.push({
          to: user.expoPushToken,
          sound: 'default',
          title,
          body: message,
          data: { title, message },
        });
      }
    }

    // Envoyer via Socket.IO pour ceux qui sont connectés
    io.emit('globalNotification', { titre: title, contenu: message, date_notification: dateNow.toISOString(), type: 'info', priorite: 'normale' });

    // Envoyer via Expo Push
    const chunks = expo.chunkPushNotifications(messagesExpo);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        console.log('✅ Tickets Expo Push envoyés:', tickets);
      } catch (err) {
        console.error('❌ Erreur Expo Push:', err);
      }
    }

    console.log(`📢 Notification globale "${title}" envoyée à ${users.length} utilisateurs`);

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
  const delay = (Math.floor(Math.random() * 10) + 1) * 9000; // entre 9s et 90s
  setTimeout(async () => {
    await sendRandomNotifications();
    scheduleNextNotification();
  }, delay);
}

setTimeout(() => {
  scheduleNextNotification();
  console.log('🔔 Notifications automatiques activées');
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
const errorHandler = require('./middlewares/errorHandler');

app.use((req, res, next) => {
  req.db = db;
  req.upload = upload;
  req.io = io;
  req.notifyUser = app.get('notifyUser');
  req.notifyAll = app.get('notifyAll');
  next();
});

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


