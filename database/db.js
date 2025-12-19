import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || './database.db';

let db;
let SQL;

// Initialize database
export async function initializeDatabase() {
  try {
    SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
      console.log('✓ Database loaded from file');
    } else {
      db = new SQL.Database();
      console.log('✓ New database created');
    }

    // Execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.run(schema);

    console.log('✓ Database schema initialized');

    // Seed initial data
    await seedDatabase();

    // Save database
    saveDatabase();
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Save database to file
function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Helper to run queries and save
export function runQuery(query, params = []) {
  try {
    if (params.length > 0) {
      const stmt = db.prepare(query);
      stmt.bind(params);
      stmt.step();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
      stmt.free();
      saveDatabase();
      return lastInsertRowid;
    } else {
      db.run(query);
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
      saveDatabase();
      return lastInsertRowid;
    }
  } catch (error) {
    console.error('Error running query:', error);
    throw error;
  }
}

// Helper to get all rows
export function getAll(query, params = []) {
  try {
    if (params.length > 0) {
      const stmt = db.prepare(query);
      stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } else {
      const results = [];
      const queryResult = db.exec(query);
      if (queryResult.length > 0) {
        const columns = queryResult[0].columns;
        const values = queryResult[0].values;
        values.forEach(row => {
          const obj = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          results.push(obj);
        });
      }
      return results;
    }
  } catch (error) {
    console.error('Error in getAll:', error);
    return [];
  }
}

// Helper to get one row
export function getOne(query, params = []) {
  const results = getAll(query, params);
  return results.length > 0 ? results[0] : null;
}

// Seed database with initial data
async function seedDatabase() {
  try {
    // Check if super admin exists
    const superuserExists = getOne('SELECT id FROM users WHERE role = ?', ['superuser']);

    if (!superuserExists) {
      const hashedPassword = bcrypt.hashSync(process.env.SUPERUSER_PASSWORD || 'Admin123!', 10);

      const stmt = db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)');
      stmt.bind([
        process.env.SUPERUSER_EMAIL || 'admin@cashout.com',
        hashedPassword,
        'superuser'
      ]);
      stmt.step();
      stmt.free();
      saveDatabase();

      console.log('✓ Super admin user created');
      console.log(`  Email: ${process.env.SUPERUSER_EMAIL || 'admin@cashout.com'}`);
      console.log(`  Password: ${process.env.SUPERUSER_PASSWORD || 'Admin123!'}`);
    }

    // Seed categories
    const categories = [
      { name: 'Tarjetas clonadas', description: 'Tarjetas conseguidas con tecnologia NFC' },
      { name: 'Chips NFC', description: 'Chips para clonar Tarjetas bancarias y tarjetas de acceso' },
      { name: 'Archivos FUD', description: '  Evasion de antivirus ' },
      { name: 'Cuentas de Paypal', description: 'Cuentas verificadas con monto random (bajo su riesgo)' },
      { name: 'Teléfonos', description: 'Teléfonos móviles y accesorios' },
      { name: 'Joyería', description: 'Joyas y artículos de lujo' },
      { name: 'Billetes', description: 'Colección de billetes 1:1' },
      { name: 'RAT', description: 'Software de hacking multiplataforma' },
      { name: 'Tarjetas de juego modificadas', description: 'Tarjetas de juego modificadas de valor' },
    ];

    for (const category of categories) {
      const exists = getOne('SELECT id FROM categories WHERE name = ?', [category.name]);
      if (!exists) {
        const stmt = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)');
        stmt.bind([category.name, category.description]);
        stmt.step();
        stmt.free();
      }
    }

    saveDatabase();
    console.log('✓ Categories seeded');

    // Seed sample products
    seedSampleProducts();
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

// Seed sample products for demonstration
function seedSampleProducts() {
  const productsCount = getOne('SELECT COUNT(*) as count FROM products');

  if (productsCount && productsCount.count > 0) return;

  const sampleProducts = [
    { name: 'Amazon Gift Card $50', description: 'Tarjeta de regalo de Amazon por $50 USD', price: 55.00, stock: 20, category: 1, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Netflix Gift Card 1 mes', description: 'Suscripción de Netflix por 1 mes', price: 15.00, stock: 50, category: 1, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Steam Gift Card $25', description: 'Tarjeta de regalo de Steam por $25 USD', price: 27.50, stock: 30, category: 1, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Chips Poker 1M', description: '1 millón de chips para juegos de poker online', price: 10.00, stock: 100, category: 2, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Monedas FIFA 100K', description: '100,000 monedas para FIFA Ultimate Team', price: 20.00, stock: 75, category: 2, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Curso Completo de JavaScript', description: 'Curso completo de JavaScript desde cero hasta avanzado', price: 45.00, stock: 999, category: 3, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Pack Libros Programación PDF', description: 'Colección de 50 libros de programación en PDF', price: 25.00, stock: 999, category: 3, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Cuenta LOL Nivel 30', description: 'Cuenta de League of Legends nivel 30 sin rankear', price: 30.00, stock: 15, category: 4, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' },
    { name: 'Cuenta Valorant', description: 'Cuenta de Valorant con agentes desbloqueados', price: 40.00, stock: 10, category: 4, image_url: 'https://i.postimg.cc/m2v6mXmX/placeholder.png' }
  ];

  for (const product of sampleProducts) {
    const stmt = db.prepare(`
      INSERT INTO products (name, description, price, stock, category_id, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.bind([
      product.name,
      product.description,
      product.price,
      product.stock,
      product.category,
      product.image_url
    ]);
    stmt.step();
    stmt.free();
  }

  saveDatabase();
  console.log('✓ Sample products seeded');
}

export { db, saveDatabase, getAll as getAllRows, getOne as getOneRow };
export default { initializeDatabase, runQuery, getAll, getOne, saveDatabase };
