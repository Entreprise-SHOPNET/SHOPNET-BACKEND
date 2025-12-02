const fs = require('fs');
const mysql = require('mysql2/promise');
const path = require('path');

async function exportTables() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'tramway.proxy.rlwy.net',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'ttMMcidXhgqyBMILkIOKnqEZwFufzlkb',
        database: process.env.DB_NAME || 'railway',
        port: process.env.DB_PORT || 13291
    });

    const [tables] = await connection.query("SHOW TABLES");
    let sqlDump = '';

    for (const t of tables) {
        const tableName = Object.values(t)[0];
        const [create] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
        sqlDump += `${create[0]['Create Table']};\n\n`;
    }

    const filePath = path.join(__dirname, 'tables_only.sql');
    fs.writeFileSync(filePath, sqlDump);
    console.log(`✔ Structure des tables exportée : ${filePath}`);

    await connection.end();
}

// Exécution directe si lancé avec Node
exportTables().catch(err => console.error(err));
