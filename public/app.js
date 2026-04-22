const STORAGE_KEY = "blindbox.books.v1";
const HISTORY_KEY = "blindbox.history.v1";
const PILE_SEED_KEY = "blindbox.pileSeed.v1";
const ADMIN_TOKEN_KEY = "blindbox.adminToken.v1";

let SERVER_MODE = false;
let PUBLIC_EDIT_MODE = false;

const GIFT_THEMES = [
  {
    boxA: "rgba(214, 170, 74, .92)",
    boxB: "rgba(150, 106, 38, .94)",
    pattern: "radial-gradient(circle at 12px 10px, rgba(255,255,255,.55) 0 2px, transparent 3px), radial-gradient(circle at 4px 16px, rgba(255,255,255,.40) 0 1.6px, transparent 3px)",
    patternSize: "24px 22px",
    patternOpacity: ".24",
  },
  {
    boxA: "rgba(78, 150, 92, .92)",
    boxB: "rgba(46, 108, 62, .94)",
    pattern: "radial-gradient(circle, rgba(255,255,255,.32) 0 1.7px, transparent 2.2px)",
    patternSize: "16px 16px",
    patternOpacity: ".34",
  },
  {
    boxA: "rgba(196, 62, 58, .92)",
    boxB: "rgba(140, 34, 34, .94)",
    pattern: "repeating-linear-gradient(135deg, rgba(255,255,255,.18) 0 10px, transparent 10px 22px)",
    patternSize: "26px 26px",
    patternOpacity: ".24",
  },
  {
    boxA: "rgba(236, 228, 212, .96)",
    boxB: "rgba(206, 192, 170, .96)",
    pattern: "radial-gradient(circle at 10px 8px, rgba(179,138,58,.55) 0 2px, transparent 3px)",
    patternSize: "22px 20px",
    patternOpacity: ".22",
  },
];

function nowISO() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

function setAdminToken(token) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, String(token || "").trim());
}

async function detectServerMode() {
  if (location.protocol === "file:") return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 900);
  try {
    const res = await fetch("./api/health", { signal: controller.signal, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    PUBLIC_EDIT_MODE = Boolean(data?.publicEdit);
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("accept", "application/json");
  if (options.json) headers.set("content-type", "application/json; charset=utf-8");
  const token = getAdminToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers, body: options.json ? JSON.stringify(options.json) : options.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function serverListBooks() {
  const data = await apiFetch("./api/books", { cache: "no-store" });
  return Array.isArray(data.books) ? data.books : [];
}

async function syncBooksFromServer() {
  const serverBooks = await serverListBooks();
  const local = loadBooks();
  const statusById = new Map(local.map((b) => [b.id, b.status || "available"]));
  const merged = serverBooks.map((b) => ({
    ...b,
    status: statusById.get(b.id) || "available",
  }));
  saveBooks(merged);
  addHistory({ id: uid("event"), at: nowISO(), action: "sync", bookId: null, detail: `count=${merged.length}` });
  return merged;
}

function loadBooks() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const books = safeJsonParse(raw, []);
  return Array.isArray(books) ? books : [];
}

function saveBooks(books) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

function loadHistory() {
  const raw = localStorage.getItem(HISTORY_KEY);
  const history = safeJsonParse(raw, []);
  return Array.isArray(history) ? history : [];
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addHistory(event) {
  const history = loadHistory();
  // Attach a snapshot so history stays readable even if the book is deleted.
  if (event && event.bookId && !event.bookTitle) {
    const b = getBookById(event.bookId);
    if (b) {
      event = { ...event, bookTitle: b.title || "", bookAuthor: b.author || "" };
    }
  }
  history.unshift(event);
  saveHistory(history.slice(0, 400));
}

function getBookById(id) {
  return loadBooks().find((b) => b.id === id) || null;
}

function setBookStatus(id, status) {
  const books = loadBooks();
  const idx = books.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  books[idx] = { ...books[idx], status };
  saveBooks(books);
  return true;
}

function removeBook(id) {
  const books = loadBooks().filter((b) => b.id !== id);
  saveBooks(books);
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pickRandom(books) {
  if (!books.length) return null;
  return books[Math.floor(Math.random() * books.length)];
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function getPileSeed() {
  const raw = localStorage.getItem(PILE_SEED_KEY);
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const seed = Math.floor(Math.random() * 2 ** 31) + Date.now();
  localStorage.setItem(PILE_SEED_KEY, String(seed));
  return seed;
}

function hashStringToInt(str) {
  // FNV-1a
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function themeForBookId(id) {
  const h = hashStringToInt(String(id || ""));
  return GIFT_THEMES[h % GIFT_THEMES.length] || GIFT_THEMES[0];
}

function monogramForTitle(title) {
  const t = String(title || "").trim();
  if (!t) return "B";
  // Prefer first CJK character or first A-Z.
  const cjk = t.match(/[\u4e00-\u9fff]/);
  if (cjk) return cjk[0];
  const latin = t.match(/[A-Za-z]/);
  return (latin ? latin[0] : t[0]).toUpperCase();
}

function setNavCurrent(page) {
  document.querySelectorAll(".nav a").forEach((a) => {
    const target = a.getAttribute("data-page");
    if (!target) return;
    a.setAttribute("aria-current", target === page ? "page" : "false");
  });
}

function updateBook(id, patch) {
  const books = loadBooks();
  const idx = books.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  books[idx] = { ...books[idx], ...patch };
  saveBooks(books);
  return true;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function ensureSeedBooks() {
  if (SERVER_MODE) return;
  const books = loadBooks();
  if (books.length) return;
  const seed = [
    { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", note: "拆到就读：感受陌生世界的秩序。", coverUrl: "" },
    { title: "百年孤独", author: "加西亚·马尔克斯", note: "拆到就读：为魔幻现实留一段夜色。", coverUrl: "" },
    { title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", note: "拆到就读：把系统设计当成耐心活。", coverUrl: "" },
  ].map((b) => ({
    id: uid("book"),
    title: b.title,
    author: b.author,
    note: b.note,
    coverUrl: b.coverUrl,
    coverDataUrl: "",
    status: "available",
    createdAt: nowISO(),
  }));
  saveBooks(seed);
  addHistory({ id: uid("event"), at: nowISO(), action: "seed", bookId: null, detail: "seeded 3 books" });
}

function hydrateCover(elCover, book) {
  const coverDataUrl = (book.coverDataUrl || "").trim();
  const url = (book.coverUrl || "").trim();
  elCover.innerHTML = "";
  const src = coverDataUrl || url || generatePlaceholderCoverDataUrl(book);
  const img = document.createElement("img");
  img.alt = `${book.title} cover`;
  img.loading = "lazy";
  img.src = src;
  img.addEventListener("error", () => {
    const fallback = generatePlaceholderCoverDataUrl(book);
    if (fallback && img.src !== fallback) {
      img.src = fallback;
      return;
    }
    elCover.innerHTML = `<div class="cover__monogram">${monogramForTitle(book.title)}</div>`;
  });
  elCover.appendChild(img);
}

function generatePlaceholderCoverDataUrl(book) {
  const title = String(book?.title || "").trim() || "Untitled";
  const author = String(book?.author || "").trim();
  const mono = monogramForTitle(title);

  const safe = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a212b"/>
      <stop offset="1" stop-color="#0b0d10"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#B38A3A" stop-opacity="0.65"/>
      <stop offset="0.55" stop-color="#E7D7A6" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#B38A3A" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="240" height="320" rx="18" fill="url(#bg)"/>
  <rect x="16" y="16" width="208" height="288" rx="16" fill="none" stroke="url(#gold)" stroke-opacity="0.55"/>
  <rect x="28" y="28" width="184" height="264" rx="14" fill="none" stroke="#B38A3A" stroke-opacity="0.18"/>
  <circle cx="120" cy="102" r="44" fill="none" stroke="url(#gold)" stroke-opacity="0.7"/>
  <text x="120" y="117" text-anchor="middle" font-family="Georgia, 'Songti SC', serif" font-size="54" fill="#E7D7A6" fill-opacity="0.86" filter="url(#softShadow)">${safe(mono)}</text>
  <text x="120" y="185" text-anchor="middle" font-family="Georgia, 'Songti SC', serif" font-size="18" fill="#e9edf3" fill-opacity="0.96">${safe(title).slice(0, 18)}</text>
  ${author ? `<text x="120" y="212" text-anchor="middle" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif" font-size="12" letter-spacing="1.6" fill="#a7b2c3" fill-opacity="0.92">BY ${safe(author).slice(0, 24)}</text>` : ""}
  <path d="M48 256H192" stroke="#B38A3A" stroke-opacity="0.25"/>
  <text x="120" y="276" text-anchor="middle" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif" font-size="10" letter-spacing="3.2" fill="#a7b2c3" fill-opacity="0.75">BOOK BLINDBOX</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderNowReading(container) {
  const books = loadBooks().filter((b) => b.status === "now");
  if (!books.length) {
    container.innerHTML = `<p class="panel__hint">暂无“正在读”。拆一个，或者去书库挑几本丢进盒子里。</p>`;
    return;
  }
  const list = document.createElement("div");
  list.className = "list";
  books.slice(0, 6).forEach((b) => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <p class="item__title">${escapeHtml(b.title)}</p>
        <p class="item__sub">${escapeHtml(b.author || "—")} · <span class="pill pill--wax">Now</span></p>
      </div>
      <div class="btnrow">
        <button class="btn btn--goldline" data-action="done" data-id="${b.id}">完成</button>
        <button class="btn btn--goldline" data-action="return" data-id="${b.id}">放回</button>
      </div>
    `;
    list.appendChild(item);
  });
  container.innerHTML = "";
  container.appendChild(list);
  container.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (!id || !action) return;
      if (action === "done") {
        setBookStatus(id, "done");
        addHistory({ id: uid("event"), at: nowISO(), action: "done", bookId: id });
      } else if (action === "return") {
        setBookStatus(id, "available");
        addHistory({ id: uid("event"), at: nowISO(), action: "return", bookId: id });
      }
      renderNowReading(container);
    });
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function initUnboxPage() {
  SERVER_MODE = await detectServerMode();
  if (SERVER_MODE) {
    try { await syncBooksFromServer(); } catch {}
  } else {
    ensureSeedBooks();
  }
  setNavCurrent("unbox");

  const pool = document.getElementById("pool");
  const overlay = document.getElementById("overlay");
  const overlayBackdrop = overlay?.querySelector("[data-close='1']");
  const gift = document.getElementById("gift");
  const btnUnboxRandom = document.getElementById("btnUnboxRandom");
  const reveal = document.getElementById("reveal");
  const cover = document.getElementById("revealCover");
  const title = document.getElementById("revealTitle");
  const author = document.getElementById("revealAuthor");
  const note = document.getElementById("revealNote");
  const btnChoose = document.getElementById("btnChoose");
  const btnPutBack = document.getElementById("btnPutBack");
  const btnClose = document.getElementById("btnClose");
  const btnEdit = document.getElementById("btnEdit");
  const noBooks = document.getElementById("noBooks");
  const nowReading = document.getElementById("nowReading");

  let current = null;
  let opening = false;
  const seed = getPileSeed();

  function closeOverlay() {
    overlay.classList.add("hidden");
    document.documentElement.style.overflow = "";
    resetOverlayStage();
  }

  function openOverlayForBook(book) {
    current = book;
    const t = themeForBookId(book.id);
    gift.style.setProperty("--giftA", t.boxA);
    gift.style.setProperty("--giftB", t.boxB);
    overlay.classList.remove("hidden");
    document.documentElement.style.overflow = "hidden";
    resetOverlayStage();
    // trigger open animation + reveal content
    openAndReveal(book);
  }

  function setRevealVisible(visible) {
    reveal.classList.toggle("hidden", !visible);
    if (visible) {
      reveal.classList.remove("float-in");
      // Re-trigger entrance animation.
      requestAnimationFrame(() => reveal.classList.add("float-in"));
    } else {
      reveal.classList.remove("float-in");
    }
  }

  function setEmptyStateIfNeeded() {
    const available = loadBooks().filter((b) => b.status === "available");
    noBooks.classList.toggle("hidden", available.length !== 0);
  }

  function resetOverlayStage() {
    gift.classList.remove("gift--opening");
    gift.classList.add("gift--idle");
    setRevealVisible(false);
    current = null;
    opening = false;
    btnChoose.disabled = true;
    btnPutBack.disabled = true;
  }

  function openAndReveal(book) {
    current = book;
    opening = true;
    gift.classList.remove("gift--idle");
    gift.classList.add("gift--opening");

    // After lid animation, show reveal card.
    window.setTimeout(() => {
      hydrateCover(cover, book);
      title.textContent = book.title || "Untitled";
      author.textContent = book.author ? `BY ${book.author}` : "—";
      note.textContent = book.note ? book.note : "拆到了，就当作命运递给你的礼物。";
      setRevealVisible(true);
      btnChoose.disabled = false;
      btnPutBack.disabled = false;
      opening = false;
    }, 520);
  }

  function renderPool() {
    const available = loadBooks().filter((b) => b.status === "available");
    setEmptyStateIfNeeded();
    if (!pool) return;
    if (!available.length) {
      pool.innerHTML = "";
      return;
    }
    pool.innerHTML = "";

    const rng = mulberry32(seed + available.length);
    const poolRect = pool.getBoundingClientRect();
    const w = Math.max(320, poolRect.width || 320);
    const tileW = 148;
    const tileH = 168;
    const pad = 2;
    const rowsHint = Math.max(3, Math.ceil(Math.sqrt(available.length)));
    const targetH = Math.max(520, rowsHint * 140);

    const placed = [];
    function overlaps(x, y) {
      const r1 = { x, y, w: tileW, h: tileH };
      return placed.some((r2) => {
        const ax = r1.x < r2.x + r2.w + pad && r1.x + r1.w + pad > r2.x;
        const ay = r1.y < r2.y + r2.h + pad && r1.y + r1.h + pad > r2.y;
        return ax && ay;
      });
    }

    function pickPos(i) {
      const maxX = Math.max(0, w - tileW - 8);
      const maxY = Math.max(0, targetH - tileH - 8);
      let tries = 0;
      while (tries++ < 90) {
        // Bias towards the middle so it looks "piled", and allow some overlap.
        const bx = (rng() + rng() + rng()) / 3; // 0..1 (peaks at 0.5)
        const by = (rng() + rng() + rng()) / 3;
        const spreadX = maxX * 0.86;
        const spreadY = maxY * 0.82;
        const x = Math.round(8 + (maxX - spreadX) / 2 + bx * spreadX);
        const y = Math.round(8 + (maxY - spreadY) / 2 + by * spreadY);
        if (!overlaps(x, y) || rng() < 0.22) return { x, y };
      }
      // Fallback: staggered.
      const x = Math.round(10 + (i % 4) * (tileW * 0.78));
      const y = Math.round(10 + Math.floor(i / 4) * (tileH * 0.78));
      return { x, y };
    }

    let maxBottom = 0;
    available.forEach((b, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gift-tile";
      btn.setAttribute("aria-label", `礼物盒 ${idx + 1}`);
      btn.setAttribute("data-id", b.id);
      const { x, y } = pickPos(idx);
      placed.push({ x, y, w: tileW, h: tileH });
      maxBottom = Math.max(maxBottom, y + tileH);
      const r = (rng() * 16 - 8).toFixed(2);
      const s = (0.78 + rng() * 0.42).toFixed(3);
      const z = String(10 + Math.floor(y) + Math.floor(Number(s) * 40));
      btn.style.setProperty("--x", `${x}px`);
      btn.style.setProperty("--y", `${y}px`);
      btn.style.setProperty("--r", `${r}deg`);
      btn.style.setProperty("--s", String(s));
      btn.style.zIndex = z;

      const t = themeForBookId(b.id);
      btn.style.setProperty("--boxA", t.boxA);
      btn.style.setProperty("--boxB", t.boxB);
      btn.style.setProperty("--pattern", t.pattern);
      btn.style.setProperty("--patternSize", t.patternSize);
      btn.style.setProperty("--patternOpacity", t.patternOpacity);
      btn.innerHTML = `
        <div class="gift-tile__box">
          <div class="gift3d" aria-hidden="true">
            <div class="gift3d__top"></div>
            <div class="gift3d__front"></div>
            <div class="gift3d__side"></div>
            <div class="gift3d__shine"></div>
          </div>
          <div class="gift-tile__seal" aria-hidden="true"></div>
        </div>
        <div class="gift-tile__label"><span class="pill">Box</span><span>#${String(idx + 1).padStart(2, "0")}</span></div>
      `;
      btn.addEventListener("click", () => openOverlayForBook(b));
      pool.appendChild(btn);
    });

    pool.style.minHeight = `${Math.max(520, maxBottom + 18)}px`;
  }

  function doRandomUnbox() {
    if (opening) return;
    const available = loadBooks().filter((b) => b.status === "available");
    if (!available.length) {
      setEmptyStateIfNeeded();
      return;
    }
    const book = pickRandom(available);
    if (!book) return;
    openOverlayForBook(book);
  }

  btnUnboxRandom?.addEventListener("click", doRandomUnbox);

  btnChoose.addEventListener("click", () => {
    if (!current) return;
    setBookStatus(current.id, "now");
    addHistory({ id: uid("event"), at: nowISO(), action: "choose", bookId: current.id });
    renderNowReading(nowReading);
    closeOverlay();
    renderPool();
  });

  btnPutBack?.addEventListener("click", () => {
    if (!current) return;
    addHistory({ id: uid("event"), at: nowISO(), action: "put_back", bookId: current.id });
    closeOverlay();
  });

  btnEdit?.addEventListener("click", () => {
    if (!current) return;
    const id = current.id;
    closeOverlay();
    window.location.href = `./library.html?edit=${encodeURIComponent(id)}`;
  });

  btnClose?.addEventListener("click", closeOverlay);
  overlayBackdrop?.addEventListener("click", closeOverlay);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeOverlay();
  });

  // Allow clicking the big gift to open (if user didn't use random button).
  gift.addEventListener("click", () => {
    if (!current || opening) return;
    // Re-play opening.
    setRevealVisible(false);
    gift.classList.remove("gift--opening");
    window.setTimeout(() => openAndReveal(current), 60);
  });

  document.getElementById("btnToLibrary")?.addEventListener("click", () => {
    window.location.href = "./library.html";
  });

  renderNowReading(nowReading);
  resetOverlayStage();
  setEmptyStateIfNeeded();
  renderPool();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => renderPool(), 120);
  });
}

async function initLibraryPage() {
  SERVER_MODE = await detectServerMode();
  if (SERVER_MODE) {
    try { await syncBooksFromServer(); } catch {}
  } else {
    ensureSeedBooks();
  }
  setNavCurrent("library");

  const form = document.getElementById("addForm");
  const bulkForm = document.getElementById("bulkForm");
  const list = document.getElementById("bookList");
  const stats = document.getElementById("stats");
  const btnClear = document.getElementById("btnClearBooks");
  const adminTokenInput = document.getElementById("adminToken");
  const btnAdminSave = document.getElementById("btnAdminSave");
  const btnAdminSync = document.getElementById("btnAdminSync");
  const adminStatus = document.getElementById("adminStatus");
  const editOverlay = document.getElementById("editOverlay");
  const editBackdrop = editOverlay?.querySelector("[data-close='1']");
  const editForm = document.getElementById("editForm");
  const editId = document.getElementById("editId");
  const editTitle = document.getElementById("editTitle");
  const editAuthor = document.getElementById("editAuthor");
  const editNote = document.getElementById("editNote");
  const editCoverUrl = document.getElementById("editCoverUrl");
  const editCoverFile = document.getElementById("editCoverFile");
  const btnClearCover = document.getElementById("btnClearCover");
  const btnEditClose = document.getElementById("btnEditClose");
  let editClearCover = false;

  function isAdmin() {
    return SERVER_MODE && (PUBLIC_EDIT_MODE || Boolean(getAdminToken()));
  }

  function updateAdminUI(message = "") {
    if (!SERVER_MODE) {
      adminStatus.textContent = "本地模式（localStorage）";
      return;
    }
    const ok = isAdmin();
    adminStatus.textContent = PUBLIC_EDIT_MODE
      ? "共享模式：公开编辑已开启"
      : ok ? "共享模式：已解锁管理" : `共享模式：只读（需要 Admin Token）${message ? "· " + message : ""}`;
    // Disable write actions when not admin.
    form.querySelectorAll("input,textarea,button").forEach((el) => {
      if (el.id === "adminToken" || el.id === "btnAdminSave" || el.id === "btnAdminSync") return;
      el.disabled = !ok;
    });
    bulkForm.querySelectorAll("textarea,button").forEach((el) => {
      el.disabled = !ok;
    });
    btnClear.disabled = !ok;
  }

  function openEdit(id) {
    const b = getBookById(id);
    if (!b) return;
    editId.value = b.id;
    editTitle.value = b.title || "";
    editAuthor.value = b.author || "";
    editNote.value = b.note || "";
    editCoverUrl.value = b.coverUrl || "";
    if (editCoverFile) editCoverFile.value = "";
    editClearCover = false;
    editOverlay.classList.remove("hidden");
    document.documentElement.style.overflow = "hidden";
    editTitle.focus();
  }

  function closeEdit() {
    editOverlay.classList.add("hidden");
    document.documentElement.style.overflow = "";
    editClearCover = false;
  }

  function render() {
    const books = loadBooks();
    const available = books.filter((b) => b.status === "available").length;
    const now = books.filter((b) => b.status === "now").length;
    const done = books.filter((b) => b.status === "done").length;
    stats.innerHTML = `
      <span class="pill">Available ${available}</span>
      <span class="pill pill--wax">Now ${now}</span>
      <span class="pill pill--ok">Done ${done}</span>
    `;

    const sorted = [...books].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const canWrite = !SERVER_MODE || PUBLIC_EDIT_MODE || Boolean(getAdminToken());
    if (!sorted.length) {
      list.innerHTML = `<p class="panel__hint">书库是空的。先添加几本想读的书。</p>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "list";
    sorted.forEach((b) => {
      const statusPill =
        b.status === "now" ? `<span class="pill pill--wax">Now</span>` :
        b.status === "done" ? `<span class="pill pill--ok">Done</span>` :
        `<span class="pill">Available</span>`;

      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div>
          <p class="item__title">${escapeHtml(b.title)}</p>
          <p class="item__sub">${escapeHtml(b.author || "—")} · ${statusPill}</p>
        </div>
        <div class="btnrow">
          ${canWrite ? `<button class="btn btn--goldline" data-action="edit" data-id="${b.id}">编辑</button>` : ""}
          ${b.status !== "available" ? `<button class="btn btn--goldline" data-action="avail" data-id="${b.id}">放回</button>` : ""}
          ${b.status !== "done" ? `<button class="btn btn--goldline" data-action="done" data-id="${b.id}">完成</button>` : ""}
          ${canWrite ? `<button class="btn btn--danger" data-action="del" data-id="${b.id}">删除</button>` : ""}
        </div>
      `;
      wrap.appendChild(item);
    });
    list.innerHTML = "";
    list.appendChild(wrap);

    list.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (!id || !action) return;
        if (action === "edit") {
          openEdit(id);
          return;
        }
        if (action === "del") {
          (async () => {
            const before = loadBooks().find((b) => b.id === id) || null;
            addHistory({
              id: uid("event"),
              at: nowISO(),
              action: "delete",
              bookId: id,
              bookTitle: before?.title || "",
              bookAuthor: before?.author || "",
            });
            try {
              if (SERVER_MODE) {
                await apiFetch(`./api/books/${encodeURIComponent(id)}`, { method: "DELETE" });
                await syncBooksFromServer();
              } else {
                removeBook(id);
              }
              render();
            } catch (err) {
              alert(`删除失败：${err?.message || err}`);
            }
          })();
          return;
        }
        if (action === "done") {
          setBookStatus(id, "done");
          addHistory({ id: uid("event"), at: nowISO(), action: "done", bookId: id });
        }
        if (action === "avail") {
          setBookStatus(id, "available");
          addHistory({ id: uid("event"), at: nowISO(), action: "return", bookId: id });
        }
        render();
      });
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    if (!title) return;
    const author = String(fd.get("author") || "").trim();
    const note = String(fd.get("note") || "").trim();
    const coverUrl = String(fd.get("coverUrl") || "").trim();
    const coverFile = fd.get("coverFile");
    let coverDataUrl = "";
    if (coverFile instanceof File && coverFile.size) {
      try {
        coverDataUrl = await readFileAsDataUrl(coverFile);
      } catch {
        coverDataUrl = "";
      }
    }
    const newBook = {
      id: uid("book"),
      title,
      author,
      note,
      coverUrl,
      coverDataUrl,
      createdAt: nowISO(),
    };
    try {
      if (SERVER_MODE) {
        await apiFetch("./api/books", { method: "POST", json: newBook });
        await syncBooksFromServer();
      } else {
        const books = loadBooks();
        books.unshift({ ...newBook, status: "available" });
        saveBooks(books);
      }
      addHistory({ id: uid("event"), at: nowISO(), action: "add", bookId: newBook.id });
      form.reset();
      render();
    } catch (err) {
      alert(`添加失败：${err?.message || err}`);
    }
  });

  bulkForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(bulkForm);
    const raw = String(fd.get("bulk") || "");
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return;

    const added = [];
    lines.forEach((line) => {
      const m = line.split(" - ");
      const title = (m[0] || "").trim();
      const author = (m.slice(1).join(" - ") || "").trim();
      if (!title) return;
      added.push({
        id: uid("book"),
        title,
        author,
        note: "",
        coverUrl: "",
        coverDataUrl: "",
        createdAt: nowISO(),
      });
    });
    if (!added.length) return;
    try {
      if (SERVER_MODE) {
        for (const b of added) {
          // eslint-disable-next-line no-await-in-loop
          await apiFetch("./api/books", { method: "POST", json: b });
        }
        await syncBooksFromServer();
      } else {
        const books = loadBooks();
        added.reverse().forEach((b) => books.unshift({ ...b, status: "available" }));
        saveBooks(books);
      }
      addHistory({ id: uid("event"), at: nowISO(), action: "bulk_add", bookId: null, detail: `count=${added.length}` });
      bulkForm.reset();
      render();
    } catch (err) {
      alert(`导入失败：${err?.message || err}`);
    }
  });

  btnClear.addEventListener("click", () => {
    if (!confirm("确定要清空书库吗？（历史记录不会清空）")) return;
    (async () => {
      try {
        if (SERVER_MODE) {
          await apiFetch("./api/books", { method: "DELETE" });
          await syncBooksFromServer();
        } else {
          saveBooks([]);
        }
        addHistory({ id: uid("event"), at: nowISO(), action: "clear_books", bookId: null });
        render();
      } catch (err) {
        alert(`清空失败：${err?.message || err}`);
      }
    })();
  });

  editBackdrop?.addEventListener("click", closeEdit);
  btnEditClose?.addEventListener("click", closeEdit);
  btnClearCover?.addEventListener("click", () => {
    editClearCover = true;
    if (editCoverUrl) editCoverUrl.value = "";
    if (editCoverFile) editCoverFile.value = "";
  });

  editForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = String(editId.value || "");
    if (!id) return;
    const patch = {
      title: String(editTitle.value || "").trim(),
      author: String(editAuthor.value || "").trim(),
      note: String(editNote.value || "").trim(),
      coverUrl: String(editCoverUrl.value || "").trim(),
    };
    if (!patch.title) return;
    const file = editCoverFile?.files?.[0];
    if (file && file.size) {
      try {
        patch.coverDataUrl = await readFileAsDataUrl(file);
      } catch {
        // Ignore.
      }
    } else if (editClearCover) {
      patch.coverDataUrl = "";
      patch.coverUrl = "";
    }
    try {
      if (SERVER_MODE) {
        await apiFetch(`./api/books/${encodeURIComponent(id)}`, { method: "PUT", json: { ...patch, id } });
        await syncBooksFromServer();
      } else {
        updateBook(id, patch);
      }
      addHistory({ id: uid("event"), at: nowISO(), action: "edit", bookId: id });
      closeEdit();
      render();
    } catch (err) {
      alert(`保存失败：${err?.message || err}`);
    }
  });

  // Admin controls
  if (adminTokenInput) adminTokenInput.value = getAdminToken();
  btnAdminSave?.addEventListener("click", async () => {
    setAdminToken(String(adminTokenInput?.value || ""));
    try {
      await syncBooksFromServer();
      updateAdminUI();
      render();
    } catch (err) {
      updateAdminUI(err?.message || "连接失败");
    }
  });
  btnAdminSync?.addEventListener("click", async () => {
    try {
      await syncBooksFromServer();
      render();
      updateAdminUI();
    } catch (err) {
      updateAdminUI(err?.message || "同步失败");
    }
  });

  // Deep link: /library.html?edit=<id>
  const params = new URLSearchParams(window.location.search);
  const editTarget = params.get("edit");
  if (editTarget) {
    // Delay until initial render finishes.
    setTimeout(() => openEdit(editTarget), 0);
  }

  render();
  updateAdminUI();
}

function initHistoryPage() {
  // History is local per-user, but book metadata can come from server.
  (async () => {
    SERVER_MODE = await detectServerMode();
    if (SERVER_MODE) {
      try { await syncBooksFromServer(); } catch {}
    } else {
      ensureSeedBooks();
    }
    _initHistoryPageAfterBootstrap();
  })();
}

function _initHistoryPageAfterBootstrap() {
  setNavCurrent("history");

  const list = document.getElementById("historyList");
  const btnClear = document.getElementById("btnClearHistory");

  function actionLabel(action) {
    const map = {
      seed: "初始化",
      add: "添加",
      bulk_add: "批量添加",
      delete: "删除",
      clear_books: "清空书库",
      choose: "选中开读",
      put_back: "放回池子",
      return: "放回池子",
      done: "完成",
      edit: "编辑",
    };
    return map[action] || action;
  }

  function render() {
    const history = loadHistory();
    if (!history.length) {
      list.innerHTML = `<p class="panel__hint">还没有记录。去拆一个吧。</p>`;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "list";
    history.slice(0, 200).forEach((h) => {
      const book = h.bookId ? getBookById(h.bookId) : null;
      const title = book?.title || h.bookTitle || h.detail || "—";
      const sub = book?.author || h.bookAuthor || "—";
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div>
          <p class="item__title">${escapeHtml(title)}</p>
          <p class="item__sub">${escapeHtml(sub)} · ${escapeHtml(actionLabel(h.action))} · ${escapeHtml(formatTime(h.at))}</p>
        </div>
        <div>
          <span class="pill">${escapeHtml(h.action)}</span>
        </div>
      `;
      wrap.appendChild(item);
    });
    list.innerHTML = "";
    list.appendChild(wrap);
  }

  btnClear.addEventListener("click", () => {
    if (!confirm("确定要清空历史记录吗？")) return;
    saveHistory([]);
    render();
  });

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.getAttribute("data-page");
  if (page === "unbox") void initUnboxPage();
  if (page === "library") void initLibraryPage();
  if (page === "history") initHistoryPage();
});
