require("dotenv").config();

process.on("uncaughtException",  (err)    => { console.error("UNCAUGHT EXCEPTION:", err.message); });
process.on("unhandledRejection", (reason) => { console.error("UNHANDLED REJECTION:", reason);     });

const fs       = require("fs");
const path     = require("path");
const crypto   = require("crypto");
const express  = require("express");
const axios    = require("axios");
const { execSync } = require("child_process");
const { Telegraf, Markup } = require("telegraf");
const LocalSession = require("telegraf-session-local");
const { fal } = require("@fal-ai/client");

const bot = new Telegraf(process.env.BOT_TOKEN);

// ─── ПОСТІЙНЕ СХОВИЩЕ (має бути до LocalSession!) ────────────────────────────
const DATA_DIR = "/app/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── ПЕРСИСТЕНТНА СЕСІЯ ───────────────────────────────────────────────────────
const localSession = new LocalSession({
  database: path.join(DATA_DIR, "sessions.json"),
  property: "session",
  storage: LocalSession.storageFileAsync,
  format: { serialize: JSON.stringify, deserialize: JSON.parse },
  getSessionKey: (ctx) => ctx.from ? String(ctx.from.id) : null,
});
bot.use(localSession.middleware());

fal.config({ credentials: process.env.FAL_KEY });

bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (e) {
    console.error("GLOBAL HANDLER ERROR:", e.message);
    try { await ctx.reply("❌ Сталася помилка. Спробуй ще раз або /start"); } catch {}
  }
});

// ─── КОНСТАНТИ ────────────────────────────────────────────────────────────────
const ADMINS = [346101852, 688515215];

const WAYFORPAY = {
  merchantAccount: process.env.WAYFORPAY_MERCHANT    || "",
  secretKey:       process.env.WAYFORPAY_SECRET      || "",
  domainName:      process.env.WAYFORPAY_DOMAIN      || "",
  returnUrl:       process.env.WAYFORPAY_RETURN_URL  || "https://t.me/Promtiai_bot",
  serviceUrl:      process.env.WAYFORPAY_SERVICE_URL || "",
};

const REFERRAL_PROMTI_BONUS = 5;

const PROMTI_PRICES = {
  photo:    1,
  seedance: 5,
  kling:    8,
};

// ─── ШЛЯХИ ДО ФАЙЛІВ ─────────────────────────────────────────────────────────
const USERS_PATH        = path.join(DATA_DIR, "users.json");
const PAYMENTS_PATH     = path.join(DATA_DIR, "payments.json");
const PAYMENT_LOCK_PATH = path.join(DATA_DIR, "payment.lock.json");
const PACKAGES_PATH     = path.join(DATA_DIR, "packages.json");
const GEN_LOG_PATH      = path.join(DATA_DIR, "generation_logs.jsonl");

const PROMPTS_PATH      = path.join(DATA_DIR, "prompts.json");
const CONTENT_PATH      = path.join(DATA_DIR, "content.json");
const SETTINGS_PATH     = path.join(DATA_DIR, "settings.json");

for (const [src, dst] of [
  [path.join(__dirname, "prompts.json"),  PROMPTS_PATH],
  [path.join(__dirname, "content.json"),  CONTENT_PATH],
  [path.join(__dirname, "settings.json"), SETTINGS_PATH],
]) {
  if (fs.existsSync(src)) {
    const srcStat = fs.statSync(src);
    const dstExists = fs.existsSync(dst);
    if (!dstExists) {
      fs.copyFileSync(src, dst);
      console.log(`📋 Copied ${path.basename(src)} to Volume`);
    } else if (path.basename(src) === "settings.json") {
      const srcContent = fs.readFileSync(src, "utf8");
      const dstContent = fs.readFileSync(dst, "utf8");
      try {
        const srcJson = JSON.parse(srcContent);
        JSON.parse(dstContent);
        const merged = { ...srcJson, ...JSON.parse(dstContent) };
        fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
        console.log(`🔄 Merged settings.json`);
      } catch (e) {
        fs.copyFileSync(src, dst);
        console.log(`🔧 Fixed corrupted settings.json from GitHub`);
      }
    }
  }
}

// ─── НАЛАШТУВАННЯ ─────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  photoRateLimitMs:    15000,
  videoRateLimitMs:    60000,
  aiPromptRateLimitMs: 30000,
  photoTimeoutMs:      120000,
  seedanceTimeoutMs:   300000,
  klingTimeoutMs:      480000,
  seedanceDurationSec: 5,
  klingDurationSec:    5,
  seedanceAspectRatio: "9:16",
  klingAspectRatio:    "9:16",
  maxWorkers:          5,
  dailySeedanceLimit:  5,
  dailyKlingLimit:     3,
  aiPromptEnabled:     true,
  videoEnabled:        true,
  dailyAiPromptLimit:  10,
};

let _settingsCache = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_MS = 30000;

function loadSettings() {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTime < SETTINGS_CACHE_MS) {
    return _settingsCache;
  }
  _settingsCache = { ...DEFAULT_SETTINGS, ...loadJson(SETTINGS_PATH, DEFAULT_SETTINGS) };
  _settingsCacheTime = now;
  return _settingsCache;
}

function invalidateSettingsCache() {
  _settingsCache = null;
}

// ─── JSON HELPERS ─────────────────────────────────────────────────────────────
function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
      return JSON.parse(JSON.stringify(fallback));
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`LOAD JSON ERROR ${filePath}:`, e.message);
    return JSON.parse(JSON.stringify(fallback));
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function appendLog(entry) {
  try { fs.appendFileSync(GEN_LOG_PATH, JSON.stringify(entry) + "\n", "utf8"); }
  catch (e) { console.error("LOG APPEND ERROR:", e.message); }
}

function log(type, userId, details = "") {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] ${type} | user:${userId || "-"} | ${details}`);
}

// ─── ДАНІ ─────────────────────────────────────────────────────────────────────
const DEFAULT_PROMPTS = {
  portrait: "ultra realistic portrait, studio lighting, preserve face, do not change identity",
  beauty:   "beauty editorial, glossy skin, preserve face, do not change identity",
  fashion:  "high fashion photoshoot, preserve face, do not change identity",
  art:      "digital art, artistic portrait, preserve face, do not change identity",
  trend:    "viral instagram aesthetic, preserve face, do not change identity",
  seedance: "cinematic motion, smooth animation, realistic movement",
  kling:    "cinematic video, fluid motion, high quality animation",
};

const DEFAULT_CONTENT = {
  welcomeText:  "Привіт ✨\n\nОбери що хочеш зробити:\n🖼 Фото — генерація фото по стилях\n🎬 Відео — анімація фото у відео\n\n🎁 1 фото безкоштовно",
  infoText:     "PROMTI AI Bot\n\n🖼 Фото:\n10/99грн · 20/179грн · 30/249грн · 50/399грн\n\n🎬 Seedance:\n3/199грн · 5/349грн · 10/599грн\n\n🎥 Kling:\n3/299грн · 5/499грн · 10/899грн",
  helpText:     "Допомога:\n\n🖼 Фото:\n1. Натисни 🖼 Фото\n2. Обери стиль\n3. Надішли фото\n\n🎬 Відео:\n1. Натисни 🎬 Відео\n2. Обери модель\n3. Надішли фото для анімації",
  supportText:  "Напиши в підтримку: https://t.me/promteamai?direct",
  ideaText:     "💡 Ідеї для промтів:\n\n🖼 Фото:\n• \"portrait in Renaissance style\"\n• \"cyberpunk neon portrait\"\n\n🎬 Відео:\n• \"hair gently flowing in wind\"\n• \"eyes slowly opening, cinematic\"",
  support_link: "https://t.me/promteamai?direct",
  pricesText:   "💰 PROMTI AI — Ціни\n\n💎 Валюта: Promti ✨\n1 Promti ✨ = від 6.7 до 9.9 грн\n\n📦 Пакети:\n10 Promti ✨ — 99 грн (9.9 грн/✨)\n30 Promti ✨ — 249 грн (8.3 грн/✨)\n60 Promti ✨ — 449 грн (7.5 грн/✨)\n150 Promti ✨ — 999 грн (6.7 грн/✨) 🔥\n\n💰 Ціни послуг:\n🖼 Фото — 1 Promti ✨\n🎬 Seedance відео — 5 Promti ✨\n🎥 Kling відео — 8 Promti ✨\n\n🎁 1 Promti ✨ безкоштовно при реєстрації!\n👫 +5 Promti ✨ за кожного друга який оплатить",
  promptLibrary: {},
  promptCategories: {},
};

let users    = loadJson(USERS_PATH,    {});
let prompts  = loadJson(PROMPTS_PATH,  DEFAULT_PROMPTS);
let content  = loadJson(CONTENT_PATH,  DEFAULT_CONTENT);
let payments = loadJson(PAYMENTS_PATH, []);

prompts = { ...DEFAULT_PROMPTS, ...prompts };
content = { ...DEFAULT_CONTENT, ...content };
if (!content.promptLibrary || typeof content.promptLibrary !== "object" || Array.isArray(content.promptLibrary)) content.promptLibrary = {};
if (!content.promptCategories || typeof content.promptCategories !== "object" || Array.isArray(content.promptCategories)) content.promptCategories = {};
saveJson(PROMPTS_PATH, prompts);
saveJson(CONTENT_PATH, content);

// ─── ПАКЕТИ ──────────────────────────────────────────────────────────────────
const DEFAULT_PACKAGES = {
  promti_pack10:  { key: "promti_pack10",  type: "promti", title: "10 Promti ✨",  promti: 10,  amount: 99,  priceText: "99 грн"  },
  promti_pack30:  { key: "promti_pack30",  type: "promti", title: "30 Promti ✨",  promti: 30,  amount: 249, priceText: "249 грн" },
  promti_pack60:  { key: "promti_pack60",  type: "promti", title: "60 Promti ✨",  promti: 60,  amount: 449, priceText: "449 грн" },
  promti_pack150: { key: "promti_pack150", type: "promti", title: "150 Promti ✨", promti: 150, amount: 999, priceText: "999 грн" },
};

function loadPackages() {
  const saved = loadJson(PACKAGES_PATH, null);
  // ✅ Якщо файлу нема або в ньому відсутні ключі DEFAULT_PACKAGES — мержимо
  if (!saved || Object.keys(saved).length === 0) {
    saveJson(PACKAGES_PATH, DEFAULT_PACKAGES);
    return JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
  }
  // ✅ Якщо хоча б одного дефолтного пакету нема в saved — додаємо
  let changed = false;
  for (const key of Object.keys(DEFAULT_PACKAGES)) {
    if (!saved[key]) {
      saved[key] = DEFAULT_PACKAGES[key];
      changed = true;
      console.log(`📦 Додано дефолтний пакет: ${key}`);
    }
  }
  if (changed) saveJson(PACKAGES_PATH, saved);
  return saved;
}

let dynamicPackages = loadPackages();
function getPackages()         { return dynamicPackages; }
function saveDynamicPackages() { saveJson(PACKAGES_PATH, dynamicPackages); }

// ─── АТОМАРНИЙ LOCK ОПЛАТ ─────────────────────────────────────────────────────
let creditedSet = new Set(loadJson(PAYMENT_LOCK_PATH, []));
function markAsCredited(ref) { creditedSet.add(ref); saveJson(PAYMENT_LOCK_PATH, [...creditedSet]); }
function isCredited(ref)     { return creditedSet.has(ref); }

// ─── ЧЕРГА ГЕНЕРАЦІЙ ─────────────────────────────────────────────────────────
const photoQueue = [];
const videoQueue = [];
let activePhotoWorkers = 0;
let activeVideoWorkers = 0;

const generationQueue = { get length() { return photoQueue.length + videoQueue.length; } };
let activeWorkers = 0;

const JOB_TIMEOUT_MS = 10 * 60 * 1000;

function enqueueGeneration(userId, taskFn, type = "photo", ctx = null) {
  return new Promise((resolve, reject) => {
    const queue = type === "video" ? videoQueue : photoQueue;

    const wrappedTask = () => {
      const timeoutPromise = new Promise((_, rej) =>
        setTimeout(() => rej(new Error("JOB_HARD_TIMEOUT")), JOB_TIMEOUT_MS)
      );
      return Promise.race([taskFn(), timeoutPromise]);
    };

    queue.push({ userId, taskFn: wrappedTask, resolve, reject, ctx, notifiedPosition: 0 });
    processQueue();
  });
}

function processQueue() {
  const cfg = loadSettings();
  const maxTotal = cfg.maxWorkers || 10;
  const maxPhoto = 6;
  const maxVideo = 4;

  photoQueue.forEach((job, idx) => {
    if (job.notifiedPosition !== idx + 1) {
      job.notifiedPosition = idx + 1;
      if (job.ctx) {
        job.ctx.reply(`⏳ Ти в черзі: #${idx + 1}\nЗараз обробляється фото...\nОрієнтовно 45 сек — 1 хв ⌛`).catch(() => {});
      }
    }
  });

  videoQueue.forEach((job, idx) => {
    if (job.notifiedPosition !== idx + 1) {
      job.notifiedPosition = idx + 1;
      if (job.ctx) {
        job.ctx.reply(`⏳ Ти в черзі: #${idx + 1}\nЗараз генерується відео...\nОрієнтовно 1-8 хв ⌛`).catch(() => {});
      }
    }
  });

  while (activePhotoWorkers < maxPhoto && activeWorkers < maxTotal && photoQueue.length > 0) {
    const job = photoQueue.shift();
    activePhotoWorkers++;
    activeWorkers++;
    if (job.ctx && job.notifiedPosition > 1) {
      job.ctx.reply("✅ Черга дійшла! Починаю генерацію...").catch(() => {});
    }
    job.taskFn()
      .then(job.resolve).catch(job.reject)
      .finally(() => { activePhotoWorkers--; activeWorkers--; processQueue(); });
  }

  while (activeVideoWorkers < maxVideo && activeWorkers < maxTotal && videoQueue.length > 0) {
    const job = videoQueue.shift();
    activeVideoWorkers++;
    activeWorkers++;
    if (job.ctx && job.notifiedPosition > 1) {
      job.ctx.reply("✅ Черга дійшла! Починаю генерацію відео...").catch(() => {});
    }
    job.taskFn()
      .then(job.resolve).catch(job.reject)
      .finally(() => { activeVideoWorkers--; activeWorkers--; processQueue(); });
  }
}

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
const userLastPhoto    = {};
const userLastVideo    = {};
const userLastAiPrompt = {};
const userGenerating   = new Set();
const userPhotoSpam    = {};
const SPAM_WINDOW_MS   = 10000;
const SPAM_MAX_PHOTOS  = 3;

function checkPhotoSpam(userId) {
  const now   = Date.now();
  const times = (userPhotoSpam[userId] || []).filter(t => now - t < SPAM_WINDOW_MS);
  userPhotoSpam[userId] = times;
  if (times.length >= SPAM_MAX_PHOTOS) return true;
  userPhotoSpam[userId].push(now);
  return false;
}

function checkRateLimit(userId, type) {
  const cfg = loadSettings();
  const map  = type === "video" ? userLastVideo : type === "ai" ? userLastAiPrompt : userLastPhoto;
  const ms   = type === "video" ? cfg.videoRateLimitMs : type === "ai" ? cfg.aiPromptRateLimitMs : cfg.photoRateLimitMs;
  const now  = Date.now();
  if (map[userId] && now - map[userId] < ms) return Math.ceil((ms - (now - map[userId])) / 1000);
  return 0;
}

function touchRateLimit(userId, type) {
  const map = type === "video" ? userLastVideo : type === "ai" ? userLastAiPrompt : userLastPhoto;
  map[userId] = Date.now();
}

// ─── ДЕННІ ЛІМІТИ ─────────────────────────────────────────────────────────────
function getTodayDate() { return new Date().toISOString().slice(0, 10); }

function checkDailyVideoLimit(user, model) {
  const cfg   = loadSettings();
  const today = getTodayDate();
  const limit = model === "kling" ? cfg.dailyKlingLimit : cfg.dailySeedanceLimit;
  if (limit === 0) return null;
  if (user.dailyVideoDate !== today) { user.dailyVideoDate = today; user.dailySeedanceCount = 0; user.dailyKlingCount = 0; }
  const used = model === "kling" ? (user.dailyKlingCount || 0) : (user.dailySeedanceCount || 0);
  if (used >= limit) return `❌ Денний ліміт ${model === "kling" ? "Kling" : "Seedance"}: ${limit} відео/день.\nСпробуй завтра або купи більший пакет.`;
  return null;
}

function checkDailyAiLimit(user) {
  const cfg   = loadSettings();
  const limit = cfg.dailyAiPromptLimit;
  if (limit === 0) return null;
  const today = getTodayDate();
  if (user.dailyAiDate !== today) { user.dailyAiDate = today; user.dailyAiCount = 0; }
  if ((user.dailyAiCount || 0) >= limit) return `❌ Денний ліміт AI-промтів: ${limit}/день. Спробуй завтра або напиши промт вручну через ✍️ Свій промт.`;
  return null;
}

function incrementDailyAi(user) {
  const today = getTodayDate();
  if (user.dailyAiDate !== today) { user.dailyAiDate = today; user.dailyAiCount = 0; }
  user.dailyAiCount = (user.dailyAiCount || 0) + 1;
}

function incrementDailyVideo(user, model) {
  const today = getTodayDate();
  if (user.dailyVideoDate !== today) { user.dailyVideoDate = today; user.dailySeedanceCount = 0; user.dailyKlingCount = 0; }
  if (model === "kling") user.dailyKlingCount = (user.dailyKlingCount || 0) + 1;
  else user.dailySeedanceCount = (user.dailySeedanceCount || 0) + 1;
}

// ─── ПОМИЛКИ → АДМІНИ ────────────────────────────────────────────────────────
const adminErrorLog = {};
const ADMIN_ERROR_DEBOUNCE_MS = 60000;

async function notifyAdminsError(message) {
  const now = Date.now();
  const key = message.slice(0, 100);
  if (adminErrorLog[key] && now - adminErrorLog[key] < ADMIN_ERROR_DEBOUNCE_MS) {
    console.log("ADMIN NOTIFY DEBOUNCED:", key);
    return;
  }
  adminErrorLog[key] = now;
  for (const adminId of ADMINS) {
    try { await bot.telegram.sendMessage(adminId, `⚠️ ПОМИЛКА:\n\n${message}`); }
    catch (e) { console.error("NOTIFY ADMIN ERROR:", e.message); }
  }
}

// ─── ЮЗЕР HELPERS ─────────────────────────────────────────────────────────────
function isAdmin(userId) { return ADMINS.includes(userId); }
function ensureSession(ctx) { if (!ctx.session) ctx.session = {}; }

function resetState(ctx) {
  ensureSession(ctx);
  ctx.session.mode                  = null;
  ctx.session.style                 = null;
  ctx.session.photoMode             = null;
  ctx.session.videoInputMode        = null;
  ctx.session.awaitingCustomAmount  = false;
  ctx.session.customType            = null;
  ctx.session.awaitingCustomPrompt  = false;
  ctx.session.customPrompt          = null;
  ctx.session.awaitingAiPrompt      = null;
  ctx.session.awaitingPromptEditKey = null;
  ctx.session.awaitingTextEditKey   = null;
  ctx.session.awaitingPromptPreviewKey = null;
  ctx.session.currentPromptKey      = null;
  ctx.session.sourcePromptKey       = null;
}

function getUser(id) {
  if (!users[id]) {
    users[id] = {
      id,
      promti: 1,
      purchasedPromti: 0,
      generations: 0, seedanceGenerations: 0, klingGenerations: 0,
      totalSpent: 0, username: "", firstName: "",
      referredBy: null, referralCount: 0, banned: false,
      dailyVideoDate: null, dailySeedanceCount: 0, dailyKlingCount: 0,
      dailyAiDate: null, dailyAiCount: 0,
      lastPaymentRequest: null, pendingOrderReference: null, lastPaidAt: null,
      sourcePromptKey: null,
      lastGeneratedPromptKey: null,
      pendingPurchasePromptKey: null,
      lastPurchaseAttributedOrderReference: null,
      createdAt: new Date().toISOString(),
    };
    saveJson(USERS_PATH, users);
  }
  if (users[id].videoGenerations !== undefined && users[id].seedanceGenerations === undefined) {
    users[id].seedanceGenerations = users[id].videoGenerations || 0;
    users[id].klingGenerations    = 0;
    delete users[id].videoGenerations;
  }
  return users[id];
}

function touchUser(ctx) {
  const user = getUser(ctx.from.id);
  const newUsername  = ctx.from.username   || "";
  const newFirstName = ctx.from.first_name || "";
  if (user.username !== newUsername || user.firstName !== newFirstName) {
    user.username  = newUsername;
    user.firstName = newFirstName;
    saveJson(USERS_PATH, users);
  }
  return user;
}

let _saveUsersTimer = null;
function saveUsers() {
  if (_saveUsersTimer) clearTimeout(_saveUsersTimer);
  _saveUsersTimer = setTimeout(() => {
    saveJson(USERS_PATH, users);
    _saveUsersTimer = null;
  }, 300);
}

function saveUsersSync() { saveJson(USERS_PATH, users); }

function savePrompts()  { saveJson(PROMPTS_PATH,  prompts);  }
function saveContent()  { saveJson(CONTENT_PATH,  content);  }
function savePayments() { saveJson(PAYMENTS_PATH, payments); }

function getUserVideoTotal(user) { return (user.seedanceGenerations || 0) + (user.klingGenerations || 0); }

const PROMPT_LIBRARY_PAGE_SIZE = 6;

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePromptKey(key = "") {
  return String(key).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizePromptLibraryItem(item = {}, key = "") {
  return {
    key: item.key || key,
    title: item.title || key,
    prompt: item.prompt || "",
    category: item.category || "other",
    previewPhoto: item.previewPhoto || null,
    isTrending: Boolean(item.isTrending),
    createdAt: Number(item.createdAt || Date.now()),
    clicks: Number(item.clicks || 0),
    generations: Number(item.generations || 0),
    purchases: Number(item.purchases || 0),
  };
}

function ensurePromptLibrary() {
  if (!content.promptLibrary || typeof content.promptLibrary !== "object" || Array.isArray(content.promptLibrary)) {
    content.promptLibrary = {};
  }
  let changed = false;
  for (const [key, item] of Object.entries(content.promptLibrary)) {
    const normalized = normalizePromptLibraryItem(item, key);
    if (JSON.stringify(normalized) !== JSON.stringify(item)) {
      content.promptLibrary[key] = normalized;
      changed = true;
    }
  }
  if (changed) saveContent();
  return content.promptLibrary;
}

function getPromptStyle(key) {
  const promptLibrary = ensurePromptLibrary();
  if (!key || !promptLibrary[key]) return null;
  return normalizePromptLibraryItem(promptLibrary[key], key);
}

function getSortedPromptStyles() {
  return Object.values(ensurePromptLibrary())
    .map(item => normalizePromptLibraryItem(item, item.key))
    .sort((a, b) =>
      Number(b.isTrending) - Number(a.isTrending) ||
      Number(b.clicks || 0) - Number(a.clicks || 0) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

function getPromptCategoryStats() {
  const stats = {};
  for (const style of getSortedPromptStyles()) {
    stats[style.category] = (stats[style.category] || 0) + 1;
  }
  return stats;
}

function incrementPromptMetric(promptKey, metric, amount = 1) {
  const style = getPromptStyle(promptKey);
  if (!style) return false;
  style[metric] = Number(style[metric] || 0) + amount;
  content.promptLibrary[promptKey] = style;
  saveContent();
  return true;
}

function formatConversion(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

async function resolveBotUsername(ctx) {
  if (ctx?.botInfo?.username) return ctx.botInfo.username;
  if (bot?.botInfo?.username) return bot.botInfo.username;
  if (process.env.BOT_USERNAME) return process.env.BOT_USERNAME;
  try {
    const me = await bot.telegram.getMe();
    return me?.username || "Promtiai_bot";
  } catch {
    return "Promtiai_bot";
  }
}

function getPromptDeepLink(username, key) {
  return `https://t.me/${username}?start=prompt_${key}`;
}

function getPromptBalanceText(userId) {
  if (isAdmin(userId)) return "Адмін: безліміт ✅";
  const user = getUser(userId);
  return `${user.promti || 0} Promti ✨`;
}

function clearPromptAttribution(ctx) {
  ensureSession(ctx);
  ctx.session.currentPromptKey = null;
  ctx.session.sourcePromptKey = null;
}

function applyPromptStyleToSession(ctx, promptKey) {
  const style = getPromptStyle(promptKey);
  if (!style) return null;
  ensureSession(ctx);
  const user = getUser(ctx.from.id);

  ctx.session.mode = "photo";
  ctx.session.photoMode = "edit";
  ctx.session.customType = "custom_photo";
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = style.prompt;
  ctx.session.awaitingAiPrompt = null;
  ctx.session.awaitingCustomAmount = false;
  ctx.session.awaitingPromptEditKey = null;
  ctx.session.awaitingTextEditKey = null;
  ctx.session.currentPromptKey = style.key;
  ctx.session.sourcePromptKey = style.key;
  ctx.session.style = null;
  ctx.session.videoInputMode = null;

  user.sourcePromptKey = style.key;
  saveUsers();
  return style;
}

function markPromptGeneration(user, promptKey) {
  if (!promptKey) return;
  if (!getPromptStyle(promptKey)) return;
  incrementPromptMetric(promptKey, "generations");
  user.lastGeneratedPromptKey = promptKey;
  user.pendingPurchasePromptKey = promptKey;
  saveUsers();
}

function markPromptPurchase(user, orderReference) {
  const promptKey = user.pendingPurchasePromptKey;
  if (!promptKey) return false;
  if (user.lastPurchaseAttributedOrderReference === orderReference) return false;
  if (!getPromptStyle(promptKey)) return false;
  incrementPromptMetric(promptKey, "purchases");
  user.lastPurchaseAttributedOrderReference = orderReference;
  user.pendingPurchasePromptKey = null;
  saveUsers();
  return true;
}

function buildPromptStyleCardText(style, options = {}) {
  const { admin = false, userId = null, botUsername = "Promtiai_bot" } = options;
  const trendMark = style.isTrending ? "🔥 Тренд\n" : "";
  const deepLink = getPromptDeepLink(botUsername, style.key);
  if (admin) {
    return (
      `🎨 <b>${escapeHtml(style.title)}</b>\n` +
      `${trendMark}` +
      `Ключ: <code>${escapeHtml(style.key)}</code>\n` +
      `Категорія: <b>${escapeHtml(style.category)}</b>\n\n` +
      `Clicks: <b>${style.clicks}</b>\n` +
      `Generations: <b>${style.generations}</b>\n` +
      `Purchases: <b>${style.purchases}</b>\n` +
      `Gen conversion: <b>${formatConversion(style.generations, style.clicks)}</b>\n` +
      `Purchase conversion: <b>${formatConversion(style.purchases, style.clicks)}</b>\n\n` +
      `Deep-link:\n<code>${escapeHtml(deepLink)}</code>\n\n` +
      `Промт:\n<code>${escapeHtml(style.prompt)}</code>`
    );
  }

  const balanceText = userId ? getPromptBalanceText(userId) : "-";
  return (
    `🎨 <b>${escapeHtml(style.title)}</b>\n` +
    `${trendMark}` +
    `Категорія: <b>${escapeHtml(style.category)}</b>\n\n` +
    `Надішли своє фото — бот зробить таке ж.\n` +
    `Баланс: <b>${escapeHtml(balanceText)}</b>`
  );
}

function buildPromptLibraryKeyboard(page = 0, admin = false) {
  const items = getSortedPromptStyles();
  const totalPages = Math.max(1, Math.ceil(items.length / PROMPT_LIBRARY_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * PROMPT_LIBRARY_PAGE_SIZE;
  const pageItems = items.slice(start, start + PROMPT_LIBRARY_PAGE_SIZE);
  const prefix = admin ? "admin_promptlib" : "promptlib";
  const rows = pageItems.map(style => [
    Markup.button.callback(
      `${style.isTrending ? "🔥 " : ""}${style.title}`,
      `${prefix}_open_${style.key}`
    )
  ]);
  const nav = [];
  if (safePage > 0) nav.push(Markup.button.callback("⬅️", `${prefix}_page_${safePage - 1}`));
  nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, `${prefix}_noop`));
  if (safePage < totalPages - 1) nav.push(Markup.button.callback("➡️", `${prefix}_page_${safePage + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function buildPromptStyleKeyboard(style, admin = false) {
  if (!admin) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✅ Обрати стиль", `promptlib_apply_${style.key}`)],
      [Markup.button.callback("📚 До списку стилів", "promptlib_page_0")],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback(style.isTrending ? "🔕 Зняти тренд" : "🔥 Зробити трендом", `admin_promptlib_trend_${style.key}_${style.isTrending ? "off" : "on"}`)],
    [Markup.button.callback("🖼 Preview фото", `admin_promptlib_preview_${style.key}`)],
    [Markup.button.callback("🗑 Видалити", `admin_promptlib_delete_${style.key}`)],
    [Markup.button.callback("📚 До бібліотеки", "admin_promptlib_page_0")],
  ]);
}

async function sendPromptLibraryPage(ctx, page = 0, admin = false) {
  const items = getSortedPromptStyles();
  if (!items.length) {
    return ctx.reply(
      admin
        ? "🎨 Бібліотека стилів порожня.\n\nДодай перший стиль через /addprompt KEY | CATEGORY | TITLE | PROMPT"
        : "🎨 Поки що стилів немає. Спробуй трохи пізніше."
    );
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PROMPT_LIBRARY_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const categoryStats = getPromptCategoryStats();
  const categoryText = Object.entries(categoryStats)
    .slice(0, 6)
    .map(([category, count]) => `${category}: ${count}`)
    .join(" • ");

  const text = admin
    ? `🎨 <b>Бібліотека стилів</b>\n\nУсього стилів: <b>${items.length}</b>\nКатегорії: ${escapeHtml(categoryText || "-")}\n\nВідкрий стиль, щоб побачити deep-link, статистику та керування.`
    : `🎨 <b>Трендові стилі</b>\n\nОбери стиль зі списку. Спочатку показані трендові, далі — всі інші.\n\nКатегорії: ${escapeHtml(categoryText || "-")}`;

  const markup = buildPromptLibraryKeyboard(safePage, admin);

  if (ctx.updateType === "callback_query") {
    try {
      return await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: markup.reply_markup,
      });
    } catch (e) {
      if (String(e.message || "").includes("message is not modified")) return;
    }
  }

  return ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: markup.reply_markup,
  });
}

async function sendPromptStyleCard(ctx, promptKey, admin = false) {
  const style = getPromptStyle(promptKey);
  if (!style) return ctx.reply("❌ Стиль не знайдено.");
  const botUsername = await resolveBotUsername(ctx);
  const text = buildPromptStyleCardText(style, { admin, userId: ctx.from?.id, botUsername });
  const markup = buildPromptStyleKeyboard(style, admin);
  if (style.previewPhoto) {
    return ctx.replyWithPhoto(style.previewPhoto, {
      caption: text,
      parse_mode: "HTML",
      reply_markup: markup.reply_markup,
    });
  }
  return ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: markup.reply_markup,
  });
}

async function sendPromptReadyMessage(ctx, style, options = {}) {
  const { withPreview = false } = options;
  const text =
    `✅ Стиль завантажено\n\n` +
    `🎨 ${style.title}\n` +
    `Категорія: ${style.category}\n` +
    `Баланс: ${getPromptBalanceText(ctx.from.id)}\n\n` +
    `Надішли своє фото 📸`;

  if (withPreview && style.previewPhoto) {
    return ctx.replyWithPhoto(style.previewPhoto, {
      caption: text,
      reply_markup: photoMenu().reply_markup,
    });
  }
  return ctx.reply(text, photoMenu());
}

async function replyLongText(ctx, text, extra = undefined) {
  const limit = 3800;
  if (!text || text.length <= limit) return ctx.reply(text, extra);
  for (let i = 0; i < text.length; i += limit) {
    const chunk = text.slice(i, i + limit);
    await ctx.reply(chunk, i === 0 ? extra : undefined);
  }
}

// ─── РЕФЕРАЛЬНА СИСТЕМА ───────────────────────────────────────────────────────
async function handleReferral(ctx, referrerId) {
  const newUserId = ctx.from.id;
  if (referrerId === newUserId) return;
  const referrer = getUser(referrerId);
  const newUser  = getUser(newUserId);
  if (newUser.referredBy) return;
  if (!referrer.totalSpent && (referrer.referralCount || 0) >= 20) { console.warn(`REFERRAL ABUSE: user ${referrerId}`); return; }
  newUser.referredBy     = referrerId;
  newUser.refPaid        = false;
  referrer.referralCount = (referrer.referralCount || 0) + 1;
  saveUsers();
  try { await bot.telegram.sendMessage(referrerId, `👋 Новий друг зареєструвався по твоєму лінку!\n🎁 Бонус +${REFERRAL_PROMTI_BONUS} Promti ✨ отримаєш коли він зробить першу оплату.`); }
  catch (e) { console.error("REFERRAL NOTIFY:", e.message); }
}

// ─── ВАЛІДАЦІЯ ФОТО ───────────────────────────────────────────────────────────
function validatePhoto(photo) {
  const size = photo.file_size || 0;
  if (size > 0 && size < 50 * 1024) return `❌ Фото занадто маленьке (${Math.round(size/1024)}KB). Мінімум 50KB.`;
  if (size > 20 * 1024 * 1024)      return `❌ Фото занадто велике. Максимум 20MB.`;
  return null;
}

// ─── ОТРИМАННЯ ЗОБРАЖЕННЯ ─────────────────────────────────────────────────────
// ─── ХЕЛПЕР: надіслати текст з опціональним фото ────────────────────────────
// Якщо фото є і текст ≤1024 символів → фото з caption
// Якщо фото є і текст довший → фото без caption + текст окремим повідомленням
// Якщо фото немає → звичайний текст
async function sendWithOptionalPhoto(ctx, text, photoFileId, menu) {
  try {
    if (!photoFileId) {
      return await ctx.reply(text, menu);
    }
    const CAPTION_LIMIT = 1024;
    if (text.length <= CAPTION_LIMIT) {
      return await ctx.replyWithPhoto(photoFileId, { caption: text, ...menu });
    }
    // Текст задовгий → фото без caption + текст окремо
    await ctx.replyWithPhoto(photoFileId).catch(() => {});
    return await ctx.reply(text, menu);
  } catch (e) {
    console.error("sendWithOptionalPhoto ERROR:", e.message);
    // Fallback на звичайний текст якщо фото не вдалось надіслати
    try { return await ctx.reply(text, menu); } catch {}
  }
}

async function getImage(ctx, fileId, maxRetries = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const file = await ctx.telegram.getFile(fileId);
      const url  = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      const res  = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
      return `data:image/jpeg;base64,${Buffer.from(res.data).toString("base64")}`;
    } catch (e) {
      lastErr = e;
      console.warn(`getImage RETRY ${attempt}/${maxRetries}:`, e.message);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

async function tgSendWithRetry(fn, maxRetries = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      console.warn(`TG SEND RETRY ${attempt}/${maxRetries}:`, e.message);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

// ─── FAL UPLOAD IMAGE ────────────────────────────────────────────────────────
async function uploadImageToFal(base64DataUrl) {
  try {
    const base64Data = base64DataUrl.replace(/^data:image\/[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const blob = new Blob([buffer], { type: "image/jpeg" });
    const url = await fal.storage.upload(blob, {
      filename: `img_${Date.now()}.jpg`,
      contentType: "image/jpeg",
    });
    console.log("FAL UPLOAD URL:", url);
    return url;
  } catch (e) {
    console.error("FAL UPLOAD ERROR:", e.message);
    return base64DataUrl;
  }
}

// ─── FAL RETRY ────────────────────────────────────────────────────────────────
async function falWithRetry(model, input, timeoutMs, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const falPromise     = fal.subscribe(model, { input, logs: true });
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error("FAL_TIMEOUT")), timeoutMs));
      return await Promise.race([falPromise, timeoutPromise]);
    } catch (e) {
      lastError = e;
      if (e.message === "FAL_TIMEOUT") throw e;
      console.error(`FAL ERROR attempt ${attempt}/${maxRetries}:`);
      console.error(`  message: ${e.message}`);
      console.error(`  status: ${e.status || e.statusCode || "unknown"}`);
      console.error(`  body: ${JSON.stringify(e.body || e.response?.data || e.detail || {}, null, 2)}`);
      const retryable = e?.status >= 500 || String(e?.message).includes("503") || String(e?.message).includes("500");
      if (!retryable || attempt === maxRetries) throw e;
      console.warn(`FAL RETRY ${attempt}/${maxRetries}:`, e.message);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

// ─── ПРОГРЕС ВІДЕО ────────────────────────────────────────────────────────────
function startVideoProgress(ctx) {
  const iv = setInterval(() => ctx.telegram.sendChatAction(ctx.chat.id, "upload_video").catch(() => {}), 5000);
  return () => clearInterval(iv);
}

// ─── AI ПРОМТ ─────────────────────────────────────────────────────────────────
async function generateAiPrompt(imageBase64, mode) {
  const cfg = loadSettings();
  if (!cfg.aiPromptEnabled) return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    notifyAdminsError("ANTHROPIC_API_KEY відсутній — AI-промт не працює!").catch(() => {});
    return null;
  }
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const anthropic = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = mode === "video"
      ? `You are an expert at writing image-to-video animation prompts for Seedance and Kling AI models.
Write ONE ultra-short English prompt — MAXIMUM 10 words (≈5 seconds to read aloud).
Focus on natural motion: hair, eyes, lips, wind, camera movement.
Examples: "hair gently flowing in wind, soft bokeh" / "eyes slowly opening, cinematic close-up"
Output ONLY the prompt. No punctuation at end. No extra words.`
      : `You are an expert at writing image editing prompts for AI photo generation models.
Write ONE short English prompt (max 15 words) to enhance or stylize this portrait.
Preserve face identity. Consider: lighting, style, mood.
Output ONLY the prompt text, nothing else.`;

    const response = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 60,
      system:     systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64.replace("data:image/jpeg;base64,", "") } },
          { type: "text",  text: "Write a prompt for this image." },
        ],
      }],
    });
    return response.content?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error("AI PROMPT ERROR:", e.message);
    return null;
  }
}

// ─── WAYFORPAY ────────────────────────────────────────────────────────────────
function buildOrderReference(userId, packKey) {
  return `tg_${userId}_${packKey}_${Date.now()}`;
}

function parseOrderReference(ref) {
  // ✅ Формат: tg_{userId}_{packKey}_{timestamp}
  // packKey може бути: promti_pack10, custom_1776681162229, photo_pack20 і т.д.
  const m = /^tg_(\d+)_(.+)_(\d+)$/.exec(ref || "");
  if (!m) return null;
  return { userId: Number(m[1]), packKey: m[2] };
}

function signWfpPurchase({ merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency, productName, productCount, productPrice }) {
  const vals = [merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency, ...productName, ...productCount, ...productPrice];
  return crypto.createHmac("md5", WAYFORPAY.secretKey).update(vals.join(";"), "utf8").digest("hex");
}

function signWfpCallback(data) {
  const vals = [
    data.merchantAccount   || "",
    data.orderReference    || "",
    data.amount            || "",
    data.currency          || "",
    data.authCode          || "",
    data.cardPan           || "",
    data.transactionStatus || "",
    data.reasonCode        || "",
  ];
  return crypto.createHmac("md5", WAYFORPAY.secretKey).update(vals.join(";"), "utf8").digest("hex");
}

function buildWfpAcceptResponse(ref) {
  const time = Math.floor(Date.now() / 1000);
  const sig  = crypto.createHmac("md5", WAYFORPAY.secretKey).update([ref, "accept", time].join(";"), "utf8").digest("hex");
  return { orderReference: ref, status: "accept", time, signature: sig };
}

function normalizeWayForPayCallbackBody(body) {
  if (!body) return {};

  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }

  if (body.merchantSignature) return body;

  for (const key of Object.keys(body)) {
    if (typeof key === "string" && key.startsWith("{")) {
      try { return JSON.parse(key); } catch {}
    }
    if (typeof body[key] === "string" && body[key].startsWith("{")) {
      try { return JSON.parse(body[key]); } catch {}
    }
  }

  return body;
}

async function createWayForPayInvoice(userId, packKey) {
  const pack = getPackages()[packKey];
  if (!pack) throw new Error("Unknown package");
  if (!WAYFORPAY.merchantAccount || !WAYFORPAY.secretKey || !WAYFORPAY.domainName || !WAYFORPAY.serviceUrl)
    throw new Error("WayForPay not fully configured");

  const orderReference = buildOrderReference(userId, packKey);
  const orderDate      = Math.floor(Date.now() / 1000);
  const payload = {
    transactionType: "CREATE_INVOICE", merchantAccount: WAYFORPAY.merchantAccount,
    merchantDomainName: WAYFORPAY.domainName, merchantAuthType: "SimpleSignature",
    apiVersion: 1, language: "UA", serviceUrl: WAYFORPAY.serviceUrl,
    returnUrl: WAYFORPAY.returnUrl, orderReference, orderDate,
    amount: pack.amount, currency: "UAH",
    productName: [pack.title], productPrice: [pack.amount], productCount: [1],
  };
  payload.merchantSignature = signWfpPurchase({
    merchantAccount: payload.merchantAccount, merchantDomainName: payload.merchantDomainName,
    orderReference: payload.orderReference, orderDate: payload.orderDate,
    amount: payload.amount, currency: payload.currency,
    productName: payload.productName, productCount: payload.productCount, productPrice: payload.productPrice,
  });

  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await axios.post("https://api.wayforpay.com/api", payload, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`WFP API RETRY ${attempt}/3:`, e.message);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  const data = res.data || {};
  const invoiceUrl = data.invoiceUrl || data.url || data.href || null;
  if (!invoiceUrl) throw new Error(`WayForPay no invoiceUrl: ${JSON.stringify(data)}`);

  payments.push({ provider: "wayforpay", orderReference, userId, packKey, amount: pack.amount, status: "created", createdAt: new Date().toISOString() });
  savePayments();
  return { invoiceUrl, orderReference };
}

function updatePaymentStatus(ref, data, status) {
  const p = payments.find(x => x.orderReference === ref);
  if (p) { if (p.status === "credited") return; p.callback = data; p.updatedAt = new Date().toISOString(); p.status = status || p.status; }
  else payments.push({ provider: "wayforpay", orderReference: ref, status: status || "callback_received", createdAt: new Date().toISOString(), callback: data });
  savePayments();
}

// ─── СЕГМЕНТАЦІЯ ЮЗЕРІВ ───────────────────────────────────────────────────────
function getUserSegment(u) {
  if ((u.totalSpent || 0) >= 500)                            return "🐳 Whale";
  if ((u.totalSpent || 0) > 0)                               return "💳 Paying";
  if ((u.generations || 0) > 0 || getUserVideoTotal(u) > 0) return "🔥 Active";
  return "🆕 New";
}

// ─── СТАТИСТИКА ───────────────────────────────────────────────────────────────
function getBotStats() {
  const all = Object.values(users);
  const cfg = loadSettings();
  return {
    totalUsers:       all.length,
    activeUsers:      all.filter(u => u.generations > 0 || getUserVideoTotal(u) > 0).length,
    bannedUsers:      all.filter(u => u.banned).length,
    totalPhotoGen:    all.reduce((s, u) => s + (u.generations          || 0), 0),
    totalSeedanceGen: all.reduce((s, u) => s + (u.seedanceGenerations  || 0), 0),
    totalKlingGen:    all.reduce((s, u) => s + (u.klingGenerations     || 0), 0),
    totalReferrals:   all.reduce((s, u) => s + (u.referralCount        || 0), 0),
    totalRevenue:     payments.filter(p => p.status === "credited").reduce((s, p) => s + (Number(p.amount) || 0), 0),
    totalPaidOrders:  payments.filter(p => p.status === "credited").length,
    queueLength:      generationQueue.length,
    activeWorkers,
    maxWorkers:       cfg.maxWorkers,
    segments: {
      new:    all.filter(u => getUserSegment(u) === "🆕 New").length,
      active: all.filter(u => getUserSegment(u) === "🔥 Active").length,
      paying: all.filter(u => getUserSegment(u) === "💳 Paying").length,
      whales: all.filter(u => getUserSegment(u) === "🐳 Whale").length,
    },
    aiPromptEnabled: cfg.aiPromptEnabled,
    videoEnabled:    cfg.videoEnabled,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasFalKey:       !!process.env.FAL_KEY,
    hasWfp:          !!WAYFORPAY.merchantAccount,
  };
}

// ─── МЕНЮ ─────────────────────────────────────────────────────────────────────
const mainMenu  = () => Markup.keyboard([
  ["🖼 Фото", "🎬 Відео"],
  ["🎨 Трендові стилі"],
  ["✨ Купити Promti ✨"],
  ["📊 Баланс", "💰 Ціни"],
  ["💡 Ідея для промтів", "👫 Запросити друга"],
  ["ℹ️ Інформація", "❓ Допомога"],
  ["🆘 Підтримка"]
]).resize();
const photoMenu = () => Markup.keyboard([
  ["🖼 Редагувати фото", "✨ Створити фото"],
  ["🤖 AI промт для фото"],
  ["📊 Баланс"],
  ["↩️ Назад"]
]).resize();
const videoMenu     = () => Markup.keyboard([
  ["🎬 Seedance", "🎥 Kling"],
  ["🤖 AI промт для відео"],
  ["📊 Баланс"],
  ["↩️ Назад"]
]).resize();
const seedanceMenu  = () => Markup.keyboard([
  ["⚡ Авто анімація", "🎬 Анімація + промт"],
  ["🎥 Відео з тексту"],
  ["↩️ Назад до відео"]
]).resize();
const klingMenu     = () => Markup.keyboard([
  ["⚡ Авто анімація", "🎬 Анімація + промт"],
  ["🎥 Відео з тексту"],
  ["↩️ Назад до відео"]
]).resize();
const adminMenu       = () => Markup.keyboard([
  ["📊 Статус бота", "👤 Мій ID"],
  ["👥 Користувачі", "💳 Останні оплати"],
  ["🎨 Бібліотека стилів", "📈 Аналітика"],
  ["📦 Пакети", "⚙️ Налаштування"],
  ["✏️ Змінити текст", "📝 Поточні тексти"],
  ["🖼 Прикріпити фото"],
  ["↩️ Назад"],
]).resize();
const adminPromptsMenu = () => Markup.keyboard([["portrait", "beauty"], ["fashion", "art"], ["trend", "seedance"], ["kling"], ["↩️ Назад"]]).resize();
const adminTextsMenu   = () => Markup.keyboard([["welcomeText", "infoText"], ["helpText", "supportText"], ["ideaText", "pricesText"], ["↩️ Назад"]]).resize();
const adminPhotosMenu  = () => Markup.keyboard([
  ["📷 welcomePhoto", "📷 infoPhoto"],
  ["📷 helpPhoto", "📷 pricesPhoto"],
  ["📷 ideaPhoto", "📷 broadcastPhoto"],
  ["↩️ Назад"]
]).resize();

const paymentInlineKeyboard = (payUrl, pack) => Markup.inlineKeyboard([
  [Markup.button.url(`💳 Оплатити ${pack.title} — ${pack.priceText}`, payUrl)],
  [Markup.button.callback("🔄 Перевірити оплату", `checkpay_${pack.key}`)],
]);

// ─── START ────────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  ensureSession(ctx);
  const isNew = !users[ctx.from.id];
  const user = touchUser(ctx);
  resetState(ctx);
  const payload = ctx.startPayload || "";
  if (isNew && payload.startsWith("ref_")) {
    const refId = Number(payload.replace("ref_", ""));
    if (refId && refId !== ctx.from.id) await handleReferral(ctx, refId);
  }
  if (payload.startsWith("prompt_")) {
    const promptKey = normalizePromptKey(payload.replace("prompt_", ""));
    const style = getPromptStyle(promptKey);
    if (style) {
      incrementPromptMetric(style.key, "clicks");
      applyPromptStyleToSession(ctx, style.key);
      user.sourcePromptKey = style.key;
      saveUsers();
      return sendPromptReadyMessage(ctx, style, { withPreview: true });
    }
  }
  return sendWithOptionalPhoto(ctx, content.welcomeText, content.welcomePhoto, mainMenu());
});

// ─── КОМАНДИ ──────────────────────────────────────────────────────────────────
bot.command("help",  (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.helpText, content.helpPhoto, mainMenu()); });
bot.command("info",  (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.infoText, content.infoPhoto, mainMenu()); });
bot.command("myid",  (ctx) => { touchUser(ctx); return ctx.reply(`Твій ID: ${ctx.from.id}`); });
bot.command("admin", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  resetState(ctx);
  return ctx.reply(
    "👑 Адмін панель\n\n" +

    "📊 КНОПКИ МЕНЮ:\n" +
    "📊 Статус бота — черга, воркери, ключі API, сегменти юзерів, виручка\n" +
    "👤 Мій ID — показує твій Telegram ID\n" +
    "👥 Користувачі — останні 15 юзерів з балансом\n" +
    "💳 Останні оплати — останні 15 транзакцій\n" +
    "📈 Аналітика — конверсія, топ пакети, виручка 7 днів\n" +
    "📦 Пакети — всі пакети з цінами\n" +
    "✏️ Змінити текст — редагувати тексти бота\n" +
    "📝 Поточні тексти — переглянути всі тексти\n" +
    "⚙️ Налаштування — ліміти черги, таймаути, денні ліміти\n" +
    "🖼 Прикріпити фото — додати/видалити фото до welcomeText, infoText, helpText, pricesText, ideaText або broadcast\n\n" +

    "💰 ЦІНИ ТА ПАКЕТИ:\n" +
    "/packages — переглянути всі пакети і ціни\n" +
    "/setprice promti_pack10 120 — змінити ціну пакету\n" +
    "/addpackage KEY promti 15 1199 15 Promti — додати новий пакет\n" +
    "/setlink support_link https://t.me/... — змінити посилання\n\n" +

    "👥 КЕРУВАННЯ ЮЗЕРАМИ:\n" +
    "/userinfo ID — повна інфо про юзера\n" +
    "/addpromti ID 10 — нарахувати Promti юзеру вручну\n" +
    "/ban ID — заблокувати юзера\n" +
    "/unban ID — розблокувати юзера\n" +
    "/delete_user ID — видалити юзера повністю\n\n" +

    "📢 РОЗСИЛКА:\n" +
    "/broadcast Текст — надіслати всім юзерам\n" +
    "/analytics — детальна аналітика",
    adminMenu()
  );
});

bot.command("ref", (ctx) => {
  touchUser(ctx);
  const botUsername = ctx.botInfo?.username || "Promtiai_bot";
  const link = `https://t.me/${botUsername}?start=ref_${ctx.from.id}`;
  return ctx.reply(`🔗 Реферальне посилання:\n${link}\n\n🎁 За кожного друга який оплатить: +${REFERRAL_PROMTI_BONUS} Promti ✨\nЗапрошено: ${users[ctx.from.id]?.referralCount || 0}`);
});

bot.command("addprompt", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const raw = ctx.message.text.replace(/^\/addprompt(@\w+)?\s*/i, "");
  const parts = raw.split("|").map(part => part.trim());
  if (parts.length < 4) return ctx.reply("Формат: /addprompt KEY | CATEGORY | TITLE | PROMPT");

  const [rawKey, category, title, ...promptParts] = parts;
  const key = normalizePromptKey(rawKey);
  const prompt = promptParts.join(" | ").trim();

  if (!key) return ctx.reply("❌ Некоректний KEY. Дозволені символи: a-z, 0-9, _ та -");
  if (!category || !title || !prompt) return ctx.reply("❌ Усі поля обов'язкові.");
  if (getPromptStyle(key)) return ctx.reply(`❌ Стиль з key "${key}" вже існує.`);

  ensurePromptLibrary();
  if (!content.promptCategories[category]) {
    content.promptCategories[category] = {
      key: category,
      title: category,
      sortOrder: 0,
    };
  }
  content.promptLibrary[key] = normalizePromptLibraryItem({
    key,
    title,
    prompt,
    category,
    previewPhoto: null,
    isTrending: false,
    createdAt: Date.now(),
    clicks: 0,
    generations: 0,
    purchases: 0,
  }, key);
  saveContent();

  const botUsername = await resolveBotUsername(ctx);
  const deepLink = getPromptDeepLink(botUsername, key);
  ctx.session.awaitingPromptPreviewKey = key;

  return ctx.reply(
    `✅ Стиль створено\n\n` +
    `KEY: ${key}\n` +
    `Категорія: ${category}\n` +
    `Назва: ${title}\n\n` +
    `Deep-link:\n${deepLink}\n\n` +
    `Можеш одразу надіслати preview-фото для цього стилю або зробити це пізніше через /setpromptpreview ${key}`
  );
});

bot.command("prompts", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const items = getSortedPromptStyles();
  if (!items.length) return ctx.reply("Бібліотека стилів порожня.");

  const botUsername = await resolveBotUsername(ctx);
  const text = items.map(style =>
    `${style.isTrending ? "🔥 " : ""}${style.title}\n` +
    `key: ${style.key}\n` +
    `category: ${style.category}\n` +
    `deep-link: ${getPromptDeepLink(botUsername, style.key)}`
  ).join("\n\n");

  return replyLongText(ctx, text);
});

bot.command("delprompt", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const key = normalizePromptKey(ctx.message.text.replace(/^\/delprompt(@\w+)?\s*/i, ""));
  if (!key) return ctx.reply("Формат: /delprompt KEY");
  if (!getPromptStyle(key)) return ctx.reply(`❌ Стиль "${key}" не знайдено.`);

  delete content.promptLibrary[key];
  saveContent();
  return ctx.reply(`✅ Стиль "${key}" видалено.`);
});

bot.command("topprompts", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const sortBy = (ctx.message.text.split(/\s+/)[1] || "purchases").toLowerCase();
  const metric = ["clicks", "generations", "purchases"].includes(sortBy) ? sortBy : "purchases";
  const items = getSortedPromptStyles()
    .sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0))
    .slice(0, 10);

  if (!items.length) return ctx.reply("Бібліотека стилів порожня.");

  const text = items.map((style, index) =>
    `${index + 1}. ${style.title} (${style.key})\n` +
    `Clicks: ${style.clicks} | Generations: ${style.generations} | Purchases: ${style.purchases}\n` +
    `Gen conversion: ${formatConversion(style.generations, style.clicks)}\n` +
    `Purchase conversion: ${formatConversion(style.purchases, style.clicks)}`
  ).join("\n\n");

  return replyLongText(ctx, `🏆 Топ стилів за ${metric}\n\n${text}`);
});

bot.command("trendprompt", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const [, rawKey, rawValue] = ctx.message.text.split(/\s+/);
  const key = normalizePromptKey(rawKey);
  const style = getPromptStyle(key);
  if (!style) return ctx.reply(`❌ Стиль "${key}" не знайдено.`);
  if (!["on", "off"].includes((rawValue || "").toLowerCase())) {
    return ctx.reply("Формат: /trendprompt KEY on|off");
  }

  style.isTrending = rawValue.toLowerCase() === "on";
  content.promptLibrary[key] = style;
  saveContent();
  return ctx.reply(`✅ Для стилю "${key}" тренд-статус: ${style.isTrending ? "ON" : "OFF"}`);
});

bot.command("setpromptpreview", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const key = normalizePromptKey(ctx.message.text.replace(/^\/setpromptpreview(@\w+)?\s*/i, ""));
  const style = getPromptStyle(key);
  if (!style) return ctx.reply(`❌ Стиль "${key}" не знайдено.`);

  ctx.session.awaitingPromptPreviewKey = key;
  return ctx.reply(
    `🖼 Надішли preview-фото для стилю "${key}".\n` +
    `Або напиши "видалити", щоб прибрати поточне preview.`
  );
});

bot.command("addpromti", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const [, id, amt] = ctx.message.text.split(/\s+/);
  if (!id || !amt) return ctx.reply("Формат: /addpromti ID КІЛЬКІСТЬ");
  const user = getUser(Number(id));
  user.promti = (user.promti || 0) + Number(amt);
  saveUsersSync();
  await ctx.reply(`✅ +${amt} Promti ✨ → user ${id}. Баланс: ${user.promti} Promti ✨`);
  bot.telegram.sendMessage(Number(id), `🎉 +${amt} Promti ✨ на баланс!\nБаланс: ${user.promti} Promti ✨`, mainMenu()).catch(() => {});
});

bot.command("reset_packages", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  dynamicPackages = JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
  saveDynamicPackages();
  const list = Object.keys(dynamicPackages).join("\n");
  return ctx.reply(`✅ Пакети скинуто до дефолтних:\n\n${list}`);
});

bot.command("delete_user", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Формат: /delete_user ID");
  if (!users[id]) return ctx.reply("Не знайдено");

  const u = users[id];
  delete users[id];

  const before = payments.length;
  payments = payments.filter(p => p.userId !== id);

  saveUsersSync();
  savePayments();

  return ctx.reply(
    `✅ Видалено:\nUser ${id} (@${u.username || "-"})\nПлатежів: ${before - payments.length}\nВитрачено було: ${u.totalSpent || 0} грн`
  );
});

bot.command("userinfo", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Формат: /userinfo ID");
  const u = users[id];
  if (!u) return ctx.reply("Користувача не знайдено");
  const cfg = loadSettings();
  return ctx.reply(
    `👤 ID: ${u.id} ${getUserSegment(u)}\n@${u.username || "-"} | ${u.firstName || "-"}\n\n` +
    `💎 Баланс Promti ✨: ${u.promti || 0}\n\n` +
    `⚡ Фото: ${u.generations || 0}\n🎬 Seedance: ${u.seedanceGenerations || 0}\n🎥 Kling: ${u.klingGenerations || 0}\n\n` +
    `💰 Витрачено: ${u.totalSpent || 0} грн\n👫 Рефералів: ${u.referralCount || 0}\n` +
    `🚫 Бан: ${u.banned ? "так" : "ні"}\n📅 З: ${(u.createdAt || "").slice(0, 10)}\n\n` +
    `📊 Сьогодні Seedance: ${u.dailySeedanceCount || 0}/${cfg.dailySeedanceLimit}\n` +
    `📊 Сьогодні Kling: ${u.dailyKlingCount || 0}/${cfg.dailyKlingLimit}`
  );
});

bot.command("ban", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Формат: /ban ID");
  const user = getUser(id); user.banned = true; saveUsersSync();
  await ctx.reply(`🚫 User ${id} заблокований`);
  bot.telegram.sendMessage(id, "🚫 Ваш акаунт заблокований. Напишіть в підтримку.").catch(() => {});
});

bot.command("unban", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Формат: /unban ID");
  const user = getUser(id); user.banned = false; saveUsersSync();
  await ctx.reply(`✅ User ${id} розблокований`);
  bot.telegram.sendMessage(id, "✅ Ваш акаунт розблоковано. Можете продовжувати.", mainMenu()).catch(() => {});
});

bot.command("broadcast", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const text = ctx.message.text.replace("/broadcast", "").trim();
  if (!text) return ctx.reply("Формат: /broadcast Текст\n\nЯкщо прикріплено 📷 broadcastPhoto — надішлеться з фото.");

  const all = Object.values(users).filter(u => !u.banned);
  let sent = 0, failed = 0;
  const photoId = content.broadcastPhoto || null;
  await ctx.reply(`⏳ Надсилаю ${all.length} користувачам${photoId ? " (з фото)" : ""}...`);

  const BATCH_SIZE  = 25;
  const BATCH_DELAY = 1500;
  const MSG_DELAY   = 50;
  const CAPTION_LIMIT = 1024;

  for (let i = 0; i < all.length; i++) {
    const u = all[i];
    try {
      if (photoId) {
        if (text.length <= CAPTION_LIMIT) {
          await bot.telegram.sendPhoto(u.id, photoId, { caption: text, ...mainMenu() });
        } else {
          await bot.telegram.sendPhoto(u.id, photoId).catch(() => {});
          await bot.telegram.sendMessage(u.id, text, mainMenu());
        }
      } else {
        await bot.telegram.sendMessage(u.id, text, mainMenu());
      }
      sent++;
    } catch { failed++; }

    await new Promise(r => setTimeout(r, MSG_DELAY));

    if ((i + 1) % BATCH_SIZE === 0) {
      await ctx.reply(`⏳ Надіслано ${sent}/${all.length}...`);
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return ctx.reply(`✅ Broadcast завершено!\nНадіслано: ${sent}\nПомилок: ${failed}`);
});

// ─── АДМІН: КЕРУВАННЯ ПАКЕТАМИ ────────────────────────────────────────────────

bot.command("analytics", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const all = Object.values(users);
  const paid = payments.filter(p => p.status === "credited");

  const packCount = {};
  paid.forEach(p => {
    packCount[p.packKey] = (packCount[p.packKey] || 0) + 1;
  });
  const topPacks = Object.entries(packCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, cnt]) => `  ${key}: ${cnt} разів`)
    .join("\n");

  const now = Date.now();
  const DAY = 86400000;
  const revenueByDay = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY).toISOString().slice(0, 10);
    revenueByDay[d] = 0;
  }
  paid.forEach(p => {
    const d = (p.updatedAt || p.createdAt || "").slice(0, 10);
    if (revenueByDay[d] !== undefined) revenueByDay[d] += Number(p.amount || 0);
  });
  const revenueChart = Object.entries(revenueByDay)
    .map(([d, amt]) => `  ${d.slice(5)}: ${amt} грн`)
    .join("\n");

  const totalUsers   = all.length;
  const payingUsers  = all.filter(u => (u.totalSpent || 0) > 0).length;
  const activeUsers  = all.filter(u => (u.generations || 0) > 0 || (u.seedanceGenerations || 0) > 0 || (u.klingGenerations || 0) > 0).length;
  const conversion   = totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : 0;
  const actConversion = activeUsers > 0 ? ((payingUsers / activeUsers) * 100).toFixed(1) : 0;

  const totalRevenue = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
  const avgCheck     = payingUsers > 0 ? Math.round(totalRevenue / payingUsers) : 0;

  const triedNoPayment = all.filter(u =>
    ((u.generations || 0) > 0 || (u.seedanceGenerations || 0) > 0 || (u.klingGenerations || 0) > 0) &&
    (u.totalSpent || 0) === 0
  ).length;

  const repeatBuyers = all.filter(u => {
    const userPaid = paid.filter(p => p.userId == u.id);
    return userPaid.length > 1;
  }).length;

  return ctx.reply(
    `📊 Аналітика\n\n` +
    `👥 Юзери: ${totalUsers} всього\n` +
    `  🔥 Активних: ${activeUsers}\n` +
    `  💳 Платних: ${payingUsers}\n` +
    `  😶 Спробували і пішли: ${triedNoPayment}\n\n` +
    `💰 Конверсія:\n` +
    `  Всі→платні: ${conversion}%\n` +
    `  Активні→платні: ${actConversion}%\n\n` +
    `💵 Фінанси:\n` +
    `  Всього: ${totalRevenue} грн\n` +
    `  Середній чек: ${avgCheck} грн\n` +
    `  Повторні покупки: ${repeatBuyers} юзерів\n\n` +
    `📦 Топ пакети:\n${topPacks || "  немає даних"}\n\n` +
    `📅 Виручка (7 днів):\n${revenueChart}`
  );
});

bot.command("packages", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const pkgs = getPackages();
  const text = Object.values(pkgs).map(p =>
    `${p.key}\n  💰 ${p.amount} грн | ${p.promti || p.count || 0} ✨ | ${p.type}${p.model ? " / " + p.model : ""}`
  ).join("\n\n");
  return ctx.reply(
    `📦 Всі пакети:\n\n${text}\n\n` +
    `Змінити ціну:\n/setprice promti_pack10 120\n\n` +
    `Додати пакет:\n/addpackage KEY promti 15 1199 15 Promti\n\n` +
    `Посилання:\n/setlink support_link https://t.me/support`
  );
});

bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 3) return ctx.reply("Формат: /setprice КЛЮЧ_ПАКЕТУ ЦІНА\n\nПриклад: /setprice promti_pack10 120");
  const packKey = parts[1];
  const amount  = Number(parts[2]);
  if (!getPackages()[packKey]) return ctx.reply(`❌ Пакет "${packKey}" не знайдено.\n\nДоступні ключі:\n${Object.keys(getPackages()).join("\n")}`);
  if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Ціна має бути числом більше 0");
  dynamicPackages[packKey].amount    = amount;
  dynamicPackages[packKey].priceText = `${amount} грн`;
  saveDynamicPackages();
  return ctx.reply(`✅ Ціна "${packKey}" оновлена: ${amount} грн`);
});

bot.command("addpackage", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const text  = ctx.message.text.replace("/addpackage", "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 5) {
    return ctx.reply(
      "Формат: /addpackage КЛЮЧ ТИП КІЛЬКІСТЬ ЦІНА НАЗВА\n\n" +
      "Приклад: /addpackage promti_pack200 promti 200 1299 200 Promti"
    );
  }
  const [key, type, countStr, amountStr, ...titleParts] = parts;
  const count  = Number(countStr);
  const amount = Number(amountStr);
  const title  = titleParts.join(" ");
  if (isNaN(count)  || count  <= 0) return ctx.reply("❌ Кількість має бути числом > 0");
  if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Ціна має бути числом > 0");
  if (getPackages()[key]) return ctx.reply(`❌ Пакет "${key}" вже існує. Для зміни ціни: /setprice ${key} ЦІНА`);
  dynamicPackages[key] = { key, type, title, promti: count, amount, priceText: `${amount} грн` };
  saveDynamicPackages();
  return ctx.reply(`✅ Пакет додано!\n\nКлюч: ${key}\nНазва: ${title}\nТип: ${type}\nКількість: ${count} ✨\nЦіна: ${amount} грн`);
});

bot.command("setlink", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const text  = ctx.message.text.replace("/setlink", "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2) return ctx.reply("Формат: /setlink КЛЮЧ URL\n\nПриклад: /setlink support_link https://t.me/support");
  const key = parts[0];
  const url  = parts[1];
  if (!url.startsWith("http")) return ctx.reply("❌ URL має починатись з http:// або https://");
  content[key] = url;
  saveContent();
  return ctx.reply(`✅ Посилання "${key}" збережено:\n${url}`);
});

// ─── АДМІН ХЕНДЛЕРИ ───────────────────────────────────────────────────────────
bot.hears("📊 Статус бота", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const s = getBotStats();
  return ctx.reply(
    `🤖 Статус бота\n\n` +
    `${s.hasFalKey       ? "✅" : "❌"} FAL_KEY\n` +
    `${s.hasWfp          ? "✅" : "❌"} WayForPay\n` +
    `${s.hasAnthropicKey ? "✅" : "❌"} Anthropic (AI промт)\n` +
    `${s.aiPromptEnabled ? "✅" : "⏸"} AI промт: ${s.aiPromptEnabled ? "увімкнено" : "вимкнено"}\n` +
    `${s.videoEnabled    ? "✅" : "⏸"} Відео: ${s.videoEnabled ? "увімкнено" : "вимкнено"}\n\n` +
    `⚙️ Черга: ${s.activeWorkers}/${s.maxWorkers} воркерів | ${s.queueLength} в черзі\n\n` +
    `📊 Статистика:\n` +
    `👥 Користувачів: ${s.totalUsers} (🚫${s.bannedUsers} забанено)\n` +
    `🆕 New: ${s.segments.new} | 🔥 Active: ${s.segments.active} | 💳 Paying: ${s.segments.paying} | 🐳 Whale: ${s.segments.whales}\n` +
    `🖼 Фото: ${s.totalPhotoGen}\n` +
    `🎬 Seedance: ${s.totalSeedanceGen}\n` +
    `🎥 Kling: ${s.totalKlingGen}\n` +
    `👫 Рефералів: ${s.totalReferrals}\n` +
    `💰 Зароблено: ${s.totalRevenue} грн\n` +
    `🧾 Оплат: ${s.totalPaidOrders}`,
    adminMenu()
  );
});

bot.hears("👤 Мій ID", (ctx) => { touchUser(ctx); if (!isAdmin(ctx.from.id)) return ctx.reply("❌"); return ctx.reply(`Твій ID: ${ctx.from.id}`, adminMenu()); });

bot.hears("👥 Користувачі", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const all = Object.values(users);
  if (!all.length) return ctx.reply("Немає", adminMenu());
  const text = all.slice(-15).reverse().map(u =>
    `${u.banned ? "🚫 " : ""}ID: ${u.id} @${u.username || "-"}\n` +
    `✨ ${u.promti || 0} Promti ✨ | 💰 ${u.totalSpent || 0}грн\n` +
    `⚡ ${u.generations || 0}ф ${u.seedanceGenerations || 0}s ${u.klingGenerations || 0}k | 👫 ${u.referralCount || 0}\n` +
    `📅 ${(u.createdAt || "").slice(0, 10)}`
  ).join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("💳 Останні оплати", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  if (!payments.length) return ctx.reply("Оплат немає", adminMenu());
  const text = payments.slice(-15).reverse().map(p =>
    `${p.packKey || "-"} | ${p.userId || "-"}\n${p.amount || "-"} грн | ${p.status || "-"}\n${(p.updatedAt || p.createdAt || "").slice(0, 16)}`
  ).join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("🎨 Бібліотека стилів", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return sendPromptLibraryPage(ctx, 0, true);
});

bot.hears("📝 Поточні промти", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(Object.entries(prompts).map(([k, v]) => `${k}:\n${v}`).join("\n\n"), adminMenu());
});

bot.hears("✏️ Змінити промт", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  resetState(ctx);
  return ctx.reply("Обери:", adminPromptsMenu());
});

bot.hears(["portrait", "beauty", "fashion", "art", "trend", "seedance", "kling"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const valid = ["portrait", "beauty", "fashion", "art", "trend", "seedance", "kling"];
  if (!valid.includes(ctx.message.text)) return;
  ctx.session.awaitingPromptEditKey = ctx.message.text;
  return ctx.reply(`Ключ: ${ctx.message.text}\n\nПоточний:\n${prompts[ctx.message.text]}\n\nНадішли новий.`, adminMenu());
});

bot.hears("📝 Поточні тексти", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const textOnlyEntries = Object.entries(content).filter(([k, v]) =>
    !["promptLibrary", "promptCategories"].includes(k) && typeof v !== "object"
  );
  return replyLongText(ctx, textOnlyEntries.map(([k, v]) => `${k}:\n${v}`).join("\n\n==\n\n"), adminMenu());
});

bot.hears("✏️ Змінити текст", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  resetState(ctx);
  return ctx.reply("Обери:", adminTextsMenu());
});

bot.hears(["welcomeText", "infoText", "helpText", "supportText", "ideaText", "pricesText"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const valid = ["welcomeText", "infoText", "helpText", "supportText", "ideaText", "pricesText"];
  if (!valid.includes(ctx.message.text)) return;
  ctx.session.awaitingTextEditKey = ctx.message.text;
  return ctx.reply(`Ключ: ${ctx.message.text}\n\nПоточний:\n${content[ctx.message.text]}\n\nНадішли новий.`, adminMenu());
});

// ─── АДМІН: УПРАВЛІННЯ ФОТО ───────────────────────────────────────────────────
bot.hears("🖼 Прикріпити фото", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  resetState(ctx);
  const statuses = [
    `welcomePhoto   — ${content.welcomePhoto ? "✅" : "❌"}`,
    `infoPhoto      — ${content.infoPhoto ? "✅" : "❌"}`,
    `helpPhoto      — ${content.helpPhoto ? "✅" : "❌"}`,
    `pricesPhoto    — ${content.pricesPhoto ? "✅" : "❌"}`,
    `ideaPhoto      — ${content.ideaPhoto ? "✅" : "❌"}`,
    `broadcastPhoto — ${content.broadcastPhoto ? "✅" : "❌"}`,
  ].join("\n");
  return ctx.reply(
    `🖼 Прикріпити фото до тексту\n\n` +
    `Поточний стан:\n${statuses}\n\n` +
    `Обери який текст — потім надішли фото.\n` +
    `Щоб видалити існуюче — надішли "видалити" замість фото.`,
    adminPhotosMenu()
  );
});

bot.hears(["📷 welcomePhoto", "📷 infoPhoto", "📷 helpPhoto", "📷 pricesPhoto", "📷 ideaPhoto", "📷 broadcastPhoto"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const map = {
    "📷 welcomePhoto":   "welcomePhoto",
    "📷 infoPhoto":      "infoPhoto",
    "📷 helpPhoto":      "helpPhoto",
    "📷 pricesPhoto":    "pricesPhoto",
    "📷 ideaPhoto":      "ideaPhoto",
    "📷 broadcastPhoto": "broadcastPhoto",
  };
  const key = map[ctx.message.text];
  if (!key) return;
  ctx.session.awaitingPhotoForKey = key;
  const current = content[key];
  return ctx.reply(
    `Ключ: ${key}\n\n` +
    `Поточне фото: ${current ? "✅ є" : "❌ нема"}\n\n` +
    `Надішли нове фото. Або напиши "видалити" щоб прибрати існуюче.`,
    adminMenu()
  );
});


bot.hears("⚙️ Налаштування", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const cfg = loadSettings();
  return ctx.reply(
    `⚙️ Поточні налаштування:\n\n` +
    `📷 Фото rate limit: ${cfg.photoRateLimitMs / 1000}сек\n` +
    `🎬 Відео rate limit: ${cfg.videoRateLimitMs / 1000}сек\n` +
    `🤖 AI промт rate limit: ${cfg.aiPromptRateLimitMs / 1000}сек\n\n` +
    `⏱ Таймаути:\nФото: ${cfg.photoTimeoutMs / 1000}с | Seedance: ${cfg.seedanceTimeoutMs / 1000}с | Kling: ${cfg.klingTimeoutMs / 1000}с\n\n` +
    `🎬 Seedance: ${cfg.seedanceDurationSec}сек, ${cfg.seedanceAspectRatio}\n` +
    `🎥 Kling: ${cfg.klingDurationSec}сек, ${cfg.klingAspectRatio}\n\n` +
    `👥 maxWorkers: ${cfg.maxWorkers}\n` +
    `📅 Денний ліміт Seedance: ${cfg.dailySeedanceLimit} (0=∞)\n` +
    `📅 Денний ліміт Kling: ${cfg.dailyKlingLimit} (0=∞)\n\n` +
    `🤖 AI промт: ${cfg.aiPromptEnabled ? "✅" : "❌"}\n` +
    `🎬 Відео: ${cfg.videoEnabled ? "✅" : "❌"}\n\n` +
    `Редагуй settings.json на сервері та перезапусти бота.`,
    adminMenu()
  );
});

bot.hears("📈 Аналітика", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const all = Object.values(users);
  const paid = payments.filter(p => p.status === "credited");
  const packCount = {};
  paid.forEach(p => { packCount[p.packKey] = (packCount[p.packKey] || 0) + 1; });
  const topPacks = Object.entries(packCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([key, cnt]) => `  ${key}: ${cnt} разів`).join("\n");
  const now = Date.now();
  const DAY = 86400000;
  const revenueByDay = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY).toISOString().slice(0, 10);
    revenueByDay[d] = 0;
  }
  paid.forEach(p => {
    const d = (p.updatedAt || p.createdAt || "").slice(0, 10);
    if (revenueByDay[d] !== undefined) revenueByDay[d] += Number(p.amount || 0);
  });
  const revenueChart = Object.entries(revenueByDay)
    .map(([d, amt]) => `  ${d.slice(5)}: ${amt} грн`).join("\n");
  const totalUsers    = all.length;
  const payingUsers   = all.filter(u => (u.totalSpent || 0) > 0).length;
  const activeUsers   = all.filter(u => (u.generations || 0) > 0 || (u.seedanceGenerations || 0) > 0 || (u.klingGenerations || 0) > 0).length;
  const conversion    = totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : 0;
  const actConversion = activeUsers > 0 ? ((payingUsers / activeUsers) * 100).toFixed(1) : 0;
  const totalRevenue  = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
  const avgCheck      = payingUsers > 0 ? Math.round(totalRevenue / payingUsers) : 0;
  const triedNoPayment = all.filter(u =>
    ((u.generations || 0) > 0 || (u.seedanceGenerations || 0) > 0 || (u.klingGenerations || 0) > 0) &&
    (u.totalSpent || 0) === 0
  ).length;
  const repeatBuyers = all.filter(u => paid.filter(p => p.userId == u.id).length > 1).length;
  return ctx.reply(
    `📊 Аналітика\n\n` +
    `👥 Юзери: ${totalUsers} всього\n` +
    `  🔥 Активних: ${activeUsers}\n` +
    `  💳 Платних: ${payingUsers}\n` +
    `  😶 Спробували і пішли: ${triedNoPayment}\n\n` +
    `💰 Конверсія:\n` +
    `  Всі→платні: ${conversion}%\n` +
    `  Активні→платні: ${actConversion}%\n\n` +
    `💵 Фінанси:\n` +
    `  Всього: ${totalRevenue} грн\n` +
    `  Середній чек: ${avgCheck} грн\n` +
    `  Повторні покупки: ${repeatBuyers} юзерів\n\n` +
    `📦 Топ пакети:\n${topPacks || "  немає даних"}\n\n` +
    `📅 Виручка (7 днів):\n${revenueChart}`,
    adminMenu()
  );
});

bot.hears("📦 Пакети", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const pkgs = getPackages();
  const text = Object.values(pkgs).map(p =>
    `${p.key}: ${p.amount} грн | ${p.promti || p.count || 0} ✨ | ${p.type}${p.model ? "/" + p.model : ""}`
  ).join("\n");
  return ctx.reply(
    `📦 Пакети:\n\n${text}\n\n` +
    `Змінити ціну:\n/setprice promti_pack10 120\n\n` +
    `Додати пакет:\n/addpackage KEY promti 15 1199 15 Promti\n\n` +
    `Додати посилання:\n/setlink support_link https://t.me/support`,
    adminMenu()
  );
});

// ─── НАВІГАЦІЯ ────────────────────────────────────────────────────────────────
bot.hears("↩️ Назад",          (ctx) => { touchUser(ctx); resetState(ctx); return ctx.reply("Головне меню ✨", mainMenu()); });
bot.hears("↩️ Назад до фото", (ctx) => {
  touchUser(ctx); resetState(ctx);
  ctx.session.mode = "photo";
  return ctx.reply(
    "🖼 Меню фото\n\n" +
    "🖼 Редагувати фото — надішли своє фото + промт, змінимо стиль!\n" +
    "✨ Створити фото — напиши промт, створю фото з нуля\n" +
    "🤖 AI промт — аналізую твоє фото і пропоную промт\n\n" +
    "💡 Ідеї: t.me/promteamai",
    photoMenu()
  );
});
bot.hears("↩️ Назад до відео", (ctx) => {
  touchUser(ctx); resetState(ctx);
  ctx.session.mode = "video";
  return ctx.reply(
    "🎬 Меню відео\n\n" +
    "🎬 Seedance — ByteDance модель, реалістична анімація\n" +
    "🎥 Kling — кінематографічна якість відео\n\n" +
    "💡 Ідеї: t.me/promteamai",
    videoMenu()
  );
});
bot.hears("ℹ️ Інформація",     (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.infoText,    content.infoPhoto,    mainMenu()); });
bot.hears("❓ Допомога",       (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.helpText,    content.helpPhoto,    mainMenu()); });
bot.hears("🆘 Підтримка",      (ctx) => { touchUser(ctx); return ctx.reply(content.supportText, mainMenu()); });
bot.hears("💰 Ціни",           (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.pricesText || "💰 Ціни тимчасово недоступні", content.pricesPhoto, mainMenu()); });

bot.hears("💬 Своя сума", async (ctx) => {
  touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu());
  ctx.session.awaitingCustomAmount = true;
  return ctx.reply(
    `💬 Введи бажану суму в гривнях\n\n1 Promti ✨ = 9.9 грн\nМінімум: 50 грн\n\nПриклад: 200`,
    Markup.keyboard([["↩️ Назад"]]).resize()
  );
});

bot.hears(["✨ Купити Promti ✨", "✨ Купити Promti", "💳 Купити Promti"], (ctx) => {
  touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu());
  return ctx.reply(
    `💎 Обери пакет Promti ✨\n\n` +
    `📦 Пакети:\n` +
    `10 Promti ✨ — 99 грн (9.9 грн/✨)\n` +
    `30 Promti ✨ — 249 грн (8.3 грн/✨)\n` +
    `60 Promti ✨ — 449 грн (7.5 грн/✨)\n` +
    `150 Promti ✨ — 999 грн (6.7 грн/✨) 🔥\n\n` +
    `💰 Ціни послуг:\n` +
    `🖼 Фото — 1 Promti ✨\n` +
    `🎬 Seedance — 5 Promti ✨\n` +
    `🎥 Kling — 8 Promti ✨\n\n` +
    `🎁 При реєстрації: 1 Promti ✨ безкоштовно`,
    Markup.inlineKeyboard([
      [Markup.button.callback("10 Promti ✨ — 99 грн",  "buy_pack_promti_pack10")],
      [Markup.button.callback("30 Promti ✨ — 249 грн", "buy_pack_promti_pack30")],
      [Markup.button.callback("60 Promti ✨ — 449 грн", "buy_pack_promti_pack60")],
      [Markup.button.callback("150 Promti ✨ — 999 грн 🔥", "buy_pack_promti_pack150")],
      [Markup.button.callback("💬 Своя сума", "buy_custom_amount")],
    ])
  );
});

bot.hears("👫 Запросити друга", async (ctx) => {
  touchUser(ctx);
  const userId  = ctx.from.id;
  const user    = getUser(userId);
  const botName = ctx.botInfo?.username || "promtibotai";
  const refLink = `https://t.me/${botName}?start=ref_${userId}`;
  const earned  = user.referralEarned || 0;
  const count   = user.referralCount  || 0;
  return ctx.reply(
    `👫 Реферальна програма\n\n` +
    `Запроси друга — отримай бонус!\n` +
    `🎁 За кожного друга який оплатить: +${REFERRAL_PROMTI_BONUS} Promti ✨\n\n` +
    `📊 Твоя статистика:\n` +
    `  Запрошено друзів: ${count}\n` +
    `  Зароблено: +${earned} Promti ✨\n\n` +
    `🔗 Твоє посилання:\n${refLink}\n\n` +
    `💡 Поділись з друзями — вони отримають 1 Promti ✨ безкоштовно при реєстрації!`,
    mainMenu()
  );
});
bot.hears("💡 Ідея для промтів",(ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.ideaText, content.ideaPhoto, mainMenu()); });

// ─── БАЛАНС ───────────────────────────────────────────────────────────────────
bot.hears("📊 Баланс", (ctx) => {
  const user = touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("📊 Адмін: безліміт ✅", adminMenu());
  const botUsername = ctx.botInfo?.username || "Promtiai_bot";
  const cfg = loadSettings();
  return ctx.reply(
    `📊 Твій баланс: ${user.promti || 0} Promti ✨\n\n` +
    `💰 Ціни послуг:\n` +
    `🖼 Фото — 1 Promti ✨\n` +
    `🎬 Seedance — 5 Promti ✨\n` +
    `🎥 Kling — 8 Promti ✨\n\n` +
    `📅 Seedance сьогодні: ${user.dailySeedanceCount || 0}/${cfg.dailySeedanceLimit}\n` +
    `📅 Kling сьогодні: ${user.dailyKlingCount || 0}/${cfg.dailyKlingLimit}\n\n` +
    `👫 Запрошено друзів: ${user.referralCount || 0}\n` +
    `🔗 https://t.me/${botUsername}?start=ref_${user.id}`,
    mainMenu()
  );
});

// ─── РОЗДІЛИ ──────────────────────────────────────────────────────────────────
bot.hears("🖼 Фото", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  return ctx.reply(
    "🖼 Меню фото\n\n" +
    "🖼 Редагувати фото — надішли своє фото + промт, змінимо стиль!\n" +
    "✨ Створити фото — напиши промт, створю фото з нуля\n" +
    "🤖 AI промт — аналізую твоє фото і пропоную промт\n\n" +
    "💡 Ідеї: t.me/promteamai",
    photoMenu()
  );
});
bot.hears("🎨 Трендові стилі", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  return sendPromptLibraryPage(ctx, 0, false);
});
bot.hears("🎬 Відео", (ctx) => {
  const cfg = loadSettings();
  if (!cfg.videoEnabled) return ctx.reply("🎬 Відео тимчасово недоступне. Спробуй пізніше.", mainMenu());
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video";
  return ctx.reply(
    "🎬 Меню відео\n\n" +
    "🎬 Seedance — ByteDance модель, реалістична анімація\n" +
    "🎥 Kling — кінематографічна якість відео\n\n" +
    "💡 Ідеї: t.me/promteamai",
    videoMenu()
  );
});

// ─── ФОТО РЕЖИМИ ──────────────────────────────────────────────────────────────
bot.hears("🖼 Редагувати фото", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  ctx.session.photoMode = "edit";
  ctx.session.customType = "custom_photo";
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  return ctx.reply(
    "✏️ Режим редагування фото\n\nНапиши промт як хочеш змінити фото, потім надішли своє фото.\n\nПриклад: \"beauty editorial, glossy skin\"\n\n💡 Ідеї: t.me/promteamai",
    photoMenu()
  );
});

bot.hears("✨ Створити фото", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  ctx.session.photoMode = "create";
  ctx.session.customType = "create_photo";
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  return ctx.reply(
    "✨ Режим створення фото\n\nНапиши що хочеш згенерувати — фото буде створено з нуля.\n\nПриклад: \"portrait of woman in Renaissance style, cinematic lighting\"\n\n💡 Ідеї: t.me/promteamai",
    photoMenu()
  );
});

// ─── ВІДЕО МОДЕЛІ ─────────────────────────────────────────────────────────────
bot.hears("🎬 Seedance", (ctx) => {
  const cfg = loadSettings();
  if (cfg.seedanceEnabled === false) {
    return ctx.reply(cfg.seedanceComingSoonText || "🎬 Seedance тимчасово недоступний. Скоро повернеться! Спробуй 🎥 Kling.", videoMenu());
  }
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video"; ctx.session.style = "seedance";
  ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  ctx.session.videoInputMode = null;
  return ctx.reply(
    "🎬 Seedance 2.0\n\n" +
    "Спеціалізується на анімації об'єктів, природи, мультиплікації та фантастичних сцен.\n\n" +
    "⚡ Авто анімація — надішли фото, оживлю автоматично\n" +
    "🎬 Анімація + промт — надішли фото зі своїм описом руху\n" +
    "🎥 Відео з тексту — створю відео з нуля по опису\n\n" +
    "✅ Підходить для:\n" +
    "• Ляльки, іграшки, фігурки\n" +
    "• Природа, пейзажі, тварини\n" +
    "• Арт, мультиплікація, фентезі\n" +
    "• Продукти, предмети, логотипи\n\n" +
    "⛔️ Не підтримує фото реальних людей\n" +
    "👉 Для анімації людей — використовуй 🎥 Kling\n\n" +
    "💡 Ідеї: t.me/promteamai",
    seedanceMenu()
  );
});

bot.hears("⚡ Авто анімація", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("Спочатку обери модель: 🎬 Seedance або 🎥 Kling", videoMenu());
  ctx.session.videoInputMode = "image";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = null;
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  const defaultPrompt = prompts[style] || "cinematic motion, smooth animation";
  const isSeeedance = style === "seedance";
  return ctx.reply(
    `⚡ Авто анімація\n\nНадішли фото — оживлю з дефолтним промтом:\n📝 "${defaultPrompt}"\n\n` +
    (isSeeedance ? "⛔️ Лише для об'єктів та природи (не людей)\n👉 Для людей — використовуй Kling\n\n" : "") +
    `✍️ Хочеш свій промт? Напиши його перед фото.`,
    menu
  );
});

bot.hears("🎬 Анімація + промт", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("Спочатку обери модель: 🎬 Seedance або 🎥 Kling", videoMenu());
  ctx.session.videoInputMode = "image";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  const isSeedanceStyle = style === "seedance";
  return ctx.reply(
    `🎬 Анімація + промт\n\nНапиши промт, потім надішли фото.\n\n` +
    (isSeedanceStyle
      ? `Приклад: "gentle swaying in wind, soft light"\n\n⛔️ Лише для об'єктів та природи — не людей\n👉 Для анімації людей — Kling\n\n`
      : `Приклад: "cinematic close-up, eyes slowly opening"\n\n`) +
    `💡 t.me/promteamai`,
    menu
  );
});

bot.hears("🎥 Відео з тексту", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("Спочатку обери модель: 🎬 Seedance або 🎥 Kling", videoMenu());
  ctx.session.videoInputMode = "text";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  return ctx.reply(
    `🎥 Відео з тексту\n\nНапиши детальний промт — створю відео з нуля!\n\nПриклад: "cinematic portrait of woman, wind in hair, golden hour"\n\n💡 t.me/promteamai`,
    menu
  );
});

bot.hears("🎥 Kling", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video"; ctx.session.style = "kling";
  ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  ctx.session.videoInputMode = null;
  return ctx.reply(
    "🎥 Kling\n\n" +
    "📸 Фото → Відео — надішли фото + промт, оживлю!\n" +
    "✍️ Текст → Відео — напиши промт, створю кінематографічне відео\n\n" +
    "Приклад: \"cinematic close-up, soft bokeh\"\n\n" +
    "💡 Ідеї: t.me/promteamai",
    klingMenu()
  );
});

// ─── AI ПРОМТ ─────────────────────────────────────────────────────────────────
bot.hears("🤖 AI промт для фото", (ctx) => {
  const cfg  = loadSettings();
  const user = touchUser(ctx);
  if (!cfg.aiPromptEnabled) return ctx.reply("🤖 AI промт тимчасово вимкнено.", photoMenu());
  if (!isAdmin(ctx.from.id) && (user.totalSpent || 0) <= 0) {
    return ctx.reply(
      "🔒 AI промт доступний після покупки будь-якого пакету 💳\n\nКупи пакет Promti — і отримаєш доступ до AI промтів!",
      photoMenu()
    );
  }
  ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo"; ctx.session.style = null;
  ctx.session.awaitingAiPrompt = "photo"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("🤖 Надішли фото — я запропоную промт для генерації.", photoMenu());
});

bot.hears("🤖 AI промт для відео", (ctx) => {
  const cfg  = loadSettings();
  const user = touchUser(ctx);
  if (!cfg.aiPromptEnabled) return ctx.reply("🤖 AI промт тимчасово вимкнено.", videoMenu());
  if (!isAdmin(ctx.from.id) && (user.totalSpent || 0) <= 0) {
    return ctx.reply(
      "🔒 AI промт доступний після покупки будь-якого пакету 💳\n\nКупи пакет Promti — і отримаєш доступ до AI промтів!",
      videoMenu()
    );
  }
  ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video";
  if (!ctx.session.style) ctx.session.style = "seedance";
  ctx.session.awaitingAiPrompt = "video"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  const label = ctx.session.style === "kling" ? "🎥 Kling" : "🎬 Seedance";
  return ctx.reply(`🤖 AI промт для відео (${label})\n\nНадішли:\n📸 Фото — опишу рух\n🎬 Відео до 10 сек — проаналізую рух\n\nПромт: макс. 10 слів.`, videoMenu());
});

// ─── ПОКУПКА ──────────────────────────────────────────────────────────────────
async function sendAutoPayment(ctx, packKey) {
  try {
    const user = touchUser(ctx);
    const pack = getPackages()[packKey];
    if (!pack) return ctx.reply("❌ Пакет не знайдено.");
    const { invoiceUrl, orderReference } = await createWayForPayInvoice(ctx.from.id, packKey);
    user.pendingOrderReference = orderReference;
    user.lastPaymentRequest    = { packKey, createdAt: new Date().toISOString() };
    saveUsers();
    return ctx.reply(`Пакет: ${pack.title}\nЦіна: ${pack.priceText}`, paymentInlineKeyboard(invoiceUrl, pack));
  } catch (e) {
    console.error("PAYMENT ERROR:", e.message);
    return ctx.reply("❌ Не вдалося створити рахунок. Спробуй пізніше.");
  }
}

// ✅ Inline callback обробники для покупки пакетів (надійніше ніж reply-кнопки)
bot.action(/^buy_pack_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const packKey = ctx.match[1];
    await sendAutoPayment(ctx, packKey);
  } catch (e) {
    console.error("BUY_PACK CALLBACK ERROR:", e.message);
    try { await ctx.reply("❌ Не вдалося створити рахунок. Спробуй ще раз."); } catch {}
  }
});

bot.action("buy_custom_amount", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    touchUser(ctx);
    if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu());
    ctx.session.awaitingCustomAmount = true;
    return ctx.reply(
      `💬 Введи бажану суму в гривнях\n\n1 Promti ✨ = 9.9 грн\nМінімум: 50 грн\n\nПриклад: 200`,
      Markup.keyboard([["↩️ Назад"]]).resize()
    );
  } catch (e) { console.error("BUY CUSTOM AMOUNT:", e.message); }
});

// ✅ Залишаю старі reply-hears як fallback (раптом юзер якось натисне)
bot.hears(/^10\s+Promti/i,  (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack10"); });
bot.hears(/^30\s+Promti/i,  (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack30"); });
bot.hears(/^60\s+Promti/i,  (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack60"); });
bot.hears(/^150\s+Promti/i, (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack150"); });

bot.action(/^checkpay_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery("Якщо оплата пройшла — буде зараховано автоматично ✅"); }
  catch (e) { console.error("CHECKPAY:", e.message); }
});

// ─── АПСЕЛ INLINE КНОПКИ ─────────────────────────────────────────────────────
bot.action(/^pay_custom_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const tempKey = ctx.match[1];
    if (!dynamicPackages[tempKey]) return ctx.reply("❌ Пакет не знайдено. Спробуй ще раз.");
    await sendAutoPayment(ctx, tempKey);
  } catch (e) { console.error("PAY CUSTOM:", e.message); }
});

bot.action("upsell_promti", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    touchUser(ctx);
    if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.");
    await ctx.reply(
      `💎 Обери пакет Promti ✨\n\n` +
      `📦 Пакети:\n` +
      `10 Promti ✨ — 99 грн\n` +
      `30 Promti ✨ — 249 грн\n` +
      `60 Promti ✨ — 449 грн\n` +
      `150 Promti ✨ — 999 грн 🔥\n\n` +
      `💰 Ціни послуг:\n` +
      `🖼 Фото — 1 Promti ✨\n` +
      `🎬 Seedance — 5 Promti ✨\n` +
      `🎥 Kling — 8 Promti ✨`,
      Markup.inlineKeyboard([
        [Markup.button.callback("10 Promti ✨ — 99 грн",  "buy_pack_promti_pack10")],
        [Markup.button.callback("30 Promti ✨ — 249 грн", "buy_pack_promti_pack30")],
        [Markup.button.callback("60 Promti ✨ — 449 грн", "buy_pack_promti_pack60")],
        [Markup.button.callback("150 Promti ✨ — 999 грн 🔥", "buy_pack_promti_pack150")],
        [Markup.button.callback("💬 Своя сума", "buy_custom_amount")],
      ])
    );
  } catch (e) { console.error("UPSELL PROMTI:", e.message); }
});

// ─── AI ПРОМТ INLINE КНОПКИ ───────────────────────────────────────────────────
bot.action(/^promptlib_page_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return sendPromptLibraryPage(ctx, Number(ctx.match[1] || 0), false);
  } catch (e) { console.error("PROMPTLIB PAGE:", e.message); }
});

bot.action(/^admin_promptlib_page_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    return sendPromptLibraryPage(ctx, Number(ctx.match[1] || 0), true);
  } catch (e) { console.error("ADMIN PROMPTLIB PAGE:", e.message); }
});

bot.action(/^promptlib_open_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return sendPromptStyleCard(ctx, normalizePromptKey(ctx.match[1]), false);
  } catch (e) { console.error("PROMPTLIB OPEN:", e.message); }
});

bot.action(/^admin_promptlib_open_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    return sendPromptStyleCard(ctx, normalizePromptKey(ctx.match[1]), true);
  } catch (e) { console.error("ADMIN PROMPTLIB OPEN:", e.message); }
});

bot.action(/^promptlib_apply_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Стиль завантажено ✅");
    touchUser(ctx);
    const style = applyPromptStyleToSession(ctx, normalizePromptKey(ctx.match[1]));
    if (!style) return ctx.reply("❌ Стиль не знайдено.");
    return sendPromptReadyMessage(ctx, style, { withPreview: false });
  } catch (e) { console.error("PROMPTLIB APPLY:", e.message); }
});

bot.action(/^admin_promptlib_trend_(.+)_(on|off)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const mode = ctx.match[2];
    const style = getPromptStyle(key);
    if (!style) return ctx.reply("❌ Стиль не знайдено.");
    style.isTrending = mode === "on";
    content.promptLibrary[key] = style;
    saveContent();
    return sendPromptStyleCard(ctx, key, true);
  } catch (e) { console.error("ADMIN PROMPTLIB TREND:", e.message); }
});

bot.action(/^admin_promptlib_preview_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Надішли preview-фото");
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const style = getPromptStyle(key);
    if (!style) return ctx.reply("❌ Стиль не знайдено.");
    ctx.session.awaitingPromptPreviewKey = key;
    return ctx.reply(`🖼 Надішли preview-фото для стилю "${key}" або напиши "видалити".`, adminMenu());
  } catch (e) { console.error("ADMIN PROMPTLIB PREVIEW:", e.message); }
});

bot.action(/^admin_promptlib_delete_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    if (!getPromptStyle(key)) return ctx.reply("❌ Стиль не знайдено.");
    delete content.promptLibrary[key];
    saveContent();
    return ctx.reply(`✅ Стиль "${key}" видалено.`, adminMenu());
  } catch (e) { console.error("ADMIN PROMPTLIB DELETE:", e.message); }
});

bot.action("promptlib_noop", async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
});

bot.action("admin_promptlib_noop", async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
});

bot.action(/^apply_ai_prompt_(photo|video)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("✅ Промт застосовано! Надішли фото.");
    const aiMode = ctx.match[1];
    await ctx.reply(
      `✅ Промт збережено:\n\n📝 <code>${ctx.session.customPrompt || "-"}</code>\n\nНадішли фото 📸`,
      { parse_mode: "HTML", ...(aiMode === "video" ? videoMenu() : photoMenu()) }
    );
  } catch (e) { console.error("APPLY AI PROMPT:", e.message); }
});

bot.action(/^regen_ai_prompt_(photo|video)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("🔄 Надішли фото ще раз");
    const aiMode = ctx.match[1];
    ctx.session.awaitingAiPrompt = aiMode; ctx.session.customPrompt = null;
    await ctx.reply("🔄 Надішли фото — згенерую новий варіант.", aiMode === "video" ? videoMenu() : photoMenu());
  } catch (e) { console.error("REGEN AI PROMPT:", e.message); }
});

// ─── ТЕКСТОВИЙ ХЕНДЛЕР ────────────────────────────────────────────────────────
const ALL_BUTTONS = [
  "🖼 Фото","🎬 Відео","🎨 Трендові стилі","📊 Баланс","💡 Ідея для промтів","ℹ️ Інформація","❓ Допомога","🆘 Підтримка","💰 Ціни",
  "👫 Запросити друга",
  "🖼 Редагувати фото","✨ Створити фото",
  "⚡ Авто анімація","🎬 Анімація + промт","🎥 Відео з тексту",
  "🤖 AI промт для фото","🤖 AI промт для відео",
  "✨ Купити Promti ✨","✨ Купити Promti","💳 Купити Promti","💬 Своя сума",
  "🎬 Seedance","🎥 Kling",
  "↩️ Назад","↩️ Назад до відео","↩️ Назад до фото",
  "📊 Статус бота","👤 Мій ID","👥 Користувачі","💳 Останні оплати","🎨 Бібліотека стилів","📈 Аналітика",
  "📦 Пакети","✏️ Змінити текст","📝 Поточні тексти","⚙️ Налаштування",
  "🖼 Прикріпити фото",
  "📷 welcomePhoto","📷 infoPhoto","📷 helpPhoto","📷 pricesPhoto","📷 ideaPhoto","📷 broadcastPhoto",
];

bot.on("text", async (ctx, next) => {
  try {
    ensureSession(ctx); touchUser(ctx);
    if (users[ctx.from.id]?.banned) return ctx.reply("🚫 Ваш акаунт заблокований. Напишіть в підтримку.");
    const text = ctx.message.text;
    // ✅ Перевіряємо також рядки що починаються з "N Promti" — це пакети, їх ловлять regex bot.hears
    const isPackButton = /^\d+\s+Promti/i.test(text);
    if (ALL_BUTTONS.includes(text) || text.startsWith("/") || isPackButton) return next();

    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptEditKey) {
      const key = ctx.session.awaitingPromptEditKey; prompts[key] = text; savePrompts();
      ctx.session.awaitingPromptEditKey = null;
      return ctx.reply(`✅ Промт "${key}" оновлено.`, adminMenu());
    }
    if (isAdmin(ctx.from.id) && ctx.session.awaitingTextEditKey) {
      const key = ctx.session.awaitingTextEditKey; content[key] = text; saveContent();
      ctx.session.awaitingTextEditKey = null;
      return ctx.reply(`✅ Текст "${key}" оновлено.`, adminMenu());
    }

    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptPreviewKey && text.toLowerCase().trim() === "видалити") {
      const key = ctx.session.awaitingPromptPreviewKey;
      const style = getPromptStyle(key);
      ctx.session.awaitingPromptPreviewKey = null;
      if (!style) return ctx.reply(`❌ Стиль "${key}" не знайдено.`, adminMenu());
      style.previewPhoto = null;
      content.promptLibrary[key] = style;
      saveContent();
      return ctx.reply(`✅ Preview-фото для "${key}" видалено.`, adminMenu());
    }

    // ✅ Адмін написав "видалити" щоб прибрати фото
    if (isAdmin(ctx.from.id) && ctx.session.awaitingPhotoForKey && text.toLowerCase().trim() === "видалити") {
      const key = ctx.session.awaitingPhotoForKey;
      ctx.session.awaitingPhotoForKey = null;
      delete content[key];
      saveContent();
      return ctx.reply(`✅ Фото "${key}" видалено.`, adminMenu());
    }

    if ((ctx.session.customType === "custom_photo" || ctx.session.customType === "create_photo") && ctx.session.awaitingCustomPrompt) {
      clearPromptAttribution(ctx);
      ctx.session.customPrompt = text;
      ctx.session.awaitingCustomPrompt = false;

      if (ctx.session.customType === "create_photo") {
        const user = getUser(ctx.from.id);
        if (userGenerating.has(ctx.from.id)) return ctx.reply("⏳ Зачекай, ще обробляється...");
        userGenerating.add(ctx.from.id);
        enqueueGeneration(ctx.from.id, () => _processGeneration(ctx, user, ctx.from.id, "photo", null), "photo", ctx)
          .catch(e => {
            userGenerating.delete(ctx.from.id);
            console.error("CREATE PHOTO ENQUEUE ERROR:", e.message);
            ctx.reply("❌ Сталася помилка. Спробуй ще раз.").catch(() => {});
          });
        return;
      }
      return ctx.reply("Промт збережено ✅\nНадішли своє фото 📸", photoMenu());
    }

    if (ctx.session.awaitingCustomAmount) {
      const amount = parseInt(text);
      if (isNaN(amount) || amount < 50) {
        return ctx.reply("❌ Мінімальна сума 50 грн. Введи число:", Markup.keyboard([["↩️ Назад"]]).resize());
      }
      const promtiCount = Math.floor(amount / 9.9);
      if (promtiCount < 5) {
        return ctx.reply("❌ Мінімум 50 грн (5 Promti ✨). Введи більшу суму:", Markup.keyboard([["↩️ Назад"]]).resize());
      }
      ctx.session.awaitingCustomAmount = false;
      const tempKey = `custom_${Date.now()}`;
      dynamicPackages[tempKey] = {
        key: tempKey,
        type: "promti",
        title: `${promtiCount} Promti ✨`,
        promti: promtiCount,
        amount: amount,
        priceText: `${amount} грн`,
        temporary: true,
      };
      saveDynamicPackages(); // ✅ зберігаємо на диск щоб callback міг знайти пакет навіть після рестарту
      await ctx.reply(
        `💎 Твій пакет:\n${promtiCount} Promti ✨ — ${amount} грн\n\nПерейти до оплати?`,
        Markup.inlineKeyboard([[Markup.button.callback("💳 Оплатити", `pay_custom_${tempKey}`)]])
      );
      return;
    }

    if (ctx.session.mode === "video" && ctx.session.videoInputMode === "image" && !ctx.session.awaitingCustomPrompt) {
      clearPromptAttribution(ctx);
      ctx.session.customPrompt = text;
      const style = ctx.session.style;
      const menu = style === "kling" ? klingMenu() : seedanceMenu();
      return ctx.reply(`✅ Промт збережено: "${text}"\nТепер надішли фото 📸`, menu);
    }

    if (ctx.session.mode === "video" && ctx.session.awaitingCustomPrompt) {
      clearPromptAttribution(ctx);
      ctx.session.customPrompt = text;
      ctx.session.awaitingCustomPrompt = false;
      const videoInputMode = ctx.session.videoInputMode || "image";
      const style = ctx.session.style;
      const menu = style === "kling" ? klingMenu() : seedanceMenu();

      if (videoInputMode === "text") {
        const user = getUser(ctx.from.id);
        if (userGenerating.has(ctx.from.id)) return ctx.reply("⏳ Зачекай, ще обробляється...");
        userGenerating.add(ctx.from.id);
        enqueueGeneration(ctx.from.id, () => _processGeneration(ctx, user, ctx.from.id, "video", null), "video", ctx)
          .catch(e => {
            userGenerating.delete(ctx.from.id);
            console.error("TEXT-TO-VIDEO ENQUEUE ERROR:", e.message);
            ctx.reply("❌ Сталася помилка. Спробуй ще раз.").catch(() => {});
          });
        return;
      }
      return ctx.reply("Промт збережено ✅\nНадішли своє фото 📸", menu);
    }
    return ctx.reply("Обери розділ через меню або /start", mainMenu());
  } catch (e) { console.error("TEXT HANDLER:", e.message); return ctx.reply("Помилка 😢", mainMenu()); }
});

// ─── ХЕНДЛЕР ФОТО ────────────────────────────────────────────────────────────
bot.on("photo", async (ctx) => {
  ensureSession(ctx);
  const user   = touchUser(ctx);
  const userId = ctx.from.id;

  if (user.banned) return ctx.reply("🚫 Ваш акаунт заблокований.");

  const photo         = ctx.message.photo[ctx.message.photo.length - 1];

  // ✅ Адмін прикріпляє фото до текстового ключа (welcomePhoto/infoPhoto тощо)
  if (isAdmin(userId) && ctx.session.awaitingPhotoForKey) {
    const key = ctx.session.awaitingPhotoForKey;
    ctx.session.awaitingPhotoForKey = null;
    content[key] = photo.file_id;
    saveContent();
    return ctx.reply(`✅ Фото прикріплено до "${key}".\n\nПеревір як виглядає — натисни відповідну кнопку в головному меню.`, adminMenu());
  }

  if (isAdmin(userId) && ctx.session.awaitingPromptPreviewKey) {
    const key = ctx.session.awaitingPromptPreviewKey;
    const style = getPromptStyle(key);
    ctx.session.awaitingPromptPreviewKey = null;
    if (!style) return ctx.reply(`❌ Стиль "${key}" не знайдено.`, adminMenu());
    style.previewPhoto = photo.file_id;
    content.promptLibrary[key] = style;
    saveContent();
    return ctx.reply(`✅ Preview-фото для стилю "${key}" збережено.`, adminMenu());
  }

  const validationErr = validatePhoto(photo);
  if (validationErr) return ctx.reply(validationErr);

  if (!isAdmin(userId) && checkPhotoSpam(userId)) {
    return ctx.reply("⚠️ Надто багато фото підряд. Зачекай кілька секунд.");
  }

  if (ctx.session.awaitingAiPrompt) {
    const aiMode = ctx.session.awaitingAiPrompt;
    if (!isAdmin(userId)) {
      const secs = checkRateLimit(userId, "ai");
      if (secs > 0) return ctx.reply(`⏳ Зачекай ${secs} сек. перед наступним AI-промтом.`);
      const aiDailyErr = checkDailyAiLimit(user);
      if (aiDailyErr) return ctx.reply(aiDailyErr, ctx.session.mode === "video" ? videoMenu() : photoMenu());
      incrementDailyAi(user); saveUsers();
    }
    touchRateLimit(userId, "ai");
    ctx.session.awaitingAiPrompt = null;
    await ctx.reply("🤖 Аналізую фото...");
    try {
      const image     = await getImage(ctx, photo.file_id);
      const suggested = await generateAiPrompt(image, aiMode);
      if (!suggested) return ctx.reply("❌ Не вдалося згенерувати промт. Спробуй ✍️ Свій промт.", aiMode === "video" ? videoMenu() : photoMenu());
      ctx.session.customPrompt     = suggested;
      ctx.session.customType       = aiMode === "video" ? `custom_video_${ctx.session.style || "seedance"}` : "custom_photo";
      ctx.session.awaitingCustomPrompt = false;
      const label = aiMode === "video" ? (ctx.session.style === "kling" ? "🎥 Kling" : "🎬 Seedance") : "🖼 Фото";
      return ctx.reply(
        `🤖 AI промт для ${label}:\n\n📝 <code>${suggested}</code>\n\nНадішли фото ще раз — промт буде застосовано.`,
        { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("✅ Застосувати", `apply_ai_prompt_${aiMode}`)], [Markup.button.callback("🔄 Новий варіант", `regen_ai_prompt_${aiMode}`)]]).reply_markup }
      );
    } catch (e) {
      console.error("AI PROMPT HANDLER:", e.message);
      return ctx.reply("❌ Помилка аналізу. Спробуй ще раз.", aiMode === "video" ? videoMenu() : photoMenu());
    }
  }

  if (userGenerating.has(userId)) return ctx.reply("⏳ Зачекай, твоє фото ще обробляється...");

  if (!isAdmin(userId)) {
    const mode = ctx.session.mode;
    const secs = checkRateLimit(userId, mode === "video" ? "video" : "photo");
    if (secs > 0) return ctx.reply(`⏳ Зачекай ще ${secs} сек.`);
  }

  const MAX_QUEUE = 50;
  const currentQueue = ctx.session.mode === "video" ? videoQueue : photoQueue;
  if (currentQueue.length >= MAX_QUEUE) return ctx.reply("⚠️ Сервіс зараз перевантажений. Спробуй через кілька хвилин.");

  userGenerating.add(userId);

  const genType = ctx.session.mode === "video" ? "video" : "photo";
  enqueueGeneration(userId, () => _processGeneration(ctx, user, userId, ctx.session.mode, photo), genType, ctx)
    .catch(e => {
      userGenerating.delete(userId);
      console.error("ENQUEUE ERROR:", e.message);
      ctx.reply("❌ Сталася помилка. Спробуй ще раз.").catch(() => {});
    });
});

// ─── ПРОЦЕСИНГ ГЕНЕРАЦІЇ ─────────────────────────────────────────────────────
async function _processGeneration(ctx, user, userId, mode, photo) {
  const cfg = loadSettings();
  let chargedFromBalance = false;
  const startMs          = Date.now();

  try {
    touchRateLimit(userId, mode === "video" ? "video" : "photo");

    // ══ ВІДЕО ══
    if (mode === "video") {
      const videoStyle = ctx.session.style;
      if (!videoStyle) { userGenerating.delete(userId); return ctx.reply("Обери модель: 🎬 Seedance або 🎥 Kling", videoMenu()); }
      if (ctx.session.awaitingCustomPrompt) { userGenerating.delete(userId); return ctx.reply("Спочатку напиши промт текстом.", videoMenu()); }

      if (!isAdmin(userId)) {
        const dailyErr = checkDailyVideoLimit(user, videoStyle);
        if (dailyErr) { userGenerating.delete(userId); return ctx.reply(dailyErr, videoMenu()); }
        const videoCost = videoStyle === "kling" ? PROMTI_PRICES.kling : PROMTI_PRICES.seedance;
        if ((user.promti || 0) < videoCost) {
          userGenerating.delete(userId);
          return ctx.reply(
            `❌ Недостатньо Promti ✨\n\nПотрібно: ${videoCost} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨\n\n💳 Купи пакет Promti`,
            videoStyle === "kling" ? klingMenu() : seedanceMenu()
          );
        }
        user.promti -= videoCost; chargedFromBalance = true; saveUsersSync();
      }

      const prompt       = ctx.session.customPrompt || prompts[videoStyle];
      const videoInputMode = ctx.session.videoInputMode || "image";
      const stopProgress = startVideoProgress(ctx);
      const modeLabel = videoInputMode === "text" ? "з тексту" : "з фото";
      await ctx.reply(`⏳ Генерую ${videoStyle === "seedance" ? "Seedance" : "Kling"} відео ${modeLabel}...\nЦе займе 1-8 хв ⌛`);

      const image = videoInputMode === "text" ? null : await getImage(ctx, photo.file_id);

      try {
        let videoUrl = null;
        if (videoStyle === "seedance") {
          if (videoInputMode === "text") {
            const result = await falWithRetry(
              "bytedance/seedance-2.0/fast/text-to-video",
              { prompt, generate_audio: false },
              cfg.seedanceTimeoutMs
            );
            videoUrl = result?.data?.video?.url;
          } else {
            const imageUrl = await uploadImageToFal(image);
            console.log("SEEDANCE INPUT:", { prompt: prompt?.slice(0, 50), image_url: imageUrl });
            if (!imageUrl || imageUrl.startsWith("data:")) {
              throw new Error("imageUrl invalid or fallback base64 — upload failed");
            }
            const result = await falWithRetry(
              "bytedance/seedance-2.0/fast/image-to-video",
              {
                prompt: prompt || "cinematic motion, smooth animation",
                image_url: imageUrl,
                generate_audio: false,
              },
              cfg.seedanceTimeoutMs
            );
            videoUrl = result?.data?.video?.url;
          }
        } else {
          if (videoInputMode === "text") {
            const result = await falWithRetry(
              "fal-ai/kling-video/v3/pro/text-to-video",
              {
                prompt,
                duration: String(cfg.klingDurationSec),
                aspect_ratio: cfg.klingAspectRatio || "9:16",
                generate_audio: false,
                negative_prompt: "blur, distort, and low quality",
                cfg_scale: 0.5,
              },
              cfg.klingTimeoutMs
            );
            videoUrl = result?.data?.video?.url;
          } else {
            if (!image) throw new Error("No image provided for Kling");
            const result = await falWithRetry(
              "fal-ai/kling-video/v3/pro/image-to-video",
              {
                prompt,
                start_image_url: image,
                duration: String(cfg.klingDurationSec),
                generate_audio: false,
                negative_prompt: "blur, distort, and low quality",
                cfg_scale: 0.5,
              },
              cfg.klingTimeoutMs
            );
            videoUrl = result?.data?.video?.url;
          }
        }

        stopProgress();
        if (!videoUrl) throw new Error("fal не повернув відео");

        if (!isAdmin(userId)) incrementDailyVideo(user, videoStyle);
        if (videoStyle === "seedance") user.seedanceGenerations = (user.seedanceGenerations || 0) + 1;
        else user.klingGenerations = (user.klingGenerations || 0) + 1;
        saveUsersSync();
        userGenerating.delete(userId);

        log("VIDEO_OK", userId, `model:${videoStyle} dur:${Date.now()-startMs}ms`);
        appendLog({ type: "video", model: videoStyle, userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });

        const caption = isAdmin(userId)
          ? `🎬 Відео готове ✨\nМодель: ${videoStyle}\nАдмін: безліміт ✅`
          : `🎬 Відео готове ✨\nЗалишилось: ${user.promti || 0} Promti ✨`;

        await tgSendWithRetry(() => ctx.replyWithVideo({ url: videoUrl }, { caption }));

        if (!isAdmin(userId) && (user.promti || 0) <= 5) {
          await ctx.reply(
            `💡 Залишилось ${user.promti || 0} Promti ✨. Поповни баланс!`,
            Markup.inlineKeyboard([[Markup.button.callback("💎 Купити Promti ✨", "upsell_promti")]])
          );
        }
        return;

      } catch (e) {
        stopProgress();
        userGenerating.delete(userId);
        const refundCost = videoStyle === "kling" ? PROMTI_PRICES.kling : PROMTI_PRICES.seedance;
        if (!isAdmin(userId) && chargedFromBalance) { user.promti = (user.promti || 0) + refundCost; saveUsersSync(); }
        appendLog({ type: "video", model: videoStyle, userId, prompt, success: false, error: e.message, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });
        throw e;
      }
    }

    // ══ ФОТО ══
    const customType = ctx.session.customType;
    const photoMode  = ctx.session.photoMode || "edit";
    let prompt = "";
    let promptKeyForStats = null;

    if (customType === "custom_photo" || customType === "create_photo") {
      if (!ctx.session.customPrompt) { userGenerating.delete(userId); return ctx.reply("Спочатку напиши промт текстом.", photoMenu()); }
      prompt = ctx.session.customPrompt;
      const selectedPromptKey = ctx.session.currentPromptKey || ctx.session.sourcePromptKey || user.sourcePromptKey;
      const selectedStyle = getPromptStyle(selectedPromptKey);
      if (selectedStyle && selectedStyle.prompt === prompt) {
        promptKeyForStats = selectedStyle.key;
      }
    } else {
      userGenerating.delete(userId);
      return ctx.reply("Обери режим: 🖼 Редагувати фото або ✨ Створити фото", photoMenu());
    }

    if (!isAdmin(userId)) {
      const photoCost = PROMTI_PRICES.photo;
      if ((user.promti || 0) < photoCost) {
        userGenerating.delete(userId);
        return ctx.reply(
          `❌ Недостатньо Promti ✨\n\nПотрібно: ${photoCost} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨\n\n💳 Купи пакет Promti`,
          photoMenu()
        );
      }
      user.promti -= photoCost;
      chargedFromBalance = true;
      saveUsersSync();
    }

    let url = null;

    if (photoMode === "create") {
      await ctx.reply("⏳ Створюю фото з нуля... (~45 сек)");
      const result = await falWithRetry(
        "fal-ai/nano-banana-2",
        {
          prompt,
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "png",
          resolution: "1K",
          limit_generations: true,
        },
        cfg.photoTimeoutMs
      );
      url = result?.data?.images?.[0]?.url;
    } else {
      await ctx.reply("⏳ Редагую фото... (~45 сек)");
      const image  = await getImage(ctx, photo.file_id);
      const result = await falWithRetry(
        "fal-ai/nano-banana-2/edit",
        {
          prompt,
          image_urls: [image],
          num_images: 1,
          aspect_ratio: "auto",
          output_format: "png",
          resolution: "1K",
          limit_generations: true,
        },
        cfg.photoTimeoutMs
      );
      url = result?.data?.images?.[0]?.url;
    }

    if (!url) throw new Error("fal не повернув зображення");

    user.generations = (user.generations || 0) + 1;
    if (promptKeyForStats) markPromptGeneration(user, promptKeyForStats);
    saveUsersSync();
    userGenerating.delete(userId);
    log("PHOTO_OK", userId, `dur:${Date.now()-startMs}ms`);
    appendLog({ type: "photo", model: customType || "custom", userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });

    const caption = isAdmin(userId) ? "Готово ✨\nАдмін: безліміт ✅" : `Готово ✨\nЗалишилось: ${user.promti || 0} Promti ✨`;
    await tgSendWithRetry(() => ctx.replyWithPhoto({ url }, { caption }));

    if (!isAdmin(userId) && user.generations % 3 === 0) {
      await ctx.reply(
        "💡 Хочеш оживити це фото? Спробуй відео-генерацію!",
        Markup.inlineKeyboard([[Markup.button.callback("🎬 Seedance", "upsell_promti"), Markup.button.callback("🎥 Kling", "upsell_promti")]])
      );
    }
    return;

  } catch (e) {
    userGenerating.delete(userId);
    console.error("GENERATION ERROR:", e.message);
    if (!isAdmin(userId)) {
      if (chargedFromBalance) {
        if (mode === "video") {
          const refCost = (ctx.session?.style === "kling") ? PROMTI_PRICES.kling : PROMTI_PRICES.seedance;
          user.promti = (user.promti || 0) + refCost;
        } else {
          user.promti = (user.promti || 0) + PROMTI_PRICES.photo;
        }
        saveUsersSync();
      }
    }
    notifyAdminsError(`${mode === "video" ? "VIDEO" : "PHOTO"} ERROR: user ${userId}\n${e.message}`).catch(() => {});
    if (e.message === "FAL_TIMEOUT") return ctx.reply("⏱ Занадто довго. Спробуй ще раз.");
    return ctx.reply("❌ Помилка генерації. Спробуй ще раз.");
  }
}

// ─── ХЕНДЛЕР ВІДЕО (для AI-промту) ───────────────────────────────────────────
bot.on(["video", "video_note"], async (ctx) => {
  ensureSession(ctx); touchUser(ctx);
  if (ctx.session.awaitingAiPrompt !== "video") {
    return ctx.reply("🎬 Для генерації промту — натисни 🤖 AI промт для відео\nДля генерації — надішли фото.", videoMenu());
  }
  const videoObj = ctx.message.video || ctx.message.video_note;
  if ((videoObj.duration || 0) > 10) return ctx.reply("❌ Відео до 10 сек. Або надішли фото.", videoMenu());
  ctx.session.awaitingAiPrompt = null;
  await ctx.reply("🎬 Аналізую відео...");
  try {
    const file     = await ctx.telegram.getFile(videoObj.file_id);
    const videoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const tmpVideo = `/tmp/vid_${ctx.from.id}_${Date.now()}.mp4`;
    const tmpFrame = `/tmp/frame_${ctx.from.id}_${Date.now()}.jpg`;
    const videoRes = await axios.get(videoUrl, { responseType: "arraybuffer", timeout: 60000 });
    fs.writeFileSync(tmpVideo, Buffer.from(videoRes.data));
    try {
      execSync(`ffmpeg -y -i "${tmpVideo}" -vframes 1 -q:v 2 "${tmpFrame}"`, { timeout: 15000, stdio: "pipe" });
    } catch (ffmpegErr) {
      try { fs.unlinkSync(tmpVideo); } catch {}
      console.error("FFMPEG ERROR:", ffmpegErr.message);
      return ctx.reply("❌ ffmpeg недоступний. Надішли фото замість відео 📸", videoMenu());
    }
    const frameBase64 = `data:image/jpeg;base64,${fs.readFileSync(tmpFrame).toString("base64")}`;
    try { fs.unlinkSync(tmpVideo); fs.unlinkSync(tmpFrame); } catch {}
    const suggested = await generateAiPrompt(frameBase64, "video");
    if (!suggested) return ctx.reply("❌ Не вдалося згенерувати промт. Спробуй надіслати фото.", videoMenu());
    ctx.session.customPrompt     = suggested;
    ctx.session.customType       = `custom_video_${ctx.session.style || "seedance"}`;
    ctx.session.awaitingCustomPrompt = false;
    const label = ctx.session.style === "kling" ? "🎥 Kling" : "🎬 Seedance";
    return ctx.reply(
      `🤖 AI промт для ${label}:\n\n📝 <code>${suggested}</code>\n\n✅ Промт збережено. Надішли фото для генерації відео 📸`,
      { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("✅ Застосувати", "apply_ai_prompt_video")], [Markup.button.callback("🔄 Новий варіант", "regen_ai_prompt_video")]]).reply_markup }
    );
  } catch (e) {
    console.error("VIDEO AI PROMPT ERROR:", e.message);
    return ctx.reply("❌ Помилка обробки відео. Спробуй надіслати фото.", videoMenu());
  }
});

// ─── EXPRESS / HTTP ───────────────────────────────────────────────────────────
const app = express();
app.set("trust proxy", 1);
app.use((req, res, next) => {
  if (req.path === "/payment") return next();
  express.json({ limit: "1mb" })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: true })(req, res, next);
  });
});

app.get("/",       (_, res) => res.send("Bot is running"));
app.get("/health", (_, res) => {
  const s   = getBotStats();
  const cfg = loadSettings();
  res.json({
    ok: true,
    queue: s.queueLength, workers: `${s.activeWorkers}/${s.maxWorkers}`,
    totalUsers: s.totalUsers, bannedUsers: s.bannedUsers,
    photo: s.totalPhotoGen, seedance: s.totalSeedanceGen, kling: s.totalKlingGen,
    revenue: s.totalRevenue,
    flags: { aiPrompt: cfg.aiPromptEnabled, video: cfg.videoEnabled },
    keys: { fal: s.hasFalKey, wfp: s.hasWfp, anthropic: s.hasAnthropicKey },
  });
});

// ─── WAYFORPAY CALLBACK ───────────────────────────────────────────────────────
app.post("/payment",
  express.text({ type: "*/*" }),
  express.json({ type: "application/json", limit: "1mb" }),
  express.urlencoded({ extended: true }),
  async (req, res) => {
  try {
    let data = {};
    const raw = req.body;
    console.log("RAW TYPE:", typeof raw);
    console.log("RAW PREVIEW:", typeof raw === "string" ? raw.slice(0, 100) : JSON.stringify(raw).slice(0, 100));

    if (typeof raw === "string") {
      try { data = JSON.parse(raw); }
      catch(e) {
        try {
          const decoded = decodeURIComponent(raw);
          if (decoded.includes("merchantAccount")) data = JSON.parse(decoded);
        } catch {}
      }
    } else if (raw && typeof raw === "object") {
      data = normalizeWayForPayCallbackBody(raw);
    }

    console.log("=== WFP CALLBACK ===", JSON.stringify(data));
    console.log("merchantSignature:", data.merchantSignature);

    const expectedSig = signWfpCallback(data);
    console.log("EXPECTED SIG:", expectedSig);
    console.log("RECEIVED SIG:", data.merchantSignature);
    console.log("MATCH:", expectedSig === data.merchantSignature);

    if (expectedSig !== data.merchantSignature) {
      log("WFP_SIG_INVALID", null, `ref:${data.orderReference}`);
      console.error("WFP SIGNATURE INVALID");
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const parsed = parseOrderReference(data.orderReference);
    if (!parsed) {
      console.error("WFP PARSE FAILED:", data.orderReference);
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const { userId, packKey } = parsed;

    const pack = getPackages()[packKey];
    if (!pack) {
      console.error("WFP UNKNOWN PACK:", packKey);
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const user     = getUser(userId);
    const txStatus = (data.transactionStatus || "").toLowerCase();

    updatePaymentStatus(data.orderReference, data, txStatus || "callback_received");

    if (txStatus === "approved" && !isCredited(data.orderReference)) {
      markAsCredited(data.orderReference);

      const p = payments.find(x => x.orderReference === data.orderReference);
      if (p) { p.status = "credited"; p.updatedAt = new Date().toISOString(); p.amount = Number(data.amount || 0); p.callback = data; }

      const promtiAmount = pack.promti || pack.count || 0;
      user.promti          = (user.promti          || 0) + promtiAmount;
      user.purchasedPromti = (user.purchasedPromti || 0) + promtiAmount;
      user.totalSpent            = (user.totalSpent || 0) + Number(data.amount || 0);
      user.pendingOrderReference = null;
      user.lastPaidAt            = new Date().toISOString();
      markPromptPurchase(user, data.orderReference);
      saveUsersSync(); savePayments();

      log("CREDITED", userId, `pack:${packKey} +${promtiAmount} amount:${data.amount}грн`);
      console.log(`✅ CREDITED: user ${userId}, pack ${packKey}, +${promtiAmount}`);

      if (user.referredBy && !user.refPaid) {
        const referrer = getUser(user.referredBy);
        if (referrer) {
          user.refPaid       = true;
          referrer.promti = (referrer.promti || 0) + REFERRAL_PROMTI_BONUS;
          referrer.referralEarned = (referrer.referralEarned || 0) + REFERRAL_PROMTI_BONUS;
          saveUsersSync();
          try {
            await bot.telegram.sendMessage(
              user.referredBy,
              `🎉 Твій друг зробив першу оплату!\n+${REFERRAL_PROMTI_BONUS} Promti ✨ нараховано\nБаланс: ${referrer.promti} Promti ✨`
            );
          } catch (e) { console.error("REFERRAL BONUS NOTIFY:", e.message); }
          log("REFERRAL_BONUS", user.referredBy, `from user:${userId} +${REFERRAL_PROMTI_BONUS} ✨`);
        }
      }

      try {
        await bot.telegram.sendMessage(
          userId,
          `✅ Оплату підтверджено!\n\n✨ ${pack.title}\nНараховано: +${promtiAmount} Promti ✨\nБаланс: ${user.promti} Promti ✨`,
          mainMenu()
        );
      } catch (e) { console.error("SEND USER MSG:", e.message); }

      for (const adminId of ADMINS) {
        try {
          await bot.telegram.sendMessage(
            adminId,
            `✅ Оплата!\nUser: ${userId} @${user.username || "-"}\n${pack.title} | ${data.amount} грн\n${data.orderReference}`
          );
        } catch (e) { console.error("SEND ADMIN MSG:", e.message); }
      }

    } else if (txStatus === "approved") {
      console.log("ALREADY CREDITED:", data.orderReference);
    }

    return res.status(200).json(buildWfpAcceptResponse(data.orderReference));
  } catch (error) {
    console.error("WFP PAYMENT ERROR:", error);
    return res.status(200).json(buildWfpAcceptResponse("unknown"));
  }
});

// ─── ЗАПУСК ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  const cfg = loadSettings();
  console.log(`🌐 HTTP on port ${PORT}`);
  console.log(`📡 WFP Callback: ${WAYFORPAY.serviceUrl || "НЕ ЗАДАНО!"}`);
  console.log(`⚙️  maxWorkers: ${cfg.maxWorkers} | photoRL: ${cfg.photoRateLimitMs}ms | videoRL: ${cfg.videoRateLimitMs}ms`);
  console.log(`📅 Seedance limit/day: ${cfg.dailySeedanceLimit} | Kling: ${cfg.dailyKlingLimit}`);
  console.log(`🤖 AI промт: ${cfg.aiPromptEnabled ? "✅" : "❌"} | Anthropic key: ${process.env.ANTHROPIC_API_KEY ? "✅" : "❌"}`);
});

// ─── BACKUP КОЖНІ 6 ГОДИН ────────────────────────────────────────────────────
const BACKUP_DIR   = path.join(DATA_DIR, "backups");
const BACKUP_FILES = [USERS_PATH, PAYMENTS_PATH, PAYMENT_LOCK_PATH, PACKAGES_PATH];

function runBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const filePath of BACKUP_FILES) {
      if (!fs.existsSync(filePath)) continue;
      const name = path.basename(filePath, ".json");
      const dest = path.join(BACKUP_DIR, `${name}_${ts}.json`);
      fs.copyFileSync(filePath, dest);
    }
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      const full = path.join(BACKUP_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
    console.log(`💾 Backup done: ${ts}`);
  } catch (e) { console.error("BACKUP ERROR:", e.message); }
}

setInterval(runBackup, 6 * 60 * 60 * 1000);

bot.launch({
  dropPendingUpdates: true,
  allowedUpdates: ["message", "callback_query"],
})
  .then(() => {
    console.log("🔥 Бот запущений (v5 fixed)");
    runBackup();
  })
  .catch(err => {
    console.error("BOT LAUNCH ERROR:", err.message);
    if (err.message && err.message.includes("timed out")) {
      console.log("🔄 Retrying bot launch in 5s...");
      setTimeout(() => {
        bot.launch({ dropPendingUpdates: true })
          .then(() => console.log("🔥 Бот запущений після retry"))
          .catch(e => console.error("BOT RETRY ERROR:", e.message));
      }, 5000);
    }
  });

// ─── GRACEFUL SHUTDOWN ───────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`⏳ ${signal} — чекаємо завершення генерацій...`);

  for (const adminId of ADMINS) {
    bot.telegram.sendMessage(adminId, `⚠️ Бот перезапускається (${signal})\nАктивних генерацій: ${activeWorkers}`).catch(() => {});
  }

  const maxWait = 5 * 60 * 1000;
  const start   = Date.now();

  while (activeWorkers > 0 && Date.now() - start < maxWait) {
    console.log(`⏳ Активних генерацій: ${activeWorkers}, чекаємо...`);
    await new Promise(r => setTimeout(r, 3000));
  }

  if (activeWorkers > 0) {
    console.log(`⚠️ Таймаут очікування — зупиняємось з ${activeWorkers} активними генераціями`);
    for (const userId of userGenerating) {
      const user = users[userId];
      if (user) {
        bot.telegram.sendMessage(
          userId,
          "⚠️ Генерацію перервано через оновлення бота.\nБаланс збережено — спробуй ще раз!"
        ).catch(() => {});
      }
    }
    saveUsersSync();
  }

  console.log("✅ Завершено — зупиняємось.");
  bot.stop(signal);
  process.exit(0);
}

process.once("SIGINT",  () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGUSR2", () => gracefulShutdown("SIGUSR2"));
