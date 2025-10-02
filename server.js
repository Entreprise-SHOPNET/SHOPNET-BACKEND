


const fs = require('fs');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const http = require('http');           // 🔥 pour Socket.IO
const { Server } = require('socket.io');

// Initialisation
const app = express();
const server = http.createServer(app);  // 🔥 on passe par http pour brancher io

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Stocker les sockets des vendeurs connectés
const connectedVendors = new Map();

// Gestion des connexions Socket.IO
io.on('connection', (socket) => {
  console.log(`📡 Nouveau client connecté : ${socket.id}`);

  socket.on('registerVendor', (vendorId) => {
    console.log(`✅ Vendeur ${vendorId} enregistré avec socket ${socket.id}`);
    connectedVendors.set(vendorId, socket);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client déconnecté : ${socket.id}`);
    for (const [vendorId, s] of connectedVendors.entries()) {
      if (s.id === socket.id) {
        connectedVendors.delete(vendorId);
        break;
      }
    }
  });
});

// Pour envoyer une notification à un vendeur
app.set('notifyVendor', (vendorId, message) => {
  const socket = connectedVendors.get(vendorId);
  if (socket) {
    socket.emit('newOrder', message);
  } else {
    console.log(`⚠️ Vendeur ${vendorId} non connecté`);
  }
});

// Logs
app.use(morgan('combined', {
  skip: (req, res) => process.env.NODE_ENV === 'test'
}));

// Sécurité
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Faire confiance au proxy (nécessaire pour express-rate-limit sur Render)
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', apiLimiter);



// Uploads
const configureUploadsDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

// JSON parser sauf pour multipart
app.use((req, res, next) => {
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    next();
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});

app.use('/uploads', express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cache-Control', 'public, max-age=31536000');
  }
}));

// DB & middlewares
const db = require('./db');
const errorHandler = require('./middlewares/errorHandler');

app.use((req, res, next) => {
  req.db = db;
  req.upload = upload;
  req.io = io;                          // 🔥 pour l'utiliser dans les routes
  req.notifyVendor = app.get('notifyVendor');
  next();
});

// Routes
// ----------------------
// IMPORT DES ROUTES
// ----------------------
const productsRoutes = require('./Route/products');
const authConnexionRoutes = require('./Route/Connexion');
const authRegisterRoutes = require('./Route/Inscription');
const cartRoutes = require('./Route/cart');
const verifyOtpRoute = require('./Route/verifyOtp');
const userRoutes = require('./Route/vendeur/user');
const searchRoute = require('./ia_statique/search');
const commandesRouter = require('./Route/vendeur/commandes');
const commandesDetailsRouter = require('./Route/vendeur/commandesDetails');
const likesRoutes = require('./Route/Interactions/likes');
const shareRoutes = require('./Route/Interactions/share');
const commentsRoutes = require('./Route/Interactions/comments');
const sellersRoutes = require('./Route/Profile/publicSellerProfile');
const statistiquesRoute = require('./Route/Profile/statistiques');
const uploadCloudinaryRoute = require('./Route/uploadCloudinary');
const editProduitsRoute = require('./Route/vendeur/EditProduits');
const allProductsRoutes = require('./Route/allProducts');

// ----------------------
// MONTAGE DES ROUTES
// ----------------------

// 🔹 Produits
app.use('/api/products', productsRoutes);           // CRUD produits
app.use('/api/products/explore', productsExploreRoutes);
app.use('/api/products', likesRoutes);              // Likes produits
app.use('/api/products', shareRoutes);              // Partages produits
app.use('/api/products', commentsRoutes);           // Commentaires produits
app.use('/api/products', editProduitsRoute);        // Edition produits

// 🔹 Authentification
app.use('/api/auth', authConnexionRoutes);
app.use('/api/auth', authRegisterRoutes);

// 🔹 Panier et commandes
app.use('/api/cart', cartRoutes);
app.use('/api/commandes', commandesRouter);
app.use('/api/commandes', commandesDetailsRouter);

// 🔹 Utilisateurs & profils
app.use('/api/user', userRoutes);
app.use('/api', sellersRoutes);                     // Infos publiques vendeurs
app.use('/api/Profile/statistiques', statistiquesRoute);

// 🔹 Outils et recherche
app.use('/api', verifyOtpRoute);
app.use('/api/search', searchRoute);
app.use('/api/upload', uploadCloudinaryRoute);
app.use('/api/all-products', allProductsRoutes);

//------------------------------------------------//
   //AUTRE MODULES
//-----------------------------------------------//


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
