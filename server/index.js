import fs from "node:fs";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";

const app = express();

const ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "blindbox.sqlite");
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const PUBLIC_EDIT = String(process.env.PUBLIC_EDIT || "true").toLowerCase() !== "false";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function json(res, code, body) {
  res.status(code).set("content-type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

function requireAdmin(req, res, next) {
  if (PUBLIC_EDIT) return next();
  if (!ADMIN_TOKEN) return json(res, 500, { ok: false, error: "ADMIN_TOKEN not configured" });
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (token !== ADMIN_TOKEN) return json(res, 401, { ok: false, error: "Unauthorized" });
  next();
}

function isValidId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{6,120}$/.test(id);
}

function clampText(s, maxLen) {
  const v = String(s || "");
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function sanitizeBook(input, { requireId }) {
  const id = String(input?.id || "");
  if (requireId && !isValidId(id)) return { error: "Invalid id" };
  const title = clampText(input?.title, 200).trim();
  if (!title) return { error: "Missing title" };
  const author = clampText(input?.author, 120).trim();
  const note = clampText(input?.note, 400).trim();
  const coverUrl = clampText(input?.coverUrl, 1200).trim();
  const coverDataUrl = clampText(input?.coverDataUrl, 450_000).trim();
  const createdAt = String(input?.createdAt || new Date().toISOString());
  return {
    book: { id, title, author, note, coverUrl, coverDataUrl, createdAt },
  };
}

function createSqliteStore() {
  ensureDir(path.dirname(DB_PATH));

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      coverUrl TEXT NOT NULL DEFAULT '',
      coverDataUrl TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_createdAt ON books(createdAt DESC);
  `);

  const stmtList = db.prepare(`SELECT id, title, author, note, coverUrl, coverDataUrl, createdAt FROM books ORDER BY createdAt DESC`);
  const stmtGet = db.prepare(`SELECT id, title, author, note, coverUrl, coverDataUrl, createdAt FROM books WHERE id = ?`);
  const stmtInsert = db.prepare(`
    INSERT INTO books (id, title, author, note, coverUrl, coverDataUrl, createdAt)
    VALUES (@id, @title, @author, @note, @coverUrl, @coverDataUrl, @createdAt)
  `);
  const stmtUpdate = db.prepare(`
    UPDATE books
    SET title=@title, author=@author, note=@note, coverUrl=@coverUrl, coverDataUrl=@coverDataUrl
    WHERE id=@id
  `);
  const stmtDelete = db.prepare(`DELETE FROM books WHERE id = ?`);
  const stmtClear = db.prepare(`DELETE FROM books`);
  const stmtCount = db.prepare(`SELECT COUNT(1) as n FROM books`);

  return {
    kind: "sqlite",
    label: DB_PATH,
    list: async () => stmtList.all(),
    get: async (id) => stmtGet.get(id),
    insert: async (book) => stmtInsert.run(book),
    update: async (book) => stmtUpdate.run(book),
    delete: async (id) => stmtDelete.run(id),
    clear: async () => stmtClear.run(),
    count: async () => Number(stmtCount.get()?.n || 0),
    seed: async (books) => db.transaction(() => books.forEach((book) => stmtInsert.run(book)))(),
  };
}

async function createPostgresStore() {
  const { Pool } = await import("pg");
  const shouldUseSsl = String(process.env.PGSSL || "").toLowerCase() === "true" || DATABASE_URL.includes("sslmode=require");
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      "coverUrl" TEXT NOT NULL DEFAULT '',
      "coverDataUrl" TEXT NOT NULL DEFAULT '',
      "createdAt" TEXT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_books_createdAt" ON books("createdAt" DESC)`);

  const bookColumns = `id, title, author, note, "coverUrl", "coverDataUrl", "createdAt"`;

  return {
    kind: "postgres",
    label: "DATABASE_URL",
    list: async () => (await pool.query(`SELECT ${bookColumns} FROM books ORDER BY "createdAt" DESC`)).rows,
    get: async (id) => (await pool.query(`SELECT ${bookColumns} FROM books WHERE id = $1`, [id])).rows[0],
    insert: async (book) => pool.query(
      `INSERT INTO books (id, title, author, note, "coverUrl", "coverDataUrl", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [book.id, book.title, book.author, book.note, book.coverUrl, book.coverDataUrl, book.createdAt],
    ),
    update: async (book) => pool.query(
      `UPDATE books SET title=$2, author=$3, note=$4, "coverUrl"=$5, "coverDataUrl"=$6 WHERE id=$1`,
      [book.id, book.title, book.author, book.note, book.coverUrl, book.coverDataUrl],
    ),
    delete: async (id) => pool.query(`DELETE FROM books WHERE id = $1`, [id]),
    clear: async () => pool.query(`DELETE FROM books`),
    count: async () => Number((await pool.query(`SELECT COUNT(1) as n FROM books`)).rows[0]?.n || 0),
    seed: async (books) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const book of books) {
          await client.query(
            `INSERT INTO books (id, title, author, note, "coverUrl", "coverDataUrl", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
            [book.id, book.title, book.author, book.note, book.coverUrl, book.coverDataUrl, book.createdAt],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function createStore() {
  return DATABASE_URL ? createPostgresStore() : createSqliteStore();
}

const store = await createStore();

app.disable("x-powered-by");
app.use(express.json({ limit: "650kb" }));

app.get("/api/health", (req, res) => {
  json(res, 200, { ok: true, publicEdit: PUBLIC_EDIT, storage: store.kind });
});

app.get("/api/books", async (req, res) => {
  try {
    const books = await store.list();
    json(res, 200, { ok: true, books });
  } catch {
    json(res, 500, { ok: false, error: "List failed" });
  }
});

app.delete("/api/books", requireAdmin, async (req, res) => {
  try {
    await store.clear();
    json(res, 200, { ok: true });
  } catch {
    json(res, 500, { ok: false, error: "Clear failed" });
  }
});

app.post("/api/books", requireAdmin, async (req, res) => {
  const { book, error } = sanitizeBook(req.body, { requireId: true });
  if (error) return json(res, 400, { ok: false, error });
  if (!book.createdAt) book.createdAt = new Date().toISOString();
  try {
    await store.insert(book);
    json(res, 201, { ok: true, book: await store.get(book.id) });
  } catch {
    json(res, 400, { ok: false, error: "Insert failed" });
  }
});

app.put("/api/books/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidId(id)) return json(res, 400, { ok: false, error: "Invalid id" });
  const existing = await store.get(id);
  if (!existing) return json(res, 404, { ok: false, error: "Not found" });
  const merged = { ...existing, ...req.body, id };
  const { book, error } = sanitizeBook(merged, { requireId: true });
  if (error) return json(res, 400, { ok: false, error });
  try {
    await store.update(book);
    json(res, 200, { ok: true, book: await store.get(id) });
  } catch {
    json(res, 500, { ok: false, error: "Update failed" });
  }
});

app.delete("/api/books/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidId(id)) return json(res, 400, { ok: false, error: "Invalid id" });
  try {
    await store.delete(id);
    json(res, 200, { ok: true });
  } catch {
    json(res, 500, { ok: false, error: "Delete failed" });
  }
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[blindbox] listening on http://localhost:${port}`);
  console.log(`[blindbox] storage: ${store.kind} (${store.label})`);
});

try {
  const n = await store.count();
  if (n === 0) {
    await store.seed([
      { id: "book_seed_left-hand", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", note: "拆到就读：感受陌生世界的秩序。", coverUrl: "", coverDataUrl: "", createdAt: new Date().toISOString() },
      { id: "book_seed_100y", title: "百年孤独", author: "加西亚·马尔克斯", note: "拆到就读：为魔幻现实留一段夜色。", coverUrl: "", coverDataUrl: "", createdAt: new Date().toISOString() },
      { id: "book_seed_ddia", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", note: "拆到就读：把系统设计当成耐心活。", coverUrl: "", coverDataUrl: "", createdAt: new Date().toISOString() },
    ]);
    console.log("[blindbox] seeded 3 sample books");
  }
} catch (error) {
  console.error("[blindbox] seed failed", error);
}
