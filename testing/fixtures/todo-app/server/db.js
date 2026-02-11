// SQLite database setup for Todo app
const Database = require('better-sqlite3');
const path = require('path');

function initDb(dbPath) {
  const db = new Database(dbPath || path.join(__dirname, '..', 'todos.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

module.exports = { initDb };
