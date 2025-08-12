

require('dotenv').config();
const mysql = require('mysql2/promise');
const url = require('url');

if (!process.env.MYSQL_PUBLIC_URL) {
  console.error("❌ La variable d'environnement MYSQL_PUBLIC_URL est manquante.");
  process.exit(1);
}

const params = url.parse(process.env.MYSQL_PUBLIC_URL);

if (!params.auth || !params.hostname || !params.pathname) {
  console.error("❌ MYSQL_PUBLIC_URL invalide dans .env");
  process.exit(1);
}

const [user, password] = params.auth.split(':');
const database = params.pathname.replace('/', '');
const host = params.hostname;
const port = params.port ? parseInt(params.port) : 3306;

const pool = mysql.createPool({
  host,
  user,
  password,
  database,
  port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log(`✅ Connecté à MySQL sur ${host}:${port} base "${database}"`);
  } catch (err) {
    console.error('❌ Erreur de connexion MySQL:', err.message);
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

testConnection();

module.exports = pool;
