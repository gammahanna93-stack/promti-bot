require("dotenv").config();

process.on("uncaughtException",  (err)    => { console.error("UNCAUGHT EXCEPTION:", err.message); });
process.on("unhandledRejection", (reason) => { console.error("UNHANDLED REJECTION:", reason);     });

const fs       = require("fs");
const os       = require("os");
const path     = require("path");
const crypto   = require("crypto");
const express  = require("express");
const axios    = require("axios");
const iconv    = require("iconv-lite");
const { execSync } = require("child_process");
const { Telegraf, Markup } = require("telegraf");
const LocalSession = require("telegraf-session-local");
const { fal } = require("@fal-ai/client");
let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (e) {
  console.warn("OPENAI SDK NOT INSTALLED YET:", e.message);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
let openai = null;
if (OpenAI && process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    console.warn("OPENAI CLIENT INIT FAILED:", e.message);
    openai = null;
  }
}

// ─── ПОСТІЙНЕ СХОВИЩЕ (має бути до LocalSession!) ────────────────────────────
function resolveWritableDataDir() {
  const candidates = [
    process.env.DATA_DIR,
    process.env.PERSISTENT_DATA_DIR,
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
    "/app/data",
    path.join(__dirname, "data"),
    path.join(os.tmpdir(), "promti-data"),
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      console.log(`DATA DIR READY: ${candidate}`);
      return candidate;
    } catch (error) {
      lastError = error;
      console.warn(`DATA DIR FAILED: ${candidate} -> ${error.message}`);
    }
  }

  throw lastError || new Error("No writable data directory available");
}

const DATA_DIR = resolveWritableDataDir();

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

function looksLikeGarbledText(value) {
  if (typeof value !== "string" || !value) return false;
  return GARBLED_PATTERNS.some((pattern) => value.includes(pattern));
}

function decodeGarbledText(value = "") {
  const raw = String(value);
  if (!looksLikeGarbledText(raw)) return raw;
  try {
    const decoded = iconv.decode(iconv.encode(raw, "cp1251"), "utf8");
    return looksLikeGarbledText(decoded) ? raw : decoded;
  } catch {
    return raw;
  }
}

function sanitizeTextTree(value) {
  if (typeof value === "string") return decodeGarbledText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeTextTree(item));
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeTextTree(item)]));
}

function getNestedValue(source, pathValue, fallback = undefined) {
  const segments = String(pathValue || "").split(".").filter(Boolean);
  let current = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) return fallback;
    current = current[segment];
  }
  return current === undefined ? fallback : current;
}

function setNestedValue(target, pathValue, nextValue) {
  const segments = String(pathValue || "").split(".").filter(Boolean);
  if (!segments.length) return target;
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments[segments.length - 1]] = nextValue;
  return target;
}

function normalizeTelegramPayload(value) {
  return sanitizeTextTree(value);
}

function patchTelegramContext(ctx) {
  if (ctx.__encodingPatched) return;
  ctx.__encodingPatched = true;

  const wrap = (methodName, config = {}) => {
    if (typeof ctx[methodName] !== "function") return;
    const original = ctx[methodName].bind(ctx);
    ctx[methodName] = (...args) => {
      const nextArgs = [...args];
      if (config.textArg !== undefined && typeof nextArgs[config.textArg] === "string") {
        nextArgs[config.textArg] = decodeGarbledText(nextArgs[config.textArg]);
      }
      if (config.optionsArg !== undefined && nextArgs[config.optionsArg] && typeof nextArgs[config.optionsArg] === "object") {
        nextArgs[config.optionsArg] = normalizeTelegramPayload(nextArgs[config.optionsArg]);
      }
      if (config.mediaGroupArg !== undefined && Array.isArray(nextArgs[config.mediaGroupArg])) {
        nextArgs[config.mediaGroupArg] = normalizeTelegramPayload(nextArgs[config.mediaGroupArg]);
      }
      return original(...nextArgs);
    };
  };

  wrap("reply", { textArg: 0, optionsArg: 1 });
  wrap("editMessageText", { textArg: 0, optionsArg: 1 });
  wrap("answerCbQuery", { textArg: 0, optionsArg: 1 });
  wrap("replyWithPhoto", { optionsArg: 1 });
  wrap("replyWithVideo", { optionsArg: 1 });
  wrap("replyWithDocument", { optionsArg: 1 });
  wrap("replyWithMediaGroup", { mediaGroupArg: 0 });
}

function patchTelegramApi() {
  if (bot.telegram.__encodingPatched) return;
  bot.telegram.__encodingPatched = true;

  const wrap = (methodName, config = {}) => {
    if (typeof bot.telegram[methodName] !== "function") return;
    const original = bot.telegram[methodName].bind(bot.telegram);
    bot.telegram[methodName] = (...args) => {
      const nextArgs = [...args];
      if (config.textArg !== undefined && typeof nextArgs[config.textArg] === "string") {
        nextArgs[config.textArg] = decodeGarbledText(nextArgs[config.textArg]);
      }
      if (config.optionsArg !== undefined && nextArgs[config.optionsArg] && typeof nextArgs[config.optionsArg] === "object") {
        nextArgs[config.optionsArg] = normalizeTelegramPayload(nextArgs[config.optionsArg]);
      }
      return original(...nextArgs);
    };
  };

  wrap("sendMessage", { textArg: 1, optionsArg: 2 });
  wrap("sendPhoto", { optionsArg: 2 });
  wrap("sendVideo", { optionsArg: 2 });
  wrap("sendDocument", { optionsArg: 2 });
}

patchTelegramApi();

bot.use(async (ctx, next) => {
  patchTelegramContext(ctx);
  if (ctx.message && typeof ctx.message.text === "string") {
    ctx.message.text = normalizeIncomingButtonText(ctx.message.text);
  }
  await next();
});

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

const ADMIN_IDS = ADMINS;
const KYIV_TIMEZONE = "Europe/Kyiv";
const GOOGLE_SHEETS_URL = "https://docs.google.com/spreadsheets/d/1i1D_vLOLPHJbf-u1feSDMwh9FSkhVoRmHVSj9THVEFU/edit";
const GOOGLE_SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "1i1D_vLOLPHJbf-u1feSDMwh9FSkhVoRmHVSj9THVEFU";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const ANALYTICS_SHEETS = {
  EVENTS: ["timestamp", "user_id", "event", "value", "style_id", "generation_id", "extra"],
  USERS: ["user_id", "first_seen", "last_seen", "source", "total_generations", "total_spent"],
  PAYMENTS: ["timestamp", "user_id", "amount", "currency", "promti_added", "status"],
  GENERATIONS: ["timestamp", "user_id", "type", "style_id", "generation_id", "status"],
};
const ANALYTICS_CURRENCY = "UAH";
const GARBLED_PATTERNS = [
  "Рџ", "Рґ", "РЅ", "СЊ", "С–", "СЏ", "вњ", "рџ", "РІС", "Р ", "Р’", "Р“", "Р—", "вЂ", "пёЏ",
];

const REFERRAL_PROMTI_BONUS = 5;
const START_PROMTI_BONUS = 3;

const PROMTI_PRICES = {
  photo:    1,
  seedance: 5,
  kling:    8,
};

const MAX_PROMPT_EXAMPLE_PHOTOS = 10;

// ─── ШЛЯХИ ДО ФАЙЛІВ ─────────────────────────────────────────────────────────
const USERS_PATH        = path.join(DATA_DIR, "users.json");
const PAYMENTS_PATH     = path.join(DATA_DIR, "payments.json");
const PAYMENT_LOCK_PATH = path.join(DATA_DIR, "payment.lock.json");
const PACKAGES_PATH     = path.join(DATA_DIR, "packages.json");
const GEN_LOG_PATH      = path.join(DATA_DIR, "generation_logs.jsonl");
const AI_PROMPT_CACHE_PATH = path.join(DATA_DIR, "ai_prompt_cache.json");
const TEMP_JOBS_PATH = path.join(DATA_DIR, "temp_jobs.json");
const FAILED_COMMANDS_PATH = path.join(DATA_DIR, "failed_commands.json");
const DYNAMIC_PROMPTS_PATH = path.join(DATA_DIR, "dynamic-prompts.json");
const VIDEO_PRESETS_PATH = path.join(DATA_DIR, "video-presets.json");
const OPENAI_TOOLS_PATH = path.join(DATA_DIR, "openai-tools.json");

const PROMPTS_PATH      = path.join(DATA_DIR, "prompts.json");
const CONTENT_PATH      = path.join(DATA_DIR, "content.json");
const SETTINGS_PATH     = path.join(DATA_DIR, "settings.json");
const LANDING_CONTENT_PATH = path.join(DATA_DIR, "landing-content.json");
const LANDING_CONTENT_DEFAULT_PATH = path.join(__dirname, "landing-content.default.json");
const LANDING_UPLOADS_DIR = path.join(DATA_DIR, "landing-uploads");
const DYNAMIC_PROMPTS_DEFAULT_PATH = fs.existsSync(path.join(__dirname, "dynamic-prompts.json"))
  ? path.join(__dirname, "dynamic-prompts.json")
  : path.join(__dirname, "Новая папка", "версія валюта", "dynamic-prompts.json");

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "promti123!";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || process.env.BOT_TOKEN || "promti-admin-secret";
const ADMIN_COOKIE_NAME = "promti_admin";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

if (!fs.existsSync(LANDING_UPLOADS_DIR)) fs.mkdirSync(LANDING_UPLOADS_DIR, { recursive: true });

for (const [src, dst] of [
  [path.join(__dirname, "prompts.json"),  PROMPTS_PATH],
  [path.join(__dirname, "content.json"),  CONTENT_PATH],
  [path.join(__dirname, "settings.json"), SETTINGS_PATH],
  [LANDING_CONTENT_DEFAULT_PATH, LANDING_CONTENT_PATH],
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
  defaultImageProvider: "fal",
  defaultImageModel: "fal-ai/nano-banana-2",
  defaultOpenAIImageProvider: "openai",
  defaultOpenAIImageModel: "gpt-image-1",
  defaultPromptProvider: "openai",
  defaultPromptModel: "gpt-4.1-mini",
  aiPromptCacheEnabled: true,
  aiPromptCacheTtlMs: 86400000,
  failedCommandsTtlMs: 604800000,
  tempJobsTtlMs: 86400000,
  sessionCleanupTtlMs: 86400000,
  cacheCleanupIntervalMs: 3600000,
  chatgptTrendPricePromti: 1,
  infographicPricePromti: 2,
  svgLogoPricePromti: 3,
  defaultInfographicProvider: "openai",
  defaultInfographicImageModel: "gpt-image-1",
  defaultSvgModel: "gpt-4.1-mini",
  providers: {
    fal: { enabled: true },
    openai: { enabled: true },
  },
};

let _settingsCache = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_MS = 30000;

function loadSettings() {
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTime < SETTINGS_CACHE_MS) {
    return _settingsCache;
  }
  const savedSettings = loadJson(SETTINGS_PATH, DEFAULT_SETTINGS);
  _settingsCache = {
    ...DEFAULT_SETTINGS,
    ...savedSettings,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(savedSettings.providers || {}),
      fal: {
        ...DEFAULT_SETTINGS.providers.fal,
        ...((savedSettings.providers || {}).fal || {}),
      },
      openai: {
        ...DEFAULT_SETTINGS.providers.openai,
        ...((savedSettings.providers || {}).openai || {}),
      },
    },
  };
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

function ensureBackupDir() {
  const dir = path.join(DATA_DIR, "backups", "managed");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function backupJsonFile(filePath, label = path.basename(filePath, ".json")) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const backupDir = ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `${label}_${stamp}.json`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (e) {
    console.error("BACKUP JSON ERROR:", e.message);
    return null;
  }
}

function repairGarbledJson(defaultValue, currentValue, stats = { replaced: 0 }) {
  const cleanDefault = sanitizeTextTree(defaultValue);
  const cleanCurrent = sanitizeTextTree(currentValue);

  if (typeof cleanCurrent === "string") {
    if (typeof cleanDefault === "string" && looksLikeGarbledText(String(currentValue || ""))) {
      stats.replaced += 1;
      return cleanDefault;
    }
    return cleanCurrent;
  }

  if (Array.isArray(cleanCurrent)) {
    const defaultItem = Array.isArray(cleanDefault) ? cleanDefault[0] : undefined;
    return cleanCurrent.map((item) => repairGarbledJson(defaultItem, item, stats));
  }

  if (!cleanCurrent || typeof cleanCurrent !== "object") {
    return cleanDefault !== undefined ? cleanDefault : cleanCurrent;
  }

  const result = {};
  const keys = new Set([
    ...Object.keys(cleanDefault || {}),
    ...Object.keys(cleanCurrent || {}),
  ]);

  for (const key of keys) {
    if (cleanDefault && Object.prototype.hasOwnProperty.call(cleanDefault, key)) {
      result[key] = repairGarbledJson(cleanDefault[key], cleanCurrent[key], stats);
      continue;
    }

    const extraValue = cleanCurrent[key];
    if (typeof extraValue === "string" && looksLikeGarbledText(String(currentValue?.[key] || ""))) {
      stats.replaced += 1;
      result[key] = decodeGarbledText(extraValue);
    } else if (extraValue && typeof extraValue === "object") {
      result[key] = repairGarbledJson(undefined, extraValue, stats);
    } else {
      result[key] = extraValue;
    }
  }

  return result;
}

function readRepoJsonDefault(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return sanitizeTextTree(fallback);
    return sanitizeTextTree(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (e) {
    console.error(`READ DEFAULT JSON ERROR ${filePath}:`, e.message);
    return sanitizeTextTree(fallback);
  }
}

function repairTextStorageFile(filePath, defaultValue, label) {
  const stats = { replaced: 0 };
  try {
    const current = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, "utf8"))
      : undefined;
    const repaired = repairGarbledJson(defaultValue, current, stats);
    const shouldWrite = !fs.existsSync(filePath) || stats.replaced > 0;
    if (shouldWrite) {
      fs.writeFileSync(filePath, JSON.stringify(repaired, null, 2), "utf8");
      console.log(`ENCODING REPAIR: ${label} repaired, replaced ${stats.replaced} strings`);
    } else {
      console.log(`ENCODING REPAIR: ${label} clean`);
    }
    return { filePath, label, replaced: stats.replaced, wrote: shouldWrite };
  } catch (e) {
    const fallbackValue = sanitizeTextTree(defaultValue);
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2), "utf8");
    console.log(`ENCODING REPAIR: ${label} reset from defaults after parse error (${e.message})`);
    return { filePath, label, replaced: stats.replaced, wrote: true, reset: true };
  }
}

function resetTextStorageFile(filePath, defaultValue, label) {
  const cleanValue = sanitizeTextTree(defaultValue);
  fs.writeFileSync(filePath, JSON.stringify(cleanValue, null, 2), "utf8");
  console.log(`ENCODING RESET: ${label} overwritten with clean defaults`);
  return { filePath, label, replaced: 0, wrote: true, reset: true };
}

function cloneJson(data) {
  return JSON.parse(JSON.stringify(data));
}

function deepMerge(defaultValue, incomingValue) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(incomingValue) ? cloneJson(incomingValue) : cloneJson(defaultValue);
  }
  if (defaultValue && typeof defaultValue === "object") {
    const result = {};
    const source = incomingValue && typeof incomingValue === "object" && !Array.isArray(incomingValue) ? incomingValue : {};
    for (const key of Object.keys(defaultValue)) {
      result[key] = deepMerge(defaultValue[key], source[key]);
    }
    for (const key of Object.keys(source)) {
      if (!(key in result)) result[key] = cloneJson(source[key]);
    }
    return result;
  }
  return incomingValue !== undefined ? incomingValue : defaultValue;
}

const DEFAULT_LANDING_CONTENT = sanitizeTextTree(loadJson(LANDING_CONTENT_DEFAULT_PATH, {
  locales: { uk: {}, en: {} },
  botLink: "https://t.me/Promtiai_bot",
  theme: { supportsEnglishLater: true },
}));

function loadLandingContent() {
  const saved = loadJson(LANDING_CONTENT_PATH, DEFAULT_LANDING_CONTENT);
  const merged = deepMerge(DEFAULT_LANDING_CONTENT, saved);
  saveJson(LANDING_CONTENT_PATH, merged);
  return merged;
}

let landingContent = loadLandingContent();

if (landingContent?.locales?.uk?.hero?.trust === "1 Promti ✨ безкоштовно при старті") {
  landingContent.locales.uk.hero.trust = "3 Promti ✨ безкоштовно при старті";
}
if (landingContent?.locales?.uk?.ctaSection?.title === "Спробуй зараз і отримай перший Promti ✨ безкоштовно") {
  landingContent.locales.uk.ctaSection.title = "Спробуй зараз і отримай перші 3 Promti ✨ безкоштовно";
}
saveJson(LANDING_CONTENT_PATH, landingContent);

function getLandingContent() {
  return cloneJson(landingContent);
}

function saveLandingContent(nextContent) {
  landingContent = deepMerge(DEFAULT_LANDING_CONTENT, nextContent || {});
  saveJson(LANDING_CONTENT_PATH, landingContent);
  return landingContent;
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((acc, chunk) => {
      const separatorIndex = chunk.indexOf("=");
      if (separatorIndex === -1) return acc;
      const key = chunk.slice(0, separatorIndex).trim();
      const value = chunk.slice(separatorIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function signAdminSession(expiresAt) {
  return crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(`${ADMIN_LOGIN}:${expiresAt}`)
    .digest("hex");
}

function createAdminSessionToken() {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  return `${expiresAt}.${signAdminSession(expiresAt)}`;
}

function isValidAdminSession(token) {
  if (!token || typeof token !== "string") return false;
  const [expiresAtRaw, signature] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAt || !signature || Date.now() > expiresAt) return false;
  const expected = signAdminSession(expiresAt);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function buildAdminCookie(token, req) {
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ];
  if (req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https")) {
    cookieParts.push("Secure");
  }
  return cookieParts.join("; ");
}

function clearAdminCookie(req) {
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https")) {
    cookieParts.push("Secure");
  }
  return cookieParts.join("; ");
}

function requireAdminAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (!isValidAdminSession(cookies[ADMIN_COOKIE_NAME])) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  return next();
}

function sanitizeUploadBaseName(fileName = "image") {
  const ext = path.extname(String(fileName)).toLowerCase();
  const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
  const safeExt = allowedExt.has(ext) ? ext : ".png";
  const base = path
    .basename(String(fileName), ext)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "image";
  return { base, ext: safeExt };
}

function saveLandingImageUpload(fileName, dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("INVALID_IMAGE_DATA");
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("INVALID_IMAGE_FORMAT");

  const mimeType = match[1].toLowerCase();
  const mimeToExt = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  const parsed = sanitizeUploadBaseName(fileName);
  const ext = mimeToExt[mimeType] || parsed.ext;
  const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${parsed.base}${ext}`;
  const absolutePath = path.join(LANDING_UPLOADS_DIR, uniqueName);
  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("IMAGE_TOO_LARGE");
  }

  fs.writeFileSync(absolutePath, buffer);
  return `/uploads/${uniqueName}`;
}

function appendLog(entry) {
  try { fs.appendFileSync(GEN_LOG_PATH, JSON.stringify(entry) + "\n", "utf8"); }
  catch (e) { console.error("LOG APPEND ERROR:", e.message); }
}

function log(type, userId, details = "") {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] ${type} | user:${userId || "-"} | ${details}`);
}

let googleTokenCache = { accessToken: null, expiresAt: 0 };
let analyticsEnsurePromise = null;
let analyticsUsersRowCache = null;

function getGoogleServiceAccountCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
      return parsed;
    } catch (e) {
      console.error("GOOGLE_SERVICE_ACCOUNT_JSON parse error:", e.message);
      return null;
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: String(process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, "\n"),
      token_uri: GOOGLE_TOKEN_URL,
    };
  }

  return null;
}

function isAnalyticsEnabled() {
  return Boolean(getGoogleServiceAccountCredentials());
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getGoogleAccessToken() {
  if (!isAnalyticsEnabled()) return null;
  if (googleTokenCache.accessToken && googleTokenCache.expiresAt - Date.now() > 60_000) {
    return googleTokenCache.accessToken;
  }

  const creds = getGoogleServiceAccountCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: creds.token_uri || GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), creds.private_key)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  const response = await axios.post(
    creds.token_uri || GOOGLE_TOKEN_URL,
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30000 }
  );

  googleTokenCache = {
    accessToken: response.data.access_token,
    expiresAt: Date.now() + Number(response.data.expires_in || 3600) * 1000,
  };
  return googleTokenCache.accessToken;
}

async function sheetsApiRequest(method, endpoint, { params, data } = {}) {
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) throw new Error("ANALYTICS_DISABLED");
  const response = await axios({
    method,
    url: `${GOOGLE_SHEETS_BASE_URL}/${GOOGLE_SHEETS_SPREADSHEET_ID}${endpoint}`,
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
    data,
    timeout: 30000,
  });
  return response.data;
}

async function ensureAnalyticsSheets() {
  if (!isAnalyticsEnabled()) return false;
  if (analyticsEnsurePromise) return analyticsEnsurePromise;

  analyticsEnsurePromise = (async () => {
    const metadata = await sheetsApiRequest("get", "", { params: { fields: "sheets.properties.title" } });
    const existingTitles = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
    const missing = Object.keys(ANALYTICS_SHEETS).filter((title) => !existingTitles.has(title));

    if (missing.length) {
      await sheetsApiRequest("post", ":batchUpdate", {
        data: {
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
    }

    for (const [title, headers] of Object.entries(ANALYTICS_SHEETS)) {
      const range = encodeURIComponent(`${title}!1:1`);
      const current = await sheetsApiRequest("get", `/values/${range}`);
      if (!current.values || !current.values.length) {
        await sheetsApiRequest("put", `/values/${encodeURIComponent(`${title}!A1`)}`, {
          params: { valueInputOption: "RAW" },
          data: { range: `${title}!A1`, majorDimension: "ROWS", values: [headers] },
        });
      }
    }

    return true;
  })().catch((e) => {
    analyticsEnsurePromise = null;
    throw e;
  });

  return analyticsEnsurePromise;
}

async function appendSheetRow(sheetName, row) {
  await ensureAnalyticsSheets();
  return sheetsApiRequest("post", `/values/${encodeURIComponent(`${sheetName}!A1`)}:append`, {
    params: {
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    },
    data: {
      range: `${sheetName}!A1`,
      majorDimension: "ROWS",
      values: [row],
    },
  });
}

async function getSheetRows(sheetName) {
  await ensureAnalyticsSheets();
  const response = await sheetsApiRequest("get", `/values/${encodeURIComponent(`${sheetName}!A:Z`)}`);
  return response.values || [];
}

function serializeAnalyticsExtra(extra = {}) {
  if (typeof extra === "string") return extra;
  return Object.entries(extra)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
    .join(";");
}

function parseAnalyticsExtra(extra = "") {
  return String(extra || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((acc, chunk) => {
      const [key, ...rest] = chunk.split("=");
      if (!key) return acc;
      acc[key] = rest.join("=");
      return acc;
    }, {});
}

function getKyivDateKey(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(safeDate);
}

function getKyivTimestamp(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: KYIV_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(safeDate);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function getRecentKyivDateKeys(days) {
  const keys = [];
  for (let index = 0; index < days; index += 1) {
    keys.push(getKyivDateKey(new Date(Date.now() - index * 86400000)));
  }
  return new Set(keys);
}

function runAnalyticsTask(task, label) {
  Promise.resolve()
    .then(task)
    .catch((e) => {
      console.error(`${label}:`, e.message);
    });
}

async function ensureUsersSheetIndex() {
  if (analyticsUsersRowCache) return analyticsUsersRowCache;
  const rows = await getSheetRows("USERS");
  analyticsUsersRowCache = {};
  rows.slice(1).forEach((row, index) => {
    const userId = row[0];
    if (userId) analyticsUsersRowCache[String(userId)] = index + 2;
  });
  return analyticsUsersRowCache;
}

function deriveUserSource(ctx, user) {
  const payload = ctx.startPayload || "";
  if (payload.startsWith("prompt_")) return "style";
  if (payload.startsWith("ref_")) return "referral";
  if (user?.sourcePromptKey) return "style";
  return "direct";
}

async function upsertAnalyticsUser(ctx, user, overrides = {}) {
  if (!isAnalyticsEnabled()) return false;
  await ensureAnalyticsSheets();

  const userId = String(ctx.from?.id || user?.id || "");
  if (!userId) return false;

  const rowsIndex = await ensureUsersSheetIndex();
  const nowTs = getKyivTimestamp();
  const currentRow = rowsIndex[userId];
  const existingRows = currentRow ? await getSheetRows("USERS") : null;
  const existing = currentRow && existingRows?.[currentRow - 1] ? existingRows[currentRow - 1] : null;
  const totalGenerations = Number(
    overrides.totalGenerations !== undefined
      ? overrides.totalGenerations
      : (user?.generations || 0) + (user?.seedanceGenerations || 0) + (user?.klingGenerations || 0)
  );
  const totalSpent = Number(
    overrides.totalSpent !== undefined
      ? overrides.totalSpent
      : user?.totalSpent || 0
  );
  const row = [
    userId,
    existing?.[1] || overrides.firstSeen || nowTs,
    overrides.lastSeen || nowTs,
    overrides.source || existing?.[3] || deriveUserSource(ctx, user),
    totalGenerations,
    totalSpent,
  ];

  if (currentRow) {
    await sheetsApiRequest("put", `/values/${encodeURIComponent(`USERS!A${currentRow}:F${currentRow}`)}`, {
      params: { valueInputOption: "USER_ENTERED" },
      data: { range: `USERS!A${currentRow}:F${currentRow}`, majorDimension: "ROWS", values: [row] },
    });
  } else {
    await appendSheetRow("USERS", row);
    analyticsUsersRowCache = null;
  }

  return true;
}

function queueAnalyticsUserTouch(ctx, user, overrides = {}) {
  runAnalyticsTask(() => upsertAnalyticsUser(ctx, user, overrides), "ANALYTICS_USER");
}

function getUserTotalGenerations(user) {
  return Number(user?.generations || 0) + Number(user?.seedanceGenerations || 0) + Number(user?.klingGenerations || 0);
}

function createGenerationId(userId, prefix = "gen") {
  return `${prefix}_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function logEvent({
  user_id,
  event,
  value = 0,
  style_id = "",
  generation_id = "",
  extra = "",
}) {
  if (!isAnalyticsEnabled()) return false;
  await appendSheetRow("EVENTS", [
    getKyivTimestamp(),
    String(user_id || ""),
    event,
    Number(value || 0),
    style_id || "",
    generation_id || "",
    serializeAnalyticsExtra(extra),
  ]);
  return true;
}

async function trackAnalyticsGeneration({
  userId,
  type,
  styleId = "",
  generationId = "",
  status = "success",
}) {
  if (!isAnalyticsEnabled()) return false;
  await appendSheetRow("GENERATIONS", [
    getKyivTimestamp(),
    String(userId || ""),
    type || "",
    styleId || "",
    generationId || "",
    status || "",
  ]);
  return true;
}

function queueLogEvent(payload) {
  runAnalyticsTask(() => logEvent(payload), `ANALYTICS_EVENT_${payload?.event || "unknown"}`);
}

function queueAnalyticsEvent(ctx, event, value = 0, extra = {}) {
  queueLogEvent({
    user_id: ctx?.from?.id || extra.userId || "",
    event,
    value,
    style_id: extra.style_id || extra.style || "",
    generation_id: extra.generation_id || extra.generationId || "",
    extra,
  });
}

function queueAnalyticsGeneration(payload) {
  runAnalyticsTask(() => trackAnalyticsGeneration(payload), `ANALYTICS_GENERATION_${payload?.generationId || "unknown"}`);
}

function hasLoggedPaymentAnalytics(paymentRecord, marker) {
  if (!paymentRecord) return false;
  if (!Array.isArray(paymentRecord.analyticsLoggedStatuses)) paymentRecord.analyticsLoggedStatuses = [];
  return paymentRecord.analyticsLoggedStatuses.includes(marker);
}

function markLoggedPaymentAnalytics(paymentRecord, marker) {
  if (!paymentRecord) return false;
  if (!Array.isArray(paymentRecord.analyticsLoggedStatuses)) paymentRecord.analyticsLoggedStatuses = [];
  if (!paymentRecord.analyticsLoggedStatuses.includes(marker)) paymentRecord.analyticsLoggedStatuses.push(marker);
  return true;
}

async function trackAnalyticsPayment({ userId, amount, promtiAdded = 0, status, currency = ANALYTICS_CURRENCY }) {
  if (!isAnalyticsEnabled()) return false;
  await appendSheetRow("PAYMENTS", [
    getKyivTimestamp(),
    String(userId || ""),
    Number(amount || 0),
    currency || ANALYTICS_CURRENCY,
    Number(promtiAdded || 0),
    status || "",
  ]);
  return true;
}

function formatTopList(entries, fallback = "—") {
  if (!entries.length) return fallback;
  return entries
    .map(([label, value], index) => `${index + 1}. ${label} — ${value}`)
    .join("\n");
}

function requireAdminAnalytics(ctx) {
  if (isAdmin(ctx.from.id)) return true;
  ctx.reply("⛔ Access denied").catch(() => {});
  return false;
}

async function loadAnalyticsSnapshot() {
  const [userRows, eventRows, paymentRows, generationRows] = await Promise.all([
    getSheetRows("USERS"),
    getSheetRows("EVENTS"),
    getSheetRows("PAYMENTS"),
    getSheetRows("GENERATIONS"),
  ]);

  const users = userRows.slice(1).map((row) => ({
    user_id: row[0] || "",
    first_seen: row[1] || "",
    last_seen: row[2] || "",
    source: row[3] || "",
    total_generations: Number(row[4] || 0),
    total_spent: Number(row[5] || 0),
  }));

  const events = eventRows.slice(1).map((row) => ({
    timestamp: row[0] || "",
    user_id: row[1] || "",
    event: row[2] || "",
    value: Number(row[3] || 0),
    style_id: row[4] || "",
    generation_id: row[5] || "",
    extra: row[6] || "",
    extraMap: parseAnalyticsExtra(row[6] || ""),
  }));

  const payments = paymentRows.slice(1).map((row) => ({
    timestamp: row[0] || "",
    user_id: row[1] || "",
    amount: Number(row[2] || 0),
    currency: row[3] || ANALYTICS_CURRENCY,
    promti_added: Number(row[4] || 0),
    status: row[5] || "",
  }));

  const generations = generationRows.slice(1).map((row) => ({
    timestamp: row[0] || "",
    user_id: row[1] || "",
    type: row[2] || "",
    style_id: row[3] || "",
    generation_id: row[4] || "",
    status: row[5] || "",
  }));

  return { users, events, payments, generations };
}

// ─── ДАНІ ─────────────────────────────────────────────────────────────────────
const DEFAULT_PROMPTS = sanitizeTextTree({
  portrait: "ultra realistic portrait, studio lighting, preserve face, do not change identity",
  beauty:   "beauty editorial, glossy skin, preserve face, do not change identity",
  fashion:  "high fashion photoshoot, preserve face, do not change identity",
  art:      "digital art, artistic portrait, preserve face, do not change identity",
  trend:    "viral instagram aesthetic, preserve face, do not change identity",
  seedance: "cinematic motion, smooth animation, realistic movement",
  kling:    "cinematic video, fluid motion, high quality animation",
});

const DEFAULT_BUTTON_LABELS = sanitizeTextTree({
  main_photo: "🖼 Фото",
  main_video: "🎬 Відео",
  main_ai_studio: "🧠 AI Studio",
  main_infographics: "🧾 Інфографіки",
  main_buy_promti: "✨ Купити Promti ✨",
  main_balance: "📊 Баланс",
  main_prices: "💰 Ціни",
  main_ideas: "💡 Ідея для промтів",
  main_referral: "👫 Запросити друга",
  main_info: "ℹ️ Інформація",
  main_help: "❓ Допомога",
  main_support: "🆘 Підтримка",
  ai_studio_trends: "🔥 Тренди ChatGPT",
  ai_studio_library: "📚 Бібліотека стилів",
  photo_edit: "🖼 Редагувати фото",
  photo_create: "✨ Створити фото",
  photo_ai_prompt: "🤖 AI промт для фото",
  photo_saved_prompts: "⭐ Мої промти",
  video_seedance: "🎬 Seedance",
  video_kling: "🎥 Kling",
  video_ai_prompt: "🤖 AI промт для відео",
  video_saved_prompts: "⭐ Мої промти",
  infographic_png: "🧾 Інфографіка PNG",
  infographic_svg: "🔷 SVG логотип",
  back: "↩️ Назад",
  back_photo: "↩️ Назад до фото",
  back_video: "↩️ Назад до відео",
});

const DEFAULT_BUTTON_HINTS = sanitizeTextTree({
  main_photo:
    "🖼 Меню фото\n\n" +
    "Обери режим:\n" +
    "🖼 Редагувати фото — надішли своє фото + промт, змінимо стиль\n" +
    "✨ Створити фото — напиши ідею, створю фото з нуля\n" +
    "🤖 AI промт — підкажу промт на основі твого фото\n\n" +
    "💡 Ідеї: t.me/promteamai",
  main_video:
    "🎬 Меню відео\n\n" +
    "🎬 Seedance — реалістична анімація фото\n" +
    "🎥 Kling — більш кінематографічний результат\n\n" +
    "💡 Ідеї: t.me/promteamai",
  main_ai_studio:
    "🧠 AI Studio\n\n" +
    "Тут зібрані готові ідеї для генерацій:\n" +
    "🔥 Тренди ChatGPT — вірусні формати та ідеї\n" +
    "📚 Бібліотека стилів — готові фото-стилі для селфі та портретів",
  main_infographics:
    "🧾 Інфографіки\n\n" +
    "Обери, що хочеш створити:\n" +
    "🧾 Інфографіка PNG — готовий візуал для поста, реклами або каруселі\n" +
    "🔷 SVG логотип — чистий масштабований логотип у SVG",
  photo_edit:
    "✏️ Режим редагування фото\n\n" +
    "Напиши, як хочеш змінити фото, потім надішли селфі.\n" +
    "Приклад: beauty editorial, glossy skin",
  photo_create:
    "✨ Режим створення фото\n\n" +
    "Напиши, що хочеш згенерувати — я створю зображення з нуля.\n" +
    "Приклад: portrait of woman in Renaissance style, cinematic lighting",
  photo_ai_prompt:
    "🤖 AI промт для фото\n\n" +
    "Надішли фото, і я підготую короткий промт для генерації.",
  video_seedance:
    "🎬 Seedance\n\n" +
    "Ця модель добре підходить для природного руху, волосся, погляду та міміки.",
  video_kling:
    "🎥 Kling\n\n" +
    "Ця модель краще підходить для кінематографічної анімації та драматичнішого руху.",
  video_ai_prompt:
    "🤖 AI промт для відео\n\n" +
    "Надішли фото або коротке відео, і я підготую короткий промт для анімації.",
  infographic_png:
    "🧾 Інфографіка PNG\n\n" +
    "Надішли текстовий опис або фото з підписом. Я зберу з цього готову інфографіку.",
  infographic_svg:
    "🔷 SVG логотип\n\n" +
    "Напиши короткий бриф: назва бренду, сфера, стиль, кольори, символи. Я поверну чистий SVG-файл.",
});

const DEFAULT_CONTENT = sanitizeTextTree({
  welcomeText:  "Привіт ✨\n\nОбери що хочеш зробити:\n🖼 Фото — генерація фото по стилях\n🎬 Відео — анімація фото у відео\n\n🎁 3 Promti ✨ безкоштовно при старті",
  infoText:     "PROMTI AI Bot\n\n🖼 Фото:\n10/99грн · 20/179грн · 30/249грн · 50/399грн\n\n🎬 Seedance:\n3/199грн · 5/349грн · 10/599грн\n\n🎥 Kling:\n3/299грн · 5/499грн · 10/899грн",
  helpText:     "Допомога:\n\n🖼 Фото:\n1. Натисни 🖼 Фото\n2. Обери стиль\n3. Надішли фото\n\n🎬 Відео:\n1. Натисни 🎬 Відео\n2. Обери модель\n3. Надішли фото для анімації",
  supportText:  "Напиши в підтримку: https://t.me/promteamai?direct",
  ideaText:     "💡 Ідеї для промтів:\n\n🖼 Фото:\n• \"portrait in Renaissance style\"\n• \"cyberpunk neon portrait\"\n\n🎬 Відео:\n• \"hair gently flowing in wind\"\n• \"eyes slowly opening, cinematic\"",
  support_link: "https://t.me/promteamai?direct",
  pricesText:   "💰 PROMTI AI — Ціни\n\n💎 Валюта: Promti ✨\n1 Promti ✨ = від 6.7 до 9.9 грн\n\n📦 Пакети:\n10 Promti ✨ — 99 грн (9.9 грн/✨)\n30 Promti ✨ — 249 грн (8.3 грн/✨)\n60 Promti ✨ — 449 грн (7.5 грн/✨)\n150 Promti ✨ — 999 грн (6.7 грн/✨) 🔥\n\n💰 Ціни послуг:\n🖼 Фото — 1 Promti ✨\n🎬 Seedance відео — 5 Promti ✨\n🎥 Kling відео — 8 Promti ✨\n\n🎁 3 Promti ✨ безкоштовно при реєстрації!\n👫 +5 Promti ✨ за кожного друга який оплатить",
  buttonLabels: DEFAULT_BUTTON_LABELS,
  buttonHints: DEFAULT_BUTTON_HINTS,
  promptLibrary: {},
  promptCategories: {},
  chatgptTrendLibrary: {},
});

const DEFAULT_DYNAMIC_PROMPTS = sanitizeTextTree(readRepoJsonDefault(DYNAMIC_PROMPTS_DEFAULT_PATH, { templates: [] }));
const DEFAULT_VIDEO_PRESETS = sanitizeTextTree({
  seedance: {
    id: "seedance",
    title: "Seedance",
    description: "Базовий preset для Seedance відео",
    provider: "fal",
    model: "bytedance/seedance-2.0/fast",
    type: "video",
    price: 5,
    promptTemplate: "cinematic motion, smooth animation, realistic movement",
    previewVideo: null,
    exampleVideos: [],
    isActive: true,
    stats: {},
  },
  kling: {
    id: "kling",
    title: "Kling",
    description: "Базовий preset для Kling відео",
    provider: "fal",
    model: "fal-ai/kling-video/v3/pro",
    type: "video",
    price: 8,
    promptTemplate: "cinematic video, fluid motion, high quality animation",
    previewVideo: null,
    exampleVideos: [],
    isActive: true,
    stats: {},
  },
});
const DEFAULT_OPENAI_TOOLS = sanitizeTextTree({
  infographic_default: {
    id: "infographic_default",
    title: "Default Infographic",
    description: "Базовий preset для інфографік",
    type: "infographic",
    provider: "openai",
    model: "gpt-image-1",
    systemPrompt: "Create a clean modern infographic PNG with premium editorial layout.",
    userPromptTemplate: "{{input}}",
    inputType: "mixed",
    outputType: "infographic",
    price: 2,
    isActive: true,
    examples: [],
    stats: {},
  },
  svg_default: {
    id: "svg_default",
    title: "Default SVG",
    description: "Базовий preset для SVG логотипів",
    type: "svg",
    provider: "openai",
    model: "gpt-4.1-mini",
    systemPrompt: "Return only valid SVG markup. No markdown. No explanation.",
    userPromptTemplate: "{{input}}",
    inputType: "text",
    outputType: "svg",
    price: 3,
    isActive: true,
    examples: [],
    stats: {},
  },
});

function getTextRepairTargets() {
  return [
    {
      filePath: CONTENT_PATH,
      label: "content.json",
      defaultValue: readRepoJsonDefault(path.join(__dirname, "content.json"), DEFAULT_CONTENT),
    },
    {
      filePath: SETTINGS_PATH,
      label: "settings.json",
      defaultValue: readRepoJsonDefault(path.join(__dirname, "settings.json"), DEFAULT_SETTINGS),
    },
    {
      filePath: PROMPTS_PATH,
      label: "prompts.json",
      defaultValue: readRepoJsonDefault(path.join(__dirname, "prompts.json"), DEFAULT_PROMPTS),
    },
    {
      filePath: LANDING_CONTENT_PATH,
      label: "landing-content.json",
      defaultValue: readRepoJsonDefault(LANDING_CONTENT_DEFAULT_PATH, DEFAULT_LANDING_CONTENT),
    },
    {
      filePath: DYNAMIC_PROMPTS_PATH,
      label: "dynamic-prompts.json",
      defaultValue: DEFAULT_DYNAMIC_PROMPTS,
    },
    {
      filePath: VIDEO_PRESETS_PATH,
      label: "video-presets.json",
      defaultValue: DEFAULT_VIDEO_PRESETS,
    },
    {
      filePath: OPENAI_TOOLS_PATH,
      label: "openai-tools.json",
      defaultValue: DEFAULT_OPENAI_TOOLS,
    },
  ];
}

function runEncodingRepair({ reset = false } = {}) {
  return getTextRepairTargets().map((target) =>
    reset
      ? resetTextStorageFile(target.filePath, target.defaultValue, target.label)
      : repairTextStorageFile(target.filePath, target.defaultValue, target.label)
  );
}

runEncodingRepair();

let users    = loadJson(USERS_PATH,    {});
let prompts  = loadJson(PROMPTS_PATH,  DEFAULT_PROMPTS);
let content  = loadJson(CONTENT_PATH,  DEFAULT_CONTENT);
let payments = loadJson(PAYMENTS_PATH, []);
let aiPromptCache = loadJson(AI_PROMPT_CACHE_PATH, {});
let tempJobs = loadJson(TEMP_JOBS_PATH, []);
let failedCommands = loadJson(FAILED_COMMANDS_PATH, []);
let dynamicStyleLibrary = loadJson(DYNAMIC_PROMPTS_PATH, DEFAULT_DYNAMIC_PROMPTS);
let videoPresets = loadJson(VIDEO_PRESETS_PATH, DEFAULT_VIDEO_PRESETS);
let openAiTools = loadJson(OPENAI_TOOLS_PATH, DEFAULT_OPENAI_TOOLS);

prompts = sanitizeTextTree({ ...DEFAULT_PROMPTS, ...prompts });
content = sanitizeTextTree({ ...DEFAULT_CONTENT, ...content });
content.buttonLabels = {
  ...DEFAULT_BUTTON_LABELS,
  ...(content.buttonLabels && typeof content.buttonLabels === "object" && !Array.isArray(content.buttonLabels) ? content.buttonLabels : {}),
};
content.buttonHints = {
  ...DEFAULT_BUTTON_HINTS,
  ...(content.buttonHints && typeof content.buttonHints === "object" && !Array.isArray(content.buttonHints) ? content.buttonHints : {}),
};
if (!content.promptLibrary || typeof content.promptLibrary !== "object" || Array.isArray(content.promptLibrary)) content.promptLibrary = {};
if (!content.promptCategories || typeof content.promptCategories !== "object" || Array.isArray(content.promptCategories)) content.promptCategories = {};
if (!content.chatgptTrendLibrary || typeof content.chatgptTrendLibrary !== "object" || Array.isArray(content.chatgptTrendLibrary)) content.chatgptTrendLibrary = {};
if (typeof content.welcomeText === "string") {
  content.welcomeText = content.welcomeText
    .replaceAll("1 фото безкоштовно", "3 Promti ✨ безкоштовно")
    .replaceAll("1 Promti ✨ безкоштовно при старті", "3 Promti ✨ безкоштовно при старті");
}
if (typeof content.pricesText === "string") {
  content.pricesText = content.pricesText.replaceAll("1 Promti ✨ безкоштовно при реєстрації", "3 Promti ✨ безкоштовно при реєстрації");
}
saveJson(PROMPTS_PATH, prompts);
saveJson(CONTENT_PATH, content);
dynamicStyleLibrary = normalizeDynamicPromptsStore(dynamicStyleLibrary);
videoPresets = ensureVideoPresets();
openAiTools = ensureOpenAiTools();
saveJson(DYNAMIC_PROMPTS_PATH, dynamicStyleLibrary);
saveJson(VIDEO_PRESETS_PATH, videoPresets);
saveJson(OPENAI_TOOLS_PATH, openAiTools);

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
  ctx.session.awaitingPromptExamplesKey = null;
  ctx.session.awaitingChatgptPreviewKey = null;
  ctx.session.selectedPromptExampleIndex = null;
  ctx.session.currentPromptKey      = null;
  ctx.session.sourcePromptKey       = null;
  ctx.session.currentDynamicSeriesId = null;
  ctx.session.currentDynamicVariantId = null;
  ctx.session.sourceDynamicSeriesId = null;
  ctx.session.sourceDynamicVariantId = null;
  ctx.session.chatgptTrendKey       = null;
  ctx.session.infographicMode       = null;
  ctx.session.awaitingInfographicInput = false;
  ctx.session.lastStateAt           = null;
}

function getUser(id) {
  if (!users[id]) {
    users[id] = {
      id,
      promti: START_PROMTI_BONUS,
      purchasedPromti: 0,
      generations: 0, seedanceGenerations: 0, klingGenerations: 0,
      totalSpent: 0, username: "", firstName: "",
      referredBy: null, referralCount: 0, banned: false,
      dailyVideoDate: null, dailySeedanceCount: 0, dailyKlingCount: 0,
      dailyAiDate: null, dailyAiCount: 0,
      lastPaymentRequest: null, pendingOrderReference: null, lastPaidAt: null,
      sourcePromptKey: null,
      sourceDynamicSeriesId: null,
      sourceDynamicVariantId: null,
      lastGeneratedPromptKey: null,
      lastGeneratedStyleRef: null,
      pendingPurchasePromptKey: null,
      pendingPurchaseStyleRef: null,
      lastPurchaseAttributedOrderReference: null,
      savedPrompts: [],
      createdAt: new Date().toISOString(),
    };
    saveJson(USERS_PATH, users);
  }
  if (users[id].videoGenerations !== undefined && users[id].seedanceGenerations === undefined) {
    users[id].seedanceGenerations = users[id].videoGenerations || 0;
    users[id].klingGenerations    = 0;
    delete users[id].videoGenerations;
  }
  if (!Array.isArray(users[id].savedPrompts)) users[id].savedPrompts = [];
  if (users[id].sourceDynamicSeriesId === undefined) users[id].sourceDynamicSeriesId = null;
  if (users[id].sourceDynamicVariantId === undefined) users[id].sourceDynamicVariantId = null;
  if (users[id].lastGeneratedStyleRef === undefined) users[id].lastGeneratedStyleRef = null;
  if (users[id].pendingPurchaseStyleRef === undefined) users[id].pendingPurchaseStyleRef = null;
  return users[id];
}

function buildSavedPromptId() {
  return `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveUserPrompt(user, { promptText, mode, title = "" }) {
  if (!promptText) return null;
  const item = {
    id: buildSavedPromptId(),
    title: title || `My ${mode === "video" ? "video" : "photo"} prompt`,
    promptText,
    mode: mode === "video" ? "video" : "photo",
    createdAt: Date.now(),
    lastUsedAt: 0,
  };
  user.savedPrompts = Array.isArray(user.savedPrompts) ? user.savedPrompts : [];
  user.savedPrompts.unshift(item);
  user.savedPrompts = user.savedPrompts.slice(0, 50);
  saveUsersSync();
  return item;
}

function getSavedPrompt(user, promptId) {
  return (Array.isArray(user.savedPrompts) ? user.savedPrompts : []).find((item) => item.id === promptId) || null;
}

function buildSavedPromptsKeyboard(user, mode = null) {
  const promptsList = (Array.isArray(user.savedPrompts) ? user.savedPrompts : []).filter((item) => !mode || item.mode === mode);
  if (!promptsList.length) return null;
  return Markup.inlineKeyboard([
    ...promptsList.slice(0, 20).map((item) => ([
      Markup.button.callback(`✅ ${item.title}`, `savedprompt_use_${item.id}`),
      Markup.button.callback("🗑", `savedprompt_delete_${item.id}`),
    ])),
    [Markup.button.callback("↩️ Назад", "savedprompt_back")],
  ]);
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
  queueAnalyticsUserTouch(ctx, user);
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
function saveAiPromptCacheSync() { saveJson(AI_PROMPT_CACHE_PATH, aiPromptCache); }
function saveTempJobsSync() { saveJson(TEMP_JOBS_PATH, tempJobs); }
function saveFailedCommandsSync() { saveJson(FAILED_COMMANDS_PATH, failedCommands); }

function getUserVideoTotal(user) { return (user.seedanceGenerations || 0) + (user.klingGenerations || 0); }
function isPaymentCreditedStatus(status) { return String(status || "").toLowerCase() === "credited"; }

function truncateForLog(value, maxLength = 240) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function logFailedCommand({ userId, type, error, context = {} }) {
  const cfg = loadSettings();
  const entry = {
    userId: Number(userId || 0) || null,
    type: String(type || "unknown"),
    error: truncateForLog(error?.message || error || "Unknown error", 300),
    context: truncateForLog(context, 400),
    createdAt: Date.now(),
  };
  failedCommands = Array.isArray(failedCommands) ? failedCommands : [];
  failedCommands.push(entry);
  failedCommands = failedCommands.slice(-500);
  saveFailedCommandsSync();
  return entry;
}

function touchSessionState(ctx) {
  ensureSession(ctx);
  ctx.session.lastStateAt = Date.now();
}

function cleanupSessionsStorage(ttlMs) {
  try {
    const raw = loadJson(path.join(DATA_DIR, "sessions.json"), {});
    const cleanupKeys = [
      "mode",
      "style",
      "photoMode",
      "videoInputMode",
      "awaitingCustomPrompt",
      "customPrompt",
      "awaitingAiPrompt",
      "awaitingPromptEditKey",
      "awaitingTextEditKey",
      "awaitingPromptPreviewKey",
      "awaitingPromptExamplesKey",
      "selectedPromptExampleIndex",
      "currentPromptKey",
      "sourcePromptKey",
      "currentDynamicSeriesId",
      "currentDynamicVariantId",
      "sourceDynamicSeriesId",
      "sourceDynamicVariantId",
      "infographicMode",
      "awaitingInfographicInput",
      "chatgptTrendKey",
      "awaitingChatgptPreviewKey",
    ];
    const stores = [];
    if (raw && typeof raw === "object") {
      if (raw.sessions && typeof raw.sessions === "object") stores.push(raw.sessions);
      stores.push(raw);
    }
    let changed = false;
    for (const store of stores) {
      for (const [sessionKey, sessionValue] of Object.entries(store)) {
        if (!sessionValue || typeof sessionValue !== "object" || Array.isArray(sessionValue)) continue;
        const lastStateAt = Number(sessionValue.lastStateAt || 0);
        if (!lastStateAt || Date.now() - lastStateAt <= ttlMs) continue;
        for (const key of cleanupKeys) {
          if (key in sessionValue) {
            delete sessionValue[key];
            changed = true;
          }
        }
        if ("lastStateAt" in sessionValue) {
          delete sessionValue.lastStateAt;
          changed = true;
        }
        store[sessionKey] = sessionValue;
      }
    }
    if (changed) saveJson(path.join(DATA_DIR, "sessions.json"), raw);
  } catch (e) {
    console.error("SESSION CLEANUP ERROR:", e.message);
  }
}

function cleanupOldData() {
  const cfg = loadSettings();
  const now = Date.now();
  let cleaned = {
    aiPromptCache: 0,
    failedCommands: 0,
    tempJobs: 0,
    tempFiles: 0,
  };

  try {
    const cacheTtl = Number(cfg.aiPromptCacheTtlMs || 86400000);
    let changed = false;
    for (const [key, value] of Object.entries(aiPromptCache || {})) {
      if (!value || now - Number(value.createdAt || 0) > cacheTtl) {
        delete aiPromptCache[key];
        cleaned.aiPromptCache += 1;
        changed = true;
      }
    }
    if (changed) saveAiPromptCacheSync();
  } catch (e) {
    console.error("AI PROMPT CACHE CLEANUP ERROR:", e.message);
  }

  try {
    const failedTtl = Number(cfg.failedCommandsTtlMs || 604800000);
    const prevCount = Array.isArray(failedCommands) ? failedCommands.length : 0;
    failedCommands = (Array.isArray(failedCommands) ? failedCommands : []).filter((item) => now - Number(item?.createdAt || 0) <= failedTtl);
    cleaned.failedCommands = prevCount - failedCommands.length;
    if (cleaned.failedCommands > 0) saveFailedCommandsSync();
  } catch (e) {
    console.error("FAILED COMMANDS CLEANUP ERROR:", e.message);
  }

  try {
    const tempJobsTtl = Number(cfg.tempJobsTtlMs || 86400000);
    const prevCount = Array.isArray(tempJobs) ? tempJobs.length : 0;
    tempJobs = (Array.isArray(tempJobs) ? tempJobs : []).filter((item) => now - Number(item?.createdAt || 0) <= tempJobsTtl);
    cleaned.tempJobs = prevCount - tempJobs.length;
    if (cleaned.tempJobs > 0) saveTempJobsSync();
  } catch (e) {
    console.error("TEMP JOBS CLEANUP ERROR:", e.message);
  }

  try {
    const tmpDir = "/tmp";
    if (fs.existsSync(tmpDir)) {
      const cutoff = now - 24 * 60 * 60 * 1000;
      for (const fileName of fs.readdirSync(tmpDir)) {
        if (!fileName.startsWith("promti_")) continue;
        const fullPath = path.join(tmpDir, fileName);
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          cleaned.tempFiles += 1;
        }
      }
    }
  } catch (e) {
    console.error("TMP FILES CLEANUP ERROR:", e.message);
  }

  cleanupSessionsStorage(Number(cfg.sessionCleanupTtlMs || 86400000));
  return cleaned;
}

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

function buildSafeEntityId(preferredValue, fallbackPrefix = "item") {
  const normalized = normalizePromptKey(preferredValue);
  return normalized || `${fallbackPrefix}_${Date.now()}`;
}

function toAbsolutePublicUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${getAdminPanelBaseUrl()}${raw}`;
  return raw;
}

function toTelegramMediaRef(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) return toAbsolutePublicUrl(raw);
  return raw;
}

function normalizePromptLibraryItem(item = {}, key = "") {
  const examplePhotos = Array.isArray(item.examplePhotos)
    ? item.examplePhotos.filter(Boolean).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS)
    : [];
  const exampleLabels = Array.isArray(item.exampleLabels)
    ? item.exampleLabels
        .map((label) => String(label || "").trim())
        .slice(0, MAX_PROMPT_EXAMPLE_PHOTOS)
    : [];
  return {
    id: item.id || key,
    key: item.key || key,
    title: item.title || key,
    description: item.description || "",
    prompt: item.prompt || "",
    category: item.category || "other",
    previewPhoto: item.previewPhoto || null,
    examplePhotos,
    exampleLabels,
    provider: item.provider || "fal",
    model: item.model || loadSettings().defaultImageModel || "fal-ai/nano-banana-2",
    promptModel: item.promptModel || loadSettings().defaultPromptModel || "gpt-4.1-mini",
    type: item.type || "image_edit",
    pricePromti: Number(item.pricePromti || 1),
    isActive: item.isActive !== false,
    cacheEnabled: item.cacheEnabled !== false,
    fallbackProvider: item.fallbackProvider || "fal",
    fallbackModel: item.fallbackModel || loadSettings().defaultImageModel || "fal-ai/nano-banana-2",
    isTrending: Boolean(item.isTrending),
    sortOrder: Number(item.sortOrder || 0),
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

function getPromptExamplePhotos(style) {
  return Array.isArray(style?.examplePhotos)
    ? style.examplePhotos.filter(Boolean).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS)
    : [];
}

function getPromptExampleEntries(style) {
  const photos = getPromptExamplePhotos(style);
  const labels = Array.isArray(style?.exampleLabels) ? style.exampleLabels : [];
  return photos.map((photo, index) => ({
    index,
    photo,
    label: String(labels[index] || `Ракурс ${index + 1}`).trim(),
  }));
}

function getSortedPromptStyles() {
  return Object.values(ensurePromptLibrary())
    .map(item => normalizePromptLibraryItem(item, item.key))
    .sort((a, b) =>
      Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
      Number(b.isTrending) - Number(a.isTrending) ||
      Number(b.clicks || 0) - Number(a.clicks || 0) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

function normalizeDynamicVariant(seriesId, variant = {}, index = 0) {
  return {
    id: normalizePromptKey(variant.id || `${seriesId}_variant_${index + 1}`),
    title: variant.title || `Variant ${index + 1}`,
    subtitle: variant.subtitle || "",
    variantPrompt: variant.variantPrompt || variant.prompt || "",
    previewImage: variant.previewImage || null,
    exampleImages: Array.isArray(variant.exampleImages) ? variant.exampleImages.filter(Boolean).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS) : [],
    isActive: variant.isActive !== false,
    stats: typeof variant.stats === "object" && variant.stats ? variant.stats : { clicks: 0, generations: 0, purchases: 0 },
  };
}

function normalizeDynamicStyleSeries(item = {}, key = "") {
  const seriesId = normalizePromptKey(item.id || key);
  return {
    id: seriesId,
    title: item.title || key,
    description: item.description || "",
    type: "dynamic",
    provider: item.provider || "fal",
    model: item.model || loadSettings().defaultImageModel || "fal-ai/nano-banana-2",
    price: Number(item.price || item.pricePromti || 1),
    isActive: item.isActive !== false,
    isTrending: Boolean(item.isTrending),
    previewImage: item.previewImage || null,
    exampleImages: Array.isArray(item.exampleImages) ? item.exampleImages.filter(Boolean).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS) : [],
    templatePrompt: item.templatePrompt || item.template || "",
    variants: Array.isArray(item.variants) ? item.variants.map((variant, index) => normalizeDynamicVariant(seriesId, variant, index)) : [],
    stats: typeof item.stats === "object" && item.stats ? item.stats : { clicks: 0, generations: 0, purchases: 0 },
    createdAt: Number(item.createdAt || Date.now()),
  };
}

function normalizeDynamicPromptsStore(store = {}) {
  if (Array.isArray(store?.templates)) {
    const mapped = {};
    for (const template of store.templates) {
      const seriesId = normalizePromptKey(template.id || template.key || template.title || `series_${Object.keys(mapped).length + 1}`);
      const variants = Object.entries(template.options || {}).map(([variantId, option], index) => ({
        id: normalizePromptKey(variantId),
        title: option.label || variantId,
        subtitle: option.subtitle || "",
        variantPrompt: Object.entries(option || {})
          .filter(([field]) => !["label", "subtitle", "previewImage", "exampleImages", "isActive", "stats"].includes(field))
          .map(([field, value]) => `${field}: ${value}`)
          .join("\n"),
        previewImage: option.previewImage || null,
        exampleImages: option.exampleImages || [],
        isActive: option.isActive !== false,
        stats: option.stats || { clicks: 0, generations: 0, purchases: 0 },
      }));
      mapped[seriesId] = normalizeDynamicStyleSeries({
        id: seriesId,
        title: template.title || seriesId,
        description: template.selectorLabel || "",
        provider: template.provider || "fal",
        model: template.model || loadSettings().defaultImageModel || "fal-ai/nano-banana-2",
        price: Number(template.price || template.pricePromti || 1),
        isActive: template.enabled !== false,
        isTrending: Boolean(template.isTrending),
        previewImage: template.previewImage || null,
        exampleImages: template.exampleImages || [],
        templatePrompt: template.template || "",
        variants,
        stats: template.stats || { clicks: 0, generations: 0, purchases: 0 },
      }, seriesId);
    }
    return mapped;
  }

  const result = {};
  for (const [key, item] of Object.entries(store || {})) {
    const normalized = normalizeDynamicStyleSeries(item, key);
    result[normalized.id] = normalized;
  }
  return result;
}

function saveDynamicStyles() {
  backupJsonFile(DYNAMIC_PROMPTS_PATH, "dynamic-prompts");
  dynamicStyleLibrary = normalizeDynamicPromptsStore(dynamicStyleLibrary);
  saveJson(DYNAMIC_PROMPTS_PATH, dynamicStyleLibrary);
}

function ensureDynamicStyleLibrary() {
  dynamicStyleLibrary = normalizeDynamicPromptsStore(dynamicStyleLibrary);
  return dynamicStyleLibrary;
}

function getDynamicSeries(seriesId) {
  const library = ensureDynamicStyleLibrary();
  const key = normalizePromptKey(seriesId);
  return key && library[key] ? normalizeDynamicStyleSeries(library[key], key) : null;
}

function getDynamicVariant(seriesId, variantId) {
  const series = getDynamicSeries(seriesId);
  if (!series) return null;
  return series.variants.find((variant) => variant.id === normalizePromptKey(variantId)) || null;
}

function resolveDynamicDeepLink(targetId) {
  const key = normalizePromptKey(targetId);
  const library = ensureDynamicStyleLibrary();
  if (library[key]) return { series: library[key], variant: null };
  for (const series of Object.values(library)) {
    const variant = (series.variants || []).find((item) => item.id === key);
    if (variant) return { series, variant };
  }
  return null;
}

function buildDynamicStylePrompt(series, variant) {
  const baseTemplate = String(series?.templatePrompt || "");
  const variantPrompt = String(variant?.variantPrompt || "");
  const combined = baseTemplate.replace(/\{\{\s*variantPrompt\s*\}\}/gi, variantPrompt);
  return combined.includes("{{variantPrompt}}") ? combined : `${combined}\n\n${variantPrompt}`.trim();
}

function incrementDynamicMetric(seriesId, metric, variantId = null, amount = 1) {
  const series = getDynamicSeries(seriesId);
  if (!series) return false;
  series.stats = typeof series.stats === "object" && series.stats ? series.stats : { clicks: 0, generations: 0, purchases: 0 };
  series.stats[metric] = Number(series.stats[metric] || 0) + amount;
  if (variantId) {
    const variant = series.variants.find((item) => item.id === normalizePromptKey(variantId));
    if (!variant) return false;
    variant.stats = typeof variant.stats === "object" && variant.stats ? variant.stats : { clicks: 0, generations: 0, purchases: 0 };
    variant.stats[metric] = Number(variant.stats[metric] || 0) + amount;
  }
  dynamicStyleLibrary[series.id] = series;
  saveDynamicStyles();
  return true;
}

function normalizeVideoPreset(item = {}, key = "") {
  return {
    id: normalizePromptKey(item.id || key),
    title: item.title || key,
    description: item.description || "",
    provider: item.provider || "fal",
    model: item.model || "",
    type: "video",
    price: Number(item.price || 0),
    promptTemplate: item.promptTemplate || "",
    previewVideo: item.previewVideo || null,
    exampleVideos: Array.isArray(item.exampleVideos) ? item.exampleVideos.filter(Boolean).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS) : [],
    isActive: item.isActive !== false,
    stats: typeof item.stats === "object" && item.stats ? item.stats : { clicks: 0, generations: 0, purchases: 0 },
  };
}

function ensureVideoPresets() {
  const result = {};
  for (const [key, item] of Object.entries(videoPresets || {})) {
    const normalized = normalizeVideoPreset(item, key);
    result[normalized.id] = normalized;
  }
  videoPresets = result;
  return videoPresets;
}

function saveVideoPresets() {
  backupJsonFile(VIDEO_PRESETS_PATH, "video-presets");
  ensureVideoPresets();
  saveJson(VIDEO_PRESETS_PATH, videoPresets);
}

function normalizeOpenAiTool(item = {}, key = "") {
  return {
    id: normalizePromptKey(item.id || key),
    title: item.title || key,
    description: item.description || "",
    type: item.type === "svg" ? "svg" : "infographic",
    provider: "openai",
    model: item.model || (item.type === "svg" ? loadSettings().defaultSvgModel : loadSettings().defaultInfographicImageModel),
    systemPrompt: item.systemPrompt || "",
    userPromptTemplate: item.userPromptTemplate || "{{input}}",
    inputType: item.inputType || "mixed",
    outputType: item.outputType || item.type || "infographic",
    price: Number(item.price || 0),
    isActive: item.isActive !== false,
    examples: Array.isArray(item.examples) ? item.examples.filter(Boolean).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS) : [],
    stats: typeof item.stats === "object" && item.stats ? item.stats : { clicks: 0, uses: 0, purchases: 0 },
  };
}

function ensureOpenAiTools() {
  const result = {};
  for (const [key, item] of Object.entries(openAiTools || {})) {
    const normalized = normalizeOpenAiTool(item, key);
    result[normalized.id] = normalized;
  }
  openAiTools = result;
  return openAiTools;
}

function saveOpenAiTools() {
  backupJsonFile(OPENAI_TOOLS_PATH, "openai-tools");
  ensureOpenAiTools();
  saveJson(OPENAI_TOOLS_PATH, openAiTools);
}

function getActiveOpenAiTool(type) {
  return Object.values(ensureOpenAiTools()).find((item) => item.type === type && item.isActive !== false) || null;
}

function normalizeChatgptTrendItem(item = {}, key = "") {
  const cfg = loadSettings();
  return {
    key: item.key || key,
    title: item.title || key,
    category: item.category || "analysis",
    model: item.model || cfg.defaultPromptModel || "gpt-4.1-mini",
    type: item.type || "chatgpt_prompt",
    promptText: item.promptText || "",
    inputType: item.inputType || "photo_or_text",
    resultType: item.resultType || "analysis",
    previewPhoto: item.previewPhoto || null,
    threadPostText: item.threadPostText || "",
    threadCommentText: item.threadCommentText || "",
    pricePromti: Number(item.pricePromti || cfg.chatgptTrendPricePromti || 1),
    isActive: item.isActive !== false,
    isTrending: Boolean(item.isTrending),
    clicks: Number(item.clicks || 0),
    uses: Number(item.uses || 0),
    createdAt: Number(item.createdAt || Date.now()),
  };
}

function ensureChatgptTrendLibrary() {
  if (!content.chatgptTrendLibrary || typeof content.chatgptTrendLibrary !== "object" || Array.isArray(content.chatgptTrendLibrary)) {
    content.chatgptTrendLibrary = {};
  }
  let changed = false;
  for (const [key, item] of Object.entries(content.chatgptTrendLibrary)) {
    const normalized = normalizeChatgptTrendItem(item, key);
    if (JSON.stringify(normalized) !== JSON.stringify(item)) {
      content.chatgptTrendLibrary[key] = normalized;
      changed = true;
    }
  }
  if (changed) saveContent();
  return content.chatgptTrendLibrary;
}

function getChatgptTrend(key) {
  const library = ensureChatgptTrendLibrary();
  if (!key || !library[key]) return null;
  return normalizeChatgptTrendItem(library[key], key);
}

function getSortedChatgptTrends({ activeOnly = false } = {}) {
  return Object.values(ensureChatgptTrendLibrary())
    .map((item) => normalizeChatgptTrendItem(item, item.key))
    .filter((item) => !activeOnly || item.isActive)
    .sort((a, b) =>
      Number(b.isTrending) - Number(a.isTrending) ||
      Number(b.clicks || 0) - Number(a.clicks || 0) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

function incrementChatgptTrendMetric(key, metric, amount = 1) {
  const trend = getChatgptTrend(key);
  if (!trend) return false;
  trend[metric] = Number(trend[metric] || 0) + amount;
  content.chatgptTrendLibrary[key] = trend;
  saveContent();
  return true;
}

function buildChatgptTrendCardText(trend, admin = false, botUsername = "Promtiai_bot") {
  const deepLink = `https://t.me/${botUsername}?start=chatgpt_${trend.key}`;
  if (admin) {
    return (
      `🔥 <b>${escapeHtml(trend.title)}</b>\n` +
      `Ключ: <code>${escapeHtml(trend.key)}</code>\n` +
      `Категорія: <b>${escapeHtml(trend.category)}</b>\n` +
      `Input: <b>${escapeHtml(trend.inputType)}</b>\n` +
      `Result: <b>${escapeHtml(trend.resultType)}</b>\n` +
      `Model: <b>${escapeHtml(trend.model)}</b>\n` +
      `Price: <b>${trend.pricePromti} Promti ✨</b>\n` +
      `Active: <b>${trend.isActive ? "yes" : "no"}</b>\n` +
      `Trending: <b>${trend.isTrending ? "yes" : "no"}</b>\n` +
      `Clicks: <b>${trend.clicks}</b>\n` +
      `Uses: <b>${trend.uses}</b>\n\n` +
      `Deep-link:\n<code>${escapeHtml(deepLink)}</code>\n\n` +
      `<code>${escapeHtml(trend.promptText)}</code>`
    );
  }

  return (
    `🔥 <b>${escapeHtml(trend.title)}</b>\n` +
    `Категорія: <b>${escapeHtml(trend.category)}</b>\n` +
    `Ціна: <b>${trend.pricePromti} Promti ✨</b>\n\n` +
    `${trend.inputType === "photo" ? "Надішли фото, і я підготую результат." : trend.inputType === "text" ? "Надішли текстовий запит." : "Надішли фото або текстовий запит."}`
  );
}

function buildChatgptTrendKeyboard(trend, admin = false) {
  if (admin) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(trend.isTrending ? "🔕 Зняти тренд" : "🔥 Зробити трендом", `admin_chatgpttrend_trend_${trend.key}_${trend.isTrending ? "off" : "on"}`)],
      [Markup.button.callback("🖼 Preview", `admin_chatgpttrend_preview_${trend.key}`)],
      [Markup.button.callback("🗑 Видалити", `admin_chatgpttrend_delete_${trend.key}`)],
      [Markup.button.callback("🔥 До трендів", "chatgpttrend_page_0")],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Використати", `chatgpttrend_use_${trend.key}`)],
    [Markup.button.callback("🔥 До трендів", "chatgpttrend_page_0")],
  ]);
}

function buildChatgptTrendLibraryKeyboard(page = 0, admin = false) {
  const items = getSortedChatgptTrends({ activeOnly: !admin });
  const totalPages = Math.max(1, Math.ceil(items.length / PROMPT_LIBRARY_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * PROMPT_LIBRARY_PAGE_SIZE;
  const pageItems = items.slice(start, start + PROMPT_LIBRARY_PAGE_SIZE);
  const prefix = admin ? "admin_chatgpttrend" : "chatgpttrend";
  const rows = pageItems.map((trend) => [
    Markup.button.callback(`${trend.isTrending ? "🔥 " : ""}${trend.title}`, `${prefix}_open_${trend.key}`),
  ]);
  const nav = [];
  if (safePage > 0) nav.push(Markup.button.callback("⬅️", `${prefix}_page_${safePage - 1}`));
  nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, `${prefix}_noop`));
  if (safePage < totalPages - 1) nav.push(Markup.button.callback("➡️", `${prefix}_page_${safePage + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

async function sendChatgptTrendLibraryPage(ctx, page = 0, admin = false) {
  const items = getSortedChatgptTrends({ activeOnly: !admin });
  if (!items.length) {
    return ctx.reply(admin ? "🔥 Бібліотека ChatGPT trends порожня." : "🔥 Поки що трендів немає. Спробуй пізніше.");
  }
  const text = admin
    ? `🔥 <b>ChatGPT Trends</b>\n\nУсього: <b>${items.length}</b>\nВідкрий trend для deep-link і керування.`
    : `🔥 <b>Тренди ChatGPT</b>\n\nОбери готовий prompt і надішли фото або текст.`;
  const markup = buildChatgptTrendLibraryKeyboard(page, admin);
  if (ctx.updateType === "callback_query") {
    try {
      return await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: markup.reply_markup });
    } catch (e) {
      if (String(e.message || "").includes("message is not modified")) return;
    }
  }
  return ctx.reply(text, { parse_mode: "HTML", reply_markup: markup.reply_markup });
}

async function sendChatgptTrendCard(ctx, key, admin = false) {
  const trend = getChatgptTrend(key);
  if (!trend) return ctx.reply("❌ Trend не знайдено.");
  const botUsername = await resolveBotUsername(ctx);
  const text = buildChatgptTrendCardText(trend, admin, botUsername);
  const markup = buildChatgptTrendKeyboard(trend, admin);
  if (trend.previewPhoto) {
    return ctx.replyWithPhoto(trend.previewPhoto, {
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

function activateChatgptTrendSession(ctx, trend) {
  ensureSession(ctx);
  ctx.session.mode = "chatgpt_trend";
  ctx.session.chatgptTrendKey = trend.key;
  ctx.session.lastStateAt = Date.now();
}

async function runChatgptTrendRequest({ trend, user, userId, textInput = "", imageBase64 = null, ctx }) {
  if (!trend?.isActive) throw new Error("CHATGPT_TREND_INACTIVE");
  const pricePromti = Number(trend.pricePromti || loadSettings().chatgptTrendPricePromti || 1);

  if (!isAdmin(userId)) {
    if ((user.promti || 0) < pricePromti) {
      queueLogEvent({
        user_id: userId,
        event: "paywall_shown",
        value: pricePromti,
        style_id: trend.key,
        extra: { type: "chatgpt_trend", balance: user.promti || 0 },
      });
      throw new Error("NOT_ENOUGH_PROMTI");
    }
    user.promti -= pricePromti;
    saveUsersSync();
  }

  try {
    if (!openai || !process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
    const userContent = [];
    if (textInput) userContent.push({ type: "input_text", text: textInput });
    if (imageBase64) userContent.push({ type: "input_image", image_url: imageBase64 });
    if (!userContent.length) userContent.push({ type: "input_text", text: "Proceed with the requested trend prompt." });

    const response = await openai.responses.create({
      model: trend.model || loadSettings().defaultPromptModel || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: trend.promptText }],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      max_output_tokens: 1200,
    });
    const resultText = extractOpenAiText(response);
    if (!resultText) throw new Error("CHATGPT_TREND_EMPTY_RESPONSE");

    incrementChatgptTrendMetric(trend.key, "uses");
    queueLogEvent({
      user_id: userId,
      event: "chatgpt_trend_success",
      value: 1,
      style_id: trend.key,
      extra: { inputType: trend.inputType, resultType: trend.resultType },
    });
    return resultText;
  } catch (e) {
    logFailedCommand({
      userId,
      type: "chatgpt_trend",
      error: e,
      context: { trendKey: trend.key, inputType: trend.inputType, resultType: trend.resultType },
    });
    if (!isAdmin(userId)) {
      user.promti = (user.promti || 0) + pricePromti;
      saveUsersSync();
    }
    queueLogEvent({
      user_id: userId,
      event: "chatgpt_trend_error",
      value: 0,
      style_id: trend.key,
      extra: { error: e.message },
    });
    throw e;
  }
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
  ctx.session.selectedPromptExampleIndex = null;
  ctx.session.currentPromptKey = null;
  ctx.session.sourcePromptKey = null;
  ctx.session.currentDynamicSeriesId = null;
  ctx.session.currentDynamicVariantId = null;
  ctx.session.sourceDynamicSeriesId = null;
  ctx.session.sourceDynamicVariantId = null;
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
  ctx.session.lastStateAt = Date.now();

  user.sourcePromptKey = style.key;
  saveUsers();
  return style;
}

function buildStaticStyleRef(promptKey) {
  return promptKey ? `static:${normalizePromptKey(promptKey)}` : "";
}

function buildDynamicStyleRef(seriesId, variantId = "") {
  const safeSeries = normalizePromptKey(seriesId);
  const safeVariant = normalizePromptKey(variantId);
  return safeSeries ? `dynamic:${safeSeries}${safeVariant ? `:${safeVariant}` : ""}` : "";
}

function parseStyleRef(styleRef = "") {
  const [type, a, b] = String(styleRef || "").split(":");
  if (type === "static" && a) return { type, promptKey: a };
  if (type === "dynamic" && a) return { type, seriesId: a, variantId: b || "" };
  return null;
}

function markStyleGeneration(user, styleRef) {
  const parsed = parseStyleRef(styleRef);
  if (!parsed) return false;
  if (parsed.type === "static") {
    if (!getPromptStyle(parsed.promptKey)) return false;
    incrementPromptMetric(parsed.promptKey, "generations");
    user.lastGeneratedPromptKey = parsed.promptKey;
  } else if (parsed.type === "dynamic") {
    if (!getDynamicSeries(parsed.seriesId)) return false;
    incrementDynamicMetric(parsed.seriesId, "generations", parsed.variantId || null);
  }
  user.lastGeneratedStyleRef = styleRef;
  user.pendingPurchaseStyleRef = styleRef;
  saveUsers();
  return true;
}

function markGeneratedStylePurchase(user, orderReference) {
  const styleRef = user.pendingPurchaseStyleRef || buildStaticStyleRef(user.pendingPurchasePromptKey);
  const parsed = parseStyleRef(styleRef);
  if (!parsed) return false;
  if (user.lastPurchaseAttributedOrderReference === orderReference) return false;
  if (parsed.type === "static") {
    if (!getPromptStyle(parsed.promptKey)) return false;
    incrementPromptMetric(parsed.promptKey, "purchases");
    user.pendingPurchasePromptKey = null;
  } else if (parsed.type === "dynamic") {
    if (!getDynamicSeries(parsed.seriesId)) return false;
    incrementDynamicMetric(parsed.seriesId, "purchases", parsed.variantId || null);
  }
  user.lastPurchaseAttributedOrderReference = orderReference;
  user.pendingPurchaseStyleRef = null;
  saveUsers();
  return true;
}

function applyDynamicVariantToSession(ctx, seriesId, variantId) {
  const series = getDynamicSeries(seriesId);
  const variant = getDynamicVariant(seriesId, variantId);
  if (!series || !variant || !series.isActive || !variant.isActive) return null;
  ensureSession(ctx);
  const user = getUser(ctx.from.id);
  const prompt = buildDynamicStylePrompt(series, variant);
  ctx.session.mode = "photo";
  ctx.session.photoMode = "edit";
  ctx.session.customType = "custom_photo";
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = prompt;
  ctx.session.currentDynamicSeriesId = series.id;
  ctx.session.currentDynamicVariantId = variant.id;
  ctx.session.sourceDynamicSeriesId = series.id;
  ctx.session.sourceDynamicVariantId = variant.id;
  ctx.session.lastStateAt = Date.now();
  user.sourceDynamicSeriesId = series.id;
  user.sourceDynamicVariantId = variant.id;
  user.pendingPurchaseStyleRef = buildDynamicStyleRef(series.id, variant.id);
  saveUsers();
  return { series, variant, prompt };
}

function markPromptGeneration(user, promptKey) {
  if (!promptKey) return;
  if (!getPromptStyle(promptKey)) return;
  user.pendingPurchasePromptKey = promptKey;
  markStyleGeneration(user, buildStaticStyleRef(promptKey));
}

function markPromptPurchase(user, orderReference) {
  const promptKey = user.pendingPurchasePromptKey;
  if (!promptKey) return false;
  if (user.lastPurchaseAttributedOrderReference === orderReference) return false;
  if (!getPromptStyle(promptKey)) return false;
  user.pendingPurchaseStyleRef = buildStaticStyleRef(promptKey);
  return markGeneratedStylePurchase(user, orderReference);
}

function buildPromptStyleCardText(style, options = {}) {
  const { admin = false, userId = null, botUsername = "Promtiai_bot" } = options;
  const trendMark = style.isTrending ? "🔥 Тренд\n" : "";
  const deepLink = getPromptDeepLink(botUsername, style.key);
  const examplesCount = getPromptExamplePhotos(style).length;
  if (admin) {
    return (
      `🎨 <b>${escapeHtml(style.title)}</b>\n` +
      `${trendMark}` +
      `Ключ: <code>${escapeHtml(style.key)}</code>\n` +
      `Категорія: <b>${escapeHtml(style.category)}</b>\n\n` +
      `Preview: <b>${style.previewPhoto ? "є" : "нема"}</b>\n` +
      `Приклади: <b>${examplesCount}/${MAX_PROMPT_EXAMPLE_PHOTOS}</b>\n\n` +
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
  const exampleEntries = getPromptExampleEntries(style);
  return (
    `🎨 <b>${escapeHtml(style.title)}</b>\n` +
    `${trendMark}` +
    `Категорія: <b>${escapeHtml(style.category)}</b>\n\n` +
    `${exampleEntries.length > 1 ? `Доступно ракурсів: <b>${exampleEntries.length}</b>\nНатисни потрібний ракурс нижче, щоб побачити точний приклад.\n\n` : ""}` +
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
    const rows = [
      [Markup.button.callback("✅ Обрати стиль", `promptlib_apply_${style.key}`)],
    ];
    const exampleEntries = getPromptExampleEntries(style);
    if (exampleEntries.length > 1) {
      rows.push(...exampleEntries.map((entry) => [
        Markup.button.callback(`🖼 ${entry.label}`, `promptlib_example:${style.key}:${entry.index}`),
      ]));
    }
    rows.push([Markup.button.callback("📚 До списку стилів", "promptlib_page_0")]);
    return Markup.inlineKeyboard(rows);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback(style.isTrending ? "🔕 Зняти тренд" : "🔥 Зробити трендом", `admin_promptlib_trend_${style.key}_${style.isTrending ? "off" : "on"}`)],
    [Markup.button.callback("🖼 Preview фото", `admin_promptlib_preview_${style.key}`)],
    [Markup.button.callback("🧩 Приклади", `admin_promptlib_examples_${style.key}`)],
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
  const examplePhotos = getPromptExamplePhotos(style);
  if (examplePhotos.length) {
    await sendPromptExamplePhotos(ctx, style);
    return ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: markup.reply_markup,
    });
  }
  if (style.previewPhoto) {
    return ctx.replyWithPhoto(toTelegramMediaRef(style.previewPhoto), {
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

  const examplePhotos = getPromptExamplePhotos(style);
  if (withPreview && examplePhotos.length) {
    await sendPromptExamplePhotos(ctx, style);
    return ctx.reply(text, photoMenu());
  }

  if (withPreview && style.previewPhoto) {
    return ctx.replyWithPhoto(toTelegramMediaRef(style.previewPhoto), {
      caption: text,
      reply_markup: photoMenu().reply_markup,
    });
  }
  return ctx.reply(text, photoMenu());
}

async function sendPromptExamplePhotos(ctx, style) {
  const photos = getPromptExamplePhotos(style);
  if (!photos.length) return false;

  try {
    for (let index = 0; index < photos.length; index += 10) {
      const chunk = photos.slice(index, index + 10);
      const media = chunk
        .map((fileId) => toTelegramMediaRef(fileId))
        .filter(Boolean)
        .map((fileId) => ({
        type: "photo",
        media: fileId,
      }));
      if (!media.length) continue;
      await ctx.replyWithMediaGroup(media);
    }
    return true;
  } catch (e) {
    console.error("SEND PROMPT EXAMPLES:", e.message);
    return false;
  }
}

async function sendPromptExampleSelection(ctx, promptKey, exampleIndex) {
  const style = getPromptStyle(promptKey);
  if (!style) return ctx.reply("❌ Стиль не знайдено.");
  const entries = getPromptExampleEntries(style);
  const selected = entries.find((entry) => entry.index === Number(exampleIndex));
  if (!selected) return ctx.reply("❌ Приклад не знайдено.");

  ensureSession(ctx);
  ctx.session.selectedPromptExampleIndex = selected.index;
  ctx.session.lastStateAt = Date.now();

  return ctx.replyWithPhoto(toTelegramMediaRef(selected.photo), {
    caption:
      `🖼 <b>${escapeHtml(style.title)}</b>\n` +
      `Ракурс: <b>${escapeHtml(selected.label)}</b>\n\n` +
      `Ось саме цей приклад є в стилі.\nНадішли своє selfie 📸`,
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback("✅ Обрати цей стиль", `promptlib_apply_${style.key}`)],
      [Markup.button.callback("📚 Назад до стилю", `promptlib_open_${style.key}`)],
    ]).reply_markup,
  });
}

function buildDynamicSeriesText(series, admin = false, botUsername = "Promtiai_bot") {
  const deepLink = `https://t.me/${botUsername}?start=dynamic_${series.id}`;
  const seriesStats = series.stats || {};
  if (admin) {
    return (
      `🔮 <b>${escapeHtml(series.title)}</b>\n` +
      `ID: <code>${escapeHtml(series.id)}</code>\n` +
      `Provider: <b>${escapeHtml(series.provider)}</b>\n` +
      `Model: <b>${escapeHtml(series.model)}</b>\n` +
      `Ціна: <b>${series.price} Promti ✨</b>\n` +
      `Активний: <b>${series.isActive ? "так" : "ні"}</b>\n` +
      `Трендовий: <b>${series.isTrending ? "так" : "ні"}</b>\n` +
      `Variants: <b>${series.variants.length}</b>\n` +
      `Clicks: <b>${Number(seriesStats.clicks || 0)}</b>\n` +
      `Generations: <b>${Number(seriesStats.generations || 0)}</b>\n` +
      `Purchases: <b>${Number(seriesStats.purchases || 0)}</b>\n\n` +
      `${escapeHtml(series.description || "-")}\n\n` +
      `Deep-link:\n<code>${escapeHtml(deepLink)}</code>`
    );
  }
  return (
    `🔮 <b>${escapeHtml(series.title)}</b>\n` +
    `${escapeHtml(series.description || "")}\n\n` +
    `Обери variant і надішли selfie 📸`
  );
}

function buildDynamicSeriesKeyboard(series, admin = false) {
  if (admin) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✏️ Редагувати серію", `admin_dynamic_edit:${series.id}`)],
      [Markup.button.callback("🧩 Варіанти", `admin_dynamic_variants:${series.id}`)],
      [Markup.button.callback("🖼 Preview", `admin_dynamic_preview:${series.id}`), Markup.button.callback("🖼 Examples", `admin_dynamic_examples:${series.id}`)],
      [Markup.button.callback("💰 Ціна", `admin_dynamic_price:${series.id}`), Markup.button.callback("🤖 Model/provider", `admin_dynamic_model:${series.id}`)],
      [Markup.button.callback("🔗 Deep-link", `admin_dynamic_deeplink:${series.id}`), Markup.button.callback("📊 Stats", `admin_dynamic_stats:${series.id}`)],
      [Markup.button.callback(series.isActive ? "⛔ Вимкнути" : "✅ Увімкнути", `admin_dynamic_toggle:${series.id}`), Markup.button.callback(series.isTrending ? "🔥 Untrend" : "🔥 Trend", `admin_dynamic_trend:${series.id}`)],
      [Markup.button.callback("🗑 Архівувати", `admin_dynamic_archive:${series.id}`)],
    ]);
  }
  const rows = (series.variants || [])
    .filter((variant) => variant.isActive !== false)
    .map((variant) => [Markup.button.callback(variant.title, `dynamic_variant_open:${series.id}:${variant.id}`)]);
  return Markup.inlineKeyboard(rows);
}

async function sendDynamicSeriesCard(ctx, seriesId, admin = false) {
  const series = getDynamicSeries(seriesId);
  if (!series) return ctx.reply("❌ Dynamic series не знайдено.");
  const botUsername = await resolveBotUsername(ctx);
  const text = buildDynamicSeriesText(series, admin, botUsername);
  const keyboard = buildDynamicSeriesKeyboard(series, admin);
  if (series.previewImage) {
    return ctx.replyWithPhoto(toTelegramMediaRef(series.previewImage), {
      caption: text,
      parse_mode: "HTML",
      reply_markup: keyboard.reply_markup,
    });
  }
  return ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: keyboard.reply_markup,
  });
}

async function sendDynamicVariantReadyMessage(ctx, series, variant) {
  return ctx.reply(
    `✅ Dynamic стиль завантажено\n\n🔮 ${series.title} — ${variant.title}\nБаланс: ${getPromptBalanceText(ctx.from.id)}\n\nНадішли selfie 📸`,
    photoMenu()
  );
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
function saveAiPromptCache() {
  saveJson(AI_PROMPT_CACHE_PATH, aiPromptCache);
}

function buildAiPromptCacheKey(imageBase64, mode, model) {
  return crypto.createHash("sha256").update(`${imageBase64}|${mode}|${model}`).digest("hex");
}

function getAiPromptSystemPrompt(mode) {
  return mode === "video"
    ? "You are an expert at writing image-to-video animation prompts.\nWrite ONE ultra-short English prompt, maximum 10 words.\nFocus on natural motion: hair, eyes, lips, wind, camera movement.\nOutput only the prompt text. No punctuation. No explanation."
    : "You are an expert at writing image editing prompts for AI photo generation models.\nWrite ONE short English prompt, max 15 words.\nPreserve face identity.\nFocus on style, lighting, mood, editorial quality.\nOutput only the prompt text. No explanation.";
}

function extractOpenAiText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return null;
}

async function generateAiPromptWithOpenAI(imageBase64, mode) {
  const cfg = loadSettings();
  const model = cfg.defaultPromptModel || "gpt-4.1-mini";
  if (!openai || !process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");

  const response = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: getAiPromptSystemPrompt(mode) }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Write a prompt for this image." },
          { type: "input_image", image_url: imageBase64 },
        ],
      },
    ],
    max_output_tokens: 80,
  });

  return extractOpenAiText(response);
}

async function generateAiPromptWithAnthropic(imageBase64, mode) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const Anthropic = require("@anthropic-ai/sdk");
  const anthropic = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 60,
    system: getAiPromptSystemPrompt(mode),
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64.replace(/^data:image\/[^;]+;base64,/, "") } },
        { type: "text", text: "Write a prompt for this image." },
      ],
    }],
  });
  return response.content?.[0]?.text?.trim() || null;
}

async function generateAiPrompt(imageBase64, mode, ctx = null) {
  const cfg = loadSettings();
  if (!cfg.aiPromptEnabled) return null;

  const model = cfg.defaultPromptModel || "gpt-4.1-mini";
  const cacheKey = buildAiPromptCacheKey(imageBase64, mode, model);
  const cached = aiPromptCache[cacheKey];

  if (
    cfg.aiPromptCacheEnabled !== false &&
    cached &&
    cached.prompt &&
    cached.model === model &&
    Date.now() - Number(cached.createdAt || 0) <= Number(cfg.aiPromptCacheTtlMs || 86400000)
  ) {
    if (ctx?.from?.id) {
      queueLogEvent({
        user_id: ctx.from.id,
        event: "ai_prompt_cache_hit",
        value: 1,
        style_id: ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || "",
        extra: { mode, model },
      });
    }
    return cached.prompt;
  }

  if (ctx?.from?.id) {
    queueLogEvent({
      user_id: ctx.from.id,
      event: "ai_prompt_cache_miss",
      value: 1,
      style_id: ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || "",
      extra: { mode, model },
    });
  }

  try {
    const prompt = await generateAiPromptWithOpenAI(imageBase64, mode);
    if (!prompt) throw new Error("OPENAI_EMPTY_PROMPT");
    if (cfg.aiPromptCacheEnabled !== false) {
      aiPromptCache[cacheKey] = { prompt, mode, model, createdAt: Date.now() };
      saveAiPromptCache();
    }
    return prompt;
  } catch (openAiError) {
    console.error("OPENAI AI PROMPT ERROR:", openAiError.message);
    try {
      const fallbackPrompt = await generateAiPromptWithAnthropic(imageBase64, mode);
      if (fallbackPrompt) {
        if (cfg.aiPromptCacheEnabled !== false) {
          aiPromptCache[cacheKey] = { prompt: fallbackPrompt, mode, model, createdAt: Date.now() };
          saveAiPromptCache();
        }
        return fallbackPrompt;
      }
    } catch (anthropicError) {
      console.error("ANTHROPIC AI PROMPT ERROR:", anthropicError.message);
    }
    if (ctx?.from?.id) {
      logFailedCommand({
        userId: ctx.from.id,
        type: "ai_prompt",
        error: openAiError,
        context: { mode, model },
      });
    }
    notifyAdminsError(`AI PROMPT ERROR:\n${openAiError.message}`).catch(() => {});
    return null;
  }
}

function stripBase64DataUrl(dataUrl = "") {
  return String(dataUrl).replace(/^data:image\/[^;]+;base64,/, "");
}

function buildOpenAiImageFile(imageBase64, fileName = `promti_${Date.now()}.png`) {
  const buffer = Buffer.from(stripBase64DataUrl(imageBase64), "base64");
  const blob = new Blob([buffer], { type: "image/png" });
  return new File([blob], fileName, { type: "image/png" });
}

async function generateImageWithFal({ prompt, imageBase64, mode, model, settings }) {
  const cfg = settings || loadSettings();
  if (!process.env.FAL_KEY) throw new Error("FAL_NOT_CONFIGURED");
  if (mode === "create") {
    const result = await falWithRetry(
      model || "fal-ai/nano-banana-2",
      {
        prompt,
        num_images: 1,
        aspect_ratio: "auto",
        output_format: "png",
        resolution: "2K",
        limit_generations: true,
      },
      cfg.photoTimeoutMs
    );
    return {
      url: result?.data?.images?.[0]?.url || null,
      provider: "fal",
      model: model || "fal-ai/nano-banana-2",
    };
  }

  const editModel = model?.includes("/edit") ? model : `${model || "fal-ai/nano-banana-2"}/edit`;
  const result = await falWithRetry(
    editModel,
    {
      prompt,
      image_urls: [imageBase64],
      num_images: 1,
      aspect_ratio: "auto",
      output_format: "png",
      resolution: "2K",
      limit_generations: true,
    },
    cfg.photoTimeoutMs
  );
  return {
    url: result?.data?.images?.[0]?.url || null,
    provider: "fal",
    model: editModel,
  };
}

async function generateImageWithOpenAI({ prompt, imageBase64, mode, model }) {
  const selectedModel = model || loadSettings().defaultOpenAIImageModel || "gpt-image-1";
  if (!openai || !process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");

  if (mode === "create") {
    const response = await openai.images.generate({
      model: selectedModel,
      prompt,
      size: "1536x1024",
    });
    const base64 = response?.data?.[0]?.b64_json || null;
    if (!base64) throw new Error("OPENAI_IMAGE_EMPTY");
    return {
      base64,
      buffer: Buffer.from(base64, "base64"),
      provider: "openai",
      model: selectedModel,
    };
  }

  const imageFile = buildOpenAiImageFile(imageBase64);
  const response = await openai.images.edit({
    model: selectedModel,
    image: imageFile,
    prompt,
    size: "1536x1024",
  });
  const base64 = response?.data?.[0]?.b64_json || null;
  if (!base64) throw new Error("OPENAI_IMAGE_EDIT_EMPTY");
  return {
    base64,
    buffer: Buffer.from(base64, "base64"),
    provider: "openai",
    model: selectedModel,
  };
}

async function generateImageByProvider({
  provider,
  model,
  prompt,
  imageBase64,
  mode,
  fallbackProvider,
  fallbackModel,
  settings,
}) {
  const selectedProvider = provider || loadSettings().defaultImageProvider || "fal";
  try {
    if (selectedProvider === "openai") {
      return await generateImageWithOpenAI({ prompt, imageBase64, mode, model });
    }
    return await generateImageWithFal({ prompt, imageBase64, mode, model, settings });
  } catch (primaryError) {
    if (!fallbackProvider || fallbackProvider === selectedProvider) throw primaryError;
    console.error("IMAGE PROVIDER FALLBACK:", primaryError.message);
    if (fallbackProvider === "openai") {
      return generateImageWithOpenAI({ prompt, imageBase64, mode, model: fallbackModel });
    }
    return generateImageWithFal({ prompt, imageBase64, mode, model: fallbackModel, settings });
  }
}

function buildInfographicPrompt(text = "") {
  const baseInstruction = "Create a clean modern infographic PNG. Use strong hierarchy, clear sections, bold headings, concise labels, premium editorial design, readable typography, and visually structured layout.";
  const userText = String(text || "").trim();
  return userText ? `${baseInstruction}\n\nTopic and content:\n${userText}` : `${baseInstruction}\n\nTurn the attached image into an infographic with a polished editorial layout.`;
}

function extractSvgMarkup(rawText = "") {
  const text = String(rawText || "").trim();
  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  return match ? match[0].trim() : "";
}

async function runInfographicPngFlow({ ctx, user, userId, textInput = "", imageBase64 = null }) {
  const cfg = loadSettings();
  const tool = getActiveOpenAiTool("infographic");
  const pricePromti = Number(tool?.price || cfg.infographicPricePromti || 2);
  const generationId = createGenerationId(userId, "infographic");
  const model = tool?.model || cfg.defaultInfographicImageModel || "gpt-image-1";
  let charged = false;

  if (!isAdmin(userId)) {
    if ((user.promti || 0) < pricePromti) {
      queueLogEvent({
        user_id: userId,
        event: "paywall_shown",
        value: pricePromti,
        style_id: "infographic_png",
        generation_id: generationId,
        extra: { type: "infographic", balance: user.promti || 0, required: pricePromti },
      });
      throw new Error("NOT_ENOUGH_PROMTI");
    }
    user.promti -= pricePromti;
    charged = true;
    saveUsersSync();
  }

  queueLogEvent({
    user_id: userId,
    event: "infographic_started",
    value: 1,
    style_id: "infographic_png",
    generation_id: generationId,
    extra: { model, input: imageBase64 ? "photo_or_text" : "text" },
  });

  try {
    await ctx.reply("⏳ Створюю інфографіку... (~30-60 сек)");
    const result = await generateImageWithOpenAI({
      prompt: tool?.systemPrompt
        ? `${tool.systemPrompt}\n\n${(tool.userPromptTemplate || "{{input}}").replace("{{input}}", textInput || "Use the attached image and create an infographic.")}`
        : buildInfographicPrompt(textInput),
      imageBase64,
      mode: imageBase64 ? "edit" : "create",
      model,
    });
    if (!result?.buffer) throw new Error("INFOGRAPHIC_EMPTY_RESULT");
    await tgSendWithRetry(() => ctx.replyWithDocument(
      { source: result.buffer, filename: `promti_infographic_${Date.now()}.png` },
      { caption: "🧾 Інфографіка PNG готова" }
    ));
    queueLogEvent({
      user_id: userId,
      event: "infographic_success",
      value: 1,
      style_id: "infographic_png",
      generation_id: generationId,
      extra: { model },
    });
    return true;
  } catch (e) {
    if (charged) {
      user.promti = (user.promti || 0) + pricePromti;
      saveUsersSync();
    }
    logFailedCommand({
      userId,
      type: "infographic_png",
      error: e,
      context: { model, hasImage: !!imageBase64 },
    });
    queueLogEvent({
      user_id: userId,
      event: "infographic_error",
      value: 0,
      style_id: "infographic_png",
      generation_id: generationId,
      extra: { model, error: e.message },
    });
    throw e;
  }
}

async function runSvgLogoFlow({ ctx, user, userId, promptText }) {
  const cfg = loadSettings();
  const tool = getActiveOpenAiTool("svg");
  const pricePromti = Number(tool?.price || cfg.svgLogoPricePromti || 3);
  const generationId = createGenerationId(userId, "svg");
  const model = tool?.model || cfg.defaultSvgModel || "gpt-4.1-mini";
  const filePath = path.join("/tmp", `promti_svg_${userId}_${Date.now()}.svg`);
  let charged = false;

  if (!openai || !process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  if (!isAdmin(userId)) {
    if ((user.promti || 0) < pricePromti) {
      queueLogEvent({
        user_id: userId,
        event: "paywall_shown",
        value: pricePromti,
        style_id: "svg_logo",
        generation_id: generationId,
        extra: { type: "svg_logo", balance: user.promti || 0, required: pricePromti },
      });
      throw new Error("NOT_ENOUGH_PROMTI");
    }
    user.promti -= pricePromti;
    charged = true;
    saveUsersSync();
  }

  queueLogEvent({
    user_id: userId,
    event: "svg_logo_started",
    value: 1,
    style_id: "svg_logo",
    generation_id: generationId,
    extra: { model },
  });

  try {
    await ctx.reply("⏳ Створюю SVG логотип... (~20-40 сек)");
    const response = await openai.responses.create({
      model,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: tool?.systemPrompt || "You create clean production-ready SVG logos. Return only valid SVG markup. No markdown. No explanation. Include viewBox. Use scalable vector shapes only. No external fonts. No external images. Keep the mark simple, readable, and brandable.",
          }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: (tool?.userPromptTemplate || "{{input}}").replace("{{input}}", promptText) }],
        },
      ],
      max_output_tokens: 2200,
    });
    const svgMarkup = extractSvgMarkup(extractOpenAiText(response) || "");
    if (!svgMarkup) throw new Error("SVG_EMPTY_RESPONSE");
    fs.writeFileSync(filePath, svgMarkup, "utf8");
    await tgSendWithRetry(() => ctx.replyWithDocument(
      { source: fs.createReadStream(filePath), filename: `promti_logo_${Date.now()}.svg` },
      { caption: "🔷 SVG логотип готовий" }
    ));
    queueLogEvent({
      user_id: userId,
      event: "svg_logo_success",
      value: 1,
      style_id: "svg_logo",
      generation_id: generationId,
      extra: { model },
    });
    return true;
  } catch (e) {
    if (charged) {
      user.promti = (user.promti || 0) + pricePromti;
      saveUsersSync();
    }
    logFailedCommand({
      userId,
      type: "svg_logo",
      error: e,
      context: { model },
    });
    queueLogEvent({
      user_id: userId,
      event: "svg_logo_error",
      value: 0,
      style_id: "svg_logo",
      generation_id: generationId,
      extra: { model, error: e.message },
    });
    throw e;
  } finally {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
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
  const promptLibraryCount = Object.keys(content.promptLibrary || {}).length;
  const chatgptTrendsCount = Object.keys(content.chatgptTrendLibrary || {}).length;
  return {
    totalUsers:       all.length,
    activeUsers:      all.filter(u => u.generations > 0 || getUserVideoTotal(u) > 0).length,
    bannedUsers:      all.filter(u => u.banned).length,
    totalPhotoGen:    all.reduce((s, u) => s + (u.generations          || 0), 0),
    totalSeedanceGen: all.reduce((s, u) => s + (u.seedanceGenerations  || 0), 0),
    totalKlingGen:    all.reduce((s, u) => s + (u.klingGenerations     || 0), 0),
    totalReferrals:   all.reduce((s, u) => s + (u.referralCount        || 0), 0),
    totalRevenue:     payments.filter(p => isPaymentCreditedStatus(p.status)).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    totalPaidOrders:  payments.filter(p => isPaymentCreditedStatus(p.status)).length,
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
    hasOpenAiKey:    !!process.env.OPENAI_API_KEY,
    hasFalKey:       !!process.env.FAL_KEY,
    hasWfp:          !!WAYFORPAY.merchantAccount,
    hasGoogleSheets: isAnalyticsEnabled(),
    defaultImageProvider: cfg.defaultImageProvider,
    defaultImageModel: cfg.defaultImageModel,
    defaultOpenAIImageModel: cfg.defaultOpenAIImageModel,
    defaultPromptModel: cfg.defaultPromptModel,
    aiPromptCacheEnabled: cfg.aiPromptCacheEnabled !== false,
    promptLibraryCount,
    chatgptTrendsCount,
  };
}

function getAdminPanelBaseUrl() {
  const explicit =
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.RAILWAY_STATIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "") ||
    (WAYFORPAY.domainName ? `https://${String(WAYFORPAY.domainName).replace(/^https?:\/\//i, "")}` : "");
  return String(explicit || "https://promti-bot-production.up.railway.app").replace(/\/+$/, "");
}

function getAdminPanelUrl(section = "") {
  const baseUrl = `${getAdminPanelBaseUrl()}/admin`;
  if (!section) return baseUrl;
  return `${baseUrl}?section=${encodeURIComponent(section)}`;
}

function buildAdminPanelKeyboard(section = "") {
  return Markup.inlineKeyboard([
    [Markup.button.url("🌐 Відкрити PROMTI Control", getAdminPanelUrl(section))],
  ]);
}

function buildAdminSectionText(section) {
  const analytics = buildAnalyticsPayload();
  const activeDynamic = Object.values(ensureDynamicStyleLibrary()).filter((item) => item.isActive !== false).length;
  const totalDynamicVariants = Object.values(ensureDynamicStyleLibrary()).reduce((sum, item) => sum + (item.variants || []).length, 0);
  const activeVideo = Object.values(ensureVideoPresets()).filter((item) => item.isActive !== false).length;
  const activeOpenAiTools = Object.values(ensureOpenAiTools()).filter((item) => item.isActive !== false).length;

  if (section === "static") {
    return [
      "📸 Static photo styles",
      "",
      `У бібліотеці: ${analytics.summary.staticStyles}`,
      `Активних: ${analytics.activeStaticStyles}`,
      `Trending: ${analytics.trendingStaticStyles}`,
      "",
      "У web-панелі можна:",
      "• створювати, дублювати, вмикати/вимикати стилі",
      "• редагувати title / description / prompt / provider / model / price",
      "• додавати preview та example images",
      "• отримувати deep-link і дивитися stats",
    ].join("\n");
  }

  if (section === "dynamic") {
    return [
      "🔮 Dynamic photo styles",
      "",
      `Серій: ${analytics.summary.dynamicSeries}`,
      `Варіантів: ${totalDynamicVariants}`,
      `Активних серій: ${activeDynamic}`,
      "",
      "У web-панелі можна:",
      "• створювати серії типу zodiac / archetypes / collections",
      "• додавати variants усередині серії",
      "• редагувати templatePrompt, price, provider, model",
      "• керувати preview, examples, deep-links і статистикою",
      "",
      "Fallback команда: /importdynamic",
    ].join("\n");
  }

  if (section === "video") {
    return [
      "🎬 Video presets",
      "",
      `Пресетів: ${analytics.summary.videoPresets}`,
      `Активних: ${activeVideo}`,
      "",
      "Тут керуються окремі video presets:",
      "• Seedance",
      "• Kling",
      "• додаткові video models у майбутньому",
    ].join("\n");
  }

  if (section === "openai") {
    return [
      "🧩 OpenAI tools",
      "",
      `Інструментів: ${analytics.summary.openAiTools}`,
      `Активних: ${activeOpenAiTools}`,
      "",
      "OpenAI tools не змішуються з photo styles.",
      "Тут окремо керуються:",
      "• 🖼 Infographic presets",
      "• ✨ SVG presets",
    ].join("\n");
  }

  if (section === "content") {
    return [
      "🔗 Content & Links",
      "",
      "У web-панелі можна редагувати:",
      "• welcome / help / info / support тексти",
      "• CTA та button copy",
      "• support link, channel link, payment links",
      "• пояснення для стилів і службові тексти",
      "",
      "Fallback у Telegram:",
      "• ✏️ Змінити текст",
      "• 📝 Поточні тексти",
      "• 🖼 Прикріпити фото",
    ].join("\n");
  }

  if (section === "settings") {
    return [
      "⚙️ Settings",
      "",
      "У web-панелі доступні ключові налаштування бота:",
      "• default providers / models",
      "• ціни OpenAI tools",
      "• support / channel links",
      "• інші службові значення без заходу в код",
    ].join("\n");
  }

  return [
    "🌐 PROMTI Control",
    "",
    "Mobile-first панель для керування ботом з телефона:",
    "• static photo styles",
    "• dynamic photo styles",
    "• video presets",
    "• OpenAI tools",
    "• content & links",
    "• analytics",
    "• settings",
  ].join("\n");
}

function serializeStaticStyleForAdmin(style, botUsername = "Promtiai_bot") {
  const normalized = normalizePromptLibraryItem(style, style.key || style.id);
  return {
    id: normalized.key,
    key: normalized.key,
    title: normalized.title,
    description: normalized.description || "",
    category: normalized.category,
    prompt: normalized.prompt,
    provider: normalized.provider,
    model: normalized.model,
    type: "static",
    price: normalized.pricePromti,
    previewImage: toAbsolutePublicUrl(normalized.previewPhoto),
    exampleImages: normalized.examplePhotos.map((item) => toAbsolutePublicUrl(item)),
    exampleLabels: normalized.exampleLabels,
    deepLink: getPromptDeepLink(botUsername, normalized.key),
    isActive: normalized.isActive,
    isTrending: normalized.isTrending,
    sortOrder: normalized.sortOrder || 0,
    stats: {
      clicks: normalized.clicks || 0,
      generations: normalized.generations || 0,
      purchases: normalized.purchases || 0,
    },
  };
}

function serializeDynamicSeriesForAdmin(series, botUsername = "Promtiai_bot") {
  const normalized = normalizeDynamicStyleSeries(series, series.id);
  return {
    ...normalized,
    deepLink: `https://t.me/${botUsername}?start=dynamic_${normalized.id}`,
    previewImage: toAbsolutePublicUrl(normalized.previewImage),
    exampleImages: (normalized.exampleImages || []).map((item) => toAbsolutePublicUrl(item)),
    variants: normalized.variants.map((variant) => ({
      ...variant,
      previewImage: toAbsolutePublicUrl(variant.previewImage),
      exampleImages: (variant.exampleImages || []).map((item) => toAbsolutePublicUrl(item)),
      deepLink: `https://t.me/${botUsername}?start=dynamic_${variant.id}`,
    })),
  };
}

function buildAnalyticsPayload() {
  const promptStyles = getSortedPromptStyles();
  const dynamicSeries = Object.values(ensureDynamicStyleLibrary());
  const videoItems = Object.values(ensureVideoPresets());
  const openAiItems = Object.values(ensureOpenAiTools());
  const paymentsCredited = payments.filter((item) => isPaymentCreditedStatus(item.status));
  const providerRollup = {};
  const modelRollup = {};

  const ingest = (provider, model, stats = {}) => {
    providerRollup[provider] = providerRollup[provider] || { clicks: 0, generations: 0, purchases: 0 };
    modelRollup[model] = modelRollup[model] || { clicks: 0, generations: 0, purchases: 0 };
    for (const metric of ["clicks", "generations", "purchases"]) {
      providerRollup[provider][metric] += Number(stats[metric] || 0);
      modelRollup[model][metric] += Number(stats[metric] || 0);
    }
  };

  promptStyles.forEach((style) => ingest(style.provider, style.model, style));
  dynamicSeries.forEach((series) => {
    ingest(series.provider, series.model, series.stats || {});
    (series.variants || []).forEach((variant) => ingest(series.provider, series.model, variant.stats || {}));
  });
  videoItems.forEach((preset) => ingest(preset.provider, preset.model, preset.stats || {}));
  openAiItems.forEach((tool) => ingest(tool.provider, tool.model, tool.stats || {}));

  return {
    summary: {
      revenue: paymentsCredited.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      purchases: paymentsCredited.length,
      staticStyles: promptStyles.length,
      dynamicSeries: dynamicSeries.length,
      dynamicVariants: dynamicSeries.reduce((sum, item) => sum + (item.variants || []).length, 0),
      videoPresets: videoItems.length,
      openAiTools: openAiItems.length,
    },
    topStaticStyles: [...promptStyles]
      .sort((a, b) => Number(b.generations || 0) - Number(a.generations || 0))
      .slice(0, 10),
    topDynamicSeries: [...dynamicSeries]
      .sort((a, b) => Number((b.stats || {}).generations || 0) - Number((a.stats || {}).generations || 0))
      .slice(0, 10),
    topDynamicVariants: dynamicSeries
      .flatMap((series) => (series.variants || []).map((variant) => ({ ...variant, seriesId: series.id, seriesTitle: series.title })))
      .sort((a, b) => Number((b.stats || {}).generations || 0) - Number((a.stats || {}).generations || 0))
      .slice(0, 10),
    topProviders: Object.entries(providerRollup).sort((a, b) => b[1].generations - a[1].generations),
    topModels: Object.entries(modelRollup).sort((a, b) => b[1].generations - a[1].generations),
    activeStaticStyles: promptStyles.filter((item) => item.isActive).length,
    inactiveStaticStyles: promptStyles.filter((item) => !item.isActive).length,
    trendingStaticStyles: promptStyles.filter((item) => item.isTrending).length,
  };
}

function getButtonLabel(key, fallback = "") {
  const stored = getNestedValue(content, `buttonLabels.${key}`, "");
  return typeof stored === "string" && stored.trim() ? stored.trim() : (DEFAULT_BUTTON_LABELS[key] || fallback);
}

function getButtonHint(key, fallback = "") {
  const stored = getNestedValue(content, `buttonHints.${key}`, "");
  return typeof stored === "string" && stored.trim() ? stored.trim() : (DEFAULT_BUTTON_HINTS[key] || fallback);
}

function normalizeIncomingButtonText(text = "") {
  if (typeof text !== "string" || !text.trim()) return text;
  for (const [key, canonical] of Object.entries(DEFAULT_BUTTON_LABELS)) {
    const configured = getButtonLabel(key, canonical);
    if (text === configured) return canonical;
  }
  return text;
}

// ─── МЕНЮ ─────────────────────────────────────────────────────────────────────
const mainMenu  = () => Markup.keyboard([
  [getButtonLabel("main_photo"), getButtonLabel("main_video")],
  [getButtonLabel("main_ai_studio")],
  [getButtonLabel("main_infographics")],
  [getButtonLabel("main_buy_promti")],
  [getButtonLabel("main_balance"), getButtonLabel("main_prices")],
  [getButtonLabel("main_ideas"), getButtonLabel("main_referral")],
  [getButtonLabel("main_info"), getButtonLabel("main_help")],
  [getButtonLabel("main_support")]
]).resize();
const photoMenu = () => Markup.keyboard([
  [getButtonLabel("photo_edit"), getButtonLabel("photo_create")],
  [getButtonLabel("photo_ai_prompt"), getButtonLabel("photo_saved_prompts")],
  [getButtonLabel("main_balance")],
  [getButtonLabel("back")]
]).resize();
const videoMenu     = () => Markup.keyboard([
  [getButtonLabel("video_seedance"), getButtonLabel("video_kling")],
  [getButtonLabel("video_ai_prompt"), getButtonLabel("video_saved_prompts")],
  [getButtonLabel("main_balance")],
  [getButtonLabel("back")]
]).resize();
const aiStudioMenu = () => Markup.keyboard([
  [getButtonLabel("ai_studio_trends")],
  [getButtonLabel("ai_studio_library")],
  [getButtonLabel("back")],
]).resize();
const infographicMenu = () => Markup.keyboard([
  [getButtonLabel("infographic_png")],
  [getButtonLabel("infographic_svg")],
  [getButtonLabel("back")],
]).resize();
const seedanceMenu  = () => Markup.keyboard([
  ["⚡ Авто анімація", "🎬 Анімація + промт"],
  ["🎥 Відео з тексту"],
  [getButtonLabel("back_video")]
]).resize();
const klingMenu     = () => Markup.keyboard([
  ["⚡ Авто анімація", "🎬 Анімація + промт"],
  ["🎥 Відео з тексту"],
  [getButtonLabel("back_video")]
]).resize();
const adminMenu       = () => Markup.keyboard([
  ["📊 Статус бота", "🌐 PROMTI Control"],
  ["📸 Static photo styles", "🔮 Dynamic photo styles"],
  ["🎬 Video presets", "🧩 OpenAI tools"],
  ["🔗 Content & Links", "📈 Аналітика"],
  ["📦 Пакети", "⚙️ Налаштування"],
  ["👥 Користувачі", "💳 Останні оплати"],
  ["👤 Мій ID", "🖼 Прикріпити фото"],
  ["🎨 Бібліотека стилів", "📝 Поточні тексти"],
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
  const promptSourceKey = payload.startsWith("prompt_") ? normalizePromptKey(payload.replace("prompt_", "")) : "";
  const startSource = payload.startsWith("prompt_")
    ? "style"
    : payload.startsWith("ref_")
      ? "referral"
      : "direct";
  queueAnalyticsUserTouch(ctx, user, {
    source: startSource,
  });
  queueLogEvent({
    user_id: ctx.from.id,
    event: "user_start",
    value: 1,
    style_id: promptSourceKey,
    extra: { source: payload.startsWith("prompt_") ? `style_${promptSourceKey}` : startSource },
  });
  if (isNew && START_PROMTI_BONUS > 0) {
    queueLogEvent({
      user_id: ctx.from.id,
      event: "free_promti_claimed",
      value: START_PROMTI_BONUS,
      style_id: promptSourceKey,
      extra: { source: startSource },
    });
  }
  if (isNew && payload.startsWith("ref_")) {
    const refId = Number(payload.replace("ref_", ""));
    if (refId && refId !== ctx.from.id) await handleReferral(ctx, refId);
  }
  if (payload.startsWith("chatgpt_")) {
    const trendKey = normalizePromptKey(payload.replace("chatgpt_", ""));
    const trend = getChatgptTrend(trendKey);
    if (trend && trend.isActive) {
      incrementChatgptTrendMetric(trend.key, "clicks");
      ctx.session.chatgptTrendKey = trend.key;
      ctx.session.mode = "chatgpt_trend";
      ctx.session.lastStateAt = Date.now();
      queueLogEvent({
        user_id: ctx.from.id,
        event: "chatgpt_trend_view",
        value: 1,
        style_id: trend.key,
        extra: { source: "deep_link" },
      });
      return sendChatgptTrendCard(ctx, trend.key, false);
    }
  }
  if (payload.startsWith("dynamic_")) {
    const targetKey = normalizePromptKey(payload.replace("dynamic_", ""));
    const resolved = resolveDynamicDeepLink(targetKey);
    if (resolved?.series) {
      incrementDynamicMetric(resolved.series.id, "clicks", resolved.variant?.id || null);
      queueLogEvent({
        user_id: ctx.from.id,
        event: "view_style",
        value: 1,
        style_id: buildDynamicStyleRef(resolved.series.id, resolved.variant?.id || ""),
        extra: { source: "deep_link_dynamic" },
      });
      if (resolved.variant) {
        const applied = applyDynamicVariantToSession(ctx, resolved.series.id, resolved.variant.id);
        if (applied) return sendDynamicVariantReadyMessage(ctx, applied.series, applied.variant);
      }
      return sendDynamicSeriesCard(ctx, resolved.series.id, false);
    }
  }
  if (payload.startsWith("prompt_")) {
    const promptKey = normalizePromptKey(payload.replace("prompt_", ""));
    const style = getPromptStyle(promptKey);
    if (style) {
      incrementPromptMetric(style.key, "clicks");
      applyPromptStyleToSession(ctx, style.key);
      user.sourcePromptKey = style.key;
      saveUsers();
      queueLogEvent({
        user_id: ctx.from.id,
        event: "view_style",
        value: 1,
        style_id: style.key,
        extra: { source: "deep_link" },
      });
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
  const adminPanelUrl = getAdminPanelUrl();
  return ctx.reply(
    [
      "🔧 PROMTI Control",
      "",
      "🌐 Веб-панель PROMTI Control:",
      adminPanelUrl,
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "📊 СТАТУС І АНАЛІТИКА",
      "━━━━━━━━━━━━━━━━━━━━━",
      "📊 Статус бота — ключі API, черга, воркери, помилки",
      "📈 Аналітика — конверсії, виручка, топ-пакети, графік 7 днів",
      "/analytics — детальна аналітика",
      "/today — сьогоднішня статистика",
      "/revenue — виручка по періодах",
      "/top — топ стилів, юзерів і продуктів",
      "/stats — Google Sheets",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "👥 КОРИСТУВАЧІ",
      "━━━━━━━━━━━━━━━━━━━━━",
      "👥 Користувачі — список останніх 15 юзерів",
      "👤 Мій ID — показати свій Telegram ID",
      "/userinfo ID — повна інформація про юзера",
      "/addpromti ID AMOUNT — нарахувати Promti юзеру",
      "/ban ID — заблокувати юзера",
      "/unban ID — розблокувати юзера",
      "/delete_user ID — видалити обліковий запис",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "💳 ОПЛАТИ І ПАКЕТИ",
      "━━━━━━━━━━━━━━━━━━━━━",
      "💳 Останні оплати — останні 15 транзакцій",
      "📦 Пакети — список усіх пакетів Promti",
      "/packages — переглянути всі пакети",
      "/setprice KEY PRICE — змінити ціну пакету",
      "/addpackage KEY promti COUNT PRICE TITLE — додати новий пакет",
      "/reset_packages — скинути пакети до дефолтних",
      "/setlink support_link URL — змінити посилання підтримки",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "🎨 СТИЛІ ТА ПРОМТИ",
      "━━━━━━━━━━━━━━━━━━━━━",
      "🧠 AI Studio — ChatGPT trends + бібліотека стилів",
      "🎨 Бібліотека стилів — усі static і dynamic стилі",
      "/stylewizard — покроковий майстер створення нового стилю",
      "/addprompt KEY | CATEGORY | TITLE | PROMPT — швидко додати static стиль",
      "/prompts — список усіх стилів з deep-link",
      "/delprompt KEY — видалити стиль",
      "/trendprompt KEY on|off — позначити стиль як трендовий",
      "/setpromptpreview KEY — задати preview photo стилю",
      `/setpromptexamples KEY — задати приклади стилю (до ${MAX_PROMPT_EXAMPLE_PHOTOS} фото)`,
      "/topprompts clicks|generations|purchases — топ стилів за метрикою",
      "/addchatgpttrend KEY | CATEGORY | TITLE | INPUT_TYPE | RESULT_TYPE | PROMPT — новий ChatGPT trend",
      "/chatgpttrends — список усіх ChatGPT trends",
      "/delchatgpttrend KEY — видалити trend",
      "/trendchatgpt KEY on|off — позначити trend як трендовий",
      "/setchatgptpreview KEY — задати preview для trend",
      "/threadtext KEY — тексти для Threads і deep-link",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "🧾 ІНФОГРАФІКИ",
      "━━━━━━━━━━━━━━━━━━━━━",
      "🧾 Інфографіка PNG — OpenAI генерація інфографіки з тексту або фото",
      "🔷 SVG логотип — OpenAI генерація чистого SVG-файлу",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "✏️ ТЕКСТИ ТА ФОТО",
      "━━━━━━━━━━━━━━━━━━━━━",
      "✏️ Змінити текст — редагувати welcome/info/help/prices/idea/support",
      "📝 Поточні тексти — переглянути всі тексти бота",
      "🖼 Прикріпити фото — фото до welcome/info/help/prices/idea/broadcast",
      "/repair_encoding — відновити тексти з volume",
      "/reset_content_clean — перезаписати текстові JSON чистими дефолтами",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "📢 РОЗСИЛКА",
      "━━━━━━━━━━━━━━━━━━━━━",
      "/broadcast TEXT — розсилка всім користувачам",
      "(якщо прикріплене 📷 broadcastPhoto — піде з фото)",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "⚙️ НАЛАШТУВАННЯ",
      "━━━━━━━━━━━━━━━━━━━━━",
      "⚙️ Налаштування — переглянути ліміти і таймаути",
      "(редагування — через settings.json + рестарт бота)",
      "",
      "━━━━━━━━━━━━━━━━━━━━━",
      "💡 ПІДКАЗКИ",
      "━━━━━━━━━━━━━━━━━━━━━",
      "• Основні секції тепер винесені в button-first PROMTI Control",
      "• Для dynamic стилю не потрібно лізти в JSON вручну — працюй через 🔮 Dynamic photo styles",
      "• Усі команди працюють тільки для адмінів",
      "• Для повного керування контентом — використовуй веб-панель"
    ].join("\n"),
    adminMenu()
  );
});


bot.command("stats", async (ctx) => {
  touchUser(ctx);
  if (!requireAdminAnalytics(ctx)) return;
  return ctx.reply(GOOGLE_SHEETS_URL);
});

bot.command("test_sheets", async (ctx) => {
  touchUser(ctx);
  if (!requireAdminAnalytics(ctx)) return;
  if (!isAnalyticsEnabled()) return ctx.reply("❌ помилка: Google Sheets не налаштовано");
  try {
    await ensureAnalyticsSheets();
    await logEvent({
      user_id: ctx.from.id,
      event: "test_sheets",
      value: 1,
      extra: { source: "admin_command" },
    });
    return ctx.reply("✅ Google Sheets працює");
  } catch (e) {
    console.error("TEST_SHEETS:", e.message);
    return ctx.reply(`❌ помилка: ${e.message}`);
  }
});

bot.command("today", async (ctx) => {
  touchUser(ctx);
  if (!requireAdminAnalytics(ctx)) return;
  if (!isAnalyticsEnabled()) return ctx.reply("Google Sheets аналітика не налаштована.");

  const snapshot = await loadAnalyticsSnapshot();
  const todayKey = getKyivDateKey();
  const successfulPayments = snapshot.payments.filter((payment) => isPaymentCreditedStatus(payment.status) && getKyivDateKey(payment.timestamp) === todayKey);
  const todayGenerations = snapshot.generations.filter((generation) => generation.status === "success" && getKyivDateKey(generation.timestamp) === todayKey);
  const newUsers = snapshot.users.filter((user) => getKyivDateKey(user.first_seen) === todayKey).length;

  return ctx.reply(
    [
      "📊 Today",
      "",
      `🖼 Генерацій: ${todayGenerations.length}`,
      `💳 Оплат: ${successfulPayments.length}`,
      `👥 Нових користувачів: ${newUsers}`,
    ].join("\n")
  );
});

bot.command("revenue", async (ctx) => {
  touchUser(ctx);
  if (!requireAdminAnalytics(ctx)) return;
  if (!isAnalyticsEnabled()) return ctx.reply("Google Sheets аналітика не налаштована.");

  const snapshot = await loadAnalyticsSnapshot();
  const successfulPayments = snapshot.payments.filter((payment) => isPaymentCreditedStatus(payment.status));
  const totalRevenue = successfulPayments.reduce((sum, payment) => sum + payment.amount, 0);

  return ctx.reply(
    [
      "💰 Revenue",
      "",
      `${totalRevenue} UAH`,
    ].join("\n")
  );
});

bot.command("top", async (ctx) => {
  touchUser(ctx);
  if (!requireAdminAnalytics(ctx)) return;
  if (!isAnalyticsEnabled()) return ctx.reply("Google Sheets аналітика не налаштована.");

  const snapshot = await loadAnalyticsSnapshot();
  const styleCounts = new Map();

  for (const generation of snapshot.generations) {
    if (generation.status !== "success") continue;
    const styleKey = generation.style_id || "-";
    styleCounts.set(styleKey, (styleCounts.get(styleKey) || 0) + 1);
  }

  const topStyles = [...styleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return ctx.reply(
    [
      "🏆 Top styles",
      "",
      formatTopList(topStyles),
    ].join("\n")
  );
});

bot.command("repair_encoding", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const results = runEncodingRepair();
  const touched = results.filter((item) => item.wrote || item.replaced > 0);
  if (!touched.length) return ctx.reply("Усі текстові файли вже чисті.");
  return ctx.reply(
    touched
      .map((item) => `${item.label}: замінено ${item.replaced} рядків`)
      .join("\n")
  );
});

bot.command("reset_content_clean", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const results = runEncodingRepair({ reset: true });
  return ctx.reply(results.map((item) => `Оновлено: ${item.label}`).join("\n"));
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
    examplePhotos: [],
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
  touchSessionState(ctx);

  return ctx.reply(
    `✅ Стиль створено\n\n` +
    `KEY: ${key}\n` +
    `Категорія: ${category}\n` +
    `Назва: ${title}\n\n` +
    `Deep-link:\n${deepLink}\n\n` +
    `Можеш одразу надіслати preview-фото для цього стилю або зробити це пізніше через /setpromptpreview ${key}\n` +
    `Для прикладів стилю використовуй /setpromptexamples ${key} — можна додати до ${MAX_PROMPT_EXAMPLE_PHOTOS} фото.`
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
    `examples: ${getPromptExamplePhotos(style).length}/${MAX_PROMPT_EXAMPLE_PHOTOS}\n` +
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
  touchSessionState(ctx);
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

function buildAnalyticsText() {
  const all = Object.values(users);
  const paid = payments.filter((payment) => isPaymentCreditedStatus(payment.status));

  const packCount = {};
  paid.forEach((payment) => {
    packCount[payment.packKey] = (packCount[payment.packKey] || 0) + 1;
  });
  const topPacks = Object.entries(packCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => `  ${key}: ${count} разів`)
    .join("\n");

  const now = Date.now();
  const DAY = 86400000;
  const revenueByDay = {};
  for (let index = 6; index >= 0; index -= 1) {
    const dateKey = new Date(now - index * DAY).toISOString().slice(0, 10);
    revenueByDay[dateKey] = 0;
  }
  paid.forEach((payment) => {
    const dateKey = (payment.updatedAt || payment.createdAt || "").slice(0, 10);
    if (revenueByDay[dateKey] !== undefined) revenueByDay[dateKey] += Number(payment.amount || 0);
  });
  const revenueChart = Object.entries(revenueByDay)
    .map(([dateKey, amount]) => `  ${dateKey.slice(5)}: ${amount} грн`)
    .join("\n");

  const totalUsers = all.length;
  const payingUsers = all.filter((user) => (user.totalSpent || 0) > 0).length;
  const activeUsers = all.filter((user) => (user.generations || 0) > 0 || (user.seedanceGenerations || 0) > 0 || (user.klingGenerations || 0) > 0).length;
  const conversion = totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : 0;
  const activeConversion = activeUsers > 0 ? ((payingUsers / activeUsers) * 100).toFixed(1) : 0;

  const totalRevenue = paid.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const avgCheck = payingUsers > 0 ? Math.round(totalRevenue / payingUsers) : 0;
  const triedNoPayment = all.filter((user) =>
    ((user.generations || 0) > 0 || (user.seedanceGenerations || 0) > 0 || (user.klingGenerations || 0) > 0) &&
    (user.totalSpent || 0) === 0
  ).length;
  const repeatBuyers = all.filter((user) => paid.filter((payment) => payment.userId == user.id).length > 1).length;

  return (
    `📊 Аналітика\n\n` +
    `👥 Юзери: ${totalUsers} всього\n` +
    `  🔥 Активних: ${activeUsers}\n` +
    `  💳 Платних: ${payingUsers}\n` +
    `  😶 Спробували і пішли: ${triedNoPayment}\n\n` +
    `💰 Конверсія:\n` +
    `  Всі→платні: ${conversion}%\n` +
    `  Активні→платні: ${activeConversion}%\n\n` +
    `💵 Фінанси:\n` +
    `  Всього: ${totalRevenue} грн\n` +
    `  Середній чек: ${avgCheck} грн\n` +
    `  Повторні покупки: ${repeatBuyers} юзерів\n\n` +
    `📦 Топ пакети:\n${topPacks || "  немає даних"}\n\n` +
    `📅 Виручка (7 днів):\n${revenueChart}`
  );
}

function buildPackagesText({ multiline = true } = {}) {
  const packages = Object.values(getPackages());
  const separator = multiline ? "\n\n" : "\n";
  const body = packages
    .map((pack) =>
      multiline
        ? `${pack.key}\n  💰 ${pack.amount} грн | ${pack.promti || pack.count || 0} ✨ | ${pack.type}${pack.model ? " / " + pack.model : ""}`
        : `${pack.key}: ${pack.amount} грн | ${pack.promti || pack.count || 0} ✨ | ${pack.type}${pack.model ? "/" + pack.model : ""}`
    )
    .join(separator);

  return (
    `${multiline ? "📦 Всі пакети" : "📦 Пакети"}:\n\n${body}\n\n` +
    `Змінити ціну:\n/setprice promti_pack10 120\n\n` +
    `Додати пакет:\n/addpackage KEY promti COUNT PRICE TITLE\n\n` +
    `Посилання:\n/setlink support_link https://t.me/support`
  );
}

bot.command("analytics", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAnalyticsText());
});

bot.command("packages", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildPackagesText({ multiline: true }));
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
    `${s.hasOpenAiKey    ? "✅" : "❌"} OPENAI_API_KEY\n` +
    `${s.hasFalKey       ? "✅" : "❌"} FAL_KEY\n` +
    `${s.hasWfp          ? "✅" : "❌"} WayForPay\n` +
    `${s.hasGoogleSheets ? "✅" : "❌"} Google Sheets\n` +
    `${s.hasAnthropicKey ? "✅" : "❌"} Anthropic fallback\n` +
    `${s.aiPromptEnabled ? "✅" : "⏸"} AI промт: ${s.aiPromptEnabled ? "увімкнено" : "вимкнено"}\n` +
    `${s.videoEnabled    ? "✅" : "⏸"} Відео: ${s.videoEnabled ? "увімкнено" : "вимкнено"}\n\n` +
    `🧠 defaultImageProvider: ${s.defaultImageProvider}\n` +
    `🖼 defaultImageModel: ${s.defaultImageModel}\n` +
    `🎨 defaultOpenAIImageModel: ${s.defaultOpenAIImageModel}\n` +
    `✍️ defaultPromptModel: ${s.defaultPromptModel}\n` +
    `🗃 aiPromptCacheEnabled: ${s.aiPromptCacheEnabled ? "true" : "false"}\n` +
    `🎨 prompt library: ${s.promptLibraryCount}\n` +
    `🔥 chatgpt trends: ${s.chatgptTrendsCount}\n\n` +
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

bot.hears("🌐 PROMTI Control", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAdminSectionText("web"), buildAdminPanelKeyboard());
});

bot.hears("📸 Static photo styles", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAdminSectionText("static"), buildAdminPanelKeyboard("static"));
});

bot.hears("🔮 Dynamic photo styles", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAdminSectionText("dynamic"), buildAdminPanelKeyboard("dynamic"));
});

bot.hears("🎬 Video presets", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAdminSectionText("video"), buildAdminPanelKeyboard("video"));
});

bot.hears("🧩 OpenAI tools", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAdminSectionText("openai"), buildAdminPanelKeyboard("openai"));
});

bot.hears("🔗 Content & Links", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAdminSectionText("content"), buildAdminPanelKeyboard("content"));
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
  const SKIP_KEYS = new Set([
    "promptLibrary", "promptCategories", "styleLibrary",
    "welcomePhoto", "infoPhoto", "helpPhoto",
    "pricesPhoto", "ideaPhoto", "broadcastPhoto",
  ]);
  const textOnlyEntries = Object.entries(content).filter(([k, v]) =>
    !SKIP_KEYS.has(k) && typeof v !== "object"
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
    `Для швидкого mobile-first редагування відкрий Settings у PROMTI Control.`,
    buildAdminPanelKeyboard("settings")
  );
});

bot.hears("📈 Аналітика", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildAnalyticsText(), adminMenu());
});

bot.hears("📦 Пакети", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply(buildPackagesText({ multiline: false }), adminMenu());
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
  const user = touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.", adminMenu());
  queueLogEvent({
    user_id: ctx.from.id,
    event: "click_buy_promti",
    value: 1,
    style_id: user.sourcePromptKey || ctx.session?.currentPromptKey || "",
    extra: { source: "menu" },
  });
  queueLogEvent({
    user_id: ctx.from.id,
    event: "paywall_shown",
    value: 1,
    style_id: user.sourcePromptKey || ctx.session?.currentPromptKey || "",
    extra: { source: "menu" },
  });
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
    `🎁 При реєстрації: ${START_PROMTI_BONUS} Promti ✨ безкоштовно`,
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
  queueLogEvent({
    user_id: userId,
    event: "click_share_style",
    value: 1,
    style_id: user.sourcePromptKey || ctx.session?.currentPromptKey || "",
    extra: { source: "referral_menu" },
  });
  return ctx.reply(
    `👫 Реферальна програма\n\n` +
    `Запроси друга — отримай бонус!\n` +
    `🎁 За кожного друга який оплатить: +${REFERRAL_PROMTI_BONUS} Promti ✨\n\n` +
    `📊 Твоя статистика:\n` +
    `  Запрошено друзів: ${count}\n` +
    `  Зароблено: +${earned} Promti ✨\n\n` +
    `🔗 Твоє посилання:\n${refLink}\n\n` +
    `💡 Поділись з друзями — вони отримають ${START_PROMTI_BONUS} Promti ✨ безкоштовно при реєстрації!`,
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
  ctx.session.lastStateAt = Date.now();
  return ctx.reply(getButtonHint("main_photo"), photoMenu());
});
bot.hears("🧠 AI Studio", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  queueLogEvent({
    user_id: ctx.from.id,
    event: "open_ai_studio",
    value: 1,
    style_id: ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || getUser(ctx.from.id).sourcePromptKey || "",
    extra: { source: "main_menu" },
  });
  return ctx.reply(getButtonHint("main_ai_studio"), aiStudioMenu());
});
bot.hears("📚 Бібліотека стилів", (ctx) => {
  const user = touchUser(ctx); ensureSession(ctx);
  queueLogEvent({
    user_id: ctx.from.id,
    event: "open_style_library",
    value: 1,
    style_id: user.sourcePromptKey || ctx.session?.currentPromptKey || "",
    extra: { source: "ai_studio" },
  });
  return sendPromptLibraryPage(ctx, 0, false);
});
bot.hears("🔥 Тренди ChatGPT", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  queueLogEvent({
    user_id: ctx.from.id,
    event: "open_chatgpt_trends",
    value: 1,
    style_id: "",
    extra: { source: "ai_studio" },
  });
  return sendChatgptTrendLibraryPage(ctx, 0, false);
});
bot.hears("🎨 Трендові стилі", (ctx) => {
  const user = touchUser(ctx); ensureSession(ctx);
  queueLogEvent({
    user_id: ctx.from.id,
    event: "click_more_variants",
    value: 1,
    style_id: user.sourcePromptKey || ctx.session?.currentPromptKey || "",
    extra: { source: "trending_menu" },
  });
  return sendPromptLibraryPage(ctx, 0, false);
});
bot.hears("🧾 Інфографіки", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  return ctx.reply(getButtonHint("main_infographics"), infographicMenu());
});
bot.hears("⭐ Мої промти", (ctx) => {
  const user = touchUser(ctx); ensureSession(ctx);
  const mode = ctx.session?.mode === "video" ? "video" : ctx.session?.mode === "photo" ? "photo" : null;
  const keyboard = buildSavedPromptsKeyboard(user, mode);
  if (!keyboard) {
    return ctx.reply(
      mode === "video"
        ? "⭐ У тебе ще немає збережених відео-промтів."
        : mode === "photo"
          ? "⭐ У тебе ще немає збережених фото-промтів."
          : "⭐ У тебе ще немає збережених промтів.",
      mode === "video" ? videoMenu() : photoMenu()
    );
  }
  return ctx.reply("⭐ Твої збережені промти:", keyboard);
});
bot.hears("🧾 Інфографіка PNG", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  resetState(ctx);
  ctx.session.mode = "infographic";
  ctx.session.infographicMode = "png";
  ctx.session.awaitingInfographicInput = true;
  touchSessionState(ctx);
  return ctx.reply(getButtonHint("infographic_png"), infographicMenu());
});
bot.hears("🔷 SVG логотип", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  resetState(ctx);
  ctx.session.mode = "infographic";
  ctx.session.infographicMode = "svg";
  ctx.session.awaitingInfographicInput = true;
  touchSessionState(ctx);
  return ctx.reply(getButtonHint("infographic_svg"), infographicMenu());
});
bot.hears("🎬 Відео", (ctx) => {
  const cfg = loadSettings();
  if (!cfg.videoEnabled) return ctx.reply("🎬 Відео тимчасово недоступне. Спробуй пізніше.", mainMenu());
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video";
  ctx.session.lastStateAt = Date.now();
  return ctx.reply(getButtonHint("main_video"), videoMenu());
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
  touchSessionState(ctx);
  return ctx.reply(getButtonHint("photo_edit"), photoMenu());
});

bot.hears("✨ Створити фото", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  ctx.session.photoMode = "create";
  ctx.session.customType = "create_photo";
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  touchSessionState(ctx);
  return ctx.reply(getButtonHint("photo_create"), photoMenu());
});

// ─── ВІДЕО МОДЕЛІ ─────────────────────────────────────────────────────────────
bot.hears("🎬 Seedance", (ctx) => {
  return openVideoModelFlow(ctx, "seedance", "video_menu");
});

bot.hears("⚡ Авто анімація", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("Спочатку обери модель: 🎬 Seedance або 🎥 Kling", videoMenu());
  ctx.session.videoInputMode = "image";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = null;
  touchSessionState(ctx);
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
  touchSessionState(ctx);
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
  touchSessionState(ctx);
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  return ctx.reply(
    `🎥 Відео з тексту\n\nНапиши детальний промт — створю відео з нуля!\n\nПриклад: "cinematic portrait of woman, wind in hair, golden hour"\n\n💡 t.me/promteamai`,
    menu
  );
});

bot.command("setpromptexamples", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");

  const key = normalizePromptKey(ctx.message.text.replace(/^\/setpromptexamples(@\w+)?\s*/i, ""));
  const style = getPromptStyle(key);
  if (!style) return ctx.reply(`❌ Стиль "${key}" не знайдено.`);

  ctx.session.awaitingPromptExamplesKey = key;
  touchSessionState(ctx);
  return ctx.reply(
    `🧩 Надсилай приклади для стилю "${key}".\n` +
    `Можна додати від 1 до ${MAX_PROMPT_EXAMPLE_PHOTOS} фото.\n` +
    `Кожне нове фото буде додаватися в список.\n\n` +
    `Команди текстом:\n` +
    `• "готово" — завершити\n` +
    `• "видалити" — очистити всі приклади`
  );
});

bot.command("addchatgpttrend", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const raw = ctx.message.text.replace(/^\/addchatgpttrend(@\w+)?\s*/i, "");
  const parts = raw.split("|").map((part) => part.trim());
  if (parts.length < 6) {
    return ctx.reply("Формат: /addchatgpttrend KEY | CATEGORY | TITLE | INPUT_TYPE | RESULT_TYPE | PROMPT");
  }
  const [rawKey, category, title, inputType, resultType, ...promptParts] = parts;
  const key = normalizePromptKey(rawKey);
  const promptText = promptParts.join(" | ").trim();
  if (!key || !promptText) return ctx.reply("❌ Некоректні дані.");
  if (getChatgptTrend(key)) return ctx.reply(`❌ Trend "${key}" вже існує.`);
  ensureChatgptTrendLibrary();
  content.chatgptTrendLibrary[key] = normalizeChatgptTrendItem({
    key,
    category,
    title,
    inputType,
    resultType,
    promptText,
    createdAt: Date.now(),
  }, key);
  saveContent();
  const botUsername = await resolveBotUsername(ctx);
  return ctx.reply(`✅ ChatGPT trend створено.\n\nDeep-link:\nhttps://t.me/${botUsername}?start=chatgpt_${key}`);
});

bot.command("chatgpttrends", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const items = getSortedChatgptTrends();
  if (!items.length) return ctx.reply("ChatGPT trends порожні.");
  const botUsername = await resolveBotUsername(ctx);
  const text = items.map((trend) =>
    `${trend.isTrending ? "🔥 " : ""}${trend.title}\n` +
    `key: ${trend.key}\n` +
    `category: ${trend.category}\n` +
    `input: ${trend.inputType}\n` +
    `deep-link: https://t.me/${botUsername}?start=chatgpt_${trend.key}`
  ).join("\n\n");
  return replyLongText(ctx, text, adminMenu());
});

bot.command("delchatgpttrend", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const key = normalizePromptKey(ctx.message.text.replace(/^\/delchatgpttrend(@\w+)?\s*/i, ""));
  if (!getChatgptTrend(key)) return ctx.reply(`❌ Trend "${key}" не знайдено.`);
  delete content.chatgptTrendLibrary[key];
  saveContent();
  return ctx.reply(`✅ Trend "${key}" видалено.`);
});

bot.command("trendchatgpt", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const [, rawKey, rawValue] = ctx.message.text.split(/\s+/);
  const key = normalizePromptKey(rawKey);
  const trend = getChatgptTrend(key);
  if (!trend) return ctx.reply(`❌ Trend "${key}" не знайдено.`);
  if (!["on", "off"].includes((rawValue || "").toLowerCase())) return ctx.reply("Формат: /trendchatgpt KEY on|off");
  trend.isTrending = rawValue.toLowerCase() === "on";
  content.chatgptTrendLibrary[key] = trend;
  saveContent();
  return ctx.reply(`✅ Trend "${key}" тренд-статус: ${trend.isTrending ? "ON" : "OFF"}`);
});

bot.command("setchatgptpreview", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const key = normalizePromptKey(ctx.message.text.replace(/^\/setchatgptpreview(@\w+)?\s*/i, ""));
  if (!getChatgptTrend(key)) return ctx.reply(`❌ Trend "${key}" не знайдено.`);
  ctx.session.awaitingChatgptPreviewKey = key;
  touchSessionState(ctx);
  return ctx.reply(`🖼 Надішли preview для trend "${key}" або напиши "видалити".`, adminMenu());
});

bot.command("threadtext", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  const key = normalizePromptKey(ctx.message.text.replace(/^\/threadtext(@\w+)?\s*/i, ""));
  const trend = getChatgptTrend(key);
  if (!trend) return ctx.reply(`❌ Trend "${key}" не знайдено.`);
  const botUsername = await resolveBotUsername(ctx);
  return ctx.reply(
    `Title: ${trend.title}\n\n` +
    `Post text:\n${trend.threadPostText || "-"}\n\n` +
    `Comment text:\n${trend.threadCommentText || "-"}\n\n` +
    `Deep-link:\nhttps://t.me/${botUsername}?start=chatgpt_${trend.key}`
  );
});

bot.command("importdynamic", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  dynamicStyleLibrary = normalizeDynamicPromptsStore(loadJson(DYNAMIC_PROMPTS_PATH, DEFAULT_DYNAMIC_PROMPTS));
  saveDynamicStyles();
  return ctx.reply(`✅ Dynamic styles імпортовано.\nСерій: ${Object.keys(dynamicStyleLibrary || {}).length}\nКерування доступне через /admin → 🔮 Dynamic photo styles`);
});

bot.command("stylewizard", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  return ctx.reply("🧙 Style Wizard перенесено у PROMTI Control.\nВідкрий /admin і створи static або dynamic style через кнопки.");
});

function openVideoModelFlow(ctx, style, source = "video_menu") {
  const cfg = loadSettings();
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video";
  ctx.session.style = style;
  ctx.session.customType = null;
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = null;
  ctx.session.videoInputMode = null;
  touchSessionState(ctx);
  const user = getUser(ctx.from.id);

  if (style === "seedance") {
    if (cfg.seedanceEnabled === false) {
      return ctx.reply(cfg.seedanceComingSoonText || "🎬 Seedance тимчасово недоступний. Скоро повернеться! Спробуй 🎥 Kling.", videoMenu());
    }
    return ctx.reply(
      "🎬 Seedance 2.0\n\n" +
      "Спеціалізується на анімації об'єктів, природи, мультиплікації та фантастичних сцен.\n\n" +
      "⚡ Авто анімація — надішли фото, оживлю автоматично\n" +
      "🎬 Анімація + промт — надішли фото зі своїм описом руху\n" +
      "🎥 Відео з тексту — створи відео з нуля по промту\n\n" +
      "⛔️ Для людей і портретів краще використовувати Kling\n\n" +
      "💡 Ідеї: t.me/promteamai",
      seedanceMenu()
    );
  }

  queueLogEvent({
    user_id: ctx.from.id,
    event: "click_animate_kling",
    value: 1,
    style_id: ctx.session.currentPromptKey || ctx.session.sourcePromptKey || user.sourcePromptKey || "",
    extra: { source },
  });
  return ctx.reply(
    "🎥 Kling\n\n" +
    "📸 Фото → Відео — надішли фото + промт, оживлю!\n" +
    "✍️ Текст → Відео — напиши промт, створю кінематографічне відео\n\n" +
    "Приклад: \"cinematic close-up, soft bokeh\"\n\n" +
    "💡 Ідеї: t.me/promteamai",
    klingMenu()
  );
}

bot.hears("🎥 Kling", (ctx) => {
  return openVideoModelFlow(ctx, "kling", "video_menu");
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
  touchSessionState(ctx);
  return ctx.reply(getButtonHint("photo_ai_prompt", "🤖 Надішли фото — я запропоную промт для генерації."), photoMenu());
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
  touchSessionState(ctx);
  const label = ctx.session.style === "kling" ? "🎥 Kling" : "🎬 Seedance";
  return ctx.reply(getButtonHint("video_ai_prompt", `🤖 AI промт для відео (${label})\n\nНадішли:\n📸 Фото — опишу рух\n🎬 Відео до 10 сек — проаналізую рух\n\nПромт: макс. 10 слів.`), videoMenu());
});

// ─── ПОКУПКА ──────────────────────────────────────────────────────────────────
async function sendAutoPayment(ctx, packKey) {
  try {
    const user = touchUser(ctx);
    const pack = getPackages()[packKey];
    if (pack) {
      queueLogEvent({
        user_id: ctx.from.id,
        event: "click_buy_promti",
        value: Number(pack.amount || 0),
        style_id: user.lastGeneratedPromptKey || user.sourcePromptKey || ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || "",
        extra: { packKey, title: pack.title, amount: pack.amount || 0 },
      });
    }
    if (!pack) return ctx.reply("❌ Пакет не знайдено.");
    const { invoiceUrl, orderReference } = await createWayForPayInvoice(ctx.from.id, packKey);
    user.pendingOrderReference = orderReference;
    user.lastPaymentRequest    = { packKey, createdAt: new Date().toISOString() };
    user.pendingPurchasePromptKey = user.lastGeneratedPromptKey || user.sourcePromptKey || ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || null;
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
    const user = touchUser(ctx);
    if (isAdmin(ctx.from.id)) return ctx.reply("✅ Адмін — безкоштовно.");
    queueLogEvent({
      user_id: ctx.from.id,
      event: "paywall_shown",
      value: 1,
      style_id: user.lastGeneratedPromptKey || user.sourcePromptKey || ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || "",
      extra: { source: "inline_upsell" },
    });
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

bot.action("upsell_video_seedance", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return openVideoModelFlow(ctx, "seedance", "post_photo_upsell");
  } catch (e) {
    console.error("UPSELL VIDEO SEEDANCE:", e.message);
    try { await ctx.reply("❌ Не вдалося відкрити Seedance. Спробуй ще раз.", videoMenu()); } catch {}
  }
});

bot.action("upsell_video_kling", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return openVideoModelFlow(ctx, "kling", "post_photo_upsell");
  } catch (e) {
    console.error("UPSELL VIDEO KLING:", e.message);
    try { await ctx.reply("❌ Не вдалося відкрити Kling. Спробуй ще раз.", videoMenu()); } catch {}
  }
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
    const promptKey = normalizePromptKey(ctx.match[1]);
    const style = getPromptStyle(promptKey);
    if (style) {
      queueLogEvent({
        user_id: ctx.from.id,
        event: "view_style",
        value: 1,
        style_id: style.key,
        extra: { source: "library" },
      });
    }
    return sendPromptStyleCard(ctx, promptKey, false);
  } catch (e) { console.error("PROMPTLIB OPEN:", e.message); }
});

bot.action(/^promptlib_example:([^:]+):(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Показую приклад ракурсу");
    return sendPromptExampleSelection(ctx, normalizePromptKey(ctx.match[1]), Number(ctx.match[2]));
  } catch (e) {
    console.error("PROMPTLIB EXAMPLE:", e.message);
  }
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
    touchSessionState(ctx);
    return ctx.reply(`🖼 Надішли preview-фото для стилю "${key}" або напиши "видалити".`, adminMenu());
  } catch (e) { console.error("ADMIN PROMPTLIB PREVIEW:", e.message); }
});

bot.action(/^admin_promptlib_examples_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Надсилай приклади стилю");
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const style = getPromptStyle(key);
    if (!style) return ctx.reply("❌ Стиль не знайдено.");
    ctx.session.awaitingPromptExamplesKey = key;
    touchSessionState(ctx);
    return ctx.reply(
      `🧩 Надсилай приклади для стилю "${key}".\n` +
      `Зараз збережено: ${getPromptExamplePhotos(style).length}/${MAX_PROMPT_EXAMPLE_PHOTOS}\n\n` +
      `• "готово" — завершити\n` +
      `• "видалити" — очистити всі приклади`,
      adminMenu()
    );
  } catch (e) { console.error("ADMIN PROMPTLIB EXAMPLES:", e.message); }
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

bot.action(/^chatgpttrend_page_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return sendChatgptTrendLibraryPage(ctx, Number(ctx.match[1] || 0), false);
  } catch (e) { console.error("CHATGPTTREND PAGE:", e.message); }
});

bot.action(/^admin_chatgpttrend_page_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    return sendChatgptTrendLibraryPage(ctx, Number(ctx.match[1] || 0), true);
  } catch (e) { console.error("ADMIN CHATGPTTREND PAGE:", e.message); }
});

bot.action(/^chatgpttrend_open_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const key = normalizePromptKey(ctx.match[1]);
    const trend = getChatgptTrend(key);
    if (trend) {
      incrementChatgptTrendMetric(key, "clicks");
      queueLogEvent({
        user_id: ctx.from.id,
        event: "chatgpt_trend_view",
        value: 1,
        style_id: key,
        extra: { source: "library" },
      });
    }
    return sendChatgptTrendCard(ctx, key, false);
  } catch (e) { console.error("CHATGPTTREND OPEN:", e.message); }
});

bot.action(/^admin_chatgpttrend_open_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    return sendChatgptTrendCard(ctx, normalizePromptKey(ctx.match[1]), true);
  } catch (e) { console.error("ADMIN CHATGPTTREND OPEN:", e.message); }
});

bot.action(/^chatgpttrend_use_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Trend завантажено ✅");
    const key = normalizePromptKey(ctx.match[1]);
    const trend = getChatgptTrend(key);
    if (!trend || !trend.isActive) return ctx.reply("❌ Trend недоступний.");
    activateChatgptTrendSession(ctx, trend);
    incrementChatgptTrendMetric(key, "clicks");
    return ctx.reply(
      trend.inputType === "photo"
        ? `🔥 ${trend.title}\n\nНадішли фото.`
        : trend.inputType === "text"
          ? `🔥 ${trend.title}\n\nНадішли текстовий запит.`
          : `🔥 ${trend.title}\n\nНадішли фото або текстовий запит.`,
      mainMenu()
    );
  } catch (e) { console.error("CHATGPTTREND USE:", e.message); }
});

bot.action(/^admin_chatgpttrend_trend_(.+)_(on|off)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const trend = getChatgptTrend(key);
    if (!trend) return ctx.reply("❌ Trend не знайдено.");
    trend.isTrending = ctx.match[2] === "on";
    content.chatgptTrendLibrary[key] = trend;
    saveContent();
    return sendChatgptTrendCard(ctx, key, true);
  } catch (e) { console.error("ADMIN CHATGPTTREND TREND:", e.message); }
});

bot.action(/^admin_chatgpttrend_preview_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Надішли preview");
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    if (!getChatgptTrend(key)) return ctx.reply("❌ Trend не знайдено.");
    ctx.session.awaitingChatgptPreviewKey = key;
    touchSessionState(ctx);
    return ctx.reply(`🖼 Надішли preview для trend "${key}" або напиши "видалити".`, adminMenu());
  } catch (e) { console.error("ADMIN CHATGPTTREND PREVIEW:", e.message); }
});

bot.action(/^admin_chatgpttrend_delete_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    if (!getChatgptTrend(key)) return ctx.reply("❌ Trend не знайдено.");
    delete content.chatgptTrendLibrary[key];
    saveContent();
    return ctx.reply(`✅ Trend "${key}" видалено.`, adminMenu());
  } catch (e) { console.error("ADMIN CHATGPTTREND DELETE:", e.message); }
});

bot.action("chatgpttrend_noop", async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
});
bot.action("admin_chatgpttrend_noop", async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
});

bot.action(/^dynamic_variant_open:(.+):(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Стиль завантажено ✅");
    const seriesId = normalizePromptKey(ctx.match[1]);
    const variantId = normalizePromptKey(ctx.match[2]);
    const applied = applyDynamicVariantToSession(ctx, seriesId, variantId);
    if (!applied) return ctx.reply("❌ Variant недоступний.");
    incrementDynamicMetric(seriesId, "clicks", variantId);
    queueLogEvent({
      user_id: ctx.from.id,
      event: "view_style",
      value: 1,
      style_id: buildDynamicStyleRef(seriesId, variantId),
      extra: { source: "dynamic_library" },
    });
    return sendDynamicVariantReadyMessage(ctx, applied.series, applied.variant);
  } catch (e) { console.error("DYNAMIC VARIANT OPEN:", e.message); }
});

bot.action("dynamic_retry_photo", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    ensureSession(ctx);
    if (ctx.session.currentDynamicSeriesId && ctx.session.currentDynamicVariantId) {
      const applied = applyDynamicVariantToSession(ctx, ctx.session.currentDynamicSeriesId, ctx.session.currentDynamicVariantId);
      if (applied) {
        return ctx.reply("🔁 Надішли selfie ще раз — згенерую новий варіант.", photoMenu());
      }
    }
    if (ctx.session.currentPromptKey) {
      const style = applyPromptStyleToSession(ctx, ctx.session.currentPromptKey);
      if (style) return ctx.reply("🔁 Надішли selfie ще раз — згенерую новий варіант.", photoMenu());
    }
    return ctx.reply("Оберіть стиль заново.", mainMenu());
  } catch (e) { console.error("DYNAMIC RETRY PHOTO:", e.message); }
});

bot.action(/^apply_ai_prompt_(photo|video)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("✅ Промт застосовано! Надішли фото.");
    const aiMode = ctx.match[1];
    await ctx.reply(
      `✅ Промт збережено:\n\n📝 <code>${escapeHtml(ctx.session.customPrompt || "-")}</code>\n\nНадішли фото 📸`,
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

bot.action(/^save_ai_prompt_(photo|video)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const mode = ctx.match[1];
    const user = touchUser(ctx);
    const promptText = ctx.session?.customPrompt || "";
    if (!promptText) return ctx.reply("❌ Немає промту для збереження.");
    const saved = saveUserPrompt(user, {
      promptText,
      mode,
      title: `${mode === "video" ? "Video" : "Photo"} prompt ${new Date().toLocaleDateString("uk-UA")}`,
    });
    if (!saved) return ctx.reply("❌ Не вдалося зберегти промт.");
    return ctx.reply(`💾 Промт збережено: ${saved.title}`, mode === "video" ? videoMenu() : photoMenu());
  } catch (e) { console.error("SAVE AI PROMPT:", e.message); }
});

bot.action(/^savedprompt_use_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Промт застосовано ✅");
    const user = touchUser(ctx);
    const item = getSavedPrompt(user, ctx.match[1]);
    if (!item) return ctx.reply("❌ Промт не знайдено.");
    ensureSession(ctx);
    ctx.session.mode = item.mode;
    ctx.session.customPrompt = item.promptText;
    ctx.session.awaitingCustomPrompt = false;
    ctx.session.lastStateAt = Date.now();
    if (item.mode === "video") {
      if (!ctx.session.style) ctx.session.style = "seedance";
      ctx.session.customType = `custom_video_${ctx.session.style}`;
    } else {
      ctx.session.photoMode = "edit";
      ctx.session.customType = "custom_photo";
    }
    item.lastUsedAt = Date.now();
    saveUsersSync();
    return ctx.reply(
      `✅ Промт застосовано:\n\n📝 <code>${escapeHtml(item.promptText)}</code>\n\nНадішли ${item.mode === "video" ? "фото для відео" : "своє фото"} 📸`,
      { parse_mode: "HTML", ...(item.mode === "video" ? videoMenu() : photoMenu()) }
    );
  } catch (e) { console.error("USE SAVED PROMPT:", e.message); }
});

bot.action(/^savedprompt_delete_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Промт видалено");
    const user = touchUser(ctx);
    user.savedPrompts = (Array.isArray(user.savedPrompts) ? user.savedPrompts : []).filter((item) => item.id !== ctx.match[1]);
    saveUsersSync();
    const mode = ctx.session?.mode === "video" ? "video" : "photo";
    const keyboard = buildSavedPromptsKeyboard(user, mode);
    if (!keyboard) return ctx.reply("⭐ Збережених промтів більше немає.", mode === "video" ? videoMenu() : photoMenu());
    return ctx.reply("⭐ Оновлений список промтів:", keyboard);
  } catch (e) { console.error("DELETE SAVED PROMPT:", e.message); }
});

bot.action("savedprompt_back", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    return ctx.reply("↩️ Повертаю в меню.", ctx.session?.mode === "video" ? videoMenu() : photoMenu());
  } catch (e) { console.error("SAVED PROMPT BACK:", e.message); }
});

// ─── ТЕКСТОВИЙ ХЕНДЛЕР ────────────────────────────────────────────────────────
const ALL_BUTTONS = [
  "🖼 Фото","🎬 Відео","🧠 AI Studio","🎨 Трендові стилі","🔥 Тренди ChatGPT","📚 Бібліотека стилів","🧾 Інфографіки","🧾 Інфографіка PNG","🔷 SVG логотип","⭐ Мої промти","📊 Баланс","💡 Ідея для промтів","ℹ️ Інформація","❓ Допомога","🆘 Підтримка","💰 Ціни",
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

    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptExamplesKey) {
      const key = ctx.session.awaitingPromptExamplesKey;
      const style = getPromptStyle(key);
      const normalizedText = text.toLowerCase().trim();
      if (!style) {
        ctx.session.awaitingPromptExamplesKey = null;
        return ctx.reply(`❌ Стиль "${key}" не знайдено.`, adminMenu());
      }
      if (normalizedText === "готово" || normalizedText === "стоп") {
        ctx.session.awaitingPromptExamplesKey = null;
        return ctx.reply(
          `✅ Збереження прикладів для "${key}" завершено.\n` +
          `Усього прикладів: ${getPromptExamplePhotos(style).length}/${MAX_PROMPT_EXAMPLE_PHOTOS}`,
          adminMenu()
        );
      }
      if (normalizedText === "видалити") {
        ctx.session.awaitingPromptExamplesKey = null;
        style.examplePhotos = [];
        content.promptLibrary[key] = normalizePromptLibraryItem(style, key);
        saveContent();
        return ctx.reply(`✅ Усі приклади для "${key}" видалено.`, adminMenu());
      }
    }

    if (isAdmin(ctx.from.id) && ctx.session.awaitingChatgptPreviewKey) {
      const key = ctx.session.awaitingChatgptPreviewKey;
      const trend = getChatgptTrend(key);
      const normalizedText = text.toLowerCase().trim();
      if (!trend) {
        ctx.session.awaitingChatgptPreviewKey = null;
        return ctx.reply(`❌ Trend "${key}" не знайдено.`, adminMenu());
      }
      if (normalizedText === "видалити") {
        ctx.session.awaitingChatgptPreviewKey = null;
        trend.previewPhoto = null;
        content.chatgptTrendLibrary[key] = normalizeChatgptTrendItem(trend, key);
        saveContent();
        return ctx.reply(`✅ Preview для trend "${key}" видалено.`, adminMenu());
      }
    }

    if (ctx.session.mode === "infographic" && ctx.session.awaitingInfographicInput) {
      const infographicMode = ctx.session.infographicMode;
      if (infographicMode === "svg") {
        if (userGenerating.has(ctx.from.id)) return ctx.reply("⏳ Зачекай, ще обробляється...");
        userGenerating.add(ctx.from.id);
        try {
          await runSvgLogoFlow({
            ctx,
            user,
            userId: ctx.from.id,
            promptText: text,
          });
          resetState(ctx);
          return ctx.reply("✅ SVG логотип готовий. Можеш створити ще один або повернутися в меню.", mainMenu());
        } catch (e) {
          if (e.message === "NOT_ENOUGH_PROMTI") {
            return ctx.reply(`❌ Недостатньо Promti ✨\nПотрібно: ${loadSettings().svgLogoPricePromti || 3} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨`, mainMenu());
          }
          notifyAdminsError(`SVG LOGO ERROR: user ${ctx.from.id}\n${e.message}`).catch(() => {});
          return ctx.reply("❌ Не вдалося створити SVG логотип. Спробуй ще раз.", infographicMenu());
        } finally {
          userGenerating.delete(ctx.from.id);
        }
      }

      if (infographicMode === "png") {
        if (userGenerating.has(ctx.from.id)) return ctx.reply("⏳ Зачекай, ще обробляється...");
        userGenerating.add(ctx.from.id);
        try {
          await runInfographicPngFlow({
            ctx,
            user,
            userId: ctx.from.id,
            textInput: text,
            imageBase64: null,
          });
          resetState(ctx);
          return ctx.reply("✅ Інфографіка готова. Можеш створити ще одну або повернутися в меню.", mainMenu());
        } catch (e) {
          if (e.message === "NOT_ENOUGH_PROMTI") {
            return ctx.reply(`❌ Недостатньо Promti ✨\nПотрібно: ${loadSettings().infographicPricePromti || 2} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨`, mainMenu());
          }
          notifyAdminsError(`INFOGRAPHIC ERROR: user ${ctx.from.id}\n${e.message}`).catch(() => {});
          return ctx.reply("❌ Не вдалося створити інфографіку. Спробуй ще раз.", infographicMenu());
        } finally {
          userGenerating.delete(ctx.from.id);
        }
      }
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

    if (ctx.session.mode === "chatgpt_trend" && ctx.session.chatgptTrendKey) {
      const trend = getChatgptTrend(ctx.session.chatgptTrendKey);
      if (!trend || !trend.isActive) return ctx.reply("❌ Trend недоступний. Обери інший.", aiStudioMenu());
      if (trend.inputType === "photo") return ctx.reply("Для цього trend потрібно надіслати саме фото.", aiStudioMenu());
      await ctx.reply("⏳ Обробляю запит...");
      try {
        const result = await runChatgptTrendRequest({
          trend,
          user,
          userId,
          textInput: text,
          imageBase64: null,
          ctx,
        });
        return replyLongText(ctx, result, mainMenu());
      } catch (e) {
        if (e.message === "NOT_ENOUGH_PROMTI") {
          return ctx.reply(`❌ Недостатньо Promti ✨\nПотрібно: ${trend.pricePromti} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨`, mainMenu());
        }
        return ctx.reply("❌ Не вдалося обробити trend. Спробуй ще раз.", mainMenu());
      }
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

  if (isAdmin(userId) && ctx.session.awaitingChatgptPreviewKey) {
    const key = ctx.session.awaitingChatgptPreviewKey;
    const trend = getChatgptTrend(key);
    ctx.session.awaitingChatgptPreviewKey = null;
    if (!trend) return ctx.reply(`❌ Trend "${key}" не знайдено.`, adminMenu());
    trend.previewPhoto = photo.file_id;
    content.chatgptTrendLibrary[key] = normalizeChatgptTrendItem(trend, key);
    saveContent();
    return ctx.reply(`✅ Preview для trend "${key}" збережено.`, adminMenu());
  }

  if (isAdmin(userId) && ctx.session.awaitingPromptExamplesKey) {
    const key = ctx.session.awaitingPromptExamplesKey;
    const style = getPromptStyle(key);
    if (!style) {
      ctx.session.awaitingPromptExamplesKey = null;
      return ctx.reply(`❌ Стиль "${key}" не знайдено.`, adminMenu());
    }

    const currentPhotos = getPromptExamplePhotos(style);
    if (currentPhotos.length >= MAX_PROMPT_EXAMPLE_PHOTOS) {
      ctx.session.awaitingPromptExamplesKey = null;
      return ctx.reply(
        `⚠️ Для стилю "${key}" уже збережено ${MAX_PROMPT_EXAMPLE_PHOTOS}/${MAX_PROMPT_EXAMPLE_PHOTOS} прикладів.\n` +
        `Напиши "видалити", щоб очистити список, або відкрий стиль у бібліотеці.`,
        adminMenu()
      );
    }

    style.examplePhotos = [...currentPhotos, photo.file_id].slice(0, MAX_PROMPT_EXAMPLE_PHOTOS);
    content.promptLibrary[key] = normalizePromptLibraryItem(style, key);
    saveContent();

    const count = getPromptExamplePhotos(style).length;
    if (count >= MAX_PROMPT_EXAMPLE_PHOTOS) {
      ctx.session.awaitingPromptExamplesKey = null;
    }

    return ctx.reply(
      `✅ Приклад ${count}/${MAX_PROMPT_EXAMPLE_PHOTOS} для стилю "${key}" збережено.\n` +
      (count >= MAX_PROMPT_EXAMPLE_PHOTOS
        ? "Ліміт досягнуто. Збереження завершено."
        : `Можеш надіслати ще фото або напиши "готово".`),
      adminMenu()
    );
  }

  if (ctx.session.mode === "infographic" && ctx.session.awaitingInfographicInput && ctx.session.infographicMode === "png") {
    if (userGenerating.has(userId)) return ctx.reply("⏳ Зачекай, ще обробляється...");
    userGenerating.add(userId);
    try {
      const image = await getImage(ctx, photo.file_id);
      await runInfographicPngFlow({
        ctx,
        user,
        userId,
        textInput: ctx.message.caption || "",
        imageBase64: image,
      });
      resetState(ctx);
      return ctx.reply("✅ Інфографіка готова. Можеш створити ще одну або повернутися в меню.", mainMenu());
    } catch (e) {
      if (e.message === "NOT_ENOUGH_PROMTI") {
        return ctx.reply(`❌ Недостатньо Promti ✨\nПотрібно: ${loadSettings().infographicPricePromti || 2} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨`, mainMenu());
      }
      notifyAdminsError(`INFOGRAPHIC PHOTO ERROR: user ${userId}\n${e.message}`).catch(() => {});
      return ctx.reply("❌ Не вдалося створити інфографіку. Спробуй ще раз.", infographicMenu());
    } finally {
      userGenerating.delete(userId);
    }
  }
  if (ctx.session.mode === "infographic" && ctx.session.awaitingInfographicInput && ctx.session.infographicMode === "svg") {
    return ctx.reply("Для SVG логотипа потрібен текстовий бриф, не фото.", infographicMenu());
  }

  if (ctx.session.mode === "chatgpt_trend" && ctx.session.chatgptTrendKey) {
    const trend = getChatgptTrend(ctx.session.chatgptTrendKey);
    if (!trend || !trend.isActive) return ctx.reply("❌ Trend недоступний. Обери інший.", aiStudioMenu());
    if (trend.inputType === "text") return ctx.reply("Для цього trend потрібен текстовий запит, не фото.", aiStudioMenu());
    await ctx.reply("⏳ Обробляю trend...");
    try {
      const image = await getImage(ctx, photo.file_id);
      const result = await runChatgptTrendRequest({
        trend,
        user,
        userId,
        textInput: ctx.message.caption || "",
        imageBase64: image,
        ctx,
      });
      return replyLongText(ctx, result, mainMenu());
    } catch (e) {
      if (e.message === "NOT_ENOUGH_PROMTI") {
        return ctx.reply(`❌ Недостатньо Promti ✨\nПотрібно: ${trend.pricePromti} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨`, mainMenu());
      }
      return ctx.reply("❌ Не вдалося обробити trend. Спробуй ще раз.", mainMenu());
    }
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
      const suggested = await generateAiPrompt(image, aiMode, ctx);
      if (!suggested) return ctx.reply("❌ Не вдалося згенерувати промт. Спробуй ✍️ Свій промт.", aiMode === "video" ? videoMenu() : photoMenu());
      ctx.session.customPrompt     = suggested;
      ctx.session.customType       = aiMode === "video" ? `custom_video_${ctx.session.style || "seedance"}` : "custom_photo";
      ctx.session.awaitingCustomPrompt = false;
      const label = aiMode === "video" ? (ctx.session.style === "kling" ? "🎥 Kling" : "🎬 Seedance") : "🖼 Фото";
      return ctx.reply(
        `🤖 AI промт для ${label}:\n\n📝 <code>${escapeHtml(suggested)}</code>\n\nНадішли фото ще раз — промт буде застосовано.`,
        { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("✅ Застосувати", `apply_ai_prompt_${aiMode}`)], [Markup.button.callback("🔄 Новий варіант", `regen_ai_prompt_${aiMode}`)], [Markup.button.callback("💾 Зберегти промт", `save_ai_prompt_${aiMode}`)]]).reply_markup }
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
  let chargedPromtiAmount = 0;
  const startMs          = Date.now();
  let analyticsGenerationId = "";
  let analyticsStyleId = "";
  let analyticsGenerationType = mode === "video" ? "video" : "photo";
  let analyticsGenerationLogged = false;

  try {
    touchRateLimit(userId, mode === "video" ? "video" : "photo");

    // ══ ВІДЕО ══
    if (mode === "video") {
      const videoStyle = ctx.session.style;
      if (!videoStyle) { userGenerating.delete(userId); return ctx.reply("Обери модель: 🎬 Seedance або 🎥 Kling", videoMenu()); }
      if (ctx.session.awaitingCustomPrompt) { userGenerating.delete(userId); return ctx.reply("Спочатку напиши промт текстом.", videoMenu()); }
      analyticsGenerationId = createGenerationId(userId, videoStyle === "kling" ? "kling" : "video");
      analyticsStyleId = videoStyle;
      analyticsGenerationType = "video";

      if (!isAdmin(userId)) {
        const dailyErr = checkDailyVideoLimit(user, videoStyle);
        if (dailyErr) { userGenerating.delete(userId); return ctx.reply(dailyErr, videoMenu()); }
        const videoCost = videoStyle === "kling" ? PROMTI_PRICES.kling : PROMTI_PRICES.seedance;
        if ((user.promti || 0) < videoCost) {
          userGenerating.delete(userId);
          queueLogEvent({
            user_id: userId,
            event: "paywall_shown",
            value: videoCost,
            style_id: videoStyle,
            generation_id: analyticsGenerationId,
            extra: { type: "video", balance: user.promti || 0, required: videoCost },
          });
          return ctx.reply(
            `❌ Недостатньо Promti ✨\n\nПотрібно: ${videoCost} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨\n\n💳 Купи пакет Promti`,
            videoStyle === "kling" ? klingMenu() : seedanceMenu()
          );
        }
        user.promti -= videoCost; chargedFromBalance = true; saveUsersSync();
        chargedPromtiAmount = videoCost;
      }

      const prompt       = ctx.session.customPrompt || prompts[videoStyle];
      const videoInputMode = ctx.session.videoInputMode || "image";
      const stopProgress = startVideoProgress(ctx);
      const modeLabel = videoInputMode === "text" ? "з тексту" : "з фото";
      if (videoStyle === "kling") {
        queueLogEvent({
          user_id: userId,
          event: "kling_started",
          value: 1,
          style_id: videoStyle,
          generation_id: analyticsGenerationId,
          extra: { input: videoInputMode },
        });
      }
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
        queueAnalyticsGeneration({
          userId,
          type: "video",
          styleId: videoStyle,
          generationId: analyticsGenerationId,
          status: "success",
        });
        analyticsGenerationLogged = true;
        if (videoStyle === "kling") {
          queueLogEvent({
            user_id: userId,
            event: "kling_success",
            value: 1,
            style_id: videoStyle,
            generation_id: analyticsGenerationId,
            extra: { input: videoInputMode },
          });
        }
        queueAnalyticsUserTouch(ctx, user, {
          totalGenerations: getUserTotalGenerations(user),
          totalSpent: user.totalSpent || 0,
        });

        const caption = isAdmin(userId)
          ? `🎬 Відео готове ✨\nМодель: ${videoStyle}\nАдмін: безліміт ✅`
          : `🎬 Відео готове ✨\nЗалишилось: ${user.promti || 0} Promti ✨`;

        await tgSendWithRetry(() => ctx.replyWithVideo({ url: videoUrl }, { caption }));

        if (!isAdmin(userId) && (user.promti || 0) <= 5) {
          queueLogEvent({
            user_id: userId,
            event: "paywall_shown",
            value: user.promti || 0,
            style_id: videoStyle,
            generation_id: analyticsGenerationId,
            extra: { type: "video", reason: "low_balance_after_success" },
          });
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
        if (!analyticsGenerationLogged && analyticsGenerationId) {
          queueAnalyticsGeneration({
            userId,
            type: "video",
            styleId: videoStyle,
            generationId: analyticsGenerationId,
            status: "error",
          });
          analyticsGenerationLogged = true;
        }
        if (videoStyle === "kling") {
          queueLogEvent({
            user_id: userId,
            event: "kling_error",
            value: 0,
            style_id: videoStyle,
            generation_id: analyticsGenerationId,
            extra: { input: videoInputMode, error: e.message },
          });
        }
        throw e;
      }
    }

    // ══ ФОТО ══
    const customType = ctx.session.customType;
    const photoMode  = ctx.session.photoMode || "edit";
    let prompt = "";
    let promptKeyForStats = null;
    let selectedStyle = null;
    let dynamicSeries = null;
    let dynamicVariant = null;
    let generationStyleRef = "";
    analyticsGenerationId = createGenerationId(userId, "photo");
    analyticsGenerationType = "photo";

    if (customType === "custom_photo" || customType === "create_photo") {
      if (!ctx.session.customPrompt) { userGenerating.delete(userId); return ctx.reply("Спочатку напиши промт текстом.", photoMenu()); }
      prompt = ctx.session.customPrompt;
      const selectedPromptKey = ctx.session.currentPromptKey || ctx.session.sourcePromptKey || user.sourcePromptKey;
      selectedStyle = getPromptStyle(selectedPromptKey);
      if (selectedStyle && selectedStyle.prompt === prompt) {
        promptKeyForStats = selectedStyle.key;
        generationStyleRef = buildStaticStyleRef(promptKeyForStats);
      } else if (ctx.session.currentDynamicSeriesId || ctx.session.sourceDynamicSeriesId || user.sourceDynamicSeriesId) {
        const seriesId = ctx.session.currentDynamicSeriesId || ctx.session.sourceDynamicSeriesId || user.sourceDynamicSeriesId;
        const variantId = ctx.session.currentDynamicVariantId || ctx.session.sourceDynamicVariantId || user.sourceDynamicVariantId;
        dynamicSeries = getDynamicSeries(seriesId);
        dynamicVariant = getDynamicVariant(seriesId, variantId);
        if (dynamicSeries && dynamicVariant) {
          generationStyleRef = buildDynamicStyleRef(dynamicSeries.id, dynamicVariant.id);
        }
      }
    } else {
      userGenerating.delete(userId);
      return ctx.reply("Обери режим: 🖼 Редагувати фото або ✨ Створити фото", photoMenu());
    }

    const imageProvider = selectedStyle?.provider || dynamicSeries?.provider || cfg.defaultImageProvider || "fal";
    const imageModel = selectedStyle?.model || dynamicSeries?.model || cfg.defaultImageModel || "fal-ai/nano-banana-2";
    const imageFallbackProvider = selectedStyle?.fallbackProvider || "fal";
    const imageFallbackModel = selectedStyle?.fallbackModel || cfg.defaultImageModel || "fal-ai/nano-banana-2";
    const photoCost = Number(selectedStyle?.pricePromti || dynamicSeries?.price || PROMTI_PRICES.photo || 1);
    analyticsStyleId = generationStyleRef || promptKeyForStats || ctx.session.currentPromptKey || ctx.session.sourcePromptKey || user.sourcePromptKey || "custom";

    if (!isAdmin(userId)) {
      if ((user.promti || 0) < photoCost) {
        userGenerating.delete(userId);
        queueLogEvent({
          user_id: userId,
          event: "paywall_shown",
          value: photoCost,
          style_id: analyticsStyleId,
          generation_id: analyticsGenerationId,
          extra: { type: "photo", balance: user.promti || 0, required: photoCost },
        });
        return ctx.reply(
          `❌ Недостатньо Promti ✨\n\nПотрібно: ${photoCost} Promti ✨\nБаланс: ${user.promti || 0} Promti ✨\n\n💳 Купи пакет Promti`,
          photoMenu()
        );
      }
      user.promti -= photoCost;
      chargedFromBalance = true;
      chargedPromtiAmount = photoCost;
      saveUsersSync();
    }

    let imageResult = null;
    let imageBase64 = null;
    const generationMode = photoMode === "create" ? "create" : "edit";

    if (photoMode === "create") {
      await ctx.reply("⏳ Створюю фото з нуля... (~45 сек)");
    } else {
      await ctx.reply("⏳ Редагую фото... (~45 сек)");
      imageBase64 = await getImage(ctx, photo.file_id);
    }

    queueLogEvent({
      user_id: userId,
      event: imageProvider === "openai" ? "openai_image_started" : "fal_image_started",
      value: 1,
      style_id: analyticsStyleId,
      generation_id: analyticsGenerationId,
      extra: { mode: generationMode, model: imageModel, fallbackProvider: imageFallbackProvider, fallbackModel: imageFallbackModel },
    });

    try {
      imageResult = await generateImageByProvider({
        provider: imageProvider,
        model: imageModel,
        prompt,
        imageBase64,
        mode: generationMode,
        fallbackProvider: imageFallbackProvider,
        fallbackModel: imageFallbackModel,
        settings: cfg,
      });
    } catch (imageError) {
      queueLogEvent({
        user_id: userId,
        event: imageProvider === "openai" ? "openai_image_error" : "fal_image_error",
        value: 0,
        style_id: analyticsStyleId,
        generation_id: analyticsGenerationId,
        extra: { mode: generationMode, model: imageModel, error: imageError.message },
      });
      throw imageError;
    }

    if (!imageResult?.url && !imageResult?.buffer && !imageResult?.base64) {
      throw new Error("IMAGE_PROVIDER_EMPTY_RESULT");
    }

    user.generations = (user.generations || 0) + 1;
    if (generationStyleRef) {
      markStyleGeneration(user, generationStyleRef);
    } else if (promptKeyForStats) {
      markPromptGeneration(user, promptKeyForStats);
      user.lastGeneratedPromptKey = promptKeyForStats;
    }
    saveUsersSync();
    userGenerating.delete(userId);
    log("PHOTO_OK", userId, `dur:${Date.now()-startMs}ms`);
    appendLog({ type: "photo", model: imageResult?.model || customType || "custom", provider: imageResult?.provider || imageProvider, userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });
    queueLogEvent({
      user_id: userId,
      event: "generate_photo",
      value: 1,
      style_id: analyticsStyleId,
      generation_id: analyticsGenerationId,
      extra: { type: "photo", mode: photoMode, provider: imageResult?.provider || imageProvider, model: imageResult?.model || imageModel },
    });
    queueLogEvent({
      user_id: userId,
      event: (imageResult?.provider || imageProvider) === "openai" ? "openai_image_success" : "fal_image_success",
      value: 1,
      style_id: analyticsStyleId,
      generation_id: analyticsGenerationId,
      extra: { mode: generationMode, model: imageResult?.model || imageModel },
    });
    queueAnalyticsGeneration({
      userId,
      type: "photo",
      styleId: analyticsStyleId,
      generationId: analyticsGenerationId,
      status: "success",
    });
    analyticsGenerationLogged = true;
    queueAnalyticsUserTouch(ctx, user, {
      totalGenerations: getUserTotalGenerations(user),
      totalSpent: user.totalSpent || 0,
    });

    const caption = isAdmin(userId) ? "Готово ✨\nАдмін: безліміт ✅" : `Готово ✨\nЗалишилось: ${user.promti || 0} Promti ✨`;
    try {
      if (imageResult?.buffer) {
        await tgSendWithRetry(() => ctx.replyWithDocument(
          { source: imageResult.buffer, filename: `promti_${Date.now()}.png` },
          { caption }
        ));
      } else {
        await tgSendWithRetry(() => ctx.replyWithDocument(
          { url: imageResult.url, filename: `promti_${Date.now()}.png` },
          { caption }
        ));
      }
    } catch (docErr) {
      console.error("DOCUMENT SEND FAILED, fallback to photo:", docErr.message);
      try {
        if (imageResult?.buffer) {
          await tgSendWithRetry(() => ctx.replyWithPhoto({ source: imageResult.buffer }, { caption }));
        } else {
          await tgSendWithRetry(() => ctx.replyWithPhoto({ url: imageResult.url }, { caption }));
        }
      } catch (photoErr) {
        console.error("PHOTO FALLBACK ALSO FAILED:", photoErr.message);
        throw photoErr;
      }
    }

    const shareStyleRef = analyticsStyleId || generationStyleRef;
    const shareBotUsername = process.env.BOT_USERNAME || bot.botInfo?.username || "Promtiai_bot";
    const sharePayload = shareStyleRef.startsWith("dynamic:")
      ? `dynamic_${(shareStyleRef.split(":")[2] || shareStyleRef.split(":")[1])}`
      : `prompt_${shareStyleRef.replace(/^static:/, "")}`;
    await ctx.reply(
      "Що далі?",
      Markup.inlineKeyboard([
        [Markup.button.callback("🔁 Ще варіант", "dynamic_retry_photo"), Markup.button.callback("🎬 Оживити фото", "upsell_video_seedance")],
        [Markup.button.callback("💎 Купити Promti", "upsell_promti"), Markup.button.url("📤 Поділитися стилем", `https://t.me/${shareBotUsername}?start=${sharePayload}`)],
      ])
    );
    return;

  } catch (e) {
    userGenerating.delete(userId);
    console.error("GENERATION ERROR:", e.message);
    logFailedCommand({
      userId,
      type: mode === "video" ? "video_generation" : "photo_generation",
      error: e,
      context: {
        mode,
        style: ctx.session?.style || "",
        promptKey: ctx.session?.currentPromptKey || ctx.session?.sourcePromptKey || user?.sourcePromptKey || "",
      },
    });
    if (!isAdmin(userId)) {
      if (chargedFromBalance) {
        if (mode === "video") {
          user.promti = (user.promti || 0) + (chargedPromtiAmount || ((ctx.session?.style === "kling") ? PROMTI_PRICES.kling : PROMTI_PRICES.seedance));
        } else {
          user.promti = (user.promti || 0) + (chargedPromtiAmount || PROMTI_PRICES.photo);
        }
        saveUsersSync();
      }
    }
    if (!analyticsGenerationLogged && analyticsGenerationId) {
      queueAnalyticsGeneration({
        userId,
        type: analyticsGenerationType,
        styleId: analyticsStyleId || ctx.session?.style || ctx.session?.currentPromptKey || user?.sourcePromptKey || "custom",
        generationId: analyticsGenerationId,
        status: "error",
      });
      analyticsGenerationLogged = true;
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
    const suggested = await generateAiPrompt(frameBase64, "video", ctx);
    if (!suggested) return ctx.reply("❌ Не вдалося згенерувати промт. Спробуй надіслати фото.", videoMenu());
    ctx.session.customPrompt     = suggested;
    ctx.session.customType       = `custom_video_${ctx.session.style || "seedance"}`;
    ctx.session.awaitingCustomPrompt = false;
    const label = ctx.session.style === "kling" ? "🎥 Kling" : "🎬 Seedance";
    return ctx.reply(
      `🤖 AI промт для ${label}:\n\n📝 <code>${escapeHtml(suggested)}</code>\n\n✅ Промт збережено. Надішли фото для генерації відео 📸`,
      { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("✅ Застосувати", "apply_ai_prompt_video")], [Markup.button.callback("🔄 Новий варіант", "regen_ai_prompt_video")], [Markup.button.callback("💾 Зберегти промт", "save_ai_prompt_video")]]).reply_markup }
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
  if (req.path === "/payment" || req.path === "/api/admin/upload-image") return next();
  express.json({ limit: "1mb" })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: true })(req, res, next);
  });
});

app.use("/uploads", express.static(LANDING_UPLOADS_DIR));
app.get("/",       (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin",  (_, res) => res.sendFile(path.join(__dirname, "promti-control.html")));
app.get("/api/landing-content", (_, res) => {
  res.json(getLandingContent());
});
app.post("/api/admin/login", (req, res) => {
  const { login, password } = req.body || {};
  if (login !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS" });
  }
  res.setHeader("Set-Cookie", buildAdminCookie(createAdminSessionToken(), req));
  return res.json({
    ok: true,
    usingDefaultCredentials: !process.env.ADMIN_LOGIN || !process.env.ADMIN_PASSWORD,
  });
});
app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", clearAdminCookie(req));
  res.json({ ok: true });
});
app.get("/api/admin/content", requireAdminAuth, (_, res) => {
  res.json(getLandingContent());
});
app.post("/api/admin/content", requireAdminAuth, (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return res.status(400).json({ ok: false, error: "INVALID_PAYLOAD" });
  }
  const saved = saveLandingContent(payload);
  return res.json({ ok: true, content: saved });
});
app.post("/api/admin/upload-image",
  express.json({ limit: "15mb" }),
  requireAdminAuth,
  (req, res) => {
    try {
      const { fileName, dataUrl } = req.body || {};
      const imageUrl = toAbsolutePublicUrl(saveLandingImageUpload(fileName, dataUrl));
      return res.json({ ok: true, imageUrl });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || "UPLOAD_FAILED" });
    }
  }
);
function toAdminBool(value, fallback = true) {
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

function safeAdminArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

app.get("/api/admin/dashboard", requireAdminAuth, async (_, res) => {
  const botUsername = await resolveBotUsername();
  res.json({
    ok: true,
    staticStyles: getSortedPromptStyles().map((item) => serializeStaticStyleForAdmin(item, botUsername)),
    dynamicStyles: Object.values(ensureDynamicStyleLibrary()).map((item) => serializeDynamicSeriesForAdmin(item, botUsername)),
    videoPresets: Object.values(ensureVideoPresets()),
    openAiTools: Object.values(ensureOpenAiTools()),
    analytics: buildAnalyticsPayload(),
    settings: loadSettings(),
    content: sanitizeTextTree(content),
  });
});

app.get("/api/admin/styles", requireAdminAuth, async (_, res) => {
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, items: getSortedPromptStyles().map((item) => serializeStaticStyleForAdmin(item, botUsername)) });
});

app.get("/api/admin/styles/:id", requireAdminAuth, async (req, res) => {
  const style = getPromptStyle(req.params.id);
  if (!style) return res.status(404).json({ ok: false, error: "STYLE_NOT_FOUND" });
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeStaticStyleForAdmin(style, botUsername) });
});

app.post("/api/admin/styles", requireAdminAuth, async (req, res) => {
  const key = buildSafeEntityId(req.body?.id || req.body?.key || req.body?.title, "style");
  if (!key) return res.status(400).json({ ok: false, error: "INVALID_STYLE_ID" });
  if (getPromptStyle(key)) return res.status(409).json({ ok: false, error: "STYLE_ALREADY_EXISTS" });
  ensurePromptLibrary();
  const style = normalizePromptLibraryItem({
    key,
    id: key,
    title: req.body?.title || key,
    description: req.body?.description || "",
    prompt: req.body?.prompt || "",
    category: req.body?.category || "other",
    provider: req.body?.provider || "fal",
    model: req.body?.model || loadSettings().defaultImageModel,
    pricePromti: Number(req.body?.price || req.body?.pricePromti || 1),
    previewPhoto: req.body?.previewImage || null,
    examplePhotos: safeAdminArray(req.body?.exampleImages),
    exampleLabels: safeAdminArray(req.body?.exampleLabels),
    isActive: toAdminBool(req.body?.isActive, true),
    isTrending: toAdminBool(req.body?.isTrending, false),
    sortOrder: Number(req.body?.sortOrder || 0),
  }, key);
  backupJsonFile(CONTENT_PATH, "content-styles");
  content.promptLibrary[key] = style;
  saveContent();
  const botUsername = await resolveBotUsername();
  return res.status(201).json({ ok: true, item: serializeStaticStyleForAdmin(style, botUsername) });
});

app.put("/api/admin/styles/:id", requireAdminAuth, async (req, res) => {
  const current = getPromptStyle(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: "STYLE_NOT_FOUND" });
  const next = normalizePromptLibraryItem({
    ...current,
    ...req.body,
    key: current.key,
    id: current.key,
    previewPhoto: req.body?.previewImage !== undefined ? req.body.previewImage : current.previewPhoto,
    examplePhotos: req.body?.exampleImages !== undefined ? safeAdminArray(req.body.exampleImages) : current.examplePhotos,
    exampleLabels: req.body?.exampleLabels !== undefined ? safeAdminArray(req.body.exampleLabels) : current.exampleLabels,
    pricePromti: Number(req.body?.price ?? req.body?.pricePromti ?? current.pricePromti ?? 1),
  }, current.key);
  backupJsonFile(CONTENT_PATH, "content-styles");
  content.promptLibrary[current.key] = next;
  saveContent();
  const botUsername = await resolveBotUsername();
  return res.json({ ok: true, item: serializeStaticStyleForAdmin(next, botUsername) });
});

app.post("/api/admin/styles/:id/duplicate", requireAdminAuth, async (req, res) => {
  const source = getPromptStyle(req.params.id);
  if (!source) return res.status(404).json({ ok: false, error: "STYLE_NOT_FOUND" });
  const duplicateId = normalizePromptKey(req.body?.id || `${source.key}_copy`);
  if (!duplicateId) return res.status(400).json({ ok: false, error: "INVALID_STYLE_ID" });
  if (getPromptStyle(duplicateId)) return res.status(409).json({ ok: false, error: "STYLE_ALREADY_EXISTS" });
  const duplicate = normalizePromptLibraryItem({
    ...source,
    key: duplicateId,
    id: duplicateId,
    title: req.body?.title || `${source.title} Copy`,
    isTrending: false,
    clicks: 0,
    generations: 0,
    purchases: 0,
    createdAt: Date.now(),
  }, duplicateId);
  backupJsonFile(CONTENT_PATH, "content-styles");
  content.promptLibrary[duplicateId] = duplicate;
  saveContent();
  const botUsername = await resolveBotUsername();
  return res.status(201).json({ ok: true, item: serializeStaticStyleForAdmin(duplicate, botUsername) });
});

app.patch("/api/admin/styles/:id/toggle", requireAdminAuth, async (req, res) => {
  const style = getPromptStyle(req.params.id);
  if (!style) return res.status(404).json({ ok: false, error: "STYLE_NOT_FOUND" });
  style.isActive = toAdminBool(req.body?.isActive, !style.isActive);
  backupJsonFile(CONTENT_PATH, "content-styles");
  content.promptLibrary[style.key] = style;
  saveContent();
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeStaticStyleForAdmin(style, botUsername) });
});

app.delete("/api/admin/styles/:id", requireAdminAuth, (req, res) => {
  if (!getPromptStyle(req.params.id)) return res.status(404).json({ ok: false, error: "STYLE_NOT_FOUND" });
  backupJsonFile(CONTENT_PATH, "content-styles");
  delete content.promptLibrary[normalizePromptKey(req.params.id)];
  saveContent();
  res.json({ ok: true });
});

app.get("/api/admin/dynamic-styles", requireAdminAuth, async (_, res) => {
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, items: Object.values(ensureDynamicStyleLibrary()).map((item) => serializeDynamicSeriesForAdmin(item, botUsername)) });
});

app.get("/api/admin/dynamic-styles/:id", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.post("/api/admin/dynamic-styles", requireAdminAuth, async (req, res) => {
  const id = buildSafeEntityId(req.body?.id || req.body?.title, "series");
  if (!id) return res.status(400).json({ ok: false, error: "INVALID_SERIES_ID" });
  if (getDynamicSeries(id)) return res.status(409).json({ ok: false, error: "DYNAMIC_SERIES_ALREADY_EXISTS" });
  const series = normalizeDynamicStyleSeries({
    ...req.body,
    id,
    variants: Array.isArray(req.body?.variants) ? req.body.variants : [],
  }, id);
  backupJsonFile(DYNAMIC_PROMPTS_PATH, "dynamic-prompts");
  dynamicStyleLibrary[id] = series;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.status(201).json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.put("/api/admin/dynamic-styles/:id", requireAdminAuth, async (req, res) => {
  const current = getDynamicSeries(req.params.id);
  if (!current) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  const next = normalizeDynamicStyleSeries({
    ...current,
    ...req.body,
    id: current.id,
    variants: req.body?.variants !== undefined ? req.body.variants : current.variants,
  }, current.id);
  backupJsonFile(DYNAMIC_PROMPTS_PATH, "dynamic-prompts");
  dynamicStyleLibrary[current.id] = next;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(next, botUsername) });
});

app.post("/api/admin/dynamic-styles/:id/variants", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  const variant = normalizeDynamicVariant(series.id, req.body || {}, series.variants.length);
  if (series.variants.some((item) => item.id === variant.id)) {
    return res.status(409).json({ ok: false, error: "VARIANT_ALREADY_EXISTS" });
  }
  series.variants.push(variant);
  dynamicStyleLibrary[series.id] = series;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.status(201).json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.put("/api/admin/dynamic-styles/:id/variants/:variantId", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  const index = series.variants.findIndex((item) => item.id === normalizePromptKey(req.params.variantId));
  if (index === -1) return res.status(404).json({ ok: false, error: "VARIANT_NOT_FOUND" });
  series.variants[index] = normalizeDynamicVariant(series.id, { ...series.variants[index], ...req.body, id: series.variants[index].id }, index);
  dynamicStyleLibrary[series.id] = series;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.patch("/api/admin/dynamic-styles/:id/toggle", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  series.isActive = toAdminBool(req.body?.isActive, !series.isActive);
  dynamicStyleLibrary[series.id] = series;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.patch("/api/admin/dynamic-styles/:id/variants/:variantId/toggle", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  const variant = series.variants.find((item) => item.id === normalizePromptKey(req.params.variantId));
  if (!variant) return res.status(404).json({ ok: false, error: "VARIANT_NOT_FOUND" });
  variant.isActive = toAdminBool(req.body?.isActive, !variant.isActive);
  dynamicStyleLibrary[series.id] = series;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.delete("/api/admin/dynamic-styles/:id/variants/:variantId", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  series.variants = series.variants.filter((item) => item.id !== normalizePromptKey(req.params.variantId));
  dynamicStyleLibrary[series.id] = series;
  saveDynamicStyles();
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.get("/api/admin/video-presets", requireAdminAuth, (_, res) => {
  res.json({ ok: true, items: Object.values(ensureVideoPresets()) });
});

app.post("/api/admin/video-presets", requireAdminAuth, (req, res) => {
  const preset = normalizeVideoPreset(req.body || {}, req.body?.id || `video_${Date.now()}`);
  if (videoPresets[preset.id]) return res.status(409).json({ ok: false, error: "VIDEO_PRESET_EXISTS" });
  videoPresets[preset.id] = preset;
  saveVideoPresets();
  res.status(201).json({ ok: true, item: preset });
});

app.put("/api/admin/video-presets/:id", requireAdminAuth, (req, res) => {
  const current = ensureVideoPresets()[normalizePromptKey(req.params.id)];
  if (!current) return res.status(404).json({ ok: false, error: "VIDEO_PRESET_NOT_FOUND" });
  const next = normalizeVideoPreset({ ...current, ...req.body, id: current.id }, current.id);
  videoPresets[current.id] = next;
  saveVideoPresets();
  res.json({ ok: true, item: next });
});

app.patch("/api/admin/video-presets/:id/toggle", requireAdminAuth, (req, res) => {
  const current = ensureVideoPresets()[normalizePromptKey(req.params.id)];
  if (!current) return res.status(404).json({ ok: false, error: "VIDEO_PRESET_NOT_FOUND" });
  current.isActive = toAdminBool(req.body?.isActive, !current.isActive);
  videoPresets[current.id] = current;
  saveVideoPresets();
  res.json({ ok: true, item: current });
});

app.get("/api/admin/openai-tools", requireAdminAuth, (_, res) => {
  res.json({ ok: true, items: Object.values(ensureOpenAiTools()) });
});

app.post("/api/admin/openai-tools", requireAdminAuth, (req, res) => {
  const tool = normalizeOpenAiTool(req.body || {}, req.body?.id || `openai_${Date.now()}`);
  if (openAiTools[tool.id]) return res.status(409).json({ ok: false, error: "OPENAI_TOOL_EXISTS" });
  openAiTools[tool.id] = tool;
  saveOpenAiTools();
  res.status(201).json({ ok: true, item: tool });
});

app.put("/api/admin/openai-tools/:id", requireAdminAuth, (req, res) => {
  const current = ensureOpenAiTools()[normalizePromptKey(req.params.id)];
  if (!current) return res.status(404).json({ ok: false, error: "OPENAI_TOOL_NOT_FOUND" });
  const next = normalizeOpenAiTool({ ...current, ...req.body, id: current.id }, current.id);
  openAiTools[current.id] = next;
  saveOpenAiTools();
  res.json({ ok: true, item: next });
});

app.patch("/api/admin/openai-tools/:id/toggle", requireAdminAuth, (req, res) => {
  const current = ensureOpenAiTools()[normalizePromptKey(req.params.id)];
  if (!current) return res.status(404).json({ ok: false, error: "OPENAI_TOOL_NOT_FOUND" });
  current.isActive = toAdminBool(req.body?.isActive, !current.isActive);
  openAiTools[current.id] = current;
  saveOpenAiTools();
  res.json({ ok: true, item: current });
});

app.get("/api/admin/analytics", requireAdminAuth, (_, res) => {
  res.json({ ok: true, analytics: buildAnalyticsPayload() });
});

app.get("/api/admin/analytics/styles/:id", requireAdminAuth, async (req, res) => {
  const style = getPromptStyle(req.params.id);
  if (!style) return res.status(404).json({ ok: false, error: "STYLE_NOT_FOUND" });
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeStaticStyleForAdmin(style, botUsername) });
});

app.get("/api/admin/analytics/dynamic/:id", requireAdminAuth, async (req, res) => {
  const series = getDynamicSeries(req.params.id);
  if (!series) return res.status(404).json({ ok: false, error: "DYNAMIC_SERIES_NOT_FOUND" });
  const botUsername = await resolveBotUsername();
  res.json({ ok: true, item: serializeDynamicSeriesForAdmin(series, botUsername) });
});

app.get("/api/admin/analytics/dynamic/:id/variants/:variantId", requireAdminAuth, (req, res) => {
  const variant = getDynamicVariant(req.params.id, req.params.variantId);
  if (!variant) return res.status(404).json({ ok: false, error: "VARIANT_NOT_FOUND" });
  res.json({ ok: true, item: variant });
});

app.put("/api/admin/content/:key", requireAdminAuth, (req, res) => {
  const rawKey = String(req.params.key || "");
  const value = req.body?.value;
  if (rawKey.startsWith("settings.")) {
    const settingKey = rawKey.replace(/^settings\./, "");
    const nextSettings = { ...loadSettings(), [settingKey]: value };
    backupJsonFile(SETTINGS_PATH, "settings-admin");
    saveJson(SETTINGS_PATH, nextSettings);
    invalidateSettingsCache();
    return res.json({ ok: true, key: rawKey, value });
  }
  backupJsonFile(CONTENT_PATH, "content-admin");
  setNestedValue(content, rawKey, value);
  saveContent();
  return res.json({ ok: true, key: rawKey, value });
});
app.get("/health", (_, res) => {
  const s   = getBotStats();
  const cfg = loadSettings();
  res.json({
    ok: true,
    queue: s.queueLength, workers: `${s.activeWorkers}/${s.maxWorkers}`,
    totalUsers: s.totalUsers, bannedUsers: s.bannedUsers,
    photo: s.totalPhotoGen, seedance: s.totalSeedanceGen, kling: s.totalKlingGen,
    revenue: s.totalRevenue,
    flags: { aiPrompt: cfg.aiPromptEnabled, video: cfg.videoEnabled, aiPromptCacheEnabled: cfg.aiPromptCacheEnabled !== false },
    keys: { fal: s.hasFalKey, wfp: s.hasWfp, anthropic: s.hasAnthropicKey, openai: s.hasOpenAiKey, googleSheets: s.hasGoogleSheets },
    defaults: {
      imageProvider: cfg.defaultImageProvider,
      imageModel: cfg.defaultImageModel,
      openAiImageModel: cfg.defaultOpenAIImageModel,
      promptModel: cfg.defaultPromptModel,
    },
    libraries: {
      promptLibrary: s.promptLibraryCount,
      chatgptTrends: s.chatgptTrendsCount,
    },
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

    const user = getUser(userId);
    const txStatus = (data.transactionStatus || "").toLowerCase();
    const paymentRecord = payments.find((entry) => entry.orderReference === data.orderReference);

    updatePaymentStatus(data.orderReference, data, txStatus || "callback_received");

    if (txStatus === "approved" && !isCredited(data.orderReference)) {
      markAsCredited(data.orderReference);

      if (paymentRecord) {
        paymentRecord.status = "credited";
        paymentRecord.updatedAt = new Date().toISOString();
        paymentRecord.amount = Number(data.amount || 0);
        paymentRecord.callback = data;
      }

      const promtiAmount = pack.promti || pack.count || 0;
      user.promti          = (user.promti          || 0) + promtiAmount;
      user.purchasedPromti = (user.purchasedPromti || 0) + promtiAmount;
      user.totalSpent            = (user.totalSpent || 0) + Number(data.amount || 0);
      user.pendingOrderReference = null;
      user.lastPaidAt            = new Date().toISOString();
      const purchasePromptKey = user.pendingPurchasePromptKey;
      markPromptPurchase(user, data.orderReference);
      saveUsersSync(); savePayments();
      if (!hasLoggedPaymentAnalytics(paymentRecord, "credited")) {
        await trackAnalyticsPayment({
          userId,
          amount: Number(data.amount || 0),
          promtiAdded: promtiAmount,
          status: "credited",
          currency: String(data.currency || ANALYTICS_CURRENCY),
        });
        markLoggedPaymentAnalytics(paymentRecord, "credited");
        savePayments();
      }
      queueLogEvent({
        user_id: userId,
        event: "payment_success",
        value: Number(data.amount || 0),
        style_id: purchasePromptKey || user.lastGeneratedPromptKey || user.sourcePromptKey || "",
        extra: {
          plan: packKey,
          amount: Number(data.amount || 0),
          currency: String(data.currency || ANALYTICS_CURRENCY),
          promti_added: promtiAmount,
          method: "wayforpay",
        },
      });
      queueAnalyticsUserTouch({ from: { id: userId } }, user, {
        totalGenerations: getUserTotalGenerations(user),
        totalSpent: user.totalSpent || 0,
      });

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
    } else {
      const failureMarker = txStatus || "failed";
      if (!hasLoggedPaymentAnalytics(paymentRecord, failureMarker)) {
        await trackAnalyticsPayment({
          userId,
          amount: Number(data.amount || 0),
          promtiAdded: 0,
          status: failureMarker,
          currency: String(data.currency || ANALYTICS_CURRENCY),
        });
        markLoggedPaymentAnalytics(paymentRecord, failureMarker);
        savePayments();
      }
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
  console.log(`🤖 AI промт: ${cfg.aiPromptEnabled ? "✅" : "❌"} | OpenAI key: ${process.env.OPENAI_API_KEY ? "✅" : "❌"} | Anthropic fallback: ${process.env.ANTHROPIC_API_KEY ? "✅" : "❌"}`);
  console.log(`🖼 Image defaults: provider=${cfg.defaultImageProvider} | model=${cfg.defaultImageModel} | openaiModel=${cfg.defaultOpenAIImageModel}`);
  console.log(`🧠 Prompt model: ${cfg.defaultPromptModel} | cache: ${cfg.aiPromptCacheEnabled !== false ? "✅" : "❌"}`);
  if (!isAnalyticsEnabled()) {
    console.log("📊 Google Sheets analytics disabled");
  }
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
setInterval(() => {
  try {
    const result = cleanupOldData();
    if (result.aiPromptCache || result.failedCommands || result.tempJobs || result.tempFiles) {
      console.log(`🧹 Cleanup: cache=${result.aiPromptCache} failed=${result.failedCommands} tempJobs=${result.tempJobs} tmpFiles=${result.tempFiles}`);
    }
  } catch (e) {
    console.error("CLEANUP INTERVAL ERROR:", e.message);
  }
}, loadSettings().cacheCleanupIntervalMs || 3600000);

bot.launch({
  dropPendingUpdates: true,
  allowedUpdates: ["message", "callback_query"],
})
  .then(() => {
    console.log("🔥 Бот запущений (v5 fixed)");
    const cleanupResult = cleanupOldData();
    if (cleanupResult.aiPromptCache || cleanupResult.failedCommands || cleanupResult.tempJobs || cleanupResult.tempFiles) {
      console.log(`🧹 Startup cleanup: cache=${cleanupResult.aiPromptCache} failed=${cleanupResult.failedCommands} tempJobs=${cleanupResult.tempJobs} tmpFiles=${cleanupResult.tempFiles}`);
    }
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
