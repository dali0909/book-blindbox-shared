import fs from "node:fs";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";

const app = express();

const ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "blindbox.sqlite");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const PUBLIC_EDIT = String(process.env.PUBLIC_EDIT || "").toLowerCase() === "true";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

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
  const coverDataUrl = clampText(input?.coverDataUrl, 450_000).trim(); // cap ~450KB text
  const createdAt = String(input?.createdAt || new Date().toISOString());
  return {
    book: { id, title, author, note, coverUrl, coverDataUrl, createdAt },
  };
}

app.disable("x-powered-by");
app.use(express.json({ limit: "650kb" }));

app.get("/api/health", (req, res) => {
  json(res, 200, { ok: true, publicEdit: PUBLIC_EDIT });
});

app.get("/api/books", (req, res) => {
  const books = stmtList.all();
  json(res, 200, { ok: true, books });
});

app.delete("/api/books", requireAdmin, (req, res) => {
  stmtClear.run();
  json(res, 200, { ok: true });
});

app.post("/api/books", requireAdmin, (req, res) => {
  const { book, error } = sanitizeBook(req.body, { requireId: true });
  if (error) return json(res, 400, { ok: false, error });
  if (!book.createdAt) book.createdAt = new Date().toISOString();
  try {
    stmtInsert.run(book);
  } catch (e) {
    return json(res, 400, { ok: false, error: "Insert failed" });
  }
  json(res, 201, { ok: true, book: stmtGet.get(book.id) });
});

app.put("/api/books/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidId(id)) return json(res, 400, { ok: false, error: "Invalid id" });
  const existing = stmtGet.get(id);
  if (!existing) return json(res, 404, { ok: false, error: "Not found" });
  const merged = { ...existing, ...req.body, id };
  const { book, error } = sanitizeBook(merged, { requireId: true });
  if (error) return json(res, 400, { ok: false, error });
  stmtUpdate.run(book);
  json(res, 200, { ok: true, book: stmtGet.get(id) });
});

app.delete("/api/books/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id || "");
  if (!isValidId(id)) return json(res, 400, { ok: false, error: "Invalid id" });
  stmtDelete.run(id);
  json(res, 200, { ok: true });
});

app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// SPA-ish fallback: serve index for unknown routes (non-api)
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[blindbox] listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[blindbox] db: ${DB_PATH}`);
});

// Seed a few samples if the database is empty (so first deploy isn't blank).
try {
  const n = Number(stmtCount.get()?.n || 0);
  if (n === 0) {
    const samples = [
      { id: "book_seed_left-hand", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", note: "拆到就读：感受陌生世界的秩序。", coverUrl: "", coverDataUrl: "", createdAt: new Date().toISOString() },
      { id: "book_seed_100y", title: "百年孤独", author: "加西亚·马尔克斯", note: "拆到就读：为魔幻现实留一段夜色。", coverUrl: "", coverDataUrl: "", createdAt: new Date().toISOString() },
      { id: "book_seed_ddia", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", note: "拆到就读：把系统设计当成耐心活。", coverUrl: "", coverDataUrl: "", createdAt: new Date().toISOString() },
    ];
    const tx = db.transaction(() => samples.forEach((b) => stmtInsert.run(b)));
    tx();
    console.log("[blindbox] seeded 3 sample books");
  }
} catch {
  // ignore
}
