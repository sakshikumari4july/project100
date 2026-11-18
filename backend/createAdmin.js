
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const readline = require('readline');

require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function createAdmin() {
  let connection;

  try {
    const name = (await ask('Enter admin name: ')).trim();
    const email = (await ask('Enter admin Gmail: ')).trim().toLowerCase();
    const password = await ask('Enter admin login password: ');

    if (!name || !email || !password) {
      throw new Error('All fields are required.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid email address.');
    }

    if (password.length < 8) {
      throw new Error('Password must contain at least 8 characters.');
    }

    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'campusvoice'
    });

    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length) {
      throw new Error('This email already has an account. Choose another email.');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await connection.execute(
      `INSERT INTO users
       (name, email, password_hash, role, is_verified)
       VALUES (?, ?, ?, 'admin', 1)`,
      [name, email, passwordHash]
    );

    console.log('\nAdmin account created successfully!');
    console.log('Admin email:', email);
    console.log('You can now login using this email and password.');
  } catch (error) {
    console.error('\nAdmin creation failed:', error.message);
  } finally {
    if (connection) await connection.end();
    rl.close();
  }
}

createAdmin();
