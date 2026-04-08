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

// ─── ПЕРСИСТЕНТНА СЕСІЯ ───────────────────────────────────────────────────────
const localSession = new LocalSession({
  database: path.join(__dirname, "sessions.json"),
  property: "session",
  storage: LocalSession.storageFileAsync,
  format: { serialize: JSON.stringify, deserialize: JSON.parse },
  getSessionKey: (ctx) => ctx.from && `${ctx.from.id}:${ctx.from.id}`,
});
bot.use(localSession.middleware());

fal.config({ credentials: process.env.FAL_KEY });

// ─── КОНСТАНТИ ────────────────────────────────────────────────────────────────
const ADMINS = [346101852, 688515215];

const WAYFORPAY = {
  merchantAccount: process.env.WAYFORPAY_MERCHANT    || "",
  secretKey:       process.env.WAYFORPAY_SECRET      || "",
  domainName:      process.env.WAYFORPAY_DOMAIN      || "",
  returnUrl:       process.env.WAYFORPAY_RETURN_URL  || "https://t.me/Promtiai_bot",
  serviceUrl:      process.env.WAYFORPAY_SERVICE_URL || "",
};

const REFERRAL_PHOTO_BONUS = 1;

// ─── ШЛЯХИ ДО ФАЙЛІВ ─────────────────────────────────────────────────────────
const USERS_PATH        = path.join(__dirname, "users.json");
const PROMPTS_PATH      = path.join(__dirname, "prompts.json");
const CONTENT_PATH      = path.join(__dirname, "content.json");
const PAYMENTS_PATH     = path.join(__dirname, "payments.json");
const PAYMENT_LOCK_PATH = path.join(__dirname, "payment.lock.json");
const SETTINGS_PATH     = path.join(__dirname, "settings.json");
const PACKAGES_PATH     = path.join(__dirname, "packages.json");
const GEN_LOG_PATH      = path.join(__dirname, "generation_logs.jsonl");

// ─── НАЛАШТУВАННЯ ─────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  photoRateLimitMs:    15000,
  videoRateLimitMs:    60000,
  aiPromptRateLimitMs: 30000,
  photoTimeoutMs:      120000,
  seedanceTimeoutMs:   180000,
  klingTimeoutMs:      300000,
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

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...loadJson(SETTINGS_PATH, DEFAULT_SETTINGS) };
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
};

let users    = loadJson(USERS_PATH,    {});
let prompts  = loadJson(PROMPTS_PATH,  DEFAULT_PROMPTS);
let content  = loadJson(CONTENT_PATH,  DEFAULT_CONTENT);
let payments = loadJson(PAYMENTS_PATH, []);

prompts = { ...DEFAULT_PROMPTS, ...prompts };
content = { ...DEFAULT_CONTENT, ...content };
saveJson(PROMPTS_PATH, prompts);
saveJson(CONTENT_PATH, content);

// ─── ПАКЕТИ (базові + динамічні з файлу) ─────────────────────────────────────
const DEFAULT_PACKAGES = {
  photo_pack10:    { key: "photo_pack10",    type: "photo", model: null,       title: "10 фото",           count: 10,  amount: 99,  priceText: "99 грн"  },
  photo_pack20:    { key: "photo_pack20",    type: "photo", model: null,       title: "20 фото",           count: 20,  amount: 179, priceText: "179 грн" },
  photo_pack30:    { key: "photo_pack30",    type: "photo", model: null,       title: "30 фото",           count: 30,  amount: 249, priceText: "249 грн" },
  photo_pack50:    { key: "photo_pack50",    type: "photo", model: null,       title: "50 фото",           count: 50,  amount: 399, priceText: "399 грн" },
  seedance_pack3:  { key: "seedance_pack3",  type: "video", model: "seedance", title: "3 Seedance відео",  count: 3,   amount: 199, priceText: "199 грн" },
  seedance_pack5:  { key: "seedance_pack5",  type: "video", model: "seedance", title: "5 Seedance відео",  count: 5,   amount: 349, priceText: "349 грн" },
  seedance_pack10: { key: "seedance_pack10", type: "video", model: "seedance", title: "10 Seedance відео", count: 10,  amount: 599, priceText: "599 грн" },
  kling_pack3:     { key: "kling_pack3",     type: "video", model: "kling",    title: "3 Kling відео",     count: 3,   amount: 299, priceText: "299 грн" },
  kling_pack5:     { key: "kling_pack5",     type: "video", model: "kling",    title: "5 Kling відео",     count: 5,   amount: 499, priceText: "499 грн" },
  kling_pack10:    { key: "kling_pack10",    type: "video", model: "kling",    title: "10 Kling відео",    count: 10,  amount: 899, priceText: "899 грн" },
};

// Завантажуємо динамічні пакети (адмін може змінювати через бот)
function loadPackages() {
  const saved = loadJson(PACKAGES_PATH, null);
  if (saved && Object.keys(saved).length > 0) return saved;
  saveJson(PACKAGES_PATH, DEFAULT_PACKAGES);
  return JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
}

let dynamicPackages = loadPackages();
function getPackages()         { return dynamicPackages; }
function saveDynamicPackages() { saveJson(PACKAGES_PATH, dynamicPackages); }

// ─── АТОМАРНИЙ LOCK ОПЛАТ ─────────────────────────────────────────────────────
let creditedSet = new Set(loadJson(PAYMENT_LOCK_PATH, []));
function markAsCredited(ref) { creditedSet.add(ref); saveJson(PAYMENT_LOCK_PATH, [...creditedSet]); }
function isCredited(ref)     { return creditedSet.has(ref); }

// ─── ЧЕРГА ГЕНЕРАЦІЙ ──────────────────────────────────────────────────────────
const generationQueue = [];
let activeWorkers = 0;

function enqueueGeneration(userId, taskFn) {
  return new Promise((resolve, reject) => {
    generationQueue.push({ userId, taskFn, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  const cfg = loadSettings();
  while (activeWorkers < cfg.maxWorkers && generationQueue.length > 0) {
    const job = generationQueue.shift();
    activeWorkers++;
    job.taskFn()
      .then(job.resolve).catch(job.reject)
      .finally(() => { activeWorkers--; processQueue(); });
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

// ─── ПОМИЛКИ → АДМІНИ ─────────────────────────────────────────────────────────
async function notifyAdminsError(message) {
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
  ctx.session.customType            = null;
  ctx.session.awaitingCustomPrompt  = false;
  ctx.session.customPrompt          = null;
  ctx.session.awaitingAiPrompt      = null;
  ctx.session.awaitingPromptEditKey = null;
  ctx.session.awaitingTextEditKey   = null;
}

function getUser(id) {
  if (!users[id]) {
    users[id] = {
      id, freeUsed: false,
      balance: 0, videoBalance: 0,
      generations: 0, seedanceGenerations: 0, klingGenerations: 0,
      purchasedPhotos: 0, purchasedVideos: 0,
      totalSpent: 0, username: "", firstName: "",
      referredBy: null, referralCount: 0, banned: false,
      dailyVideoDate: null, dailySeedanceCount: 0, dailyKlingCount: 0,
      dailyAiDate: null, dailyAiCount: 0,
      lastPaymentRequest: null, pendingOrderReference: null, lastPaidAt: null,
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
  const user     = getUser(ctx.from.id);
  user.username  = ctx.from.username   || "";
  user.firstName = ctx.from.first_name || "";
  saveJson(USERS_PATH, users);
  return user;
}

function saveUsers()    { saveJson(USERS_PATH,    users);    }
function savePrompts()  { saveJson(PROMPTS_PATH,  prompts);  }
function saveContent()  { saveJson(CONTENT_PATH,  content);  }
function savePayments() { saveJson(PAYMENTS_PATH, payments); }

function getUserVideoTotal(user) { return (user.seedanceGenerations || 0) + (user.klingGenerations || 0); }

// ─── РЕФЕРАЛЬНА СИСТЕМА ───────────────────────────────────────────────────────
async function handleReferral(ctx, referrerId) {
  const newUserId = ctx.from.id;
  if (referrerId === newUserId) return;
  const referrer = getUser(referrerId);
  const newUser  = getUser(newUserId);
  if (newUser.referredBy) return;
  if (!referrer.totalSpent && (referrer.referralCount || 0) >= 20) { console.warn(`REFERRAL ABUSE: user ${referrerId}`); return; }
  const grantBonus = !!referrer.username;
  newUser.referredBy     = referrerId;
  referrer.referralCount = (referrer.referralCount || 0) + 1;
  if (grantBonus) {
    referrer.balance += REFERRAL_PHOTO_BONUS;
    saveUsers();
    try { await bot.telegram.sendMessage(referrerId, `🎉 Новий друг зареєструвався!\n+${REFERRAL_PHOTO_BONUS} фото 🖼\nБаланс фото: ${referrer.balance}`); }
    catch (e) { console.error("REFERRAL NOTIFY:", e.message); }
  } else {
    saveUsers();
    console.log(`REFERRAL: user ${newUserId} referred by ${referrerId} — bonus skipped`);
  }
}

// ─── ВАЛІДАЦІЯ ФОТО ───────────────────────────────────────────────────────────
function validatePhoto(photo) {
  const size = photo.file_size || 0;
  if (size > 0 && size < 50 * 1024) return `❌ Фото занадто маленьке (${Math.round(size/1024)}KB). Мінімум 50KB.`;
  if (size > 20 * 1024 * 1024)      return `❌ Фото занадто велике. Максимум 20MB.`;
  return null;
}

// ─── ОТРИМАННЯ ЗОБРАЖЕННЯ ─────────────────────────────────────────────────────
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

// ─── AI ПРОМТ (Claude Vision) — використовуємо claude-haiku для економії ──────
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
      model:      "claude-haiku-4-5-20251001", // ✅ дешевша модель замість opus
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
  const m = /^tg_(\d+)_([\w]+_pack[\w]+)_\d+$/.exec(ref || "");
  if (!m) return null;
  return { userId: Number(m[1]), packKey: m[2] };
}

function signWfpPurchase({ merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency, productName, productCount, productPrice }) {
  const vals = [merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency, ...productName, ...productCount, ...productPrice];
  return crypto.createHmac("md5", WAYFORPAY.secretKey).update(vals.join(";"), "utf8").digest("hex");
}

// ✅ ВИПРАВЛЕНИЙ підпис — правильний порядок полів згідно документації WayForPay
function signWfpCallback(data) {
  const vals = [
    data.merchantAccount   || "",
    data.orderReference    || "",
    data.amount            || "",
    data.currency          || "",
    data.authCode          || "",
    data.cardPan           || "",
    data.cardType          || "",
    data.issuerBankCountry || "",
    data.issuerBankName    || "",
    data.recToken          || "",
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

  // якщо рядок — парсимо напряму
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }

  // вже нормальний обʼєкт з підписом
  if (body.merchantSignature) return body;

  // ✅ Головний кейс: JSON сидить як КЛЮЧ обʼєкта
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

  const res  = await axios.post("https://api.wayforpay.com/api", payload, { headers: { "Content-Type": "application/json" }, timeout: 30000 });
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
const mainMenu  = () => Markup.keyboard([["🖼 Фото", "🎬 Відео"], ["📊 Баланс", "💡 Ідея для промтів"], ["ℹ️ Інформація", "❓ Допомога"], ["🆘 Підтримка"]]).resize();
const photoMenu = () => Markup.keyboard([["👩 Портрет", "💄 Б'юті"], ["📸 Fashion", "🎨 Арт"], ["🔥 Тренд", "✍️ Свій промт"], ["🤖 AI промт для фото"], ["💳 Купити фото", "📊 Баланс фото"], ["↩️ Назад"]]).resize();
const videoMenu = () => Markup.keyboard([["🎬 Seedance", "🎥 Kling"], ["✍️ Свій промт відео"], ["🤖 AI промт для відео"], ["💳 Купити Seedance", "💳 Купити Kling"], ["📊 Баланс відео"], ["↩️ Назад"]]).resize();
const buyPhotoMenu    = () => Markup.keyboard([["📦 10 фото — 99 грн", "📦 20 фото — 179 грн"], ["📦 30 фото — 249 грн", "📦 50 фото — 399 грн"], ["↩️ Назад до фото"]]).resize();
const buySeedanceMenu = () => Markup.keyboard([["🎬 3 Seedance — 199 грн"], ["🎬 5 Seedance — 349 грн"], ["🎬 10 Seedance — 599 грн"], ["↩️ Назад до відео"]]).resize();
const buyKlingMenu    = () => Markup.keyboard([["🎥 3 Kling — 299 грн"],    ["🎥 5 Kling — 499 грн"],  ["🎥 10 Kling — 899 грн"],  ["↩️ Назад до відео"]]).resize();
const adminMenu       = () => Markup.keyboard([
  ["📊 Статус бота", "👤 Мій ID"],
  ["👥 Користувачі", "💳 Останні оплати"],
  ["✏️ Змінити промт", "📝 Поточні промти"],
  ["✏️ Змінити текст", "📝 Поточні тексти"],
  ["⚙️ Налаштування", "📦 Пакети"],
  ["📊 Баланс", "↩️ Назад"],
]).resize();
const adminPromptsMenu = () => Markup.keyboard([["portrait", "beauty"], ["fashion", "art"], ["trend", "seedance"], ["kling"], ["↩️ Назад"]]).resize();
const adminTextsMenu   = () => Markup.keyboard([["welcomeText", "infoText"], ["helpText", "supportText"], ["ideaText"], ["↩️ Назад"]]).resize();

const paymentInlineKeyboard = (payUrl, pack) => Markup.inlineKeyboard([
  [Markup.button.url(`💳 Оплатити ${pack.title} — ${pack.priceText}`, payUrl)],
  [Markup.button.callback("🔄 Перевірити оплату", `checkpay_${pack.key}`)],
]);

// ─── START ────────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  ensureSession(ctx);
  const isNew = !users[ctx.from.id];
  touchUser(ctx);
  resetState(ctx);
  const payload = ctx.startPayload || "";
  if (isNew && payload.startsWith("ref_")) {
    const refId = Number(payload.replace("ref_", ""));
    if (refId && refId !== ctx.from.id) await handleReferral(ctx, refId);
  }
  return ctx.reply(content.welcomeText, mainMenu());
});

// ─── КОМАНДИ ──────────────────────────────────────────────────────────────────
bot.command("help",  (ctx) => { touchUser(ctx); return ctx.reply(content.helpText,  mainMenu()); });
bot.command("info",  (ctx) => { touchUser(ctx); return ctx.reply(content.infoText,  mainMenu()); });
bot.command("myid",  (ctx) => { touchUser(ctx); return ctx.reply(`Твій ID: ${ctx.from.id}`); });
bot.command("admin", (ctx) => { touchUser(ctx); if (!isAdmin(ctx.from.id)) return ctx.reply("❌"); resetState(ctx); return ctx.reply("Адмін:", adminMenu()); });

bot.command("ref", (ctx) => {
  touchUser(ctx);
  const botUsername = ctx.botInfo?.username || "Promtiai_bot";
  const link = `https://t.me/${botUsername}?start=ref_${ctx.from.id}`;
  return ctx.reply(`🔗 Реферальне посилання:\n${link}\n\n🎁 За кожного друга +${REFERRAL_PHOTO_BONUS} фото\nЗапрошено: ${users[ctx.from.id]?.referralCount || 0}`);
});

bot.command("addphoto", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const [, id, amt] = ctx.message.text.split(/\s+/);
  if (!id || !amt) return ctx.reply("Формат: /addphoto ID КІЛЬКІСТЬ");
  const user = getUser(Number(id));
  user.balance += Number(amt);
  saveUsers();
  await ctx.reply(`✅ +${amt} фото → user ${id}. Баланс: ${user.balance}`);
  bot.telegram.sendMessage(Number(id), `🎉 +${amt} фото на баланс!\nБаланс фото: ${user.balance}`, mainMenu()).catch(() => {});
});

bot.command("addvideo", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const [, id, amt] = ctx.message.text.split(/\s+/);
  if (!id || !amt) return ctx.reply("Формат: /addvideo ID КІЛЬКІСТЬ");
  const user = getUser(Number(id));
  user.videoBalance = (user.videoBalance || 0) + Number(amt);
  saveUsers();
  await ctx.reply(`✅ +${amt} відео → user ${id}. Баланс: ${user.videoBalance}`);
  bot.telegram.sendMessage(Number(id), `🎉 +${amt} відео на баланс!\nБаланс відео: ${user.videoBalance}`, mainMenu()).catch(() => {});
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
    `🖼 Баланс фото: ${u.balance}\n🎬 Баланс відео: ${u.videoBalance || 0}\n\n` +
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
  const user = getUser(id); user.banned = true; saveUsers();
  await ctx.reply(`🚫 User ${id} заблокований`);
  bot.telegram.sendMessage(id, "🚫 Ваш акаунт заблокований. Напишіть в підтримку.").catch(() => {});
});

bot.command("unban", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Формат: /unban ID");
  const user = getUser(id); user.banned = false; saveUsers();
  await ctx.reply(`✅ User ${id} розблокований`);
  bot.telegram.sendMessage(id, "✅ Ваш акаунт розблоковано. Можете продовжувати.", mainMenu()).catch(() => {});
});

bot.command("broadcast", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const text = ctx.message.text.replace("/broadcast", "").trim();
  if (!text) return ctx.reply("Формат: /broadcast Текст");
  const all = Object.values(users).filter(u => !u.banned);
  let sent = 0, failed = 0;
  await ctx.reply(`⏳ Надсилаю ${all.length} користувачам...`);
  for (const u of all) {
    try { await bot.telegram.sendMessage(u.id, text, mainMenu()); sent++; await new Promise(r => setTimeout(r, 100)); } // ✅ 100мс замість 50
    catch { failed++; }
  }
  return ctx.reply(`✅ Broadcast: ${sent} надіслано, ${failed} помилок`);
});

// ─── АДМІН: КЕРУВАННЯ ПАКЕТАМИ ────────────────────────────────────────────────

// /packages — показати всі пакети
bot.command("packages", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const pkgs = getPackages();
  const text = Object.values(pkgs).map(p =>
    `${p.key}\n  💰 ${p.amount} грн | ${p.count} шт | ${p.type}${p.model ? " / " + p.model : ""}`
  ).join("\n\n");
  return ctx.reply(
    `📦 Всі пакети:\n\n${text}\n\n` +
    `Змінити ціну:\n/setprice photo_pack10 120\n\n` +
    `Додати пакет:\n/addpackage kling_pack15 video 15 1199 15 Kling відео\n\n` +
    `Посилання:\n/setlink support_link https://t.me/support`
  );
});

// /setprice packKey ціна
bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 3) return ctx.reply("Формат: /setprice КЛЮЧ_ПАКЕТУ ЦІНА\n\nПриклад: /setprice photo_pack10 120");
  const packKey = parts[1];
  const amount  = Number(parts[2]);
  if (!getPackages()[packKey]) return ctx.reply(`❌ Пакет "${packKey}" не знайдено.\n\nДоступні ключі:\n${Object.keys(getPackages()).join("\n")}`);
  if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Ціна має бути числом більше 0");
  dynamicPackages[packKey].amount    = amount;
  dynamicPackages[packKey].priceText = `${amount} грн`;
  saveDynamicPackages();
  return ctx.reply(`✅ Ціна "${packKey}" оновлена: ${amount} грн`);
});

// /addpackage KEY TYPE COUNT AMOUNT TITLE
bot.command("addpackage", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const text  = ctx.message.text.replace("/addpackage", "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 5) {
    return ctx.reply(
      "Формат: /addpackage КЛЮЧ ТИП КІЛЬКІСТЬ ЦІНА НАЗВА\n\n" +
      "Типи: photo, video\n" +
      "Приклад фото: /addpackage photo_pack100 photo 100 699 100 фото\n" +
      "Приклад відео: /addpackage kling_pack15 video 15 1199 15 Kling відео"
    );
  }
  const [key, type, countStr, amountStr, ...titleParts] = parts;
  const count  = Number(countStr);
  const amount = Number(amountStr);
  const title  = titleParts.join(" ");
  if (!["photo", "video"].includes(type)) return ctx.reply("❌ Тип має бути: photo або video");
  if (isNaN(count)  || count  <= 0) return ctx.reply("❌ Кількість має бути числом > 0");
  if (isNaN(amount) || amount <= 0) return ctx.reply("❌ Ціна має бути числом > 0");
  if (getPackages()[key]) return ctx.reply(`❌ Пакет "${key}" вже існує. Для зміни ціни: /setprice ${key} ЦІНА`);
  let model = null;
  if (type === "video") {
    if (key.includes("kling"))    model = "kling";
    if (key.includes("seedance")) model = "seedance";
    if (!model) return ctx.reply("❌ Для відео-пакету ключ має містити 'kling' або 'seedance'\nПриклад: kling_pack15 або seedance_pack15");
  }
  dynamicPackages[key] = { key, type, model, title, count, amount, priceText: `${amount} грн` };
  saveDynamicPackages();
  return ctx.reply(`✅ Пакет додано!\n\nКлюч: ${key}\nНазва: ${title}\nТип: ${type}${model ? " / " + model : ""}\nКількість: ${count}\nЦіна: ${amount} грн`);
});

// /setlink KEY URL — зберегти посилання
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

bot.hears("👤 Мій ID",         (ctx) => { touchUser(ctx); if (!isAdmin(ctx.from.id)) return ctx.reply("❌"); return ctx.reply(`Твій ID: ${ctx.from.id}`, adminMenu()); });

bot.hears("👥 Користувачі", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const all = Object.values(users);
  if (!all.length) return ctx.reply("Немає", adminMenu());
  const text = all.slice(-15).reverse().map(u =>
    `${u.banned ? "🚫 " : ""}ID: ${u.id} @${u.username || "-"}\n` +
    `🖼 ${u.balance} | 🎬 ${u.videoBalance || 0} | 💰 ${u.totalSpent || 0}грн\n` +
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
  return ctx.reply(Object.entries(content).map(([k, v]) => `${k}:\n${v}`).join("\n\n==\n\n"), adminMenu());
});

bot.hears("✏️ Змінити текст", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  resetState(ctx);
  return ctx.reply("Обери:", adminTextsMenu());
});

bot.hears(["welcomeText", "infoText", "helpText", "supportText", "ideaText"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const valid = ["welcomeText", "infoText", "helpText", "supportText", "ideaText"];
  if (!valid.includes(ctx.message.text)) return;
  ctx.session.awaitingTextEditKey = ctx.message.text;
  return ctx.reply(`Ключ: ${ctx.message.text}\n\nПоточний:\n${content[ctx.message.text]}\n\nНадішли новий.`, adminMenu());
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

// ✅ НОВА кнопка — Пакети
bot.hears("📦 Пакети", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const pkgs = getPackages();
  const text = Object.values(pkgs).map(p =>
    `${p.key}: ${p.amount} грн | ${p.count} шт | ${p.type}${p.model ? "/" + p.model : ""}`
  ).join("\n");
  return ctx.reply(
    `📦 Пакети:\n\n${text}\n\n` +
    `Змінити ціну:\n/setprice photo_pack10 120\n\n` +
    `Додати пакет:\n/addpackage kling_pack15 video 15 1199 15 Kling відео\n\n` +
    `Додати посилання:\n/setlink support_link https://t.me/support`,
    adminMenu()
  );
});

// ─── НАВІГАЦІЯ ────────────────────────────────────────────────────────────────
bot.hears("↩️ Назад",          (ctx) => { touchUser(ctx); resetState(ctx); return ctx.reply("Головне меню ✨", mainMenu()); });
bot.hears("↩️ Назад до фото",  (ctx) => { touchUser(ctx); resetState(ctx); ctx.session.mode = "photo"; return ctx.reply("Меню фото 🖼", photoMenu()); });
bot.hears("↩️ Назад до відео", (ctx) => { touchUser(ctx); resetState(ctx); ctx.session.mode = "video"; return ctx.reply("Меню відео 🎬", videoMenu()); });
bot.hears("ℹ️ Інформація",     (ctx) => { touchUser(ctx); return ctx.reply(content.infoText,    mainMenu()); });
bot.hears("❓ Допомога",       (ctx) => { touchUser(ctx); return ctx.reply(content.helpText,    mainMenu()); });
bot.hears("🆘 Підтримка",      (ctx) => { touchUser(ctx); return ctx.reply(content.supportText, mainMenu()); });
bot.hears("💡 Ідея для промтів",(ctx) => { touchUser(ctx); return ctx.reply(content.ideaText,   mainMenu()); });

// ─── БАЛАНС ───────────────────────────────────────────────────────────────────
bot.hears("📊 Баланс", (ctx) => {
  const user = touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("📊 Адмін: безліміт ✅", adminMenu());
  const botUsername = ctx.botInfo?.username || "Promtiai_bot";
  const cfg = loadSettings();
  return ctx.reply(
    `📊 Твій баланс:\n\n🖼 Фото: ${user.balance}\n🎬 Відео: ${user.videoBalance || 0}\n\n` +
    `Безкоштовне фото: ${user.freeUsed ? "використано" : "доступне ✅"}\n` +
    `📅 Seedance сьогодні: ${user.dailySeedanceCount || 0}/${cfg.dailySeedanceLimit}\n` +
    `📅 Kling сьогодні: ${user.dailyKlingCount || 0}/${cfg.dailyKlingLimit}\n\n` +
    `👫 Запрошено друзів: ${user.referralCount || 0}\n` +
    `🔗 https://t.me/${botUsername}?start=ref_${user.id}`,
    mainMenu()
  );
});

bot.hears("📊 Баланс фото", (ctx) => {
  const user = touchUser(ctx);
  return ctx.reply(`🖼 Баланс фото: ${user.balance}\nБезкоштовне: ${user.freeUsed ? "використано" : "✅"}\nВсього генерацій: ${user.generations || 0}`, photoMenu());
});

bot.hears("📊 Баланс відео", (ctx) => {
  const user = touchUser(ctx);
  const cfg  = loadSettings();
  return ctx.reply(
    `🎬 Баланс відео: ${user.videoBalance || 0}\n\n` +
    `🎬 Seedance генерацій: ${user.seedanceGenerations || 0}\n` +
    `🎥 Kling генерацій: ${user.klingGenerations || 0}\n\n` +
    `📅 Сьогодні Seedance: ${user.dailySeedanceCount || 0}/${cfg.dailySeedanceLimit}\n` +
    `📅 Сьогодні Kling: ${user.dailyKlingCount || 0}/${cfg.dailyKlingLimit}`,
    videoMenu()
  );
});

// ─── РОЗДІЛИ ──────────────────────────────────────────────────────────────────
bot.hears("🖼 Фото", (ctx) => { touchUser(ctx); ensureSession(ctx); ctx.session.mode = "photo"; return ctx.reply("Меню фото 🖼\nОбери стиль:", photoMenu()); });
bot.hears("🎬 Відео", (ctx) => {
  const cfg = loadSettings();
  if (!cfg.videoEnabled) return ctx.reply("🎬 Відео тимчасово недоступне. Спробуй пізніше.", mainMenu());
  touchUser(ctx); ensureSession(ctx); ctx.session.mode = "video";
  return ctx.reply("Меню відео 🎬\nОбери модель:", videoMenu());
});

// ─── ФОТО СТИЛІ ───────────────────────────────────────────────────────────────
const PHOTO_STYLES = { "👩 Портрет": "portrait", "💄 Б'юті": "beauty", "📸 Fashion": "fashion", "🎨 Арт": "art", "🔥 Тренд": "trend" };
Object.entries(PHOTO_STYLES).forEach(([btn, style]) => {
  bot.hears(btn, (ctx) => {
    touchUser(ctx); ensureSession(ctx);
    ctx.session.mode = "photo"; ctx.session.style = style;
    ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
    return ctx.reply("Надішли фото 📸", photoMenu());
  });
});

bot.hears("✍️ Свій промт", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "photo"; ctx.session.style = null;
  ctx.session.customType = "custom_photo"; ctx.session.awaitingCustomPrompt = true; ctx.session.customPrompt = null;
  return ctx.reply("Напиши промт для фото (до 500 символів), потім надішли фото.", photoMenu());
});

// ─── ВІДЕО МОДЕЛІ ─────────────────────────────────────────────────────────────
bot.hears("🎬 Seedance", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "video"; ctx.session.style = "seedance";
  if (ctx.session.customPrompt) {
    ctx.session.customType = "custom_video_seedance";
    return ctx.reply(`🎬 Seedance обрано ✅\n\n📝 Промт: ${ctx.session.customPrompt}\n\nНадішли фото.`, videoMenu());
  }
  ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("🎬 Seedance обрано ✅\nНадішли фото для анімації.", videoMenu());
});

bot.hears("🎥 Kling", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "video"; ctx.session.style = "kling";
  if (ctx.session.customPrompt) {
    ctx.session.customType = "custom_video_kling";
    return ctx.reply(`🎥 Kling обрано ✅\n\n📝 Промт: ${ctx.session.customPrompt}\n\nНадішли фото.`, videoMenu());
  }
  ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("🎥 Kling обрано ✅\nНадішли фото для анімації.", videoMenu());
});

bot.hears("✍️ Свій промт відео", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "video";
  if (!ctx.session.style) return ctx.reply("Спочатку обери модель: 🎬 Seedance або 🎥 Kling", videoMenu());
  ctx.session.customType = `custom_video_${ctx.session.style}`;
  ctx.session.awaitingCustomPrompt = true; ctx.session.customPrompt = null;
  return ctx.reply(`Напиши промт для ${ctx.session.style} (до 500 символів), потім надішли фото.`, videoMenu());
});

// ─── AI ПРОМТ ─────────────────────────────────────────────────────────────────
bot.hears("🤖 AI промт для фото", (ctx) => {
  const cfg = loadSettings();
  if (!cfg.aiPromptEnabled) return ctx.reply("🤖 AI промт тимчасово вимкнено.", photoMenu());
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "photo"; ctx.session.style = null;
  ctx.session.awaitingAiPrompt = "photo"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("🤖 Надішли фото — я запропоную промт для генерації.", photoMenu());
});

bot.hears("🤖 AI промт для відео", (ctx) => {
  const cfg = loadSettings();
  if (!cfg.aiPromptEnabled) return ctx.reply("🤖 AI промт тимчасово вимкнено.", videoMenu());
  touchUser(ctx); ensureSession(ctx);
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

bot.hears("💳 Купити фото",    (ctx) => { touchUser(ctx); if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu()); return ctx.reply("Обери пакет фото:", buyPhotoMenu()); });
bot.hears("💳 Купити Seedance", (ctx) => { touchUser(ctx); if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu()); return ctx.reply("Обери пакет Seedance 🎬:", buySeedanceMenu()); });
bot.hears("💳 Купити Kling",    (ctx) => { touchUser(ctx); if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu()); return ctx.reply("Обери пакет Kling 🎥:", buyKlingMenu()); });

bot.hears("📦 10 фото — 99 грн",      (ctx) => sendAutoPayment(ctx, "photo_pack10"));
bot.hears("📦 20 фото — 179 грн",     (ctx) => sendAutoPayment(ctx, "photo_pack20"));
bot.hears("📦 30 фото — 249 грн",     (ctx) => sendAutoPayment(ctx, "photo_pack30"));
bot.hears("📦 50 фото — 399 грн",     (ctx) => sendAutoPayment(ctx, "photo_pack50"));
bot.hears("🎬 3 Seedance — 199 грн",  (ctx) => sendAutoPayment(ctx, "seedance_pack3"));
bot.hears("🎬 5 Seedance — 349 грн",  (ctx) => sendAutoPayment(ctx, "seedance_pack5"));
bot.hears("🎬 10 Seedance — 599 грн", (ctx) => sendAutoPayment(ctx, "seedance_pack10"));
bot.hears("🎥 3 Kling — 299 грн",     (ctx) => sendAutoPayment(ctx, "kling_pack3"));
bot.hears("🎥 5 Kling — 499 грн",     (ctx) => sendAutoPayment(ctx, "kling_pack5"));
bot.hears("🎥 10 Kling — 899 грн",    (ctx) => sendAutoPayment(ctx, "kling_pack10"));

bot.action(/^checkpay_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery("Якщо оплата пройшла — буде зараховано автоматично ✅"); }
  catch (e) { console.error("CHECKPAY:", e.message); }
});

// ─── АПСЕЛ INLINE КНОПКИ ─────────────────────────────────────────────────────
bot.action("upsell_seedance", async (ctx) => {
  try { await ctx.answerCbQuery(); ensureSession(ctx); ctx.session.mode = "video"; ctx.session.style = "seedance"; await ctx.reply("Обери пакет Seedance 🎬:", buySeedanceMenu()); }
  catch (e) { console.error("UPSELL SEEDANCE:", e.message); }
});

bot.action("upsell_kling", async (ctx) => {
  try { await ctx.answerCbQuery(); ensureSession(ctx); ctx.session.mode = "video"; ctx.session.style = "kling"; await ctx.reply("Обери пакет Kling 🎥:", buyKlingMenu()); }
  catch (e) { console.error("UPSELL KLING:", e.message); }
});

// ─── AI ПРОМТ INLINE КНОПКИ ───────────────────────────────────────────────────
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
  "🖼 Фото","🎬 Відео","📊 Баланс","💡 Ідея для промтів","ℹ️ Інформація","❓ Допомога","🆘 Підтримка",
  "👩 Портрет","💄 Б'юті","📸 Fashion","🎨 Арт","🔥 Тренд","✍️ Свій промт","✍️ Свій промт відео",
  "🤖 AI промт для фото","🤖 AI промт для відео",
  "💳 Купити фото","📊 Баланс фото","💳 Купити Seedance","💳 Купити Kling","📊 Баланс відео",
  "🎬 Seedance","🎥 Kling",
  "📦 10 фото — 99 грн","📦 20 фото — 179 грн","📦 30 фото — 249 грн","📦 50 фото — 399 грн",
  "🎬 3 Seedance — 199 грн","🎬 5 Seedance — 349 грн","🎬 10 Seedance — 599 грн",
  "🎥 3 Kling — 299 грн","🎥 5 Kling — 499 грн","🎥 10 Kling — 899 грн",
  "📊 Статус бота","👤 Мій ID","👥 Користувачі","💳 Останні оплати",
  "✏️ Змінити промт","📝 Поточні промти","✏️ Змінити текст","📝 Поточні тексти","⚙️ Налаштування","📦 Пакети",
  "portrait","beauty","fashion","art","trend","seedance","kling",
  "welcomeText","infoText","helpText","supportText","ideaText",
  "↩️ Назад","↩️ Назад до фото","↩️ Назад до відео",
];

bot.on("text", async (ctx, next) => {
  try {
    ensureSession(ctx); touchUser(ctx);
    const text = ctx.message.text;
    if (ALL_BUTTONS.includes(text) || text.startsWith("/")) return next();

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

    // ✅ Валідація довжини промту
    if (ctx.session.customType === "custom_photo" && ctx.session.awaitingCustomPrompt) {
      if (text.length > 500) return ctx.reply("❌ Промт занадто довгий. Максимум 500 символів.");
      ctx.session.customPrompt = text; ctx.session.awaitingCustomPrompt = false;
      return ctx.reply("Промт збережено ✅\nНадішли фото.", photoMenu());
    }
    if (ctx.session.mode === "video" && ctx.session.awaitingCustomPrompt) {
      if (text.length > 500) return ctx.reply("❌ Промт занадто довгий. Максимум 500 символів.");
      ctx.session.customPrompt = text; ctx.session.awaitingCustomPrompt = false;
      return ctx.reply("Промт збережено ✅\nНадішли фото для анімації.", videoMenu());
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
  const validationErr = validatePhoto(photo);
  if (validationErr) return ctx.reply(validationErr);

  if (!isAdmin(userId) && checkPhotoSpam(userId)) {
    return ctx.reply("⚠️ Надто багато фото підряд. Зачекай кілька секунд.");
  }

  // ── AI ПРОМТ РЕЖИМ ────────────────────────────────────────────────
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

  // ── ЗВИЧАЙНА ГЕНЕРАЦІЯ ────────────────────────────────────────────
  if (userGenerating.has(userId)) return ctx.reply("⏳ Зачекай, твоє фото ще обробляється...");

  if (!isAdmin(userId)) {
    const mode = ctx.session.mode;
    const secs = checkRateLimit(userId, mode === "video" ? "video" : "photo");
    if (secs > 0) return ctx.reply(`⏳ Зачекай ще ${secs} сек.`);
  }

  const MAX_QUEUE = 50;
  if (generationQueue.length >= MAX_QUEUE) return ctx.reply("⚠️ Сервіс зараз перевантажений. Спробуй через кілька хвилин.");
  if (generationQueue.length > 0) await ctx.reply(`⏳ Черга: #${generationQueue.length + 1}. Зачекай...`);

  userGenerating.add(userId);

  // ✅ ВИПРАВЛЕНИЙ catch блок
  try {
    await enqueueGeneration(userId, () => _processGeneration(ctx, user, userId, ctx.session.mode, photo));
  } catch (e) {
    userGenerating.delete(userId);
    console.error("ENQUEUE ERROR:", e.message);
    ctx.reply("❌ Сталася помилка. Спробуй ще раз.").catch(() => {});
  }
});

// ─── ПРОЦЕСИНГ ГЕНЕРАЦІЇ ─────────────────────────────────────────────────────
async function _processGeneration(ctx, user, userId, mode, photo) {
  const cfg = loadSettings();
  let chargedFromBalance = false;
  let usedFree           = false;
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
        if ((user.videoBalance || 0) <= 0) {
          userGenerating.delete(userId);
          return ctx.reply(`❌ Баланс відео вичерпано\n💳 Купи ${videoStyle === "seedance" ? "Seedance" : "Kling"}`, videoMenu());
        }
        user.videoBalance -= 1; chargedFromBalance = true; saveUsers();
      }

      const prompt       = ctx.session.customPrompt || prompts[videoStyle];
      const stopProgress = startVideoProgress(ctx);
      await ctx.reply(`⏳ Генерую ${videoStyle === "seedance" ? "Seedance" : "Kling"} відео...\nЦе займе 1-3 хв ⌛`);

      const image = await getImage(ctx, photo.file_id);

      try {
        let videoUrl = null;
        if (videoStyle === "seedance") {
          const result = await falWithRetry(
            "fal-ai/bytedance/seedance-1-lite/image-to-video",
            { prompt, image_url: image, duration: String(cfg.seedanceDurationSec), aspect_ratio: cfg.seedanceAspectRatio },
            cfg.seedanceTimeoutMs
          );
          videoUrl = result?.data?.video?.url;
        } else {
          const result = await falWithRetry(
            "fal-ai/kling-video/v1.6/pro/image-to-video",
            { prompt, image_url: image, duration: String(cfg.klingDurationSec), aspect_ratio: cfg.klingAspectRatio },
            cfg.klingTimeoutMs
          );
          videoUrl = result?.data?.video?.url;
        }

        stopProgress();
        if (!videoUrl) throw new Error("fal не повернув відео");

        if (!isAdmin(userId)) incrementDailyVideo(user, videoStyle);
        if (videoStyle === "seedance") user.seedanceGenerations = (user.seedanceGenerations || 0) + 1;
        else user.klingGenerations = (user.klingGenerations || 0) + 1;
        saveUsers();
        userGenerating.delete(userId);

        appendLog({ type: "video", model: videoStyle, userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });

        const caption = isAdmin(userId)
          ? `🎬 Відео готове ✨\nМодель: ${videoStyle}\nАдмін: безліміт ✅`
          : `🎬 Відео готове ✨\n${videoStyle === "seedance" ? "🎬" : "🎥"} Залишилось: ${user.videoBalance}`;

        await tgSendWithRetry(() => ctx.replyWithVideo({ url: videoUrl }, { caption }));

        if (!isAdmin(userId) && user.videoBalance <= 2) {
          const buyBtn = videoStyle === "kling"
            ? [Markup.button.callback("💳 Купити Kling", "upsell_kling"), Markup.button.callback("💳 Купити Seedance", "upsell_seedance")]
            : [Markup.button.callback("💳 Купити Seedance", "upsell_seedance"), Markup.button.callback("💳 Купити Kling", "upsell_kling")];
          await ctx.reply(`💡 Залишилось відео: ${user.videoBalance}. Поповни пакет!`, Markup.inlineKeyboard([buyBtn]));
        }
        return;

      } catch (e) {
        stopProgress();
        userGenerating.delete(userId);
        if (!isAdmin(userId) && chargedFromBalance) { user.videoBalance += 1; saveUsers(); }
        appendLog({ type: "video", model: videoStyle, userId, prompt, success: false, error: e.message, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });
        throw e;
      }
    }

    // ══ ФОТО ══
    const style      = ctx.session.style;
    const customType = ctx.session.customType;
    let prompt = "";

    if (customType === "custom_photo") {
      if (!ctx.session.customPrompt) { userGenerating.delete(userId); return ctx.reply("Спочатку напиши промт текстом.", photoMenu()); }
      prompt = ctx.session.customPrompt;
    } else {
      if (!style || !prompts[style]) { userGenerating.delete(userId); return ctx.reply("Спочатку обери стиль 🖼 Фото", photoMenu()); }
      prompt = prompts[style];
    }

    if (!isAdmin(userId)) {
      if (!user.freeUsed) { user.freeUsed = true; usedFree = true; }
      else if (user.balance <= 0) { userGenerating.delete(userId); return ctx.reply("❌ Баланс фото вичерпано\n💳 Купити фото", photoMenu()); }
      else { user.balance -= 1; chargedFromBalance = true; }
      saveUsers();
    }

    await ctx.reply("⏳ Генерую фото...");
    const image  = await getImage(ctx, photo.file_id);
    const result = await falWithRetry("fal-ai/nano-banana-2/edit", { prompt, image_urls: [image], resolution: "1K" }, cfg.photoTimeoutMs);
    const url    = result?.data?.images?.[0]?.url;
    if (!url) throw new Error("fal не повернув зображення");

    user.generations = (user.generations || 0) + 1;
    saveUsers();
    userGenerating.delete(userId);
    appendLog({ type: "photo", model: style || "custom", userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });

    const caption = isAdmin(userId) ? "Готово ✨\nАдмін: безліміт ✅" : `Готово ✨\n🖼 Залишилось фото: ${user.balance}`;
    await tgSendWithRetry(() => ctx.replyWithPhoto({ url }, { caption }));

    if (!isAdmin(userId) && user.generations % 3 === 0) {
      await ctx.reply(
        "💡 Хочеш оживити це фото? Спробуй відео-генерацію!",
        Markup.inlineKeyboard([[Markup.button.callback("🎬 Seedance", "upsell_seedance"), Markup.button.callback("🎥 Kling", "upsell_kling")]])
      );
    }
    return;

  } catch (e) {
    userGenerating.delete(userId);
    console.error("GENERATION ERROR:", e.message);
    if (!isAdmin(userId)) {
      if (chargedFromBalance) { if (mode === "video") user.videoBalance = (user.videoBalance || 0) + 1; else user.balance += 1; }
      if (usedFree) user.freeUsed = false;
      saveUsers();
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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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
app.post("/payment", express.text({ type: "*/*" }), async (req, res) => {
  try {
    // ✅ Правильний парсинг тіла — WayForPay надсилає JSON як text/plain
    let data = {};
    try {
      const raw = req.body;
      if (typeof raw === "string" && raw.trim().startsWith("{")) {
        data = JSON.parse(raw);
      } else if (typeof raw === "object" && raw !== null) {
        data = normalizeWayForPayCallbackBody(raw);
      } else {
        data = normalizeWayForPayCallbackBody(req.body || {});
      }
    } catch (parseErr) {
      console.error("WFP BODY PARSE ERROR:", parseErr.message);
      console.error("RAW BODY:", req.body);
      data = normalizeWayForPayCallbackBody(req.body || {});
    }

    console.log("=== WFP CALLBACK ===", JSON.stringify(data));
    console.log("merchantSignature:", data.merchantSignature);

    // ✅ Діагностика підпису
    const expectedSig = signWfpCallback(data);
    console.log("EXPECTED SIG:", expectedSig);
    console.log("RECEIVED SIG:", data.merchantSignature);
    console.log("MATCH:", expectedSig === data.merchantSignature);

    if (expectedSig !== data.merchantSignature) {
      console.error("WFP SIGNATURE INVALID");
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const parsed = parseOrderReference(data.orderReference);
    if (!parsed) {
      console.error("WFP PARSE FAILED:", data.orderReference);
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const { userId, packKey } = parsed;

    // ✅ ВАЛІДАЦІЯ PACK — захист від краша
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

      if (pack.type === "video") {
        user.videoBalance    = (user.videoBalance    || 0) + pack.count;
        user.purchasedVideos = (user.purchasedVideos || 0) + pack.count;
      } else {
        user.balance         += pack.count;
        user.purchasedPhotos = (user.purchasedPhotos || 0) + pack.count;
      }
      user.totalSpent            = (user.totalSpent || 0) + Number(data.amount || 0);
      user.pendingOrderReference = null;
      user.lastPaidAt            = new Date().toISOString();
      saveUsers(); savePayments();

      console.log(`✅ CREDITED: user ${userId}, pack ${packKey}, +${pack.count}`);

      const emoji        = pack.type === "video" ? (pack.model === "kling" ? "🎥" : "🎬") : "🖼";
      const balanceNow   = pack.type === "video" ? user.videoBalance : user.balance;
      const balanceLabel = pack.type === "video" ? "Баланс відео" : "Баланс фото";

      try {
        await bot.telegram.sendMessage(
          userId,
          `✅ Оплату підтверджено!\n\n${emoji} ${pack.title}\nЗараховано: ${pack.count}\n${balanceLabel}: ${balanceNow}`,
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
const BACKUP_DIR   = path.join(__dirname, "backups");
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

bot.launch({ dropPendingUpdates: true })
  .then(() => {
    console.log("🔥 Бот запущений (v5)");
    saveJson(SETTINGS_PATH, loadSettings());
    runBackup();
  })
  .catch(err => console.error("BOT LAUNCH ERROR:", err.message));

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
process.once("SIGUSR2", () => bot.stop("SIGUSR2"));