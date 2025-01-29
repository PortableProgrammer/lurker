const { Database } = require("bun:sqlite");
const db = new Database("lurker.db", {
	strict: true,
});

function runMigration(name, migrationFn) {
	const exists = db
		.query("SELECT * FROM migrations WHERE name = $name")
		.get({ name });

	if (!exists) {
		migrationFn();
		db.query("INSERT INTO migrations (name) VALUES ($name)").run({ name });
	}
}

// users table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT
  )
`);

// subs table
db.run(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    subreddit TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, subreddit)
  )
`);

// multi table
db.run(`
  CREATE TABLE IF NOT EXISTS multireddits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    multireddit TEXT,
    subreddit TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, multireddit, subreddit)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usedAt TIMESTAMP
  )
`);

// sessions table
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    subreddit TEXT,
    query TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, query)
  )
`);

// views table
db.run(`
  CREATE TABLE IF NOT EXISTS views (
    session_id INTEGER,
    post_id TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  )
`);

// migrations table
db.query(`
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )
`).run();

runMigration("add-isAdmin-column", () => {
	db.query(`
    ALTER TABLE users
    ADD COLUMN isAdmin INTEGER DEFAULT 0
  `).run();

	// first user is admin
	db.query(`
    UPDATE users
    SET isAdmin = 1
    WHERE id = (SELECT MIN(id) FROM users)
  `).run();
});

runMigration("add-sort-view-pref-columns", () => {
  // Add sortPref column
  db.query(`
    ALTER TABLE users 
    ADD COLUMN sortPref TEXT DEFAULT 'hot'
  `).run();

  // Add viewPref column
  db.query(`
    ALTER TABLE users 
    ADD COLUMN viewPref TEXT DEFAULT 'card'
  `).run();
});

// Add Collapse AutoMod pref
runMigration("add-collapse-automod-pref-column", () => {
  db.query(`
    ALTER TABLE users
    ADD COLUMN collapseAutoModPref BOOLEAN DEFAULT 0
  `).run();
});

// Add Track Sessions pref
runMigration("add-track-sessions-pref-column", () => {
  db.query(`
    ALTER TABLE users
    ADD COLUMN pref_trackSessions BOOLEAN DEFAULT 0
  `).run();
});

// Standardize pref columns
runMigration("standardize-pref-columns", () => {
  // viewPref -> pref_view
  db.query(`
    ALTER TABLE users
    RENAME COLUMN viewPref TO pref_view
  `).run();

  // sortPref -> pref_sort
  db.query(`
    ALTER TABLE users
    RENAME COLUMN sortPref TO pref_sort
  `).run();

  // collapseAutoModPref -> pref_collapseAutomod
  db.query(`
    ALTER TABLE users
    RENAME COLUMN collapseAutoModPref TO pref_collapseAutomod
  `).run();
});

module.exports = { db };
