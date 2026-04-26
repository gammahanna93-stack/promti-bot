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

// в”Ђв”Ђв”Ђ РџРћРЎРўР†Р™РќР• РЎРҐРћР’РР©Р• (РјР°С” Р±СѓС‚Рё РґРѕ LocalSession!) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const DATA_DIR = "/app/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// в”Ђв”Ђв”Ђ РџР•Р РЎРРЎРўР•РќРўРќРђ РЎР•РЎР†РЇ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
    try { await ctx.reply("вќЊ РЎС‚Р°Р»Р°СЃСЏ РїРѕРјРёР»РєР°. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р· Р°Р±Рѕ /start"); } catch {}
  }
});

// в”Ђв”Ђв”Ђ РљРћРќРЎРўРђРќРўР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const ADMINS = [346101852, 688515215];

const WAYFORPAY = {
  merchantAccount: process.env.WAYFORPAY_MERCHANT    || "",
  secretKey:       process.env.WAYFORPAY_SECRET      || "",
  domainName:      process.env.WAYFORPAY_DOMAIN      || "",
  returnUrl:       process.env.WAYFORPAY_RETURN_URL  || "https://t.me/Promtiai_bot",
  serviceUrl:      process.env.WAYFORPAY_SERVICE_URL || "",
};

const REFERRAL_PROMTI_BONUS = 5;
const START_PROMTI_BONUS = 3;
const MAX_PROMPT_EXAMPLE_PHOTOS = 10;

const PROMTI_PRICES = {
  photo:    1,
  seedance: 5,
  kling:    8,
};

// в”Ђв”Ђв”Ђ РЁР›РЇРҐР Р”Рћ Р¤РђР™Р›Р†Р’ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const USERS_PATH        = path.join(DATA_DIR, "users.json");
const PAYMENTS_PATH     = path.join(DATA_DIR, "payments.json");
const PAYMENT_LOCK_PATH = path.join(DATA_DIR, "payment.lock.json");
const PACKAGES_PATH     = path.join(DATA_DIR, "packages.json");
const GEN_LOG_PATH      = path.join(DATA_DIR, "generation_logs.jsonl");

const PROMPTS_PATH      = path.join(DATA_DIR, "prompts.json");
const CONTENT_PATH      = path.join(DATA_DIR, "content.json");
const SETTINGS_PATH     = path.join(DATA_DIR, "settings.json");
const DYNAMIC_PROMPTS_PATH = path.join(DATA_DIR, "dynamic-prompts.json");
const LANDING_CONTENT_PATH = path.join(DATA_DIR, "landing-content.json");
const LANDING_CONTENT_DEFAULT_PATH = path.join(__dirname, "landing-content.default.json");
const LANDING_UPLOADS_DIR = path.join(DATA_DIR, "landing-uploads");

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
  [path.join(__dirname, "dynamic-prompts.json"), DYNAMIC_PROMPTS_PATH],
  [LANDING_CONTENT_DEFAULT_PATH, LANDING_CONTENT_PATH],
]) {
  if (fs.existsSync(src)) {
    const srcStat = fs.statSync(src);
    const dstExists = fs.existsSync(dst);
    if (!dstExists) {
      fs.copyFileSync(src, dst);
      console.log(`рџ“‹ Copied ${path.basename(src)} to Volume`);
    } else if (path.basename(src) === "settings.json") {
      const srcContent = fs.readFileSync(src, "utf8");
      const dstContent = fs.readFileSync(dst, "utf8");
      try {
        const srcJson = JSON.parse(srcContent);
        JSON.parse(dstContent);
        const merged = { ...srcJson, ...JSON.parse(dstContent) };
        fs.writeFileSync(dst, JSON.stringify(merged, null, 2));
        console.log(`рџ”„ Merged settings.json`);
      } catch (e) {
        fs.copyFileSync(src, dst);
        console.log(`рџ”§ Fixed corrupted settings.json from GitHub`);
      }
    }
  }
}

// в”Ђв”Ђв”Ђ РќРђР›РђРЁРўРЈР’РђРќРќРЇ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

// в”Ђв”Ђв”Ђ JSON HELPERS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

function looksLikeBrokenLandingText(value) {
  return typeof value === "string" && (
    value.includes("РІСљ") ||
    value.includes("РІР‚") ||
    value.includes("Р Р†РЎ") ||
    value.includes("Р РЋ") ||
    value.includes("Р’В©") ||
    value.includes("?? ???? ???")
  );
}

function repairLandingContent(defaultValue, incomingValue) {
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(incomingValue)) return cloneJson(defaultValue);
    const template = defaultValue[0];
    return incomingValue.map((item, index) => {
      const currentDefault = defaultValue[index] !== undefined ? defaultValue[index] : template;
      return currentDefault !== undefined ? repairLandingContent(currentDefault, item) : cloneJson(item);
    });
  }

  if (defaultValue && typeof defaultValue === "object") {
    const source = incomingValue && typeof incomingValue === "object" && !Array.isArray(incomingValue) ? incomingValue : {};
    const result = {};

    for (const key of Object.keys(defaultValue)) {
      result[key] = repairLandingContent(defaultValue[key], source[key]);
    }

    for (const key of Object.keys(source)) {
      if (!(key in result)) result[key] = cloneJson(source[key]);
    }

    return result;
  }

  if (looksLikeBrokenLandingText(incomingValue)) {
    return defaultValue;
  }

  return incomingValue !== undefined ? incomingValue : defaultValue;
}

const DEFAULT_LANDING_CONTENT = loadJson(LANDING_CONTENT_DEFAULT_PATH, {
  locales: { uk: {}, en: {} },
  botLink: "https://t.me/Promtiai_bot",
  theme: { supportsEnglishLater: true },
});

function loadLandingContent() {
  const saved = loadJson(LANDING_CONTENT_PATH, DEFAULT_LANDING_CONTENT);
  const merged = deepMerge(DEFAULT_LANDING_CONTENT, saved);
  const repaired = repairLandingContent(DEFAULT_LANDING_CONTENT, merged);
  saveJson(LANDING_CONTENT_PATH, repaired);
  return repaired;
}

let landingContent = loadLandingContent();

if (landingContent?.locales?.uk?.hero?.trust === "1 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЃС‚Р°СЂС‚С–") {
  landingContent.locales.uk.hero.trust = "3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЃС‚Р°СЂС‚С–";
}
if (landingContent?.locales?.uk?.ctaSection?.title === "РЎРїСЂРѕР±СѓР№ Р·Р°СЂР°Р· С– РѕС‚СЂРёРјР°Р№ РїРµСЂС€РёР№ Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ") {
  landingContent.locales.uk.ctaSection.title = "РЎРїСЂРѕР±СѓР№ Р·Р°СЂР°Р· С– РѕС‚СЂРёРјР°Р№ РїРµСЂС€С– 3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ";
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

// в”Ђв”Ђв”Ђ Р”РђРќР† в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
  welcomeText:  "РџСЂРёРІС–С‚ вњЁ\n\nРћР±РµСЂРё С‰Рѕ С…РѕС‡РµС€ Р·СЂРѕР±РёС‚Рё:\nрџ–ј Р¤РѕС‚Рѕ вЂ” РіРµРЅРµСЂР°С†С–СЏ С„РѕС‚Рѕ РїРѕ СЃС‚РёР»СЏС…\nрџЋ¬ Р’С–РґРµРѕ вЂ” Р°РЅС–РјР°С†С–СЏ С„РѕС‚Рѕ Сѓ РІС–РґРµРѕ\n\nрџЋЃ 3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЃС‚Р°СЂС‚С–",
  infoText:     "PROMTI AI Bot\n\nрџ–ј Р¤РѕС‚Рѕ:\n10/99РіСЂРЅ В· 20/179РіСЂРЅ В· 30/249РіСЂРЅ В· 50/399РіСЂРЅ\n\nрџЋ¬ Seedance:\n3/199РіСЂРЅ В· 5/349РіСЂРЅ В· 10/599РіСЂРЅ\n\nрџЋҐ Kling:\n3/299РіСЂРЅ В· 5/499РіСЂРЅ В· 10/899РіСЂРЅ",
  helpText:     "Р”РѕРїРѕРјРѕРіР°:\n\nрџ–ј Р¤РѕС‚Рѕ:\n1. РќР°С‚РёСЃРЅРё рџ–ј Р¤РѕС‚Рѕ\n2. РћР±РµСЂРё СЃС‚РёР»СЊ\n3. РќР°РґС–С€Р»Рё С„РѕС‚Рѕ\n\nрџЋ¬ Р’С–РґРµРѕ:\n1. РќР°С‚РёСЃРЅРё рџЋ¬ Р’С–РґРµРѕ\n2. РћР±РµСЂРё РјРѕРґРµР»СЊ\n3. РќР°РґС–С€Р»Рё С„РѕС‚Рѕ РґР»СЏ Р°РЅС–РјР°С†С–С—",
  supportText:  "РќР°РїРёС€Рё РІ РїС–РґС‚СЂРёРјРєСѓ: https://t.me/promteamai?direct",
  ideaText:     "рџ’Ў Р†РґРµС— РґР»СЏ РїСЂРѕРјС‚С–РІ:\n\nрџ–ј Р¤РѕС‚Рѕ:\nвЂў \"portrait in Renaissance style\"\nвЂў \"cyberpunk neon portrait\"\n\nрџЋ¬ Р’С–РґРµРѕ:\nвЂў \"hair gently flowing in wind\"\nвЂў \"eyes slowly opening, cinematic\"",
  support_link: "https://t.me/promteamai?direct",
  pricesText:   "рџ’° PROMTI AI вЂ” Р¦С–РЅРё\n\nрџ’Ћ Р’Р°Р»СЋС‚Р°: Promti вњЁ\n1 Promti вњЁ = РІС–Рґ 6.7 РґРѕ 9.9 РіСЂРЅ\n\nрџ“¦ РџР°РєРµС‚Рё:\n10 Promti вњЁ вЂ” 99 РіСЂРЅ (9.9 РіСЂРЅ/вњЁ)\n30 Promti вњЁ вЂ” 249 РіСЂРЅ (8.3 РіСЂРЅ/вњЁ)\n60 Promti вњЁ вЂ” 449 РіСЂРЅ (7.5 РіСЂРЅ/вњЁ)\n150 Promti вњЁ вЂ” 999 РіСЂРЅ (6.7 РіСЂРЅ/вњЁ) рџ”Ґ\n\nрџ’° Р¦С–РЅРё РїРѕСЃР»СѓРі:\nрџ–ј Р¤РѕС‚Рѕ вЂ” 1 Promti вњЁ\nрџЋ¬ Seedance РІС–РґРµРѕ вЂ” 5 Promti вњЁ\nрџЋҐ Kling РІС–РґРµРѕ вЂ” 8 Promti вњЁ\n\nрџЋЃ 3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЂРµС”СЃС‚СЂР°С†С–С—!\nрџ‘« +5 Promti вњЁ Р·Р° РєРѕР¶РЅРѕРіРѕ РґСЂСѓРіР° СЏРєРёР№ РѕРїР»Р°С‚РёС‚СЊ",
  styleLibrary: {},
  promptLibrary: {},
  promptCategories: {},
};

let users    = loadJson(USERS_PATH,    {});
let prompts  = loadJson(PROMPTS_PATH,  DEFAULT_PROMPTS);
let content  = loadJson(CONTENT_PATH,  DEFAULT_CONTENT);
let payments = loadJson(PAYMENTS_PATH, []);

prompts = { ...DEFAULT_PROMPTS, ...prompts };
content = { ...DEFAULT_CONTENT, ...content };
if (!content.styleLibrary || typeof content.styleLibrary !== "object" || Array.isArray(content.styleLibrary)) content.styleLibrary = {};
if (!content.promptLibrary || typeof content.promptLibrary !== "object" || Array.isArray(content.promptLibrary)) content.promptLibrary = {};
if (!content.promptCategories || typeof content.promptCategories !== "object" || Array.isArray(content.promptCategories)) content.promptCategories = {};
if (Object.keys(content.styleLibrary).length === 0 && Object.keys(content.promptLibrary).length > 0) {
  content.styleLibrary = content.promptLibrary;
}
content.promptLibrary = content.styleLibrary;
if (typeof content.welcomeText === "string") {
  content.welcomeText = content.welcomeText
    .replaceAll("1 С„РѕС‚Рѕ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ", "3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ")
    .replaceAll("1 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЃС‚Р°СЂС‚С–", "3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЃС‚Р°СЂС‚С–");
}
if (typeof content.pricesText === "string") {
  content.pricesText = content.pricesText.replaceAll("1 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЂРµС”СЃС‚СЂР°С†С–С—", "3 Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЂРµС”СЃС‚СЂР°С†С–С—");
}
saveJson(PROMPTS_PATH, prompts);
saveJson(CONTENT_PATH, content);

// в”Ђв”Ђв”Ђ РџРђРљР•РўР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const DEFAULT_PACKAGES = {
  promti_pack10:  { key: "promti_pack10",  type: "promti", title: "10 Promti вњЁ",  promti: 10,  amount: 99,  priceText: "99 РіСЂРЅ"  },
  promti_pack30:  { key: "promti_pack30",  type: "promti", title: "30 Promti вњЁ",  promti: 30,  amount: 249, priceText: "249 РіСЂРЅ" },
  promti_pack60:  { key: "promti_pack60",  type: "promti", title: "60 Promti вњЁ",  promti: 60,  amount: 449, priceText: "449 РіСЂРЅ" },
  promti_pack150: { key: "promti_pack150", type: "promti", title: "150 Promti вњЁ", promti: 150, amount: 999, priceText: "999 РіСЂРЅ" },
};

function loadPackages() {
  const saved = loadJson(PACKAGES_PATH, null);
  // вњ… РЇРєС‰Рѕ С„Р°Р№Р»Сѓ РЅРµРјР° Р°Р±Рѕ РІ РЅСЊРѕРјСѓ РІС–РґСЃСѓС‚РЅС– РєР»СЋС‡С– DEFAULT_PACKAGES вЂ” РјРµСЂР¶РёРјРѕ
  if (!saved || Object.keys(saved).length === 0) {
    saveJson(PACKAGES_PATH, DEFAULT_PACKAGES);
    return JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
  }
  // вњ… РЇРєС‰Рѕ С…РѕС‡Р° Р± РѕРґРЅРѕРіРѕ РґРµС„РѕР»С‚РЅРѕРіРѕ РїР°РєРµС‚Сѓ РЅРµРјР° РІ saved вЂ” РґРѕРґР°С”РјРѕ
  let changed = false;
  for (const key of Object.keys(DEFAULT_PACKAGES)) {
    if (!saved[key]) {
      saved[key] = DEFAULT_PACKAGES[key];
      changed = true;
      console.log(`рџ“¦ Р”РѕРґР°РЅРѕ РґРµС„РѕР»С‚РЅРёР№ РїР°РєРµС‚: ${key}`);
    }
  }
  if (changed) saveJson(PACKAGES_PATH, saved);
  return saved;
}

let dynamicPackages = loadPackages();
function getPackages()         { return dynamicPackages; }
function saveDynamicPackages() { saveJson(PACKAGES_PATH, dynamicPackages); }

// в”Ђв”Ђв”Ђ РђРўРћРњРђР РќРР™ LOCK РћРџР›РђРў в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
let creditedSet = new Set(loadJson(PAYMENT_LOCK_PATH, []));
function markAsCredited(ref) { creditedSet.add(ref); saveJson(PAYMENT_LOCK_PATH, [...creditedSet]); }
function isCredited(ref)     { return creditedSet.has(ref); }

// в”Ђв”Ђв”Ђ Р§Р•Р Р“Рђ Р“Р•РќР•Р РђР¦Р†Р™ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
        job.ctx.reply(`вЏі РўРё РІ С‡РµСЂР·С–: #${idx + 1}\nР—Р°СЂР°Р· РѕР±СЂРѕР±Р»СЏС”С‚СЊСЃСЏ С„РѕС‚Рѕ...\nРћСЂС–С”РЅС‚РѕРІРЅРѕ 45 СЃРµРє вЂ” 1 С…РІ вЊ›`).catch(() => {});
      }
    }
  });

  videoQueue.forEach((job, idx) => {
    if (job.notifiedPosition !== idx + 1) {
      job.notifiedPosition = idx + 1;
      if (job.ctx) {
        job.ctx.reply(`вЏі РўРё РІ С‡РµСЂР·С–: #${idx + 1}\nР—Р°СЂР°Р· РіРµРЅРµСЂСѓС”С‚СЊСЃСЏ РІС–РґРµРѕ...\nРћСЂС–С”РЅС‚РѕРІРЅРѕ 1-8 С…РІ вЊ›`).catch(() => {});
      }
    }
  });

  while (activePhotoWorkers < maxPhoto && activeWorkers < maxTotal && photoQueue.length > 0) {
    const job = photoQueue.shift();
    activePhotoWorkers++;
    activeWorkers++;
    if (job.ctx && job.notifiedPosition > 1) {
      job.ctx.reply("вњ… Р§РµСЂРіР° РґС–Р№С€Р»Р°! РџРѕС‡РёРЅР°СЋ РіРµРЅРµСЂР°С†С–СЋ...").catch(() => {});
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
      job.ctx.reply("вњ… Р§РµСЂРіР° РґС–Р№С€Р»Р°! РџРѕС‡РёРЅР°СЋ РіРµРЅРµСЂР°С†С–СЋ РІС–РґРµРѕ...").catch(() => {});
    }
    job.taskFn()
      .then(job.resolve).catch(job.reject)
      .finally(() => { activeVideoWorkers--; activeWorkers--; processQueue(); });
  }
}

// в”Ђв”Ђв”Ђ RATE LIMITING в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

// в”Ђв”Ђв”Ђ Р”Р•РќРќР† Р›Р†РњР†РўР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function getTodayDate() { return new Date().toISOString().slice(0, 10); }

function checkDailyVideoLimit(user, model) {
  const cfg   = loadSettings();
  const today = getTodayDate();
  const limit = model === "kling" ? cfg.dailyKlingLimit : cfg.dailySeedanceLimit;
  if (limit === 0) return null;
  if (user.dailyVideoDate !== today) { user.dailyVideoDate = today; user.dailySeedanceCount = 0; user.dailyKlingCount = 0; }
  const used = model === "kling" ? (user.dailyKlingCount || 0) : (user.dailySeedanceCount || 0);
  if (used >= limit) return `вќЊ Р”РµРЅРЅРёР№ Р»С–РјС–С‚ ${model === "kling" ? "Kling" : "Seedance"}: ${limit} РІС–РґРµРѕ/РґРµРЅСЊ.\nРЎРїСЂРѕР±СѓР№ Р·Р°РІС‚СЂР° Р°Р±Рѕ РєСѓРїРё Р±С–Р»СЊС€РёР№ РїР°РєРµС‚.`;
  return null;
}

function checkDailyAiLimit(user) {
  const cfg   = loadSettings();
  const limit = cfg.dailyAiPromptLimit;
  if (limit === 0) return null;
  const today = getTodayDate();
  if (user.dailyAiDate !== today) { user.dailyAiDate = today; user.dailyAiCount = 0; }
  if ((user.dailyAiCount || 0) >= limit) return `вќЊ Р”РµРЅРЅРёР№ Р»С–РјС–С‚ AI-РїСЂРѕРјС‚С–РІ: ${limit}/РґРµРЅСЊ. РЎРїСЂРѕР±СѓР№ Р·Р°РІС‚СЂР° Р°Р±Рѕ РЅР°РїРёС€Рё РїСЂРѕРјС‚ РІСЂСѓС‡РЅСѓ С‡РµСЂРµР· вњЌпёЏ РЎРІС–Р№ РїСЂРѕРјС‚.`;
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

// в”Ђв”Ђв”Ђ РџРћРњРР›РљР в†’ РђР”РњР†РќР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
    try { await bot.telegram.sendMessage(adminId, `вљ пёЏ РџРћРњРР›РљРђ:\n\n${message}`); }
    catch (e) { console.error("NOTIFY ADMIN ERROR:", e.message); }
  }
}

// в”Ђв”Ђв”Ђ Р®Р—Р•Р  HELPERS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
  ctx.session.currentPromptKey      = null;
  ctx.session.sourcePromptKey       = null;
  ctx.session.currentStyleKey       = null;
  ctx.session.currentStyleType      = null;
  ctx.session.currentDynamicSelections = {};
  ctx.session.sourceStyleKey        = null;
  ctx.session.sourceStyleType       = null;
  ctx.session.sourceDynamicSelections = {};
  ctx.session.pendingDynamicStyle   = null;
  ctx.session.styleWizard           = null;
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
      sourceStyleKey: null,
      sourceDynamicSelections: {},
      lastGeneratedPromptKey: null,
      lastGeneratedStyleKey: null,
      pendingPurchasePromptKey: null,
      pendingPurchaseStyleKey: null,
      pendingPurchaseDynamicSelections: null,
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

function normalizeSelectorVariables(variables = {}) {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(variables)) {
    const normalizedKey = String(key || "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!normalizedKey) continue;
    normalized[normalizedKey] = String(value ?? "").trim();
  }
  return normalized;
}

function normalizeSelectorOption(option = {}, fallbackKey = "") {
  return {
    key: normalizePromptKey(option.key || fallbackKey),
    label: String(option.label || fallbackKey || "Option").trim(),
    variables: normalizeSelectorVariables(option.variables),
    clicks: Number(option.clicks || 0),
    generations: Number(option.generations || 0),
    purchases: Number(option.purchases || 0),
  };
}

function normalizeStyleSelectors(selectors = []) {
  if (!Array.isArray(selectors)) return [];
  return selectors
    .map((selector, selectorIndex) => {
      if (!selector || typeof selector !== "object") return null;
      const key = normalizePromptKey(selector.key || `selector_${selectorIndex + 1}`);
      if (!key) return null;
      const rawOptions = selector.options && typeof selector.options === "object" && !Array.isArray(selector.options)
        ? selector.options
        : {};
      const normalizedOptions = {};
      for (const [optionKey, optionValue] of Object.entries(rawOptions)) {
        const normalizedOption = normalizeSelectorOption(optionValue, optionKey);
        if (!normalizedOption.key) continue;
        normalizedOptions[normalizedOption.key] = normalizedOption;
      }
      return {
        key,
        label: String(selector.label || key).trim(),
        type: selector.type === "inline" ? "inline" : "inline",
        options: normalizedOptions,
      };
    })
    .filter(Boolean);
}

function normalizePromptExamplePhotos(value) {
  const source = Array.isArray(value) ? value : (value ? [value] : []);
  return source
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .slice(0, MAX_PROMPT_EXAMPLE_PHOTOS);
}

function normalizeStyleItem(item = {}, key = "") {
  const type = item.type === "dynamic" ? "dynamic" : "static";
  const examplePhotos = normalizePromptExamplePhotos(item.examplePhotos);
  const previewPhoto = item.previewPhoto || examplePhotos[0] || null;
  const selectors = normalizeStyleSelectors(item.selectors);
  return {
    key: item.key || key,
    type,
    title: item.title || key,
    prompt: type === "static" ? String(item.prompt || item.template || "").trim() : "",
    template: type === "dynamic" ? String(item.template || item.prompt || "").trim() : "",
    selectors,
    category: item.category || "other",
    previewPhoto,
    examplePhotos,
    isTrending: Boolean(item.isTrending),
    createdAt: Number(item.createdAt || Date.now()),
    clicks: Number(item.clicks || 0),
    generations: Number(item.generations || 0),
    purchases: Number(item.purchases || 0),
  };
}

function normalizePromptLibraryItem(item = {}, key = "") {
  return normalizeStyleItem(item, key);
}

function ensureStyleLibrary() {
  const rawLegacy = content.promptLibrary && typeof content.promptLibrary === "object" && !Array.isArray(content.promptLibrary)
    ? content.promptLibrary
    : {};
  if (!content.styleLibrary || typeof content.styleLibrary !== "object" || Array.isArray(content.styleLibrary)) {
    content.styleLibrary = {};
  }

  const merged = { ...rawLegacy, ...content.styleLibrary };
  let changed = false;
  const normalizedLibrary = {};
  for (const [key, item] of Object.entries(merged)) {
    const normalized = normalizeStyleItem(item, key);
    if (JSON.stringify(normalized) !== JSON.stringify(item)) {
      changed = true;
    }
    normalizedLibrary[normalized.key] = normalized;
  }

  content.styleLibrary = normalizedLibrary;
  content.promptLibrary = content.styleLibrary;
  if (changed) saveContent();
  return content.styleLibrary;
}

function ensurePromptLibrary() {
  return ensureStyleLibrary();
}

function getStyle(key) {
  const styleLibrary = ensureStyleLibrary();
  if (!key || !styleLibrary[key]) return null;
  return normalizeStyleItem(styleLibrary[key], key);
}

function getPromptStyle(key) {
  return getStyle(key);
}

function getSortedStyles() {
  return Object.values(ensureStyleLibrary())
    .map(item => normalizeStyleItem(item, item.key))
    .sort((a, b) =>
      Number(b.isTrending) - Number(a.isTrending) ||
      Number(b.clicks || 0) - Number(a.clicks || 0) ||
      Number(b.createdAt || 0) - Number(a.createdAt || 0)
    );
}

function getSortedPromptStyles() {
  return getSortedStyles();
}

function getPromptCategoryStats() {
  const stats = {};
  for (const style of getSortedStyles()) {
    stats[style.category] = (stats[style.category] || 0) + 1;
  }
  return stats;
}

function setStyle(style) {
  const normalized = normalizeStyleItem(style, style?.key);
  ensureStyleLibrary();
  content.styleLibrary[normalized.key] = normalized;
  content.promptLibrary = content.styleLibrary;
  saveContent();
  return normalized;
}

function deleteStyle(key) {
  ensureStyleLibrary();
  delete content.styleLibrary[key];
  content.promptLibrary = content.styleLibrary;
  saveContent();
}

function readDynamicPromptsConfig() {
  const repoPath = path.join(__dirname, "dynamic-prompts.json");
  const primaryPath = fs.existsSync(repoPath)
    ? repoPath
    : DYNAMIC_PROMPTS_PATH;
  if (!fs.existsSync(primaryPath)) return { templates: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(primaryPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : { templates: [] };
  } catch (error) {
    console.error("DYNAMIC PROMPTS READ ERROR:", error.message);
    return { templates: [] };
  }
}

function convertDynamicPromptTemplate(template = {}, existingStyle = null) {
  const key = normalizePromptKey(template.id || template.key || "");
  if (!key) return null;

  let selectors = [];
  if (Array.isArray(template.selectors) && template.selectors.length) {
    selectors = normalizeStyleSelectors(template.selectors);
  } else {
    const selectorKey = normalizePromptKey(template.selectorKey || "selector");
    const rawOptions = template.options && typeof template.options === "object" && !Array.isArray(template.options)
      ? template.options
      : {};
    const options = {};
    for (const [optionKey, optionValue] of Object.entries(rawOptions)) {
      const variablesSource = optionValue?.variables && typeof optionValue.variables === "object"
        ? optionValue.variables
        : Object.fromEntries(Object.entries(optionValue || {}).filter(([innerKey]) => innerKey !== "label"));
      options[normalizePromptKey(optionKey)] = {
        key: normalizePromptKey(optionKey),
        label: optionValue?.label || optionKey,
        variables: variablesSource,
        clicks: optionValue?.clicks || 0,
        generations: optionValue?.generations || 0,
        purchases: optionValue?.purchases || 0,
      };
    }
    selectors = normalizeStyleSelectors([{
      key: selectorKey,
      label: template.selectorLabel || selectorKey,
      type: template.selectorType === "inline" ? "inline" : "inline",
      options,
    }]);
  }

  return normalizeStyleItem({
    key,
    type: "dynamic",
    title: template.title || key,
    category: template.category || existingStyle?.category || "dynamic",
    template: template.template || "",
    selectors,
    previewPhoto: existingStyle?.previewPhoto || template.previewPhoto || null,
    examplePhotos: existingStyle?.examplePhotos || template.examplePhotos || [],
    isTrending: typeof template.isTrending === "boolean" ? template.isTrending : Boolean(existingStyle?.isTrending),
    createdAt: existingStyle?.createdAt || Date.now(),
    clicks: Number(existingStyle?.clicks || 0),
    generations: Number(existingStyle?.generations || 0),
    purchases: Number(existingStyle?.purchases || 0),
  }, key);
}

function importDynamicPromptTemplates() {
  const config = readDynamicPromptsConfig();
  const templates = Array.isArray(config.templates) ? config.templates : [];
  let imported = 0;
  for (const template of templates) {
    if (!template || template.enabled === false) continue;
    const existingStyle = getStyle(normalizePromptKey(template.id || template.key || ""));
    const converted = convertDynamicPromptTemplate(template, existingStyle);
    if (!converted) continue;
    setStyle(converted);
    imported += 1;
  }
  return imported;
}

function incrementStyleMetric(styleKey, metric, amount = 1) {
  const style = getStyle(styleKey);
  if (!style) return false;
  style[metric] = Number(style[metric] || 0) + amount;
  setStyle(style);
  return true;
}

function incrementPromptMetric(promptKey, metric, amount = 1) {
  return incrementStyleMetric(promptKey, metric, amount);
}

function incrementDynamicOptionMetric(styleKey, selectorKey, optionKey, metric, amount = 1) {
  const style = getStyle(styleKey);
  if (!style || style.type !== "dynamic") return false;
  const selector = style.selectors.find(item => item.key === selectorKey);
  if (!selector || !selector.options[optionKey]) return false;
  selector.options[optionKey][metric] = Number(selector.options[optionKey][metric] || 0) + amount;
  setStyle(style);
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

function buildDynamicPrompt(style, selectedOptions = {}) {
  if (!style || style.type !== "dynamic") return style?.prompt || "";
  const variables = {};
  for (const selector of style.selectors) {
    const selectedKey = selectedOptions?.[selector.key];
    const selectedOption = selectedKey ? selector.options?.[selectedKey] : null;
    if (!selectedOption) continue;
    Object.assign(variables, normalizeSelectorVariables(selectedOption.variables));
  }

  return String(style.template || "")
    .replace(/\[([A-Z0-9_]+)\]/g, (full, placeholder) => {
      const key = String(placeholder || "").trim().toUpperCase();
      return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : full;
    })
    .trim();
}

function getStyleDeepLink(username, key, selections = {}) {
  const style = getStyle(key);
  if (!style) return `https://t.me/${username}?start=prompt_${key}`;
  const prefix = style.type === "dynamic" ? "template_" : "prompt_";
  const params = Object.entries(selections || {})
    .filter(([, value]) => value)
    .map(([selectorKey, optionKey]) => `${normalizePromptKey(selectorKey)}=${normalizePromptKey(optionKey)}`)
    .join("__");
  return `https://t.me/${username}?start=${prefix}${key}${params ? `__${params}` : ""}`;
}

function getPromptDeepLink(username, key) {
  return getStyleDeepLink(username, key);
}

function parseStyleStartPayload(payload = "") {
  const raw = String(payload || "").trim();
  if (!raw) return null;
  const prefix = raw.startsWith("template_") ? "template_" : (raw.startsWith("prompt_") ? "prompt_" : null);
  if (!prefix) return null;
  const body = raw.slice(prefix.length);
  const parts = body.split("__").filter(Boolean);
  const key = normalizePromptKey(parts.shift() || "");
  const selections = {};
  for (const part of parts) {
    const [selectorKey, optionKey] = part.split("=");
    if (!selectorKey || !optionKey) continue;
    selections[normalizePromptKey(selectorKey)] = normalizePromptKey(optionKey);
  }
  return {
    type: prefix === "template_" ? "dynamic" : "static",
    key,
    selections,
  };
}

function getPromptBalanceText(userId) {
  if (isAdmin(userId)) return "РђРґРјС–РЅ: Р±РµР·Р»С–РјС–С‚ вњ…";
  const user = getUser(userId);
  return `${user.promti || 0} Promti вњЁ`;
}

function clearPromptAttribution(ctx) {
  ensureSession(ctx);
  ctx.session.currentPromptKey = null;
  ctx.session.sourcePromptKey = null;
  ctx.session.currentStyleKey = null;
  ctx.session.currentStyleType = null;
  ctx.session.currentDynamicSelections = {};
  ctx.session.sourceStyleKey = null;
  ctx.session.sourceStyleType = null;
  ctx.session.sourceDynamicSelections = {};
}

function applyStaticStyleToSession(ctx, style, selections = {}) {
  if (!style) return null;
  const user = getUser(ctx.from.id);
  const finalPrompt = style.type === "dynamic"
    ? buildDynamicPrompt(style, selections)
    : style.prompt;

  ctx.session.mode = "photo";
  ctx.session.photoMode = "edit";
  ctx.session.customType = "custom_photo";
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = finalPrompt;
  ctx.session.awaitingAiPrompt = null;
  ctx.session.awaitingCustomAmount = false;
  ctx.session.awaitingPromptEditKey = null;
  ctx.session.awaitingTextEditKey = null;
  ctx.session.awaitingPromptPreviewKey = null;
  ctx.session.currentPromptKey = style.key;
  ctx.session.sourcePromptKey = style.key;
  ctx.session.currentStyleKey = style.key;
  ctx.session.currentStyleType = style.type;
  ctx.session.currentDynamicSelections = { ...(selections || {}) };
  ctx.session.sourceStyleKey = style.key;
  ctx.session.sourceStyleType = style.type;
  ctx.session.sourceDynamicSelections = { ...(selections || {}) };
  ctx.session.style = null;
  ctx.session.videoInputMode = null;
  ctx.session.pendingDynamicStyle = null;

  user.sourcePromptKey = style.key;
  user.sourceStyleKey = style.key;
  user.sourceDynamicSelections = { ...(selections || {}) };
  saveUsers();
  return style;
}

function applyPromptStyleToSession(ctx, promptKey) {
  const style = getPromptStyle(promptKey);
  if (!style) return null;
  ensureSession(ctx);
  if (style.type === "dynamic") return null;
  return applyStaticStyleToSession(ctx, style);
}

async function startDynamicStyleFlow(ctx, style, initialSelections = {}) {
  ensureSession(ctx);
  ctx.session.pendingDynamicStyle = {
    styleKey: style.key,
    currentSelectorIndex: 0,
    selections: { ...(initialSelections || {}) },
  };
  ctx.session.currentStyleKey = style.key;
  ctx.session.currentStyleType = style.type;
  ctx.session.currentDynamicSelections = { ...(initialSelections || {}) };
  const previewText =
    `рџЋЁ <b>${escapeHtml(style.title)}</b>\n\n` +
    `РЎРїРѕС‡Р°С‚РєСѓ РїРѕРґРёРІРёСЃСЊ РїСЂРёРєР»Р°РґРё СЃС‚РёР»СЋ, Р° РїРѕС‚С–Рј РѕР±РµСЂРё РїР°СЂР°РјРµС‚СЂРё.`;
  await sendPromptExamplePhotos(ctx, style, previewText);
  return continueDynamicStyleFlow(ctx, style.key);
}

async function continueDynamicStyleFlow(ctx, styleKey) {
  const style = getStyle(styleKey);
  if (!style || style.type !== "dynamic") return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
  ensureSession(ctx);
  if (!ctx.session.pendingDynamicStyle || ctx.session.pendingDynamicStyle.styleKey !== styleKey) {
    ctx.session.pendingDynamicStyle = {
      styleKey,
      currentSelectorIndex: 0,
      selections: {},
    };
  }

  const pending = ctx.session.pendingDynamicStyle;
  const remainingSelector = style.selectors.find(selector => !pending.selections?.[selector.key]);
  if (!remainingSelector) {
    return finalizeDynamicStylePrompt(ctx, styleKey);
  }

  const rows = Object.values(remainingSelector.options).map(option => [
    Markup.button.callback(option.label, `stylelib_select_${style.key}__${remainingSelector.key}__${option.key}`)
  ]);

  const text =
    `рџЋ› <b>${escapeHtml(style.title)}</b>\n\n` +
    `${escapeHtml(remainingSelector.label)}\n` +
    `РљСЂРѕРєС–РІ Р·Р°Р»РёС€РёР»РѕСЃСЊ: <b>${style.selectors.filter(selector => !pending.selections?.[selector.key]).length}</b>`;

  return ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard(rows).reply_markup,
  });
}

async function finalizeDynamicStylePrompt(ctx, styleKey) {
  const style = getStyle(styleKey);
  if (!style || style.type !== "dynamic") return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
  ensureSession(ctx);
  const selections = { ...(ctx.session.pendingDynamicStyle?.selections || {}) };
  const finalPrompt = buildDynamicPrompt(style, selections);
  if (!finalPrompt) return ctx.reply("вќЊ РќРµ РІРґР°Р»РѕСЃСЏ Р·С–Р±СЂР°С‚Рё РїСЂРѕРјС‚.");

  applyStaticStyleToSession(ctx, style, selections);
  ctx.session.customPrompt = finalPrompt;
  ctx.session.pendingDynamicStyle = null;

  return sendPromptReadyMessage(ctx, style, { withPreview: true });
}

function markPromptGeneration(user, promptKey, selections = null) {
  if (!promptKey) return;
  const style = getStyle(promptKey);
  if (!style) return;
  incrementStyleMetric(promptKey, "generations");
  if (style.type === "dynamic" && selections) {
    for (const [selectorKey, optionKey] of Object.entries(selections)) {
      incrementDynamicOptionMetric(promptKey, selectorKey, optionKey, "generations");
    }
  }
  user.lastGeneratedPromptKey = promptKey;
  user.lastGeneratedStyleKey = promptKey;
  user.pendingPurchasePromptKey = promptKey;
  user.pendingPurchaseStyleKey = promptKey;
  user.pendingPurchaseDynamicSelections = selections ? { ...selections } : null;
  saveUsers();
}

function markPromptPurchase(user, orderReference) {
  const promptKey = user.pendingPurchaseStyleKey || user.pendingPurchasePromptKey;
  if (!promptKey) return false;
  if (user.lastPurchaseAttributedOrderReference === orderReference) return false;
  const style = getStyle(promptKey);
  if (!style) return false;
  incrementStyleMetric(promptKey, "purchases");
  if (style.type === "dynamic" && user.pendingPurchaseDynamicSelections) {
    for (const [selectorKey, optionKey] of Object.entries(user.pendingPurchaseDynamicSelections)) {
      incrementDynamicOptionMetric(promptKey, selectorKey, optionKey, "purchases");
    }
  }
  user.lastPurchaseAttributedOrderReference = orderReference;
  user.pendingPurchasePromptKey = null;
  user.pendingPurchaseStyleKey = null;
  user.pendingPurchaseDynamicSelections = null;
  saveUsers();
  return true;
}

function buildPromptStyleCardText(style, options = {}) {
  const { admin = false, userId = null, botUsername = "Promtiai_bot" } = options;
  const trendMark = style.isTrending ? "рџ”Ґ РўСЂРµРЅРґ\n" : "";
  const styleTypeLabel = style.type === "dynamic" ? "dynamic" : "static";
  const deepLink = getStyleDeepLink(botUsername, style.key);
  const examplesCount = Array.isArray(style.examplePhotos) ? style.examplePhotos.length : 0;
  if (admin) {
    return (
      `рџЋЁ <b>${escapeHtml(style.title)}</b>\n` +
      `${trendMark}` +
      `РљР»СЋС‡: <code>${escapeHtml(style.key)}</code>\n` +
      `РўРёРї: <b>${styleTypeLabel}</b>\n` +
      `РљР°С‚РµРіРѕСЂС–СЏ: <b>${escapeHtml(style.category)}</b>\n\n` +
      `Examples: <b>${examplesCount}/${MAX_PROMPT_EXAMPLE_PHOTOS}</b>\n` +
      `Clicks: <b>${style.clicks}</b>\n` +
      `Generations: <b>${style.generations}</b>\n` +
      `Purchases: <b>${style.purchases}</b>\n` +
      (style.type === "dynamic" ? `Selectors: <b>${style.selectors.length}</b>\n\n` : "\n") +
      `Gen conversion: <b>${formatConversion(style.generations, style.clicks)}</b>\n` +
      `Purchase conversion: <b>${formatConversion(style.purchases, style.clicks)}</b>\n\n` +
      `Deep-link:\n<code>${escapeHtml(deepLink)}</code>\n\n` +
      `${style.type === "dynamic" ? "Template" : "РџСЂРѕРјС‚"}:\n<code>${escapeHtml(style.type === "dynamic" ? style.template : style.prompt)}</code>`
    );
  }

  const balanceText = userId ? getPromptBalanceText(userId) : "-";
  return (
    `рџЋЁ <b>${escapeHtml(style.title)}</b>\n` +
    `${trendMark}` +
    `РўРёРї: <b>${styleTypeLabel}</b>\n` +
    `РљР°С‚РµРіРѕСЂС–СЏ: <b>${escapeHtml(style.category)}</b>\n\n` +
    (examplesCount ? `РџСЂРёРєР»Р°РґРё: <b>${examplesCount}</b>\n` : "") +
    (style.type === "dynamic" ? `РџР°СЂР°РјРµС‚СЂС–РІ: <b>${style.selectors.length}</b>\n` : "") +
    `РќР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ вЂ” Р±РѕС‚ Р·СЂРѕР±РёС‚СЊ С‚Р°РєРµ Р¶.\n` +
    `Р‘Р°Р»Р°РЅСЃ: <b>${escapeHtml(balanceText)}</b>`
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
      `${style.isTrending ? "рџ”Ґ " : ""}${style.title}`,
      `${prefix}_open_${style.key}`
    )
  ]);
  const nav = [];
  if (safePage > 0) nav.push(Markup.button.callback("в¬…пёЏ", `${prefix}_page_${safePage - 1}`));
  nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, `${prefix}_noop`));
  if (safePage < totalPages - 1) nav.push(Markup.button.callback("вћЎпёЏ", `${prefix}_page_${safePage + 1}`));
  if (nav.length) rows.push(nav);
  return Markup.inlineKeyboard(rows);
}

function buildPromptStyleKeyboard(style, admin = false) {
  if (!admin) {
    return Markup.inlineKeyboard([
      [Markup.button.callback(style.type === "dynamic" ? "рџЋ› РћР±СЂР°С‚Рё РїР°СЂР°РјРµС‚СЂРё" : "вњ… РћР±СЂР°С‚Рё СЃС‚РёР»СЊ", `promptlib_apply_${style.key}`)],
      [Markup.button.callback("рџ“љ Р”Рѕ СЃРїРёСЃРєСѓ СЃС‚РёР»С–РІ", "promptlib_page_0")],
    ]);
  }
  return Markup.inlineKeyboard([
    [Markup.button.callback(style.isTrending ? "рџ”• Р—РЅСЏС‚Рё С‚СЂРµРЅРґ" : "рџ”Ґ Р—СЂРѕР±РёС‚Рё С‚СЂРµРЅРґРѕРј", `admin_promptlib_trend_${style.key}_${style.isTrending ? "off" : "on"}`)],
    [Markup.button.callback("рџ–ј Preview С„РѕС‚Рѕ", `admin_promptlib_preview_${style.key}`)],
    [Markup.button.callback("рџ–ј Examples x10", `admin_promptlib_examples_${style.key}`)],
    [Markup.button.callback("рџ—‘ Р’РёРґР°Р»РёС‚Рё", `admin_promptlib_delete_${style.key}`)],
    [Markup.button.callback("рџ“љ Р”Рѕ Р±С–Р±Р»С–РѕС‚РµРєРё", "admin_promptlib_page_0")],
  ]);
}

function getPromptExamplePhotos(style) {
  if (!style) return [];
  const examples = normalizePromptExamplePhotos(style.examplePhotos);
  if (examples.length) return examples;
  return style.previewPhoto ? [style.previewPhoto] : [];
}

async function sendPromptExamplePhotos(ctx, style, caption = null, options = {}) {
  const photos = getPromptExamplePhotos(style).slice(0, MAX_PROMPT_EXAMPLE_PHOTOS);
  if (!photos.length) return false;

  const { fallbackCaption = true } = options;
  const CAPTION_LIMIT = 1024;
  let inlineCaption = null;
  let trailingText = null;

  if (caption) {
    if (caption.length <= CAPTION_LIMIT) inlineCaption = caption;
    else trailingText = caption;
  }

  try {
    for (let index = 0; index < photos.length; index += 10) {
      const chunk = photos.slice(index, index + 10);
      const media = chunk.map((fileId, chunkIndex) => ({
        type: "photo",
        media: fileId,
        ...(inlineCaption && index === 0 && chunkIndex === 0 ? { caption: inlineCaption, parse_mode: "HTML" } : {}),
      }));
      await ctx.replyWithMediaGroup(media);
    }
  } catch (e) {
    console.error("sendPromptExamplePhotos ERROR:", e.message);
    if (fallbackCaption && caption) {
      await ctx.reply(caption, { parse_mode: "HTML" }).catch(() => {});
    }
    return false;
  }

  if (trailingText) {
    await ctx.reply(trailingText, { parse_mode: "HTML" }).catch(() => {});
  }

  return true;
}

async function sendPromptLibraryPage(ctx, page = 0, admin = false) {
  const items = getSortedPromptStyles();
  if (!items.length) {
    return ctx.reply(
      admin
        ? "рџЋЁ Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ РїРѕСЂРѕР¶РЅСЏ.\n\nР”РѕРґР°Р№ РїРµСЂС€РёР№ СЃС‚РёР»СЊ С‡РµСЂРµР· /addprompt KEY | CATEGORY | TITLE | PROMPT"
        : "рџЋЁ РџРѕРєРё С‰Рѕ СЃС‚РёР»С–РІ РЅРµРјР°С”. РЎРїСЂРѕР±СѓР№ С‚СЂРѕС…Рё РїС–Р·РЅС–С€Рµ."
    );
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PROMPT_LIBRARY_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const categoryStats = getPromptCategoryStats();
  const categoryText = Object.entries(categoryStats)
    .slice(0, 6)
    .map(([category, count]) => `${category}: ${count}`)
    .join(" вЂў ");

  const text = admin
    ? `рџЋЁ <b>Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ</b>\n\nРЈСЃСЊРѕРіРѕ СЃС‚РёР»С–РІ: <b>${items.length}</b>\nРљР°С‚РµРіРѕСЂС–С—: ${escapeHtml(categoryText || "-")}\n\nР’С–РґРєСЂРёР№ СЃС‚РёР»СЊ, С‰РѕР± РїРѕР±Р°С‡РёС‚Рё deep-link, СЃС‚Р°С‚РёСЃС‚РёРєСѓ С‚Р° РєРµСЂСѓРІР°РЅРЅСЏ.`
    : `рџЋЁ <b>РўСЂРµРЅРґРѕРІС– СЃС‚РёР»С–</b>\n\nРћР±РµСЂРё СЃС‚РёР»СЊ Р·С– СЃРїРёСЃРєСѓ. РЎРїРѕС‡Р°С‚РєСѓ РїРѕРєР°Р·Р°РЅС– С‚СЂРµРЅРґРѕРІС–, РґР°Р»С– вЂ” РІСЃС– С–РЅС€С–.\n\nРљР°С‚РµРіРѕСЂС–С—: ${escapeHtml(categoryText || "-")}`;

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
  if (!style) return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
  const botUsername = await resolveBotUsername(ctx);
  const text = buildPromptStyleCardText(style, { admin, userId: ctx.from?.id, botUsername });
  const markup = buildPromptStyleKeyboard(style, admin);
  const examples = getPromptExamplePhotos(style);
  if (examples.length) {
    const sentExamples = await sendPromptExamplePhotos(ctx, style, text, { fallbackCaption: false });
    if (sentExamples) {
      return ctx.reply(admin ? "Р¤РѕС‚Рѕ-РїСЂРёРєР»Р°РґРё РЅР°РґС–СЃР»Р°РЅРѕ РІРёС‰Рµ." : "РћР±РµСЂРё РґС–СЋ РЅРёР¶С‡Рµ.", {
        parse_mode: "HTML",
        reply_markup: markup.reply_markup,
      });
    }
  }
  return ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: markup.reply_markup,
  });
}

async function sendPromptReadyMessage(ctx, style, options = {}) {
  const { withPreview = false } = options;
  const text =
    `вњ… РЎС‚РёР»СЊ Р·Р°РІР°РЅС‚Р°Р¶РµРЅРѕ\n\n` +
    `рџЋЁ ${style.title}\n` +
    `РљР°С‚РµРіРѕСЂС–СЏ: ${style.category}\n` +
    `Р‘Р°Р»Р°РЅСЃ: ${getPromptBalanceText(ctx.from.id)}\n\n` +
    `РќР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ рџ“ё`;

  if (withPreview && getPromptExamplePhotos(style).length) {
    const sentExamples = await sendPromptExamplePhotos(ctx, style, text, { fallbackCaption: false });
    if (sentExamples) return ctx.reply("РќР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ рџ“ё", photoMenu());
  }
  return ctx.reply(text, photoMenu());
}

function getStyleWizardDraft(ctx) {
  ensureSession(ctx);
  return ctx.session.styleWizard || null;
}

function startStyleWizard(ctx) {
  ensureSession(ctx);
  ctx.session.styleWizard = {
    mode: "create",
    step: "type",
    style: {
      key: "",
      type: "static",
      title: "",
      category: "",
      prompt: "",
      template: "",
      selectors: [],
      previewPhoto: null,
      examplePhotos: [],
      isTrending: false,
    },
    currentSelector: null,
    currentOption: null,
  };
}

async function promptStyleWizardStep(ctx) {
  const wizard = getStyleWizardDraft(ctx);
  if (!wizard) return ctx.reply("вќЊ Wizard РЅРµ Р°РєС‚РёРІРЅРёР№.", adminMenu());

  switch (wizard.step) {
    case "type":
      return ctx.reply("РћР±РµСЂС–С‚СЊ С‚РёРї СЃС‚РёР»СЋ:", Markup.inlineKeyboard([
        [Markup.button.callback("Static", "stylewizard_type_static")],
        [Markup.button.callback("Dynamic", "stylewizard_type_dynamic")],
      ]));
    case "key":
      return ctx.reply("Р’РІРµРґРё key СЃС‚РёР»СЋ Р»Р°С‚РёРЅРёС†РµСЋ. РџСЂРёРєР»Р°Рґ: zodiac_goddess");
    case "category":
      return ctx.reply("Р’РІРµРґРё category СЃС‚РёР»СЋ. РџСЂРёРєР»Р°Рґ: zodiac");
    case "title":
      return ctx.reply("Р’РІРµРґРё title СЃС‚РёР»СЋ РґР»СЏ РєРѕСЂРёСЃС‚СѓРІР°С‡Р°.");
    case "prompt":
      return ctx.reply("РќР°РґС–С€Р»Рё РіРѕС‚РѕРІРёР№ prompt РґР»СЏ static СЃС‚РёР»СЋ.");
    case "template":
      return ctx.reply("РќР°РґС–С€Р»Рё template РґР»СЏ dynamic СЃС‚РёР»СЋ Р· [PLACEHOLDER].");
    case "selector_key":
      return ctx.reply(`Р’РІРµРґРё key selector-Р° в„–${wizard.style.selectors.length + 1}. РџСЂРёРєР»Р°Рґ: zodiac`);
    case "selector_label":
      return ctx.reply("Р’РІРµРґРё label selector-Р°. РџСЂРёРєР»Р°Рґ: РћР±РµСЂРё Р·РЅР°Рє Р·РѕРґС–Р°РєСѓ");
    case "option_key":
      return ctx.reply("Р’РІРµРґРё key option. РџСЂРёРєР»Р°Рґ: pisces");
    case "option_label":
      return ctx.reply("Р’РІРµРґРё label option. РџСЂРёРєР»Р°Рґ: Р РёР±Рё");
    case "option_variables":
      return ctx.reply("РќР°РґС–С€Р»Рё variables Сѓ JSON. РџСЂРёРєР»Р°Рґ:\n{\"ZODIAC\":\"Pisces\",\"ZODIAC_COLORS\":\"seafoam, pearl, lilac\"}");
    case "selector_continue":
      return ctx.reply("Р©Рѕ СЂРѕР±РёРјРѕ РґР°Р»С– Р· selector-Р°РјРё?", Markup.inlineKeyboard([
        [Markup.button.callback("Р©Рµ option", "stylewizard_continue_option")],
        [Markup.button.callback("РќРѕРІРёР№ selector", "stylewizard_continue_selector")],
        [Markup.button.callback("Р”Р°Р»С– РґРѕ С„РѕС‚Рѕ", "stylewizard_continue_media")],
      ]));
    case "preview":
      return ctx.reply("РќР°РґС–С€Р»Рё preview photo Р°Р±Рѕ РЅР°С‚РёСЃРЅРё skip.", Markup.inlineKeyboard([
        [Markup.button.callback("Skip preview", "stylewizard_skip_preview")],
      ]));
    case "examples":
      return ctx.reply(`РќР°РґС–С€Р»Рё РґРѕ ${MAX_PROMPT_EXAMPLE_PHOTOS} example photos.\nРљРѕР»Рё Р·Р°РІРµСЂС€РёС€ вЂ” РЅР°С‚РёСЃРЅРё done Р°Р±Рѕ skip.`, Markup.inlineKeyboard([
        [Markup.button.callback("Done examples", "stylewizard_done_examples")],
        [Markup.button.callback("Skip examples", "stylewizard_skip_examples")],
      ]));
    case "confirm": {
      const style = normalizeStyleItem(wizard.style, wizard.style.key);
      const summary =
        `вњ… РџРµСЂРµРІС–СЂ СЃС‚РёР»СЊ РїРµСЂРµРґ Р·Р±РµСЂРµР¶РµРЅРЅСЏРј\n\n` +
        `Key: ${style.key}\n` +
        `Type: ${style.type}\n` +
        `Category: ${style.category}\n` +
        `Title: ${style.title}\n` +
        `Selectors: ${style.selectors.length}\n` +
        `Preview: ${style.previewPhoto ? "yes" : "no"}\n` +
        `Examples: ${style.examplePhotos.length}/${MAX_PROMPT_EXAMPLE_PHOTOS}`;
      return ctx.reply(summary, Markup.inlineKeyboard([
        [Markup.button.callback("Р—Р±РµСЂРµРіС‚Рё СЃС‚РёР»СЊ", "stylewizard_save")],
        [Markup.button.callback("РЎРєР°СЃСѓРІР°С‚Рё", "stylewizard_cancel")],
      ]));
    }
    default:
      return ctx.reply("вќЊ РќРµРІС–РґРѕРјРёР№ РєСЂРѕРє wizard.", adminMenu());
  }
}

function appendWizardSelectorOption(ctx, optionPayload) {
  const wizard = getStyleWizardDraft(ctx);
  if (!wizard || !wizard.currentSelector) return false;
  const selector = wizard.style.selectors[wizard.style.selectors.length - 1];
  if (!selector) return false;
  selector.options[optionPayload.key] = normalizeSelectorOption(optionPayload, optionPayload.key);
  wizard.currentOption = null;
  return true;
}

function saveWizardStyle(ctx) {
  const wizard = getStyleWizardDraft(ctx);
  if (!wizard) return null;
  const style = setStyle(wizard.style);
  ctx.session.styleWizard = null;
  return style;
}

const importedDynamicStylesOnBoot = importDynamicPromptTemplates();
if (importedDynamicStylesOnBoot > 0) {
  console.log(`Imported dynamic styles: ${importedDynamicStylesOnBoot}`);
}

async function replyLongText(ctx, text, extra = undefined) {
  const limit = 3800;
  if (!text || text.length <= limit) return ctx.reply(text, extra);
  for (let i = 0; i < text.length; i += limit) {
    const chunk = text.slice(i, i + limit);
    await ctx.reply(chunk, i === 0 ? extra : undefined);
  }
}

const TELEGRAM_CAPTION_LIMIT = 1024;

async function sendPhotoWithSafeCaption({
  photo,
  text = "",
  sendPhoto,
  sendText,
  photoOptions = {},
  textOptions = undefined,
  logLabel = "sendPhotoWithSafeCaption",
}) {
  const hasText = typeof text === "string" && text.length > 0;

  try {
    if (!photo) {
      if (hasText) return await sendText(text, textOptions);
      return null;
    }

    if (!hasText) {
      return await sendPhoto(photo, photoOptions);
    }

    if (text.length <= TELEGRAM_CAPTION_LIMIT) {
      return await sendPhoto(photo, { ...photoOptions, caption: text });
    }

    await sendPhoto(photo, photoOptions);
    return await sendText(text, textOptions);
  } catch (e) {
    console.error(`${logLabel} ERROR:`, e.message);
    if (hasText) {
      try { return await sendText(text, textOptions); } catch {}
    }
    throw e;
  }
}

// в”Ђв”Ђв”Ђ Р Р•Р¤Р•Р РђР›Р¬РќРђ РЎРРЎРўР•РњРђ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
  try { await bot.telegram.sendMessage(referrerId, `рџ‘‹ РќРѕРІРёР№ РґСЂСѓРі Р·Р°СЂРµС”СЃС‚СЂСѓРІР°РІСЃСЏ РїРѕ С‚РІРѕС”РјСѓ Р»С–РЅРєСѓ!\nрџЋЃ Р‘РѕРЅСѓСЃ +${REFERRAL_PROMTI_BONUS} Promti вњЁ РѕС‚СЂРёРјР°С”С€ РєРѕР»Рё РІС–РЅ Р·СЂРѕР±РёС‚СЊ РїРµСЂС€Сѓ РѕРїР»Р°С‚Сѓ.`); }
  catch (e) { console.error("REFERRAL NOTIFY:", e.message); }
}

// в”Ђв”Ђв”Ђ Р’РђР›Р†Р”РђР¦Р†РЇ Р¤РћРўРћ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function validatePhoto(photo) {
  const size = photo.file_size || 0;
  if (size > 0 && size < 50 * 1024) return `вќЊ Р¤РѕС‚Рѕ Р·Р°РЅР°РґС‚Рѕ РјР°Р»РµРЅСЊРєРµ (${Math.round(size/1024)}KB). РњС–РЅС–РјСѓРј 50KB.`;
  if (size > 20 * 1024 * 1024)      return `вќЊ Р¤РѕС‚Рѕ Р·Р°РЅР°РґС‚Рѕ РІРµР»РёРєРµ. РњР°РєСЃРёРјСѓРј 20MB.`;
  return null;
}

// в”Ђв”Ђв”Ђ РћРўР РРњРђРќРќРЇ Р—РћР‘Р РђР–Р•РќРќРЇ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// в”Ђв”Ђв”Ђ РҐР•Р›РџР•Р : РЅР°РґС–СЃР»Р°С‚Рё С‚РµРєСЃС‚ Р· РѕРїС†С–РѕРЅР°Р»СЊРЅРёРј С„РѕС‚Рѕ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// РЇРєС‰Рѕ С„РѕС‚Рѕ С” С– С‚РµРєСЃС‚ в‰¤1024 СЃРёРјРІРѕР»С–РІ в†’ С„РѕС‚Рѕ Р· caption
// РЇРєС‰Рѕ С„РѕС‚Рѕ С” С– С‚РµРєСЃС‚ РґРѕРІС€РёР№ в†’ С„РѕС‚Рѕ Р±РµР· caption + С‚РµРєСЃС‚ РѕРєСЂРµРјРёРј РїРѕРІС–РґРѕРјР»РµРЅРЅСЏРј
// РЇРєС‰Рѕ С„РѕС‚Рѕ РЅРµРјР°С” в†’ Р·РІРёС‡Р°Р№РЅРёР№ С‚РµРєСЃС‚
async function sendWithOptionalPhoto(ctx, text, photoFileId, menu) {
  try {
    return await sendPhotoWithSafeCaption({
      photo: photoFileId,
      text,
      sendPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
      sendText: (message, options) => ctx.reply(message, options),
      photoOptions: { ...menu },
      textOptions: menu,
      logLabel: "sendWithOptionalPhoto",
    });
  } catch (e) {
    console.error("sendWithOptionalPhoto ERROR:", e.message);
    // Fallback РЅР° Р·РІРёС‡Р°Р№РЅРёР№ С‚РµРєСЃС‚ СЏРєС‰Рѕ С„РѕС‚Рѕ РЅРµ РІРґР°Р»РѕСЃСЊ РЅР°РґС–СЃР»Р°С‚Рё
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

// в”Ђв”Ђв”Ђ FAL UPLOAD IMAGE в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

// в”Ђв”Ђв”Ђ FAL RETRY в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

// в”Ђв”Ђв”Ђ РџР РћР“Р Р•РЎ Р’Р†Р”Р•Рћ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function startVideoProgress(ctx) {
  const iv = setInterval(() => ctx.telegram.sendChatAction(ctx.chat.id, "upload_video").catch(() => {}), 5000);
  return () => clearInterval(iv);
}

// в”Ђв”Ђв”Ђ AI РџР РћРњРў в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function generateAiPrompt(imageBase64, mode) {
  const cfg = loadSettings();
  if (!cfg.aiPromptEnabled) return null;
  if (!process.env.ANTHROPIC_API_KEY) {
    notifyAdminsError("ANTHROPIC_API_KEY РІС–РґСЃСѓС‚РЅС–Р№ вЂ” AI-РїСЂРѕРјС‚ РЅРµ РїСЂР°С†СЋС”!").catch(() => {});
    return null;
  }
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const anthropic = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = mode === "video"
      ? `You are an expert at writing image-to-video animation prompts for Seedance and Kling AI models.
Write ONE ultra-short English prompt вЂ” MAXIMUM 10 words (в‰€5 seconds to read aloud).
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

// в”Ђв”Ђв”Ђ WAYFORPAY в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function buildOrderReference(userId, packKey) {
  return `tg_${userId}_${packKey}_${Date.now()}`;
}

function parseOrderReference(ref) {
  // вњ… Р¤РѕСЂРјР°С‚: tg_{userId}_{packKey}_{timestamp}
  // packKey РјРѕР¶Рµ Р±СѓС‚Рё: promti_pack10, custom_1776681162229, photo_pack20 С– С‚.Рґ.
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

// в”Ђв”Ђв”Ђ РЎР•Р“РњР•РќРўРђР¦Р†РЇ Р®Р—Р•Р Р†Р’ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function getUserSegment(u) {
  if ((u.totalSpent || 0) >= 500)                            return "рџђі Whale";
  if ((u.totalSpent || 0) > 0)                               return "рџ’і Paying";
  if ((u.generations || 0) > 0 || getUserVideoTotal(u) > 0) return "рџ”Ґ Active";
  return "рџ†• New";
}

// в”Ђв”Ђв”Ђ РЎРўРђРўРРЎРўРРљРђ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
      new:    all.filter(u => getUserSegment(u) === "рџ†• New").length,
      active: all.filter(u => getUserSegment(u) === "рџ”Ґ Active").length,
      paying: all.filter(u => getUserSegment(u) === "рџ’і Paying").length,
      whales: all.filter(u => getUserSegment(u) === "рџђі Whale").length,
    },
    aiPromptEnabled: cfg.aiPromptEnabled,
    videoEnabled:    cfg.videoEnabled,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasFalKey:       !!process.env.FAL_KEY,
    hasWfp:          !!WAYFORPAY.merchantAccount,
  };
}

// в”Ђв”Ђв”Ђ РњР•РќР® в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const mainMenu  = () => Markup.keyboard([
  ["рџ–ј Р¤РѕС‚Рѕ", "рџЋ¬ Р’С–РґРµРѕ"],
  ["рџЋЁ РўСЂРµРЅРґРѕРІС– СЃС‚РёР»С–"],
  ["вњЁ РљСѓРїРёС‚Рё Promti вњЁ"],
  ["рџ“Љ Р‘Р°Р»Р°РЅСЃ", "рџ’° Р¦С–РЅРё"],
  ["рџ’Ў Р†РґРµСЏ РґР»СЏ РїСЂРѕРјС‚С–РІ", "рџ‘« Р—Р°РїСЂРѕСЃРёС‚Рё РґСЂСѓРіР°"],
  ["в„№пёЏ Р†РЅС„РѕСЂРјР°С†С–СЏ", "вќ“ Р”РѕРїРѕРјРѕРіР°"],
  ["рџ† РџС–РґС‚СЂРёРјРєР°"]
]).resize();
const photoMenu = () => Markup.keyboard([
  ["рџ–ј Р РµРґР°РіСѓРІР°С‚Рё С„РѕС‚Рѕ", "вњЁ РЎС‚РІРѕСЂРёС‚Рё С„РѕС‚Рѕ"],
  ["рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ С„РѕС‚Рѕ"],
  ["рџ“Љ Р‘Р°Р»Р°РЅСЃ"],
  ["в†©пёЏ РќР°Р·Р°Рґ"]
]).resize();
const videoMenu     = () => Markup.keyboard([
  ["рџЋ¬ Seedance", "рџЋҐ Kling"],
  ["рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ РІС–РґРµРѕ"],
  ["рџ“Љ Р‘Р°Р»Р°РЅСЃ"],
  ["в†©пёЏ РќР°Р·Р°Рґ"]
]).resize();
const seedanceMenu  = () => Markup.keyboard([
  ["вљЎ РђРІС‚Рѕ Р°РЅС–РјР°С†С–СЏ", "рџЋ¬ РђРЅС–РјР°С†С–СЏ + РїСЂРѕРјС‚"],
  ["рџЋҐ Р’С–РґРµРѕ Р· С‚РµРєСЃС‚Сѓ"],
  ["в†©пёЏ РќР°Р·Р°Рґ РґРѕ РІС–РґРµРѕ"]
]).resize();
const klingMenu     = () => Markup.keyboard([
  ["вљЎ РђРІС‚Рѕ Р°РЅС–РјР°С†С–СЏ", "рџЋ¬ РђРЅС–РјР°С†С–СЏ + РїСЂРѕРјС‚"],
  ["рџЋҐ Р’С–РґРµРѕ Р· С‚РµРєСЃС‚Сѓ"],
  ["в†©пёЏ РќР°Р·Р°Рґ РґРѕ РІС–РґРµРѕ"]
]).resize();
const adminMenu       = () => Markup.keyboard([
  ["рџ“Љ РЎС‚Р°С‚СѓСЃ Р±РѕС‚Р°", "рџ‘¤ РњС–Р№ ID"],
  ["рџ‘Ґ РљРѕСЂРёСЃС‚СѓРІР°С‡С–", "рџ’і РћСЃС‚Р°РЅРЅС– РѕРїР»Р°С‚Рё"],
  ["рџЋЁ Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ", "рџ“€ РђРЅР°Р»С–С‚РёРєР°"],
  ["рџ“¦ РџР°РєРµС‚Рё", "вљ™пёЏ РќР°Р»Р°С€С‚СѓРІР°РЅРЅСЏ"],
  ["вњЏпёЏ Р—РјС–РЅРёС‚Рё С‚РµРєСЃС‚", "рџ“ќ РџРѕС‚РѕС‡РЅС– С‚РµРєСЃС‚Рё"],
  ["рџ–ј РџСЂРёРєСЂС–РїРёС‚Рё С„РѕС‚Рѕ"],
  ["в†©пёЏ РќР°Р·Р°Рґ"],
]).resize();
const adminPromptsMenu = () => Markup.keyboard([["portrait", "beauty"], ["fashion", "art"], ["trend", "seedance"], ["kling"], ["в†©пёЏ РќР°Р·Р°Рґ"]]).resize();
const adminTextsMenu   = () => Markup.keyboard([["welcomeText", "infoText"], ["helpText", "supportText"], ["ideaText", "pricesText"], ["в†©пёЏ РќР°Р·Р°Рґ"]]).resize();
const adminPhotosMenu  = () => Markup.keyboard([
  ["рџ“· welcomePhoto", "рџ“· infoPhoto"],
  ["рџ“· helpPhoto", "рџ“· pricesPhoto"],
  ["рџ“· ideaPhoto", "рџ“· broadcastPhoto"],
  ["в†©пёЏ РќР°Р·Р°Рґ"]
]).resize();

const paymentInlineKeyboard = (payUrl, pack) => Markup.inlineKeyboard([
  [Markup.button.url(`рџ’і РћРїР»Р°С‚РёС‚Рё ${pack.title} вЂ” ${pack.priceText}`, payUrl)],
  [Markup.button.callback("рџ”„ РџРµСЂРµРІС–СЂРёС‚Рё РѕРїР»Р°С‚Сѓ", `checkpay_${pack.key}`)],
]);

// в”Ђв”Ђв”Ђ START в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
  const stylePayload = parseStyleStartPayload(payload);
  if (stylePayload) {
    const style = getStyle(stylePayload.key);
    if (style) {
      incrementStyleMetric(style.key, "clicks");
      if (style.type === "dynamic") {
        const complete = style.selectors.every(selector => stylePayload.selections?.[selector.key] && selector.options?.[stylePayload.selections[selector.key]]);
        if (complete) {
          for (const [selectorKey, optionKey] of Object.entries(stylePayload.selections)) {
            incrementDynamicOptionMetric(style.key, selectorKey, optionKey, "clicks");
          }
          ctx.session.pendingDynamicStyle = {
            styleKey: style.key,
            selections: { ...stylePayload.selections },
          };
          return finalizeDynamicStylePrompt(ctx, style.key);
        }
        return startDynamicStyleFlow(ctx, style, stylePayload.selections);
      }
      applyStaticStyleToSession(ctx, style);
      user.sourcePromptKey = style.key;
      user.sourceStyleKey = style.key;
      saveUsers();
      return sendPromptReadyMessage(ctx, style, { withPreview: true });
    }
  }
  return sendWithOptionalPhoto(ctx, content.welcomeText, content.welcomePhoto, mainMenu());
});

// в”Ђв”Ђв”Ђ РљРћРњРђРќР”Р в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.command("help",  (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.helpText, content.helpPhoto, mainMenu()); });
bot.command("info",  (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.infoText, content.infoPhoto, mainMenu()); });
bot.command("myid",  (ctx) => { touchUser(ctx); return ctx.reply(`РўРІС–Р№ ID: ${ctx.from.id}`); });
bot.command("admin", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌");
  resetState(ctx);
  return ctx.reply(
    [
      "🔧 Адмін панель",
      "",
      "Швидкі дії:",
      "📊 Статус бота — перевірка ключів, черги, API, воркерів, помилок",
      "👤 Мій ID — дізнатись свій Telegram ID",
      "👥 Користувачі — останні 15 юзерів",
      "💳 Останні оплати — останні платежі",
      "🎨 Бібліотека стилів — усі static і dynamic стилі",
      "📈 Аналітика — конверсії та виручка",
      "📦 Пакети — усі тарифні пакети",
      "⚙️ Налаштування — переглянути поточні ліміти",
      "✏️ Змінити текст — редагувати тексти бота",
      "📝 Поточні тексти — побачити поточні тексти",
      "🖼 Прикріпити фото — фото до welcome/info/help/prices/idea/broadcast",
      "",
      "Команди стилів:",
      "/stylewizard — покроковий майстер нового стилю",
      "/importdynamic — імпорт dynamic стилів з dynamic-prompts.json",
      "/addprompt KEY | CATEGORY | TITLE | PROMPT — швидко додати static стиль",
      "/prompts — список усіх стилів з deep-link",
      "/delprompt KEY — видалити стиль",
      "/trendprompt KEY on|off — позначити або зняти тренд",
      "/setpromptpreview KEY — задати preview photo стилю",
      "/setpromptexamples KEY — задати example photos стилю (до 10)",
      "/topprompts clicks|generations|purchases — топ стилів за метрикою",
      "",
      "Команди пакетів і цін:",
      "/packages — переглянути всі пакети",
      "/setprice KEY PRICE — змінити ціну пакету",
      "/addpackage KEY promti COUNT PRICE TITLE — додати пакет",
      "/setlink support_link URL — змінити посилання",
      "",
      "Команди юзерів:",
      "/userinfo ID — повна інформація про юзера",
      "/addpromti ID AMOUNT — нарахувати Promti юзеру",
      "/ban ID — заблокувати юзера",
      "/unban ID — розблокувати юзера",
      "/delete_user ID — видалити обліковий запис",
      "",
      "Команди контенту:",
      "/broadcast TEXT — розіслати всім користувачам",
      "/analytics — детальна аналітика",
      "",
      "Підказки:",
      "Для dynamic стилю: оновлюєш шаблони dynamic-prompts.json, потім /importdynamic, далі задаєш preview та examples через бот."
    ].join("\n"),
    adminMenu()
  );
});
bot.command("ref", (ctx) => {
  touchUser(ctx);
  const botUsername = ctx.botInfo?.username || "Promtiai_bot";
  const link = `https://t.me/${botUsername}?start=ref_${ctx.from.id}`;
  return ctx.reply(`рџ”— Р РµС„РµСЂР°Р»СЊРЅРµ РїРѕСЃРёР»Р°РЅРЅСЏ:\n${link}\n\nрџЋЃ Р—Р° РєРѕР¶РЅРѕРіРѕ РґСЂСѓРіР° СЏРєРёР№ РѕРїР»Р°С‚РёС‚СЊ: +${REFERRAL_PROMTI_BONUS} Promti вњЁ\nР—Р°РїСЂРѕС€РµРЅРѕ: ${users[ctx.from.id]?.referralCount || 0}`);
});

bot.command("stylewizard", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  startStyleWizard(ctx);
  return promptStyleWizardStep(ctx);
});

bot.command("importdynamic", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const imported = importDynamicPromptTemplates();
  return ctx.reply(`вњ… Р†РјРїРѕСЂС‚РѕРІР°РЅРѕ dynamic styles: ${imported}`, adminMenu());
});

bot.command("addprompt", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const raw = ctx.message.text.replace(/^\/addprompt(@\w+)?\s*/i, "");
  const parts = raw.split("|").map(part => part.trim());
  if (parts.length < 4) return ctx.reply("Р¤РѕСЂРјР°С‚: /addprompt KEY | CATEGORY | TITLE | PROMPT");

  const [rawKey, category, title, ...promptParts] = parts;
  const key = normalizePromptKey(rawKey);
  const prompt = promptParts.join(" | ").trim();

  if (!key) return ctx.reply("вќЊ РќРµРєРѕСЂРµРєС‚РЅРёР№ KEY. Р”РѕР·РІРѕР»РµРЅС– СЃРёРјРІРѕР»Рё: a-z, 0-9, _ С‚Р° -");
  if (!category || !title || !prompt) return ctx.reply("вќЊ РЈСЃС– РїРѕР»СЏ РѕР±РѕРІ'СЏР·РєРѕРІС–.");
  if (getPromptStyle(key)) return ctx.reply(`вќЊ РЎС‚РёР»СЊ Р· key "${key}" РІР¶Рµ С–СЃРЅСѓС”.`);

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

  return ctx.reply(
    `вњ… РЎС‚РёР»СЊ СЃС‚РІРѕСЂРµРЅРѕ\n\n` +
    `KEY: ${key}\n` +
    `РљР°С‚РµРіРѕСЂС–СЏ: ${category}\n` +
    `РќР°Р·РІР°: ${title}\n\n` +
    `Deep-link:\n${deepLink}\n\n` +
    `РњРѕР¶РµС€ РѕРґСЂР°Р·Сѓ РЅР°РґС–СЃР»Р°С‚Рё preview-С„РѕС‚Рѕ РґР»СЏ С†СЊРѕРіРѕ СЃС‚РёР»СЋ Р°Р±Рѕ Р·СЂРѕР±РёС‚Рё С†Рµ РїС–Р·РЅС–С€Рµ С‡РµСЂРµР· /setpromptpreview ${key}`
  );
});

bot.command("prompts", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const items = getSortedPromptStyles();
  if (!items.length) return ctx.reply("Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ РїРѕСЂРѕР¶РЅСЏ.");

  const botUsername = await resolveBotUsername(ctx);
  const text = items.map(style =>
    `${style.isTrending ? "рџ”Ґ " : ""}${style.title}\n` +
    `key: ${style.key}\n` +
    `category: ${style.category}\n` +
    `deep-link: ${getPromptDeepLink(botUsername, style.key)}`
  ).join("\n\n");

  return replyLongText(ctx, text);
});

bot.command("delprompt", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const key = normalizePromptKey(ctx.message.text.replace(/^\/delprompt(@\w+)?\s*/i, ""));
  if (!key) return ctx.reply("Р¤РѕСЂРјР°С‚: /delprompt KEY");
  if (!getPromptStyle(key)) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`);

  delete content.promptLibrary[key];
  saveContent();
  return ctx.reply(`вњ… РЎС‚РёР»СЊ "${key}" РІРёРґР°Р»РµРЅРѕ.`);
});

bot.command("topprompts", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const sortBy = (ctx.message.text.split(/\s+/)[1] || "purchases").toLowerCase();
  const metric = ["clicks", "generations", "purchases"].includes(sortBy) ? sortBy : "purchases";
  const items = getSortedPromptStyles()
    .sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0))
    .slice(0, 10);

  if (!items.length) return ctx.reply("Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ РїРѕСЂРѕР¶РЅСЏ.");

  const text = items.map((style, index) =>
    `${index + 1}. ${style.title} (${style.key})\n` +
    `Clicks: ${style.clicks} | Generations: ${style.generations} | Purchases: ${style.purchases}\n` +
    `Gen conversion: ${formatConversion(style.generations, style.clicks)}\n` +
    `Purchase conversion: ${formatConversion(style.purchases, style.clicks)}`
  ).join("\n\n");

  return replyLongText(ctx, `рџЏ† РўРѕРї СЃС‚РёР»С–РІ Р·Р° ${metric}\n\n${text}`);
});

bot.command("trendprompt", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const [, rawKey, rawValue] = ctx.message.text.split(/\s+/);
  const key = normalizePromptKey(rawKey);
  const style = getPromptStyle(key);
  if (!style) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`);
  if (!["on", "off"].includes((rawValue || "").toLowerCase())) {
    return ctx.reply("Р¤РѕСЂРјР°С‚: /trendprompt KEY on|off");
  }

  style.isTrending = rawValue.toLowerCase() === "on";
  content.promptLibrary[key] = style;
  saveContent();
  return ctx.reply(`вњ… Р”Р»СЏ СЃС‚РёР»СЋ "${key}" С‚СЂРµРЅРґ-СЃС‚Р°С‚СѓСЃ: ${style.isTrending ? "ON" : "OFF"}`);
});

bot.command("setpromptpreview", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const key = normalizePromptKey(ctx.message.text.replace(/^\/setpromptpreview(@\w+)?\s*/i, ""));
  const style = getPromptStyle(key);
  if (!style) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`);

  ctx.session.awaitingPromptPreviewKey = key;
  return ctx.reply(
    `рџ–ј РќР°РґС–С€Р»Рё preview-С„РѕС‚Рѕ РґР»СЏ СЃС‚РёР»СЋ "${key}".\n` +
    `РђР±Рѕ РЅР°РїРёС€Рё "РІРёРґР°Р»РёС‚Рё", С‰РѕР± РїСЂРёР±СЂР°С‚Рё РїРѕС‚РѕС‡РЅРµ preview.`
  );
});

bot.command("setpromptexamples", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const key = normalizePromptKey(ctx.message.text.replace(/^\/setpromptexamples(@\w+)?\s*/i, ""));
  const style = getPromptStyle(key);
  if (!style) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`);

  ctx.session.awaitingPromptExamplesKey = key;
  return ctx.reply(
    `РќР°РґС–С€Р»Рё РґРѕ ${MAX_PROMPT_EXAMPLE_PHOTOS} С„РѕС‚Рѕ РґР»СЏ СЃС‚РёР»СЋ "${key}".\n` +
    `РќР°РїРёС€Рё "РіРѕС‚РѕРІРѕ" С‰РѕР± Р·Р°РІРµСЂС€РёС‚Рё Р°Р±Рѕ "РІРёРґР°Р»РёС‚Рё" С‰РѕР± РѕС‡РёСЃС‚РёС‚Рё РІСЃС– РїСЂРёРєР»Р°РґРё.`
  );
});

bot.command("addpromti", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const [, id, amt] = ctx.message.text.split(/\s+/);
  if (!id || !amt) return ctx.reply("Р¤РѕСЂРјР°С‚: /addpromti ID РљР†Р›Р¬РљР†РЎРўР¬");
  const user = getUser(Number(id));
  user.promti = (user.promti || 0) + Number(amt);
  saveUsersSync();
  await ctx.reply(`вњ… +${amt} Promti вњЁ в†’ user ${id}. Р‘Р°Р»Р°РЅСЃ: ${user.promti} Promti вњЁ`);
  bot.telegram.sendMessage(Number(id), `рџЋ‰ +${amt} Promti вњЁ РЅР° Р±Р°Р»Р°РЅСЃ!\nР‘Р°Р»Р°РЅСЃ: ${user.promti} Promti вњЁ`, mainMenu()).catch(() => {});
});

bot.command("reset_packages", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  dynamicPackages = JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
  saveDynamicPackages();
  const list = Object.keys(dynamicPackages).join("\n");
  return ctx.reply(`вњ… РџР°РєРµС‚Рё СЃРєРёРЅСѓС‚Рѕ РґРѕ РґРµС„РѕР»С‚РЅРёС…:\n\n${list}`);
});

bot.command("delete_user", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Р¤РѕСЂРјР°С‚: /delete_user ID");
  if (!users[id]) return ctx.reply("РќРµ Р·РЅР°Р№РґРµРЅРѕ");

  const u = users[id];
  delete users[id];

  const before = payments.length;
  payments = payments.filter(p => p.userId !== id);

  saveUsersSync();
  savePayments();

  return ctx.reply(
    `вњ… Р’РёРґР°Р»РµРЅРѕ:\nUser ${id} (@${u.username || "-"})\nРџР»Р°С‚РµР¶С–РІ: ${before - payments.length}\nР’РёС‚СЂР°С‡РµРЅРѕ Р±СѓР»Рѕ: ${u.totalSpent || 0} РіСЂРЅ`
  );
});

bot.command("userinfo", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Р¤РѕСЂРјР°С‚: /userinfo ID");
  const u = users[id];
  if (!u) return ctx.reply("РљРѕСЂРёСЃС‚СѓРІР°С‡Р° РЅРµ Р·РЅР°Р№РґРµРЅРѕ");
  const cfg = loadSettings();
  return ctx.reply(
    `рџ‘¤ ID: ${u.id} ${getUserSegment(u)}\n@${u.username || "-"} | ${u.firstName || "-"}\n\n` +
    `рџ’Ћ Р‘Р°Р»Р°РЅСЃ Promti вњЁ: ${u.promti || 0}\n\n` +
    `вљЎ Р¤РѕС‚Рѕ: ${u.generations || 0}\nрџЋ¬ Seedance: ${u.seedanceGenerations || 0}\nрџЋҐ Kling: ${u.klingGenerations || 0}\n\n` +
    `рџ’° Р’РёС‚СЂР°С‡РµРЅРѕ: ${u.totalSpent || 0} РіСЂРЅ\nрџ‘« Р РµС„РµСЂР°Р»С–РІ: ${u.referralCount || 0}\n` +
    `рџљ« Р‘Р°РЅ: ${u.banned ? "С‚Р°Рє" : "РЅС–"}\nрџ“… Р—: ${(u.createdAt || "").slice(0, 10)}\n\n` +
    `рџ“Љ РЎСЊРѕРіРѕРґРЅС– Seedance: ${u.dailySeedanceCount || 0}/${cfg.dailySeedanceLimit}\n` +
    `рџ“Љ РЎСЊРѕРіРѕРґРЅС– Kling: ${u.dailyKlingCount || 0}/${cfg.dailyKlingLimit}`
  );
});

bot.command("ban", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Р¤РѕСЂРјР°С‚: /ban ID");
  const user = getUser(id); user.banned = true; saveUsersSync();
  await ctx.reply(`рџљ« User ${id} Р·Р°Р±Р»РѕРєРѕРІР°РЅРёР№`);
  bot.telegram.sendMessage(id, "рџљ« Р’Р°С€ Р°РєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРѕРІР°РЅРёР№. РќР°РїРёС€С–С‚СЊ РІ РїС–РґС‚СЂРёРјРєСѓ.").catch(() => {});
});

bot.command("unban", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const id = Number(ctx.message.text.split(/\s+/)[1]);
  if (!id) return ctx.reply("Р¤РѕСЂРјР°С‚: /unban ID");
  const user = getUser(id); user.banned = false; saveUsersSync();
  await ctx.reply(`вњ… User ${id} СЂРѕР·Р±Р»РѕРєРѕРІР°РЅРёР№`);
  bot.telegram.sendMessage(id, "вњ… Р’Р°С€ Р°РєР°СѓРЅС‚ СЂРѕР·Р±Р»РѕРєРѕРІР°РЅРѕ. РњРѕР¶РµС‚Рµ РїСЂРѕРґРѕРІР¶СѓРІР°С‚Рё.", mainMenu()).catch(() => {});
});

bot.command("broadcast", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const text = ctx.message.text.replace("/broadcast", "").trim();
  if (!text) return ctx.reply("Р¤РѕСЂРјР°С‚: /broadcast РўРµРєСЃС‚\n\nРЇРєС‰Рѕ РїСЂРёРєСЂС–РїР»РµРЅРѕ рџ“· broadcastPhoto вЂ” РЅР°РґС–С€Р»РµС‚СЊСЃСЏ Р· С„РѕС‚Рѕ.");

  const all = Object.values(users).filter(u => !u.banned);
  let sent = 0, failed = 0;
  const photoId = content.broadcastPhoto || null;
  await ctx.reply(`вЏі РќР°РґСЃРёР»Р°СЋ ${all.length} РєРѕСЂРёСЃС‚СѓРІР°С‡Р°Рј${photoId ? " (Р· С„РѕС‚Рѕ)" : ""}...`);

  const BATCH_SIZE  = 25;
  const BATCH_DELAY = 1500;
  const MSG_DELAY   = 50;

  for (let i = 0; i < all.length; i++) {
    const u = all[i];
    try {
      if (photoId) {
        await sendPhotoWithSafeCaption({
          photo: photoId,
          text,
          sendPhoto: (photo, options) => bot.telegram.sendPhoto(u.id, photo, options),
          sendText: (message, options) => bot.telegram.sendMessage(u.id, message, options),
          photoOptions: { ...mainMenu() },
          textOptions: mainMenu(),
          logLabel: "broadcast.sendPhoto",
        });
      } else {
        await bot.telegram.sendMessage(u.id, text, mainMenu());
      }
      sent++;
    } catch { failed++; }

    await new Promise(r => setTimeout(r, MSG_DELAY));

    if ((i + 1) % BATCH_SIZE === 0) {
      await ctx.reply(`вЏі РќР°РґС–СЃР»Р°РЅРѕ ${sent}/${all.length}...`);
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  return ctx.reply(`вњ… Broadcast Р·Р°РІРµСЂС€РµРЅРѕ!\nРќР°РґС–СЃР»Р°РЅРѕ: ${sent}\nРџРѕРјРёР»РѕРє: ${failed}`);
});

// в”Ђв”Ђв”Ђ РђР”РњР†Рќ: РљР•Р РЈР’РђРќРќРЇ РџРђРљР•РўРђРњР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

bot.command("analytics", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");

  const all = Object.values(users);
  const paid = payments.filter(p => p.status === "credited");

  const packCount = {};
  paid.forEach(p => {
    packCount[p.packKey] = (packCount[p.packKey] || 0) + 1;
  });
  const topPacks = Object.entries(packCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, cnt]) => `  ${key}: ${cnt} СЂР°Р·С–РІ`)
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
    .map(([d, amt]) => `  ${d.slice(5)}: ${amt} РіСЂРЅ`)
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
    `рџ“Љ РђРЅР°Р»С–С‚РёРєР°\n\n` +
    `рџ‘Ґ Р®Р·РµСЂРё: ${totalUsers} РІСЃСЊРѕРіРѕ\n` +
    `  рџ”Ґ РђРєС‚РёРІРЅРёС…: ${activeUsers}\n` +
    `  рџ’і РџР»Р°С‚РЅРёС…: ${payingUsers}\n` +
    `  рџ¶ РЎРїСЂРѕР±СѓРІР°Р»Рё С– РїС–С€Р»Рё: ${triedNoPayment}\n\n` +
    `рџ’° РљРѕРЅРІРµСЂСЃС–СЏ:\n` +
    `  Р’СЃС–в†’РїР»Р°С‚РЅС–: ${conversion}%\n` +
    `  РђРєС‚РёРІРЅС–в†’РїР»Р°С‚РЅС–: ${actConversion}%\n\n` +
    `рџ’µ Р¤С–РЅР°РЅСЃРё:\n` +
    `  Р’СЃСЊРѕРіРѕ: ${totalRevenue} РіСЂРЅ\n` +
    `  РЎРµСЂРµРґРЅС–Р№ С‡РµРє: ${avgCheck} РіСЂРЅ\n` +
    `  РџРѕРІС‚РѕСЂРЅС– РїРѕРєСѓРїРєРё: ${repeatBuyers} СЋР·РµСЂС–РІ\n\n` +
    `рџ“¦ РўРѕРї РїР°РєРµС‚Рё:\n${topPacks || "  РЅРµРјР°С” РґР°РЅРёС…"}\n\n` +
    `рџ“… Р’РёСЂСѓС‡РєР° (7 РґРЅС–РІ):\n${revenueChart}`
  );
});

bot.command("packages", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const pkgs = getPackages();
  const text = Object.values(pkgs).map(p =>
    `${p.key}\n  рџ’° ${p.amount} РіСЂРЅ | ${p.promti || p.count || 0} вњЁ | ${p.type}${p.model ? " / " + p.model : ""}`
  ).join("\n\n");
  return ctx.reply(
    `рџ“¦ Р’СЃС– РїР°РєРµС‚Рё:\n\n${text}\n\n` +
    `Р—РјС–РЅРёС‚Рё С†С–РЅСѓ:\n/setprice promti_pack10 120\n\n` +
    `Р”РѕРґР°С‚Рё РїР°РєРµС‚:\n/addpackage KEY promti 15 1199 15 Promti\n\n` +
    `РџРѕСЃРёР»Р°РЅРЅСЏ:\n/setlink support_link https://t.me/support`
  );
});

bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 3) return ctx.reply("Р¤РѕСЂРјР°С‚: /setprice РљР›Р®Р§_РџРђРљР•РўРЈ Р¦Р†РќРђ\n\nРџСЂРёРєР»Р°Рґ: /setprice promti_pack10 120");
  const packKey = parts[1];
  const amount  = Number(parts[2]);
  if (!getPackages()[packKey]) return ctx.reply(`вќЊ РџР°РєРµС‚ "${packKey}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.\n\nР”РѕСЃС‚СѓРїРЅС– РєР»СЋС‡С–:\n${Object.keys(getPackages()).join("\n")}`);
  if (isNaN(amount) || amount <= 0) return ctx.reply("вќЊ Р¦С–РЅР° РјР°С” Р±СѓС‚Рё С‡РёСЃР»РѕРј Р±С–Р»СЊС€Рµ 0");
  dynamicPackages[packKey].amount    = amount;
  dynamicPackages[packKey].priceText = `${amount} РіСЂРЅ`;
  saveDynamicPackages();
  return ctx.reply(`вњ… Р¦С–РЅР° "${packKey}" РѕРЅРѕРІР»РµРЅР°: ${amount} РіСЂРЅ`);
});

bot.command("addpackage", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const text  = ctx.message.text.replace("/addpackage", "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 5) {
    return ctx.reply(
      "Р¤РѕСЂРјР°С‚: /addpackage РљР›Р®Р§ РўРРџ РљР†Р›Р¬РљР†РЎРўР¬ Р¦Р†РќРђ РќРђР—Р’Рђ\n\n" +
      "РџСЂРёРєР»Р°Рґ: /addpackage promti_pack200 promti 200 1299 200 Promti"
    );
  }
  const [key, type, countStr, amountStr, ...titleParts] = parts;
  const count  = Number(countStr);
  const amount = Number(amountStr);
  const title  = titleParts.join(" ");
  if (isNaN(count)  || count  <= 0) return ctx.reply("вќЊ РљС–Р»СЊРєС–СЃС‚СЊ РјР°С” Р±СѓС‚Рё С‡РёСЃР»РѕРј > 0");
  if (isNaN(amount) || amount <= 0) return ctx.reply("вќЊ Р¦С–РЅР° РјР°С” Р±СѓС‚Рё С‡РёСЃР»РѕРј > 0");
  if (getPackages()[key]) return ctx.reply(`вќЊ РџР°РєРµС‚ "${key}" РІР¶Рµ С–СЃРЅСѓС”. Р”Р»СЏ Р·РјС–РЅРё С†С–РЅРё: /setprice ${key} Р¦Р†РќРђ`);
  dynamicPackages[key] = { key, type, title, promti: count, amount, priceText: `${amount} РіСЂРЅ` };
  saveDynamicPackages();
  return ctx.reply(`вњ… РџР°РєРµС‚ РґРѕРґР°РЅРѕ!\n\nРљР»СЋС‡: ${key}\nРќР°Р·РІР°: ${title}\nРўРёРї: ${type}\nРљС–Р»СЊРєС–СЃС‚СЊ: ${count} вњЁ\nР¦С–РЅР°: ${amount} РіСЂРЅ`);
});

bot.command("setlink", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const text  = ctx.message.text.replace("/setlink", "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2) return ctx.reply("Р¤РѕСЂРјР°С‚: /setlink РљР›Р®Р§ URL\n\nРџСЂРёРєР»Р°Рґ: /setlink support_link https://t.me/support");
  const key = parts[0];
  const url  = parts[1];
  if (!url.startsWith("http")) return ctx.reply("вќЊ URL РјР°С” РїРѕС‡РёРЅР°С‚РёСЃСЊ Р· http:// Р°Р±Рѕ https://");
  content[key] = url;
  saveContent();
  return ctx.reply(`вњ… РџРѕСЃРёР»Р°РЅРЅСЏ "${key}" Р·Р±РµСЂРµР¶РµРЅРѕ:\n${url}`);
});

// в”Ђв”Ђв”Ђ РђР”РњР†Рќ РҐР•РќР”Р›Р•Р Р в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџ“Љ РЎС‚Р°С‚СѓСЃ Р±РѕС‚Р°", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const s = getBotStats();
  return ctx.reply(
    `рџ¤– РЎС‚Р°С‚СѓСЃ Р±РѕС‚Р°\n\n` +
    `${s.hasFalKey       ? "вњ…" : "вќЊ"} FAL_KEY\n` +
    `${s.hasWfp          ? "вњ…" : "вќЊ"} WayForPay\n` +
    `${s.hasAnthropicKey ? "вњ…" : "вќЊ"} Anthropic (AI РїСЂРѕРјС‚)\n` +
    `${s.aiPromptEnabled ? "вњ…" : "вЏё"} AI РїСЂРѕРјС‚: ${s.aiPromptEnabled ? "СѓРІС–РјРєРЅРµРЅРѕ" : "РІРёРјРєРЅРµРЅРѕ"}\n` +
    `${s.videoEnabled    ? "вњ…" : "вЏё"} Р’С–РґРµРѕ: ${s.videoEnabled ? "СѓРІС–РјРєРЅРµРЅРѕ" : "РІРёРјРєРЅРµРЅРѕ"}\n\n` +
    `вљ™пёЏ Р§РµСЂРіР°: ${s.activeWorkers}/${s.maxWorkers} РІРѕСЂРєРµСЂС–РІ | ${s.queueLength} РІ С‡РµСЂР·С–\n\n` +
    `рџ“Љ РЎС‚Р°С‚РёСЃС‚РёРєР°:\n` +
    `рџ‘Ґ РљРѕСЂРёСЃС‚СѓРІР°С‡С–РІ: ${s.totalUsers} (рџљ«${s.bannedUsers} Р·Р°Р±Р°РЅРµРЅРѕ)\n` +
    `рџ†• New: ${s.segments.new} | рџ”Ґ Active: ${s.segments.active} | рџ’і Paying: ${s.segments.paying} | рџђі Whale: ${s.segments.whales}\n` +
    `рџ–ј Р¤РѕС‚Рѕ: ${s.totalPhotoGen}\n` +
    `рџЋ¬ Seedance: ${s.totalSeedanceGen}\n` +
    `рџЋҐ Kling: ${s.totalKlingGen}\n` +
    `рџ‘« Р РµС„РµСЂР°Р»С–РІ: ${s.totalReferrals}\n` +
    `рџ’° Р—Р°СЂРѕР±Р»РµРЅРѕ: ${s.totalRevenue} РіСЂРЅ\n` +
    `рџ§ѕ РћРїР»Р°С‚: ${s.totalPaidOrders}`,
    adminMenu()
  );
});

bot.hears("рџ‘¤ РњС–Р№ ID", (ctx) => { touchUser(ctx); if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ"); return ctx.reply(`РўРІС–Р№ ID: ${ctx.from.id}`, adminMenu()); });

bot.hears("рџ‘Ґ РљРѕСЂРёСЃС‚СѓРІР°С‡С–", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const all = Object.values(users);
  if (!all.length) return ctx.reply("РќРµРјР°С”", adminMenu());
  const text = all.slice(-15).reverse().map(u =>
    `${u.banned ? "рџљ« " : ""}ID: ${u.id} @${u.username || "-"}\n` +
    `вњЁ ${u.promti || 0} Promti вњЁ | рџ’° ${u.totalSpent || 0}РіСЂРЅ\n` +
    `вљЎ ${u.generations || 0}С„ ${u.seedanceGenerations || 0}s ${u.klingGenerations || 0}k | рџ‘« ${u.referralCount || 0}\n` +
    `рџ“… ${(u.createdAt || "").slice(0, 10)}`
  ).join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("рџ’і РћСЃС‚Р°РЅРЅС– РѕРїР»Р°С‚Рё", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  if (!payments.length) return ctx.reply("РћРїР»Р°С‚ РЅРµРјР°С”", adminMenu());
  const text = payments.slice(-15).reverse().map(p =>
    `${p.packKey || "-"} | ${p.userId || "-"}\n${p.amount || "-"} РіСЂРЅ | ${p.status || "-"}\n${(p.updatedAt || p.createdAt || "").slice(0, 16)}`
  ).join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("рџЋЁ Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  return sendPromptLibraryPage(ctx, 0, true);
});

bot.hears("рџ“ќ РџРѕС‚РѕС‡РЅС– РїСЂРѕРјС‚Рё", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  return ctx.reply(Object.entries(prompts).map(([k, v]) => `${k}:\n${v}`).join("\n\n"), adminMenu());
});

bot.hears("вњЏпёЏ Р—РјС–РЅРёС‚Рё РїСЂРѕРјС‚", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  resetState(ctx);
  return ctx.reply("РћР±РµСЂРё:", adminPromptsMenu());
});

bot.hears(["portrait", "beauty", "fashion", "art", "trend", "seedance", "kling"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const valid = ["portrait", "beauty", "fashion", "art", "trend", "seedance", "kling"];
  if (!valid.includes(ctx.message.text)) return;
  ctx.session.awaitingPromptEditKey = ctx.message.text;
  return ctx.reply(`РљР»СЋС‡: ${ctx.message.text}\n\nРџРѕС‚РѕС‡РЅРёР№:\n${prompts[ctx.message.text]}\n\nРќР°РґС–С€Р»Рё РЅРѕРІРёР№.`, adminMenu());
});

bot.hears("рџ“ќ РџРѕС‚РѕС‡РЅС– С‚РµРєСЃС‚Рё", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const SKIP_KEYS = new Set([
    "promptLibrary", "promptCategories", "styleLibrary",
    "welcomePhoto", "infoPhoto", "helpPhoto", "pricesPhoto", "ideaPhoto", "broadcastPhoto"
  ]);
  const textOnlyEntries = Object.entries(content).filter(([k, v]) =>
    !SKIP_KEYS.has(k) && typeof v !== "object"
  );
  return replyLongText(ctx, textOnlyEntries.map(([k, v]) => `${k}:\n${v}`).join("\n\n==\n\n"), adminMenu());
});

bot.hears("вњЏпёЏ Р—РјС–РЅРёС‚Рё С‚РµРєСЃС‚", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  resetState(ctx);
  return ctx.reply("РћР±РµСЂРё:", adminTextsMenu());
});

bot.hears(["welcomeText", "infoText", "helpText", "supportText", "ideaText", "pricesText"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const valid = ["welcomeText", "infoText", "helpText", "supportText", "ideaText", "pricesText"];
  if (!valid.includes(ctx.message.text)) return;
  ctx.session.awaitingTextEditKey = ctx.message.text;
  return ctx.reply(`РљР»СЋС‡: ${ctx.message.text}\n\nРџРѕС‚РѕС‡РЅРёР№:\n${content[ctx.message.text]}\n\nРќР°РґС–С€Р»Рё РЅРѕРІРёР№.`, adminMenu());
});

// в”Ђв”Ђв”Ђ РђР”РњР†Рќ: РЈРџР РђР’Р›Р†РќРќРЇ Р¤РћРўРћ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџ–ј РџСЂРёРєСЂС–РїРёС‚Рё С„РѕС‚Рѕ", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  resetState(ctx);
  const statuses = [
    `welcomePhoto   вЂ” ${content.welcomePhoto ? "вњ…" : "вќЊ"}`,
    `infoPhoto      вЂ” ${content.infoPhoto ? "вњ…" : "вќЊ"}`,
    `helpPhoto      вЂ” ${content.helpPhoto ? "вњ…" : "вќЊ"}`,
    `pricesPhoto    вЂ” ${content.pricesPhoto ? "вњ…" : "вќЊ"}`,
    `ideaPhoto      вЂ” ${content.ideaPhoto ? "вњ…" : "вќЊ"}`,
    `broadcastPhoto вЂ” ${content.broadcastPhoto ? "вњ…" : "вќЊ"}`,
  ].join("\n");
  return ctx.reply(
    `рџ–ј РџСЂРёРєСЂС–РїРёС‚Рё С„РѕС‚Рѕ РґРѕ С‚РµРєСЃС‚Сѓ\n\n` +
    `РџРѕС‚РѕС‡РЅРёР№ СЃС‚Р°РЅ:\n${statuses}\n\n` +
    `РћР±РµСЂРё СЏРєРёР№ С‚РµРєСЃС‚ вЂ” РїРѕС‚С–Рј РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ.\n` +
    `Р©РѕР± РІРёРґР°Р»РёС‚Рё С–СЃРЅСѓСЋС‡Рµ вЂ” РЅР°РґС–С€Р»Рё "РІРёРґР°Р»РёС‚Рё" Р·Р°РјС–СЃС‚СЊ С„РѕС‚Рѕ.`,
    adminPhotosMenu()
  );
});

bot.hears(["рџ“· welcomePhoto", "рџ“· infoPhoto", "рџ“· helpPhoto", "рџ“· pricesPhoto", "рџ“· ideaPhoto", "рџ“· broadcastPhoto"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  const map = {
    "рџ“· welcomePhoto":   "welcomePhoto",
    "рџ“· infoPhoto":      "infoPhoto",
    "рџ“· helpPhoto":      "helpPhoto",
    "рџ“· pricesPhoto":    "pricesPhoto",
    "рџ“· ideaPhoto":      "ideaPhoto",
    "рџ“· broadcastPhoto": "broadcastPhoto",
  };
  const key = map[ctx.message.text];
  if (!key) return;
  ctx.session.awaitingPhotoForKey = key;
  const current = content[key];
  return ctx.reply(
    `РљР»СЋС‡: ${key}\n\n` +
    `РџРѕС‚РѕС‡РЅРµ С„РѕС‚Рѕ: ${current ? "вњ… С”" : "вќЊ РЅРµРјР°"}\n\n` +
    `РќР°РґС–С€Р»Рё РЅРѕРІРµ С„РѕС‚Рѕ. РђР±Рѕ РЅР°РїРёС€Рё "РІРёРґР°Р»РёС‚Рё" С‰РѕР± РїСЂРёР±СЂР°С‚Рё С–СЃРЅСѓСЋС‡Рµ.`,
    adminMenu()
  );
});


bot.hears("вљ™пёЏ РќР°Р»Р°С€С‚СѓРІР°РЅРЅСЏ", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const cfg = loadSettings();
  return ctx.reply(
    `вљ™пёЏ РџРѕС‚РѕС‡РЅС– РЅР°Р»Р°С€С‚СѓРІР°РЅРЅСЏ:\n\n` +
    `рџ“· Р¤РѕС‚Рѕ rate limit: ${cfg.photoRateLimitMs / 1000}СЃРµРє\n` +
    `рџЋ¬ Р’С–РґРµРѕ rate limit: ${cfg.videoRateLimitMs / 1000}СЃРµРє\n` +
    `рџ¤– AI РїСЂРѕРјС‚ rate limit: ${cfg.aiPromptRateLimitMs / 1000}СЃРµРє\n\n` +
    `вЏ± РўР°Р№РјР°СѓС‚Рё:\nР¤РѕС‚Рѕ: ${cfg.photoTimeoutMs / 1000}СЃ | Seedance: ${cfg.seedanceTimeoutMs / 1000}СЃ | Kling: ${cfg.klingTimeoutMs / 1000}СЃ\n\n` +
    `рџЋ¬ Seedance: ${cfg.seedanceDurationSec}СЃРµРє, ${cfg.seedanceAspectRatio}\n` +
    `рџЋҐ Kling: ${cfg.klingDurationSec}СЃРµРє, ${cfg.klingAspectRatio}\n\n` +
    `рџ‘Ґ maxWorkers: ${cfg.maxWorkers}\n` +
    `рџ“… Р”РµРЅРЅРёР№ Р»С–РјС–С‚ Seedance: ${cfg.dailySeedanceLimit} (0=в€ћ)\n` +
    `рџ“… Р”РµРЅРЅРёР№ Р»С–РјС–С‚ Kling: ${cfg.dailyKlingLimit} (0=в€ћ)\n\n` +
    `рџ¤– AI РїСЂРѕРјС‚: ${cfg.aiPromptEnabled ? "вњ…" : "вќЊ"}\n` +
    `рџЋ¬ Р’С–РґРµРѕ: ${cfg.videoEnabled ? "вњ…" : "вќЊ"}\n\n` +
    `Р РµРґР°РіСѓР№ settings.json РЅР° СЃРµСЂРІРµСЂС– С‚Р° РїРµСЂРµР·Р°РїСѓСЃС‚Рё Р±РѕС‚Р°.`,
    adminMenu()
  );
});

bot.hears("рџ“€ РђРЅР°Р»С–С‚РёРєР°", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const all = Object.values(users);
  const paid = payments.filter(p => p.status === "credited");
  const packCount = {};
  paid.forEach(p => { packCount[p.packKey] = (packCount[p.packKey] || 0) + 1; });
  const topPacks = Object.entries(packCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([key, cnt]) => `  ${key}: ${cnt} СЂР°Р·С–РІ`).join("\n");
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
    .map(([d, amt]) => `  ${d.slice(5)}: ${amt} РіСЂРЅ`).join("\n");
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
    `рџ“Љ РђРЅР°Р»С–С‚РёРєР°\n\n` +
    `рџ‘Ґ Р®Р·РµСЂРё: ${totalUsers} РІСЃСЊРѕРіРѕ\n` +
    `  рџ”Ґ РђРєС‚РёРІРЅРёС…: ${activeUsers}\n` +
    `  рџ’і РџР»Р°С‚РЅРёС…: ${payingUsers}\n` +
    `  рџ¶ РЎРїСЂРѕР±СѓРІР°Р»Рё С– РїС–С€Р»Рё: ${triedNoPayment}\n\n` +
    `рџ’° РљРѕРЅРІРµСЂСЃС–СЏ:\n` +
    `  Р’СЃС–в†’РїР»Р°С‚РЅС–: ${conversion}%\n` +
    `  РђРєС‚РёРІРЅС–в†’РїР»Р°С‚РЅС–: ${actConversion}%\n\n` +
    `рџ’µ Р¤С–РЅР°РЅСЃРё:\n` +
    `  Р’СЃСЊРѕРіРѕ: ${totalRevenue} РіСЂРЅ\n` +
    `  РЎРµСЂРµРґРЅС–Р№ С‡РµРє: ${avgCheck} РіСЂРЅ\n` +
    `  РџРѕРІС‚РѕСЂРЅС– РїРѕРєСѓРїРєРё: ${repeatBuyers} СЋР·РµСЂС–РІ\n\n` +
    `рџ“¦ РўРѕРї РїР°РєРµС‚Рё:\n${topPacks || "  РЅРµРјР°С” РґР°РЅРёС…"}\n\n` +
    `рџ“… Р’РёСЂСѓС‡РєР° (7 РґРЅС–РІ):\n${revenueChart}`,
    adminMenu()
  );
});

bot.hears("рџ“¦ РџР°РєРµС‚Рё", (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("вќЊ");
  const pkgs = getPackages();
  const text = Object.values(pkgs).map(p =>
    `${p.key}: ${p.amount} РіСЂРЅ | ${p.promti || p.count || 0} вњЁ | ${p.type}${p.model ? "/" + p.model : ""}`
  ).join("\n");
  return ctx.reply(
    `рџ“¦ РџР°РєРµС‚Рё:\n\n${text}\n\n` +
    `Р—РјС–РЅРёС‚Рё С†С–РЅСѓ:\n/setprice promti_pack10 120\n\n` +
    `Р”РѕРґР°С‚Рё РїР°РєРµС‚:\n/addpackage KEY promti 15 1199 15 Promti\n\n` +
    `Р”РѕРґР°С‚Рё РїРѕСЃРёР»Р°РЅРЅСЏ:\n/setlink support_link https://t.me/support`,
    adminMenu()
  );
});

// в”Ђв”Ђв”Ђ РќРђР’Р†Р“РђР¦Р†РЇ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("в†©пёЏ РќР°Р·Р°Рґ",          (ctx) => { touchUser(ctx); resetState(ctx); return ctx.reply("Р“РѕР»РѕРІРЅРµ РјРµРЅСЋ вњЁ", mainMenu()); });
bot.hears("в†©пёЏ РќР°Р·Р°Рґ РґРѕ С„РѕС‚Рѕ", (ctx) => {
  touchUser(ctx); resetState(ctx);
  ctx.session.mode = "photo";
  return ctx.reply(
    "рџ–ј РњРµРЅСЋ С„РѕС‚Рѕ\n\n" +
    "рџ–ј Р РµРґР°РіСѓРІР°С‚Рё С„РѕС‚Рѕ вЂ” РЅР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ + РїСЂРѕРјС‚, Р·РјС–РЅРёРјРѕ СЃС‚РёР»СЊ!\n" +
    "вњЁ РЎС‚РІРѕСЂРёС‚Рё С„РѕС‚Рѕ вЂ” РЅР°РїРёС€Рё РїСЂРѕРјС‚, СЃС‚РІРѕСЂСЋ С„РѕС‚Рѕ Р· РЅСѓР»СЏ\n" +
    "рџ¤– AI РїСЂРѕРјС‚ вЂ” Р°РЅР°Р»С–Р·СѓСЋ С‚РІРѕС” С„РѕС‚Рѕ С– РїСЂРѕРїРѕРЅСѓСЋ РїСЂРѕРјС‚\n\n" +
    "рџ’Ў Р†РґРµС—: t.me/promteamai",
    photoMenu()
  );
});
bot.hears("в†©пёЏ РќР°Р·Р°Рґ РґРѕ РІС–РґРµРѕ", (ctx) => {
  touchUser(ctx); resetState(ctx);
  ctx.session.mode = "video";
  return ctx.reply(
    "рџЋ¬ РњРµРЅСЋ РІС–РґРµРѕ\n\n" +
    "рџЋ¬ Seedance вЂ” ByteDance РјРѕРґРµР»СЊ, СЂРµР°Р»С–СЃС‚РёС‡РЅР° Р°РЅС–РјР°С†С–СЏ\n" +
    "рџЋҐ Kling вЂ” РєС–РЅРµРјР°С‚РѕРіСЂР°С„С–С‡РЅР° СЏРєС–СЃС‚СЊ РІС–РґРµРѕ\n\n" +
    "рџ’Ў Р†РґРµС—: t.me/promteamai",
    videoMenu()
  );
});
bot.hears("в„№пёЏ Р†РЅС„РѕСЂРјР°С†С–СЏ",     (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.infoText,    content.infoPhoto,    mainMenu()); });
bot.hears("вќ“ Р”РѕРїРѕРјРѕРіР°",       (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.helpText,    content.helpPhoto,    mainMenu()); });
bot.hears("рџ† РџС–РґС‚СЂРёРјРєР°",      (ctx) => { touchUser(ctx); return ctx.reply(content.supportText, mainMenu()); });
bot.hears("рџ’° Р¦С–РЅРё",           (ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.pricesText || "рџ’° Р¦С–РЅРё С‚РёРјС‡Р°СЃРѕРІРѕ РЅРµРґРѕСЃС‚СѓРїРЅС–", content.pricesPhoto, mainMenu()); });

bot.hears("рџ’¬ РЎРІРѕСЏ СЃСѓРјР°", async (ctx) => {
  touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("вњ… РђРґРјС–РЅ вЂ” Р±РµР·РєРѕС€С‚РѕРІРЅРѕ.", adminMenu());
  ctx.session.awaitingCustomAmount = true;
  return ctx.reply(
    `рџ’¬ Р’РІРµРґРё Р±Р°Р¶Р°РЅСѓ СЃСѓРјСѓ РІ РіСЂРёРІРЅСЏС…\n\n1 Promti вњЁ = 9.9 РіСЂРЅ\nРњС–РЅС–РјСѓРј: 50 РіСЂРЅ\n\nРџСЂРёРєР»Р°Рґ: 200`,
    Markup.keyboard([["в†©пёЏ РќР°Р·Р°Рґ"]]).resize()
  );
});

bot.hears(["вњЁ РљСѓРїРёС‚Рё Promti вњЁ", "вњЁ РљСѓРїРёС‚Рё Promti", "рџ’і РљСѓРїРёС‚Рё Promti"], (ctx) => {
  touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("вњ… РђРґРјС–РЅ вЂ” Р±РµР·РєРѕС€С‚РѕРІРЅРѕ.", adminMenu());
  return ctx.reply(
    `рџ’Ћ РћР±РµСЂРё РїР°РєРµС‚ Promti вњЁ\n\n` +
    `рџ“¦ РџР°РєРµС‚Рё:\n` +
    `10 Promti вњЁ вЂ” 99 РіСЂРЅ (9.9 РіСЂРЅ/вњЁ)\n` +
    `30 Promti вњЁ вЂ” 249 РіСЂРЅ (8.3 РіСЂРЅ/вњЁ)\n` +
    `60 Promti вњЁ вЂ” 449 РіСЂРЅ (7.5 РіСЂРЅ/вњЁ)\n` +
    `150 Promti вњЁ вЂ” 999 РіСЂРЅ (6.7 РіСЂРЅ/вњЁ) рџ”Ґ\n\n` +
    `рџ’° Р¦С–РЅРё РїРѕСЃР»СѓРі:\n` +
    `рџ–ј Р¤РѕС‚Рѕ вЂ” 1 Promti вњЁ\n` +
    `рџЋ¬ Seedance вЂ” 5 Promti вњЁ\n` +
    `рџЋҐ Kling вЂ” 8 Promti вњЁ\n\n` +
    `рџЋЃ РџСЂРё СЂРµС”СЃС‚СЂР°С†С–С—: ${START_PROMTI_BONUS} Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ`,
    Markup.inlineKeyboard([
      [Markup.button.callback("10 Promti вњЁ вЂ” 99 РіСЂРЅ",  "buy_pack_promti_pack10")],
      [Markup.button.callback("30 Promti вњЁ вЂ” 249 РіСЂРЅ", "buy_pack_promti_pack30")],
      [Markup.button.callback("60 Promti вњЁ вЂ” 449 РіСЂРЅ", "buy_pack_promti_pack60")],
      [Markup.button.callback("150 Promti вњЁ вЂ” 999 РіСЂРЅ рџ”Ґ", "buy_pack_promti_pack150")],
      [Markup.button.callback("рџ’¬ РЎРІРѕСЏ СЃСѓРјР°", "buy_custom_amount")],
    ])
  );
});

bot.hears("рџ‘« Р—Р°РїСЂРѕСЃРёС‚Рё РґСЂСѓРіР°", async (ctx) => {
  touchUser(ctx);
  const userId  = ctx.from.id;
  const user    = getUser(userId);
  const botName = ctx.botInfo?.username || "promtibotai";
  const refLink = `https://t.me/${botName}?start=ref_${userId}`;
  const earned  = user.referralEarned || 0;
  const count   = user.referralCount  || 0;
  return ctx.reply(
    `рџ‘« Р РµС„РµСЂР°Р»СЊРЅР° РїСЂРѕРіСЂР°РјР°\n\n` +
    `Р—Р°РїСЂРѕСЃРё РґСЂСѓРіР° вЂ” РѕС‚СЂРёРјР°Р№ Р±РѕРЅСѓСЃ!\n` +
    `рџЋЃ Р—Р° РєРѕР¶РЅРѕРіРѕ РґСЂСѓРіР° СЏРєРёР№ РѕРїР»Р°С‚РёС‚СЊ: +${REFERRAL_PROMTI_BONUS} Promti вњЁ\n\n` +
    `рџ“Љ РўРІРѕСЏ СЃС‚Р°С‚РёСЃС‚РёРєР°:\n` +
    `  Р—Р°РїСЂРѕС€РµРЅРѕ РґСЂСѓР·С–РІ: ${count}\n` +
    `  Р—Р°СЂРѕР±Р»РµРЅРѕ: +${earned} Promti вњЁ\n\n` +
    `рџ”— РўРІРѕС” РїРѕСЃРёР»Р°РЅРЅСЏ:\n${refLink}\n\n` +
    `рџ’Ў РџРѕРґС–Р»РёСЃСЊ Р· РґСЂСѓР·СЏРјРё вЂ” РІРѕРЅРё РѕС‚СЂРёРјР°СЋС‚СЊ ${START_PROMTI_BONUS} Promti вњЁ Р±РµР·РєРѕС€С‚РѕРІРЅРѕ РїСЂРё СЂРµС”СЃС‚СЂР°С†С–С—!`,
    mainMenu()
  );
});
bot.hears("рџ’Ў Р†РґРµСЏ РґР»СЏ РїСЂРѕРјС‚С–РІ",(ctx) => { touchUser(ctx); return sendWithOptionalPhoto(ctx, content.ideaText, content.ideaPhoto, mainMenu()); });

// в”Ђв”Ђв”Ђ Р‘РђР›РђРќРЎ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџ“Љ Р‘Р°Р»Р°РЅСЃ", (ctx) => {
  const user = touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("рџ“Љ РђРґРјС–РЅ: Р±РµР·Р»С–РјС–С‚ вњ…", adminMenu());
  const botUsername = ctx.botInfo?.username || "Promtiai_bot";
  const cfg = loadSettings();
  return ctx.reply(
    `рџ“Љ РўРІС–Р№ Р±Р°Р»Р°РЅСЃ: ${user.promti || 0} Promti вњЁ\n\n` +
    `рџ’° Р¦С–РЅРё РїРѕСЃР»СѓРі:\n` +
    `рџ–ј Р¤РѕС‚Рѕ вЂ” 1 Promti вњЁ\n` +
    `рџЋ¬ Seedance вЂ” 5 Promti вњЁ\n` +
    `рџЋҐ Kling вЂ” 8 Promti вњЁ\n\n` +
    `рџ“… Seedance СЃСЊРѕРіРѕРґРЅС–: ${user.dailySeedanceCount || 0}/${cfg.dailySeedanceLimit}\n` +
    `рџ“… Kling СЃСЊРѕРіРѕРґРЅС–: ${user.dailyKlingCount || 0}/${cfg.dailyKlingLimit}\n\n` +
    `рџ‘« Р—Р°РїСЂРѕС€РµРЅРѕ РґСЂСѓР·С–РІ: ${user.referralCount || 0}\n` +
    `рџ”— https://t.me/${botUsername}?start=ref_${user.id}`,
    mainMenu()
  );
});

// в”Ђв”Ђв”Ђ Р РћР—Р”Р†Р›Р в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџ–ј Р¤РѕС‚Рѕ", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  return ctx.reply(
    "рџ–ј РњРµРЅСЋ С„РѕС‚Рѕ\n\n" +
    "рџ–ј Р РµРґР°РіСѓРІР°С‚Рё С„РѕС‚Рѕ вЂ” РЅР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ + РїСЂРѕРјС‚, Р·РјС–РЅРёРјРѕ СЃС‚РёР»СЊ!\n" +
    "вњЁ РЎС‚РІРѕСЂРёС‚Рё С„РѕС‚Рѕ вЂ” РЅР°РїРёС€Рё РїСЂРѕРјС‚, СЃС‚РІРѕСЂСЋ С„РѕС‚Рѕ Р· РЅСѓР»СЏ\n" +
    "рџ¤– AI РїСЂРѕРјС‚ вЂ” Р°РЅР°Р»С–Р·СѓСЋ С‚РІРѕС” С„РѕС‚Рѕ С– РїСЂРѕРїРѕРЅСѓСЋ РїСЂРѕРјС‚\n\n" +
    "рџ’Ў Р†РґРµС—: t.me/promteamai",
    photoMenu()
  );
});
bot.hears("рџЋЁ РўСЂРµРЅРґРѕРІС– СЃС‚РёР»С–", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  return sendPromptLibraryPage(ctx, 0, false);
});
bot.hears("рџЋ¬ Р’С–РґРµРѕ", (ctx) => {
  const cfg = loadSettings();
  if (!cfg.videoEnabled) return ctx.reply("рџЋ¬ Р’С–РґРµРѕ С‚РёРјС‡Р°СЃРѕРІРѕ РЅРµРґРѕСЃС‚СѓРїРЅРµ. РЎРїСЂРѕР±СѓР№ РїС–Р·РЅС–С€Рµ.", mainMenu());
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video";
  return ctx.reply(
    "рџЋ¬ РњРµРЅСЋ РІС–РґРµРѕ\n\n" +
    "рџЋ¬ Seedance вЂ” ByteDance РјРѕРґРµР»СЊ, СЂРµР°Р»С–СЃС‚РёС‡РЅР° Р°РЅС–РјР°С†С–СЏ\n" +
    "рџЋҐ Kling вЂ” РєС–РЅРµРјР°С‚РѕРіСЂР°С„С–С‡РЅР° СЏРєС–СЃС‚СЊ РІС–РґРµРѕ\n\n" +
    "рџ’Ў Р†РґРµС—: t.me/promteamai",
    videoMenu()
  );
});

// в”Ђв”Ђв”Ђ Р¤РћРўРћ Р Р•Р–РРњР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџ–ј Р РµРґР°РіСѓРІР°С‚Рё С„РѕС‚Рѕ", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  ctx.session.photoMode = "edit";
  ctx.session.customType = "custom_photo";
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  return ctx.reply(
    "вњЏпёЏ Р РµР¶РёРј СЂРµРґР°РіСѓРІР°РЅРЅСЏ С„РѕС‚Рѕ\n\nРќР°РїРёС€Рё РїСЂРѕРјС‚ СЏРє С…РѕС‡РµС€ Р·РјС–РЅРёС‚Рё С„РѕС‚Рѕ, РїРѕС‚С–Рј РЅР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ.\n\nРџСЂРёРєР»Р°Рґ: \"beauty editorial, glossy skin\"\n\nрџ’Ў Р†РґРµС—: t.me/promteamai",
    photoMenu()
  );
});

bot.hears("вњЁ РЎС‚РІРѕСЂРёС‚Рё С„РѕС‚Рѕ", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo";
  ctx.session.photoMode = "create";
  ctx.session.customType = "create_photo";
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  return ctx.reply(
    "вњЁ Р РµР¶РёРј СЃС‚РІРѕСЂРµРЅРЅСЏ С„РѕС‚Рѕ\n\nРќР°РїРёС€Рё С‰Рѕ С…РѕС‡РµС€ Р·РіРµРЅРµСЂСѓРІР°С‚Рё вЂ” С„РѕС‚Рѕ Р±СѓРґРµ СЃС‚РІРѕСЂРµРЅРѕ Р· РЅСѓР»СЏ.\n\nРџСЂРёРєР»Р°Рґ: \"portrait of woman in Renaissance style, cinematic lighting\"\n\nрџ’Ў Р†РґРµС—: t.me/promteamai",
    photoMenu()
  );
});

// в”Ђв”Ђв”Ђ Р’Р†Р”Р•Рћ РњРћР”Р•Р›Р† в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџЋ¬ Seedance", (ctx) => {
  const cfg = loadSettings();
  if (cfg.seedanceEnabled === false) {
    return ctx.reply(cfg.seedanceComingSoonText || "рџЋ¬ Seedance С‚РёРјС‡Р°СЃРѕРІРѕ РЅРµРґРѕСЃС‚СѓРїРЅРёР№. РЎРєРѕСЂРѕ РїРѕРІРµСЂРЅРµС‚СЊСЃСЏ! РЎРїСЂРѕР±СѓР№ рџЋҐ Kling.", videoMenu());
  }
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video"; ctx.session.style = "seedance";
  ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  ctx.session.videoInputMode = null;
  return ctx.reply(
    "рџЋ¬ Seedance 2.0\n\n" +
    "РЎРїРµС†С–Р°Р»С–Р·СѓС”С‚СЊСЃСЏ РЅР° Р°РЅС–РјР°С†С–С— РѕР±'С”РєС‚С–РІ, РїСЂРёСЂРѕРґРё, РјСѓР»СЊС‚РёРїР»С–РєР°С†С–С— С‚Р° С„Р°РЅС‚Р°СЃС‚РёС‡РЅРёС… СЃС†РµРЅ.\n\n" +
    "вљЎ РђРІС‚Рѕ Р°РЅС–РјР°С†С–СЏ вЂ” РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ, РѕР¶РёРІР»СЋ Р°РІС‚РѕРјР°С‚РёС‡РЅРѕ\n" +
    "рџЋ¬ РђРЅС–РјР°С†С–СЏ + РїСЂРѕРјС‚ вЂ” РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ Р·С– СЃРІРѕС—Рј РѕРїРёСЃРѕРј СЂСѓС…Сѓ\n" +
    "рџЋҐ Р’С–РґРµРѕ Р· С‚РµРєСЃС‚Сѓ вЂ” СЃС‚РІРѕСЂСЋ РІС–РґРµРѕ Р· РЅСѓР»СЏ РїРѕ РѕРїРёСЃСѓ\n\n" +
    "вњ… РџС–РґС…РѕРґРёС‚СЊ РґР»СЏ:\n" +
    "вЂў Р›СЏР»СЊРєРё, С–РіСЂР°С€РєРё, С„С–РіСѓСЂРєРё\n" +
    "вЂў РџСЂРёСЂРѕРґР°, РїРµР№Р·Р°Р¶С–, С‚РІР°СЂРёРЅРё\n" +
    "вЂў РђСЂС‚, РјСѓР»СЊС‚РёРїР»С–РєР°С†С–СЏ, С„РµРЅС‚РµР·С–\n" +
    "вЂў РџСЂРѕРґСѓРєС‚Рё, РїСЂРµРґРјРµС‚Рё, Р»РѕРіРѕС‚РёРїРё\n\n" +
    "в›”пёЏ РќРµ РїС–РґС‚СЂРёРјСѓС” С„РѕС‚Рѕ СЂРµР°Р»СЊРЅРёС… Р»СЋРґРµР№\n" +
    "рџ‘‰ Р”Р»СЏ Р°РЅС–РјР°С†С–С— Р»СЋРґРµР№ вЂ” РІРёРєРѕСЂРёСЃС‚РѕРІСѓР№ рџЋҐ Kling\n\n" +
    "рџ’Ў Р†РґРµС—: t.me/promteamai",
    seedanceMenu()
  );
});

bot.hears("вљЎ РђРІС‚Рѕ Р°РЅС–РјР°С†С–СЏ", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("РЎРїРѕС‡Р°С‚РєСѓ РѕР±РµСЂРё РјРѕРґРµР»СЊ: рџЋ¬ Seedance Р°Р±Рѕ рџЋҐ Kling", videoMenu());
  ctx.session.videoInputMode = "image";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = null;
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  const defaultPrompt = prompts[style] || "cinematic motion, smooth animation";
  const isSeeedance = style === "seedance";
  return ctx.reply(
    `вљЎ РђРІС‚Рѕ Р°РЅС–РјР°С†С–СЏ\n\nРќР°РґС–С€Р»Рё С„РѕС‚Рѕ вЂ” РѕР¶РёРІР»СЋ Р· РґРµС„РѕР»С‚РЅРёРј РїСЂРѕРјС‚РѕРј:\nрџ“ќ "${defaultPrompt}"\n\n` +
    (isSeeedance ? "в›”пёЏ Р›РёС€Рµ РґР»СЏ РѕР±'С”РєС‚С–РІ С‚Р° РїСЂРёСЂРѕРґРё (РЅРµ Р»СЋРґРµР№)\nрџ‘‰ Р”Р»СЏ Р»СЋРґРµР№ вЂ” РІРёРєРѕСЂРёСЃС‚РѕРІСѓР№ Kling\n\n" : "") +
    `вњЌпёЏ РҐРѕС‡РµС€ СЃРІС–Р№ РїСЂРѕРјС‚? РќР°РїРёС€Рё Р№РѕРіРѕ РїРµСЂРµРґ С„РѕС‚Рѕ.`,
    menu
  );
});

bot.hears("рџЋ¬ РђРЅС–РјР°С†С–СЏ + РїСЂРѕРјС‚", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("РЎРїРѕС‡Р°С‚РєСѓ РѕР±РµСЂРё РјРѕРґРµР»СЊ: рџЋ¬ Seedance Р°Р±Рѕ рџЋҐ Kling", videoMenu());
  ctx.session.videoInputMode = "image";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  const isSeedanceStyle = style === "seedance";
  return ctx.reply(
    `рџЋ¬ РђРЅС–РјР°С†С–СЏ + РїСЂРѕРјС‚\n\nРќР°РїРёС€Рё РїСЂРѕРјС‚, РїРѕС‚С–Рј РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ.\n\n` +
    (isSeedanceStyle
      ? `РџСЂРёРєР»Р°Рґ: "gentle swaying in wind, soft light"\n\nв›”пёЏ Р›РёС€Рµ РґР»СЏ РѕР±'С”РєС‚С–РІ С‚Р° РїСЂРёСЂРѕРґРё вЂ” РЅРµ Р»СЋРґРµР№\nрџ‘‰ Р”Р»СЏ Р°РЅС–РјР°С†С–С— Р»СЋРґРµР№ вЂ” Kling\n\n`
      : `РџСЂРёРєР»Р°Рґ: "cinematic close-up, eyes slowly opening"\n\n`) +
    `рџ’Ў t.me/promteamai`,
    menu
  );
});

bot.hears("рџЋҐ Р’С–РґРµРѕ Р· С‚РµРєСЃС‚Сѓ", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  const style = ctx.session.style;
  if (!style) return ctx.reply("РЎРїРѕС‡Р°С‚РєСѓ РѕР±РµСЂРё РјРѕРґРµР»СЊ: рџЋ¬ Seedance Р°Р±Рѕ рџЋҐ Kling", videoMenu());
  ctx.session.videoInputMode = "text";
  ctx.session.customType = `custom_video_${style}`;
  ctx.session.awaitingCustomPrompt = true;
  ctx.session.customPrompt = null;
  const menu = style === "kling" ? klingMenu() : seedanceMenu();
  return ctx.reply(
    `рџЋҐ Р’С–РґРµРѕ Р· С‚РµРєСЃС‚Сѓ\n\nРќР°РїРёС€Рё РґРµС‚Р°Р»СЊРЅРёР№ РїСЂРѕРјС‚ вЂ” СЃС‚РІРѕСЂСЋ РІС–РґРµРѕ Р· РЅСѓР»СЏ!\n\nРџСЂРёРєР»Р°Рґ: "cinematic portrait of woman, wind in hair, golden hour"\n\nрџ’Ў t.me/promteamai`,
    menu
  );
});

bot.hears("рџЋҐ Kling", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video"; ctx.session.style = "kling";
  ctx.session.customType = null; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  ctx.session.videoInputMode = null;
  return ctx.reply(
    "рџЋҐ Kling\n\n" +
    "рџ“ё Р¤РѕС‚Рѕ в†’ Р’С–РґРµРѕ вЂ” РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ + РїСЂРѕРјС‚, РѕР¶РёРІР»СЋ!\n" +
    "вњЌпёЏ РўРµРєСЃС‚ в†’ Р’С–РґРµРѕ вЂ” РЅР°РїРёС€Рё РїСЂРѕРјС‚, СЃС‚РІРѕСЂСЋ РєС–РЅРµРјР°С‚РѕРіСЂР°С„С–С‡РЅРµ РІС–РґРµРѕ\n\n" +
    "РџСЂРёРєР»Р°Рґ: \"cinematic close-up, soft bokeh\"\n\n" +
    "рџ’Ў Р†РґРµС—: t.me/promteamai",
    klingMenu()
  );
});

// в”Ђв”Ђв”Ђ AI РџР РћРњРў в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.hears("рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ С„РѕС‚Рѕ", (ctx) => {
  const cfg  = loadSettings();
  const user = touchUser(ctx);
  if (!cfg.aiPromptEnabled) return ctx.reply("рџ¤– AI РїСЂРѕРјС‚ С‚РёРјС‡Р°СЃРѕРІРѕ РІРёРјРєРЅРµРЅРѕ.", photoMenu());
  if (!isAdmin(ctx.from.id) && (user.totalSpent || 0) <= 0) {
    return ctx.reply(
      "рџ”’ AI РїСЂРѕРјС‚ РґРѕСЃС‚СѓРїРЅРёР№ РїС–СЃР»СЏ РїРѕРєСѓРїРєРё Р±СѓРґСЊ-СЏРєРѕРіРѕ РїР°РєРµС‚Сѓ рџ’і\n\nРљСѓРїРё РїР°РєРµС‚ Promti вЂ” С– РѕС‚СЂРёРјР°С”С€ РґРѕСЃС‚СѓРї РґРѕ AI РїСЂРѕРјС‚С–РІ!",
      photoMenu()
    );
  }
  ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "photo"; ctx.session.style = null;
  ctx.session.awaitingAiPrompt = "photo"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("рџ¤– РќР°РґС–С€Р»Рё С„РѕС‚Рѕ вЂ” СЏ Р·Р°РїСЂРѕРїРѕРЅСѓСЋ РїСЂРѕРјС‚ РґР»СЏ РіРµРЅРµСЂР°С†С–С—.", photoMenu());
});

bot.hears("рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ РІС–РґРµРѕ", (ctx) => {
  const cfg  = loadSettings();
  const user = touchUser(ctx);
  if (!cfg.aiPromptEnabled) return ctx.reply("рџ¤– AI РїСЂРѕРјС‚ С‚РёРјС‡Р°СЃРѕРІРѕ РІРёРјРєРЅРµРЅРѕ.", videoMenu());
  if (!isAdmin(ctx.from.id) && (user.totalSpent || 0) <= 0) {
    return ctx.reply(
      "рџ”’ AI РїСЂРѕРјС‚ РґРѕСЃС‚СѓРїРЅРёР№ РїС–СЃР»СЏ РїРѕРєСѓРїРєРё Р±СѓРґСЊ-СЏРєРѕРіРѕ РїР°РєРµС‚Сѓ рџ’і\n\nРљСѓРїРё РїР°РєРµС‚ Promti вЂ” С– РѕС‚СЂРёРјР°С”С€ РґРѕСЃС‚СѓРї РґРѕ AI РїСЂРѕРјС‚С–РІ!",
      videoMenu()
    );
  }
  ensureSession(ctx);
  clearPromptAttribution(ctx);
  ctx.session.mode = "video";
  if (!ctx.session.style) ctx.session.style = "seedance";
  ctx.session.awaitingAiPrompt = "video"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  const label = ctx.session.style === "kling" ? "рџЋҐ Kling" : "рџЋ¬ Seedance";
  return ctx.reply(`рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ РІС–РґРµРѕ (${label})\n\nРќР°РґС–С€Р»Рё:\nрџ“ё Р¤РѕС‚Рѕ вЂ” РѕРїРёС€Сѓ СЂСѓС…\nрџЋ¬ Р’С–РґРµРѕ РґРѕ 10 СЃРµРє вЂ” РїСЂРѕР°РЅР°Р»С–Р·СѓСЋ СЂСѓС…\n\nРџСЂРѕРјС‚: РјР°РєСЃ. 10 СЃР»С–РІ.`, videoMenu());
});

// в”Ђв”Ђв”Ђ РџРћРљРЈРџРљРђ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function sendAutoPayment(ctx, packKey) {
  try {
    const user = touchUser(ctx);
    const pack = getPackages()[packKey];
    if (!pack) return ctx.reply("вќЊ РџР°РєРµС‚ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
    const { invoiceUrl, orderReference } = await createWayForPayInvoice(ctx.from.id, packKey);
    user.pendingOrderReference = orderReference;
    user.lastPaymentRequest    = { packKey, createdAt: new Date().toISOString() };
    saveUsers();
    return ctx.reply(`РџР°РєРµС‚: ${pack.title}\nР¦С–РЅР°: ${pack.priceText}`, paymentInlineKeyboard(invoiceUrl, pack));
  } catch (e) {
    console.error("PAYMENT ERROR:", e.message);
    return ctx.reply("вќЊ РќРµ РІРґР°Р»РѕСЃСЏ СЃС‚РІРѕСЂРёС‚Рё СЂР°С…СѓРЅРѕРє. РЎРїСЂРѕР±СѓР№ РїС–Р·РЅС–С€Рµ.");
  }
}

// вњ… Inline callback РѕР±СЂРѕР±РЅРёРєРё РґР»СЏ РїРѕРєСѓРїРєРё РїР°РєРµС‚С–РІ (РЅР°РґС–Р№РЅС–С€Рµ РЅС–Р¶ reply-РєРЅРѕРїРєРё)
bot.action(/^buy_pack_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const packKey = ctx.match[1];
    await sendAutoPayment(ctx, packKey);
  } catch (e) {
    console.error("BUY_PACK CALLBACK ERROR:", e.message);
    try { await ctx.reply("вќЊ РќРµ РІРґР°Р»РѕСЃСЏ СЃС‚РІРѕСЂРёС‚Рё СЂР°С…СѓРЅРѕРє. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·."); } catch {}
  }
});

bot.action("buy_custom_amount", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    touchUser(ctx);
    if (isAdmin(ctx.from.id)) return ctx.reply("вњ… РђРґРјС–РЅ вЂ” Р±РµР·РєРѕС€С‚РѕРІРЅРѕ.", adminMenu());
    ctx.session.awaitingCustomAmount = true;
    return ctx.reply(
      `рџ’¬ Р’РІРµРґРё Р±Р°Р¶Р°РЅСѓ СЃСѓРјСѓ РІ РіСЂРёРІРЅСЏС…\n\n1 Promti вњЁ = 9.9 РіСЂРЅ\nРњС–РЅС–РјСѓРј: 50 РіСЂРЅ\n\nРџСЂРёРєР»Р°Рґ: 200`,
      Markup.keyboard([["в†©пёЏ РќР°Р·Р°Рґ"]]).resize()
    );
  } catch (e) { console.error("BUY CUSTOM AMOUNT:", e.message); }
});

// вњ… Р—Р°Р»РёС€Р°СЋ СЃС‚Р°СЂС– reply-hears СЏРє fallback (СЂР°РїС‚РѕРј СЋР·РµСЂ СЏРєРѕСЃСЊ РЅР°С‚РёСЃРЅРµ)
bot.hears(/^10\s+Promti/i,  (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack10"); });
bot.hears(/^30\s+Promti/i,  (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack30"); });
bot.hears(/^60\s+Promti/i,  (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack60"); });
bot.hears(/^150\s+Promti/i, (ctx) => { touchUser(ctx); sendAutoPayment(ctx, "promti_pack150"); });

bot.action(/^checkpay_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery("РЇРєС‰Рѕ РѕРїР»Р°С‚Р° РїСЂРѕР№С€Р»Р° вЂ” Р±СѓРґРµ Р·Р°СЂР°С…РѕРІР°РЅРѕ Р°РІС‚РѕРјР°С‚РёС‡РЅРѕ вњ…"); }
  catch (e) { console.error("CHECKPAY:", e.message); }
});

// в”Ђв”Ђв”Ђ РђРџРЎР•Р› INLINE РљРќРћРџРљР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.action(/^pay_custom_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const tempKey = ctx.match[1];
    if (!dynamicPackages[tempKey]) return ctx.reply("вќЊ РџР°РєРµС‚ РЅРµ Р·РЅР°Р№РґРµРЅРѕ. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.");
    await sendAutoPayment(ctx, tempKey);
  } catch (e) { console.error("PAY CUSTOM:", e.message); }
});

bot.action("upsell_promti", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    touchUser(ctx);
    if (isAdmin(ctx.from.id)) return ctx.reply("вњ… РђРґРјС–РЅ вЂ” Р±РµР·РєРѕС€С‚РѕРІРЅРѕ.");
    await ctx.reply(
      `рџ’Ћ РћР±РµСЂРё РїР°РєРµС‚ Promti вњЁ\n\n` +
      `рџ“¦ РџР°РєРµС‚Рё:\n` +
      `10 Promti вњЁ вЂ” 99 РіСЂРЅ\n` +
      `30 Promti вњЁ вЂ” 249 РіСЂРЅ\n` +
      `60 Promti вњЁ вЂ” 449 РіСЂРЅ\n` +
      `150 Promti вњЁ вЂ” 999 РіСЂРЅ рџ”Ґ\n\n` +
      `рџ’° Р¦С–РЅРё РїРѕСЃР»СѓРі:\n` +
      `рџ–ј Р¤РѕС‚Рѕ вЂ” 1 Promti вњЁ\n` +
      `рџЋ¬ Seedance вЂ” 5 Promti вњЁ\n` +
      `рџЋҐ Kling вЂ” 8 Promti вњЁ`,
      Markup.inlineKeyboard([
        [Markup.button.callback("10 Promti вњЁ вЂ” 99 РіСЂРЅ",  "buy_pack_promti_pack10")],
        [Markup.button.callback("30 Promti вњЁ вЂ” 249 РіСЂРЅ", "buy_pack_promti_pack30")],
        [Markup.button.callback("60 Promti вњЁ вЂ” 449 РіСЂРЅ", "buy_pack_promti_pack60")],
        [Markup.button.callback("150 Promti вњЁ вЂ” 999 РіСЂРЅ рџ”Ґ", "buy_pack_promti_pack150")],
        [Markup.button.callback("рџ’¬ РЎРІРѕСЏ СЃСѓРјР°", "buy_custom_amount")],
      ])
    );
  } catch (e) { console.error("UPSELL PROMTI:", e.message); }
});

// в”Ђв”Ђв”Ђ AI РџР РћРњРў INLINE РљРќРћРџРљР в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
    const key = normalizePromptKey(ctx.match[1]);
    incrementStyleMetric(key, "clicks");
    return sendPromptStyleCard(ctx, key, false);
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
    await ctx.answerCbQuery("Style loaded");
    touchUser(ctx);
    const style = getStyle(normalizePromptKey(ctx.match[1]));
    if (!style) return ctx.reply("Style not found.");
    incrementStyleMetric(style.key, "clicks");
    if (style.type === "dynamic") {
      return startDynamicStyleFlow(ctx, style);
    }
    applyStaticStyleToSession(ctx, style);
    return sendPromptReadyMessage(ctx, style, { withPreview: false });
  } catch (e) { console.error("PROMPTLIB APPLY:", e.message); }
});

bot.action(/^stylelib_select_(.+)__([a-z0-9_-]+)__([a-z0-9_-]+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const styleKey = normalizePromptKey(ctx.match[1]);
    const selectorKey = normalizePromptKey(ctx.match[2]);
    const optionKey = normalizePromptKey(ctx.match[3]);
    const style = getStyle(styleKey);
    if (!style || style.type !== "dynamic") return ctx.reply("Style not found.");
    const selector = style.selectors.find(item => item.key === selectorKey);
    if (!selector || !selector.options[optionKey]) return ctx.reply("Option not found.");
    ensureSession(ctx);
    if (!ctx.session.pendingDynamicStyle || ctx.session.pendingDynamicStyle.styleKey !== styleKey) {
      ctx.session.pendingDynamicStyle = { styleKey, selections: {} };
    }
    ctx.session.pendingDynamicStyle.selections = {
      ...(ctx.session.pendingDynamicStyle.selections || {}),
      [selectorKey]: optionKey,
    };
    incrementDynamicOptionMetric(styleKey, selectorKey, optionKey, "clicks");
    return continueDynamicStyleFlow(ctx, styleKey);
  } catch (e) { console.error("STYLELIB SELECT:", e.message); }
});

bot.action(/^stylewizard_type_(static|dynamic)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    if (!ctx.session.styleWizard) startStyleWizard(ctx);
    ctx.session.styleWizard.style.type = ctx.match[1];
    ctx.session.styleWizard.step = "key";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD TYPE:", e.message); }
});

bot.action("stylewizard_continue_option", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id) || !ctx.session.styleWizard) return;
    ctx.session.styleWizard.step = "option_key";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD OPTION:", e.message); }
});

bot.action("stylewizard_continue_selector", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id) || !ctx.session.styleWizard) return;
    ctx.session.styleWizard.currentSelector = null;
    ctx.session.styleWizard.currentOption = null;
    ctx.session.styleWizard.step = "selector_key";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD SELECTOR:", e.message); }
});

bot.action("stylewizard_continue_media", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id) || !ctx.session.styleWizard) return;
    ctx.session.styleWizard.step = "preview";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD MEDIA:", e.message); }
});

bot.action("stylewizard_skip_preview", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id) || !ctx.session.styleWizard) return;
    ctx.session.styleWizard.style.previewPhoto = null;
    ctx.session.styleWizard.step = "examples";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD SKIP PREVIEW:", e.message); }
});

bot.action("stylewizard_done_examples", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id) || !ctx.session.styleWizard) return;
    ctx.session.styleWizard.step = "confirm";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD DONE EXAMPLES:", e.message); }
});

bot.action("stylewizard_skip_examples", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id) || !ctx.session.styleWizard) return;
    ctx.session.styleWizard.style.examplePhotos = [];
    ctx.session.styleWizard.step = "confirm";
    return promptStyleWizardStep(ctx);
  } catch (e) { console.error("STYLEWIZARD SKIP EXAMPLES:", e.message); }
});

bot.action("stylewizard_save", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const style = saveWizardStyle(ctx);
    if (!style) return ctx.reply("вќЊ РќРµ РІРґР°Р»РѕСЃСЏ Р·Р±РµСЂРµРіС‚Рё СЃС‚РёР»СЊ.", adminMenu());
    const botUsername = await resolveBotUsername(ctx);
    return ctx.reply(
      `вњ… РЎС‚РёР»СЊ Р·Р±РµСЂРµР¶РµРЅРѕ\n\nKEY: ${style.key}\nType: ${style.type}\nDeep-link: ${getStyleDeepLink(botUsername, style.key)}`,
      adminMenu()
    );
  } catch (e) { console.error("STYLEWIZARD SAVE:", e.message); }
});

bot.action("stylewizard_cancel", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    ctx.session.styleWizard = null;
    return ctx.reply("Wizard СЃРєР°СЃРѕРІР°РЅРѕ.", adminMenu());
  } catch (e) { console.error("STYLEWIZARD CANCEL:", e.message); }
});

bot.action(/^admin_promptlib_trend_(.+)_(on|off)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const mode = ctx.match[2];
    const style = getPromptStyle(key);
    if (!style) return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
    style.isTrending = mode === "on";
    content.promptLibrary[key] = style;
    saveContent();
    return sendPromptStyleCard(ctx, key, true);
  } catch (e) { console.error("ADMIN PROMPTLIB TREND:", e.message); }
});

bot.action(/^admin_promptlib_preview_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("РќР°РґС–С€Р»Рё preview-С„РѕС‚Рѕ");
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const style = getPromptStyle(key);
    if (!style) return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
    ctx.session.awaitingPromptPreviewKey = key;
    return ctx.reply(`рџ–ј РќР°РґС–С€Р»Рё preview-С„РѕС‚Рѕ РґР»СЏ СЃС‚РёР»СЋ "${key}" Р°Р±Рѕ РЅР°РїРёС€Рё "РІРёРґР°Р»РёС‚Рё".`, adminMenu());
  } catch (e) { console.error("ADMIN PROMPTLIB PREVIEW:", e.message); }
});

bot.action(/^admin_promptlib_examples_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Send up to 10 photos");
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    const style = getPromptStyle(key);
    if (!style) return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
    ctx.session.awaitingPromptExamplesKey = key;
    return ctx.reply(
      `РќР°РґС–С€Р»Рё РґРѕ ${MAX_PROMPT_EXAMPLE_PHOTOS} С„РѕС‚Рѕ РґР»СЏ СЃС‚РёР»СЋ "${key}".\n` +
      `РќР°РїРёС€Рё "РіРѕС‚РѕРІРѕ" С‰РѕР± Р·Р°РІРµСЂС€РёС‚Рё Р°Р±Рѕ "РІРёРґР°Р»РёС‚Рё" С‰РѕР± РѕС‡РёСЃС‚РёС‚Рё РІСЃС– РїСЂРёРєР»Р°РґРё.`,
      adminMenu()
    );
  } catch (e) { console.error("ADMIN PROMPTLIB EXAMPLES:", e.message); }
});

bot.action(/^admin_promptlib_delete_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    if (!isAdmin(ctx.from.id)) return;
    const key = normalizePromptKey(ctx.match[1]);
    if (!getPromptStyle(key)) return ctx.reply("вќЊ РЎС‚РёР»СЊ РЅРµ Р·РЅР°Р№РґРµРЅРѕ.");
    delete content.promptLibrary[key];
    saveContent();
    return ctx.reply(`вњ… РЎС‚РёР»СЊ "${key}" РІРёРґР°Р»РµРЅРѕ.`, adminMenu());
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
    await ctx.answerCbQuery("вњ… РџСЂРѕРјС‚ Р·Р°СЃС‚РѕСЃРѕРІР°РЅРѕ! РќР°РґС–С€Р»Рё С„РѕС‚Рѕ.");
    const aiMode = ctx.match[1];
    await ctx.reply(
      `вњ… РџСЂРѕРјС‚ Р·Р±РµСЂРµР¶РµРЅРѕ:\n\nрџ“ќ <code>${escapeHtml(ctx.session.customPrompt || "-")}</code>\n\nРќР°РґС–С€Р»Рё С„РѕС‚Рѕ рџ“ё`,
      { parse_mode: "HTML", ...(aiMode === "video" ? videoMenu() : photoMenu()) }
    );
  } catch (e) { console.error("APPLY AI PROMPT:", e.message); }
});

bot.action(/^regen_ai_prompt_(photo|video)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("рџ”„ РќР°РґС–С€Р»Рё С„РѕС‚Рѕ С‰Рµ СЂР°Р·");
    const aiMode = ctx.match[1];
    ctx.session.awaitingAiPrompt = aiMode; ctx.session.customPrompt = null;
    await ctx.reply("рџ”„ РќР°РґС–С€Р»Рё С„РѕС‚Рѕ вЂ” Р·РіРµРЅРµСЂСѓСЋ РЅРѕРІРёР№ РІР°СЂС–Р°РЅС‚.", aiMode === "video" ? videoMenu() : photoMenu());
  } catch (e) { console.error("REGEN AI PROMPT:", e.message); }
});

// в”Ђв”Ђв”Ђ РўР•РљРЎРўРћР’РР™ РҐР•РќР”Р›Р•Р  в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const ALL_BUTTONS = [
  "рџ–ј Р¤РѕС‚Рѕ","рџЋ¬ Р’С–РґРµРѕ","рџЋЁ РўСЂРµРЅРґРѕРІС– СЃС‚РёР»С–","рџ“Љ Р‘Р°Р»Р°РЅСЃ","рџ’Ў Р†РґРµСЏ РґР»СЏ РїСЂРѕРјС‚С–РІ","в„№пёЏ Р†РЅС„РѕСЂРјР°С†С–СЏ","вќ“ Р”РѕРїРѕРјРѕРіР°","рџ† РџС–РґС‚СЂРёРјРєР°","рџ’° Р¦С–РЅРё",
  "рџ‘« Р—Р°РїСЂРѕСЃРёС‚Рё РґСЂСѓРіР°",
  "рџ–ј Р РµРґР°РіСѓРІР°С‚Рё С„РѕС‚Рѕ","вњЁ РЎС‚РІРѕСЂРёС‚Рё С„РѕС‚Рѕ",
  "вљЎ РђРІС‚Рѕ Р°РЅС–РјР°С†С–СЏ","рџЋ¬ РђРЅС–РјР°С†С–СЏ + РїСЂРѕРјС‚","рџЋҐ Р’С–РґРµРѕ Р· С‚РµРєСЃС‚Сѓ",
  "рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ С„РѕС‚Рѕ","рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ РІС–РґРµРѕ",
  "вњЁ РљСѓРїРёС‚Рё Promti вњЁ","вњЁ РљСѓРїРёС‚Рё Promti","рџ’і РљСѓРїРёС‚Рё Promti","рџ’¬ РЎРІРѕСЏ СЃСѓРјР°",
  "рџЋ¬ Seedance","рџЋҐ Kling",
  "в†©пёЏ РќР°Р·Р°Рґ","в†©пёЏ РќР°Р·Р°Рґ РґРѕ РІС–РґРµРѕ","в†©пёЏ РќР°Р·Р°Рґ РґРѕ С„РѕС‚Рѕ",
  "рџ“Љ РЎС‚Р°С‚СѓСЃ Р±РѕС‚Р°","рџ‘¤ РњС–Р№ ID","рџ‘Ґ РљРѕСЂРёСЃС‚СѓРІР°С‡С–","рџ’і РћСЃС‚Р°РЅРЅС– РѕРїР»Р°С‚Рё","рџЋЁ Р‘С–Р±Р»С–РѕС‚РµРєР° СЃС‚РёР»С–РІ","рџ“€ РђРЅР°Р»С–С‚РёРєР°",
  "рџ“¦ РџР°РєРµС‚Рё","вњЏпёЏ Р—РјС–РЅРёС‚Рё С‚РµРєСЃС‚","рџ“ќ РџРѕС‚РѕС‡РЅС– С‚РµРєСЃС‚Рё","вљ™пёЏ РќР°Р»Р°С€С‚СѓРІР°РЅРЅСЏ",
  "рџ–ј РџСЂРёРєСЂС–РїРёС‚Рё С„РѕС‚Рѕ",
  "рџ“· welcomePhoto","рџ“· infoPhoto","рџ“· helpPhoto","рџ“· pricesPhoto","рџ“· ideaPhoto","рџ“· broadcastPhoto",
];

bot.on("text", async (ctx, next) => {
  try {
    ensureSession(ctx); touchUser(ctx);
    if (users[ctx.from.id]?.banned) return ctx.reply("рџљ« Р’Р°С€ Р°РєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРѕРІР°РЅРёР№. РќР°РїРёС€С–С‚СЊ РІ РїС–РґС‚СЂРёРјРєСѓ.");
    const text = ctx.message.text;
    // вњ… РџРµСЂРµРІС–СЂСЏС”РјРѕ С‚Р°РєРѕР¶ СЂСЏРґРєРё С‰Рѕ РїРѕС‡РёРЅР°СЋС‚СЊСЃСЏ Р· "N Promti" вЂ” С†Рµ РїР°РєРµС‚Рё, С—С… Р»РѕРІР»СЏС‚СЊ regex bot.hears
    const isPackButton = /^\d+\s+Promti/i.test(text);
    if (ALL_BUTTONS.includes(text) || text.startsWith("/") || isPackButton) return next();

    if (isAdmin(ctx.from.id) && ctx.session.styleWizard) {
      const wizard = ctx.session.styleWizard;
      if (wizard.step === "key") {
        const key = normalizePromptKey(text);
        if (!key) return ctx.reply("вќЊ РќРµРєРѕСЂРµРєС‚РЅРёР№ key. Р’РёРєРѕСЂРёСЃС‚РѕРІСѓР№ a-z, 0-9, _ С‚Р° -");
        if (getStyle(key)) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РІР¶Рµ С–СЃРЅСѓС”.`);
        wizard.style.key = key;
        wizard.step = "category";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "category") {
        wizard.style.category = text.trim() || "other";
        wizard.step = "title";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "title") {
        wizard.style.title = text.trim();
        wizard.step = wizard.style.type === "dynamic" ? "template" : "prompt";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "prompt") {
        wizard.style.prompt = text.trim();
        wizard.step = "preview";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "template") {
        wizard.style.template = text.trim();
        wizard.step = "selector_key";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "selector_key") {
        const selectorKey = normalizePromptKey(text);
        if (!selectorKey) return ctx.reply("вќЊ РќРµРєРѕСЂРµРєС‚РЅРёР№ selector key.");
        wizard.currentSelector = { key: selectorKey, label: "", type: "inline", options: {} };
        wizard.step = "selector_label";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "selector_label") {
        wizard.currentSelector.label = text.trim();
        wizard.style.selectors.push(wizard.currentSelector);
        wizard.step = "option_key";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "option_key") {
        const optionKey = normalizePromptKey(text);
        if (!optionKey) return ctx.reply("вќЊ РќРµРєРѕСЂРµРєС‚РЅРёР№ option key.");
        wizard.currentOption = { key: optionKey, label: "", variables: {} };
        wizard.step = "option_label";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "option_label") {
        wizard.currentOption.label = text.trim();
        wizard.step = "option_variables";
        return promptStyleWizardStep(ctx);
      }
      if (wizard.step === "option_variables") {
        try {
          const variables = JSON.parse(text);
          appendWizardSelectorOption(ctx, {
            ...wizard.currentOption,
            variables,
          });
          wizard.step = "selector_continue";
          return promptStyleWizardStep(ctx);
        } catch {
          return ctx.reply("вќЊ Variables РјР°СЋС‚СЊ Р±СѓС‚Рё РІР°Р»С–РґРЅРёРј JSON.");
        }
      }
    }

    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptEditKey) {
      const key = ctx.session.awaitingPromptEditKey; prompts[key] = text; savePrompts();
      ctx.session.awaitingPromptEditKey = null;
      return ctx.reply(`вњ… РџСЂРѕРјС‚ "${key}" РѕРЅРѕРІР»РµРЅРѕ.`, adminMenu());
    }
    if (isAdmin(ctx.from.id) && ctx.session.awaitingTextEditKey) {
      const key = ctx.session.awaitingTextEditKey; content[key] = text; saveContent();
      ctx.session.awaitingTextEditKey = null;
      return ctx.reply(`вњ… РўРµРєСЃС‚ "${key}" РѕРЅРѕРІР»РµРЅРѕ.`, adminMenu());
    }

    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptExamplesKey) {
      const lower = text.toLowerCase().trim();
      const key = ctx.session.awaitingPromptExamplesKey;
      const style = getPromptStyle(key);

      if (lower === "РіРѕС‚РѕРІРѕ") {
        ctx.session.awaitingPromptExamplesKey = null;
        const count = style ? getPromptExamplePhotos(style).length : 0;
        return ctx.reply(`вњ… Р¤РѕС‚Рѕ-РїСЂРёРєР»Р°РґРё РґР»СЏ "${key}" Р·Р±РµСЂРµР¶РµРЅРѕ: ${count}/${MAX_PROMPT_EXAMPLE_PHOTOS}.`, adminMenu());
      }

      if (lower === "РІРёРґР°Р»РёС‚Рё") {
        ctx.session.awaitingPromptExamplesKey = null;
        if (!style) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`, adminMenu());
        style.examplePhotos = [];
        style.previewPhoto = null;
        content.promptLibrary[key] = style;
        saveContent();
        return ctx.reply(`вњ… РЈСЃС– С„РѕС‚Рѕ-РїСЂРёРєР»Р°РґРё РґР»СЏ "${key}" РІРёРґР°Р»РµРЅРѕ.`, adminMenu());
      }
    }

    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptPreviewKey && text.toLowerCase().trim() === "РІРёРґР°Р»РёС‚Рё") {
      const key = ctx.session.awaitingPromptPreviewKey;
      const style = getPromptStyle(key);
      ctx.session.awaitingPromptPreviewKey = null;
      if (!style) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`, adminMenu());
      style.previewPhoto = null;
      content.promptLibrary[key] = style;
      saveContent();
      return ctx.reply(`вњ… Preview-С„РѕС‚Рѕ РґР»СЏ "${key}" РІРёРґР°Р»РµРЅРѕ.`, adminMenu());
    }

    // вњ… РђРґРјС–РЅ РЅР°РїРёСЃР°РІ "РІРёРґР°Р»РёС‚Рё" С‰РѕР± РїСЂРёР±СЂР°С‚Рё С„РѕС‚Рѕ
    if (isAdmin(ctx.from.id) && ctx.session.awaitingPhotoForKey && text.toLowerCase().trim() === "РІРёРґР°Р»РёС‚Рё") {
      const key = ctx.session.awaitingPhotoForKey;
      ctx.session.awaitingPhotoForKey = null;
      delete content[key];
      saveContent();
      return ctx.reply(`вњ… Р¤РѕС‚Рѕ "${key}" РІРёРґР°Р»РµРЅРѕ.`, adminMenu());
    }

    if ((ctx.session.customType === "custom_photo" || ctx.session.customType === "create_photo") && ctx.session.awaitingCustomPrompt) {
      clearPromptAttribution(ctx);
      ctx.session.customPrompt = text;
      ctx.session.awaitingCustomPrompt = false;

      if (ctx.session.customType === "create_photo") {
        const user = getUser(ctx.from.id);
        if (userGenerating.has(ctx.from.id)) return ctx.reply("вЏі Р—Р°С‡РµРєР°Р№, С‰Рµ РѕР±СЂРѕР±Р»СЏС”С‚СЊСЃСЏ...");
        userGenerating.add(ctx.from.id);
        enqueueGeneration(ctx.from.id, () => _processGeneration(ctx, user, ctx.from.id, "photo", null), "photo", ctx)
          .catch(e => {
            userGenerating.delete(ctx.from.id);
            console.error("CREATE PHOTO ENQUEUE ERROR:", e.message);
            ctx.reply("вќЊ РЎС‚Р°Р»Р°СЃСЏ РїРѕРјРёР»РєР°. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.").catch(() => {});
          });
        return;
      }
      return ctx.reply("РџСЂРѕРјС‚ Р·Р±РµСЂРµР¶РµРЅРѕ вњ…\nРќР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ рџ“ё", photoMenu());
    }

    if (ctx.session.awaitingCustomAmount) {
      const amount = parseInt(text);
      if (isNaN(amount) || amount < 50) {
        return ctx.reply("вќЊ РњС–РЅС–РјР°Р»СЊРЅР° СЃСѓРјР° 50 РіСЂРЅ. Р’РІРµРґРё С‡РёСЃР»Рѕ:", Markup.keyboard([["в†©пёЏ РќР°Р·Р°Рґ"]]).resize());
      }
      const promtiCount = Math.floor(amount / 9.9);
      if (promtiCount < 5) {
        return ctx.reply("вќЊ РњС–РЅС–РјСѓРј 50 РіСЂРЅ (5 Promti вњЁ). Р’РІРµРґРё Р±С–Р»СЊС€Сѓ СЃСѓРјСѓ:", Markup.keyboard([["в†©пёЏ РќР°Р·Р°Рґ"]]).resize());
      }
      ctx.session.awaitingCustomAmount = false;
      const tempKey = `custom_${Date.now()}`;
      dynamicPackages[tempKey] = {
        key: tempKey,
        type: "promti",
        title: `${promtiCount} Promti вњЁ`,
        promti: promtiCount,
        amount: amount,
        priceText: `${amount} РіСЂРЅ`,
        temporary: true,
      };
      saveDynamicPackages(); // вњ… Р·Р±РµСЂС–РіР°С”РјРѕ РЅР° РґРёСЃРє С‰РѕР± callback РјС–Рі Р·РЅР°Р№С‚Рё РїР°РєРµС‚ РЅР°РІС–С‚СЊ РїС–СЃР»СЏ СЂРµСЃС‚Р°СЂС‚Сѓ
      await ctx.reply(
        `рџ’Ћ РўРІС–Р№ РїР°РєРµС‚:\n${promtiCount} Promti вњЁ вЂ” ${amount} РіСЂРЅ\n\nРџРµСЂРµР№С‚Рё РґРѕ РѕРїР»Р°С‚Рё?`,
        Markup.inlineKeyboard([[Markup.button.callback("рџ’і РћРїР»Р°С‚РёС‚Рё", `pay_custom_${tempKey}`)]])
      );
      return;
    }

    if (ctx.session.mode === "video" && ctx.session.videoInputMode === "image" && !ctx.session.awaitingCustomPrompt) {
      clearPromptAttribution(ctx);
      ctx.session.customPrompt = text;
      const style = ctx.session.style;
      const menu = style === "kling" ? klingMenu() : seedanceMenu();
      return ctx.reply(`вњ… РџСЂРѕРјС‚ Р·Р±РµСЂРµР¶РµРЅРѕ: "${text}"\nРўРµРїРµСЂ РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ рџ“ё`, menu);
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
        if (userGenerating.has(ctx.from.id)) return ctx.reply("вЏі Р—Р°С‡РµРєР°Р№, С‰Рµ РѕР±СЂРѕР±Р»СЏС”С‚СЊСЃСЏ...");
        userGenerating.add(ctx.from.id);
        enqueueGeneration(ctx.from.id, () => _processGeneration(ctx, user, ctx.from.id, "video", null), "video", ctx)
          .catch(e => {
            userGenerating.delete(ctx.from.id);
            console.error("TEXT-TO-VIDEO ENQUEUE ERROR:", e.message);
            ctx.reply("вќЊ РЎС‚Р°Р»Р°СЃСЏ РїРѕРјРёР»РєР°. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.").catch(() => {});
          });
        return;
      }
      return ctx.reply("РџСЂРѕРјС‚ Р·Р±РµСЂРµР¶РµРЅРѕ вњ…\nРќР°РґС–С€Р»Рё СЃРІРѕС” С„РѕС‚Рѕ рџ“ё", menu);
    }
    return ctx.reply("РћР±РµСЂРё СЂРѕР·РґС–Р» С‡РµСЂРµР· РјРµРЅСЋ Р°Р±Рѕ /start", mainMenu());
  } catch (e) { console.error("TEXT HANDLER:", e.message); return ctx.reply("РџРѕРјРёР»РєР° рџў", mainMenu()); }
});

// в”Ђв”Ђв”Ђ РҐР•РќР”Р›Р•Р  Р¤РћРўРћ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.on("photo", async (ctx) => {
  ensureSession(ctx);
  const user   = touchUser(ctx);
  const userId = ctx.from.id;

  if (user.banned) return ctx.reply("рџљ« Р’Р°С€ Р°РєР°СѓРЅС‚ Р·Р°Р±Р»РѕРєРѕРІР°РЅРёР№.");

  const photo         = ctx.message.photo[ctx.message.photo.length - 1];

  if (isAdmin(userId) && ctx.session.styleWizard) {
    const wizard = ctx.session.styleWizard;
    if (wizard.step === "preview") {
      wizard.style.previewPhoto = photo.file_id;
      wizard.step = "examples";
      return promptStyleWizardStep(ctx);
    }
    if (wizard.step === "examples") {
      wizard.style.examplePhotos = normalizePromptExamplePhotos([
        ...(wizard.style.examplePhotos || []),
        photo.file_id,
      ]);
      if (wizard.style.examplePhotos.length >= MAX_PROMPT_EXAMPLE_PHOTOS) {
        wizard.step = "confirm";
        return promptStyleWizardStep(ctx);
      }
      return ctx.reply(
        `вњ… Р”РѕРґР°РЅРѕ РїСЂРёРєР»Р°Рґ ${wizard.style.examplePhotos.length}/${MAX_PROMPT_EXAMPLE_PHOTOS}. РќР°РґС–С€Р»Рё С‰Рµ С„РѕС‚Рѕ Р°Р±Рѕ РЅР°С‚РёСЃРЅРё done.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Done examples", "stylewizard_done_examples")],
          [Markup.button.callback("Skip examples", "stylewizard_skip_examples")],
        ])
      );
    }
  }

  // вњ… РђРґРјС–РЅ РїСЂРёРєСЂС–РїР»СЏС” С„РѕС‚Рѕ РґРѕ С‚РµРєСЃС‚РѕРІРѕРіРѕ РєР»СЋС‡Р° (welcomePhoto/infoPhoto С‚РѕС‰Рѕ)
  if (isAdmin(userId) && ctx.session.awaitingPhotoForKey) {
    const key = ctx.session.awaitingPhotoForKey;
    ctx.session.awaitingPhotoForKey = null;
    content[key] = photo.file_id;
    saveContent();
    return ctx.reply(`вњ… Р¤РѕС‚Рѕ РїСЂРёРєСЂС–РїР»РµРЅРѕ РґРѕ "${key}".\n\nРџРµСЂРµРІС–СЂ СЏРє РІРёРіР»СЏРґР°С” вЂ” РЅР°С‚РёСЃРЅРё РІС–РґРїРѕРІС–РґРЅСѓ РєРЅРѕРїРєСѓ РІ РіРѕР»РѕРІРЅРѕРјСѓ РјРµРЅСЋ.`, adminMenu());
  }

  if (isAdmin(userId) && ctx.session.awaitingPromptPreviewKey) {
    const key = ctx.session.awaitingPromptPreviewKey;
    const style = getPromptStyle(key);
    ctx.session.awaitingPromptPreviewKey = null;
    if (!style) return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`, adminMenu());
    style.previewPhoto = photo.file_id;
    content.promptLibrary[key] = style;
    saveContent();
    return ctx.reply(`вњ… Preview-С„РѕС‚Рѕ РґР»СЏ СЃС‚РёР»СЋ "${key}" Р·Р±РµСЂРµР¶РµРЅРѕ.`, adminMenu());
  }

  if (isAdmin(userId) && ctx.session.awaitingPromptExamplesKey) {
    const key = ctx.session.awaitingPromptExamplesKey;
    const style = getPromptStyle(key);
    if (!style) {
      ctx.session.awaitingPromptExamplesKey = null;
      return ctx.reply(`вќЊ РЎС‚РёР»СЊ "${key}" РЅРµ Р·РЅР°Р№РґРµРЅРѕ.`, adminMenu());
    }

    const examples = getPromptExamplePhotos(style);
    if (examples.length >= MAX_PROMPT_EXAMPLE_PHOTOS) {
      ctx.session.awaitingPromptExamplesKey = null;
      return ctx.reply(`Р›С–РјС–С‚ РґРѕСЃСЏРіРЅСѓС‚Рѕ: ${MAX_PROMPT_EXAMPLE_PHOTOS}/${MAX_PROMPT_EXAMPLE_PHOTOS}.`, adminMenu());
    }

    style.examplePhotos = [...examples, photo.file_id].slice(0, MAX_PROMPT_EXAMPLE_PHOTOS);
    if (!style.previewPhoto) style.previewPhoto = style.examplePhotos[0] || null;
    content.promptLibrary[key] = style;
    saveContent();

    const count = style.examplePhotos.length;
    if (count >= MAX_PROMPT_EXAMPLE_PHOTOS) {
      ctx.session.awaitingPromptExamplesKey = null;
      return ctx.reply(`вњ… Р”РѕРґР°РЅРѕ С„РѕС‚Рѕ ${count}/${MAX_PROMPT_EXAMPLE_PHOTOS}. Р›С–РјС–С‚ Р·Р°РїРѕРІРЅРµРЅРѕ.`, adminMenu());
    }

    return ctx.reply(`вњ… Р”РѕРґР°РЅРѕ С„РѕС‚Рѕ ${count}/${MAX_PROMPT_EXAMPLE_PHOTOS} РґР»СЏ СЃС‚РёР»СЋ "${key}". РќР°РґС–С€Р»Рё С‰Рµ Р°Р±Рѕ РЅР°РїРёС€Рё "РіРѕС‚РѕРІРѕ".`, adminMenu());
  }

  const validationErr = validatePhoto(photo);
  if (validationErr) return ctx.reply(validationErr);

  if (!isAdmin(userId) && checkPhotoSpam(userId)) {
    return ctx.reply("вљ пёЏ РќР°РґС‚Рѕ Р±Р°РіР°С‚Рѕ С„РѕС‚Рѕ РїС–РґСЂСЏРґ. Р—Р°С‡РµРєР°Р№ РєС–Р»СЊРєР° СЃРµРєСѓРЅРґ.");
  }

  if (ctx.session.awaitingAiPrompt) {
    const aiMode = ctx.session.awaitingAiPrompt;
    if (!isAdmin(userId)) {
      const secs = checkRateLimit(userId, "ai");
      if (secs > 0) return ctx.reply(`вЏі Р—Р°С‡РµРєР°Р№ ${secs} СЃРµРє. РїРµСЂРµРґ РЅР°СЃС‚СѓРїРЅРёРј AI-РїСЂРѕРјС‚РѕРј.`);
      const aiDailyErr = checkDailyAiLimit(user);
      if (aiDailyErr) return ctx.reply(aiDailyErr, ctx.session.mode === "video" ? videoMenu() : photoMenu());
      incrementDailyAi(user); saveUsers();
    }
    touchRateLimit(userId, "ai");
    ctx.session.awaitingAiPrompt = null;
    await ctx.reply("рџ¤– РђРЅР°Р»С–Р·СѓСЋ С„РѕС‚Рѕ...");
    try {
      const image     = await getImage(ctx, photo.file_id);
      const suggested = await generateAiPrompt(image, aiMode);
      if (!suggested) return ctx.reply("вќЊ РќРµ РІРґР°Р»РѕСЃСЏ Р·РіРµРЅРµСЂСѓРІР°С‚Рё РїСЂРѕРјС‚. РЎРїСЂРѕР±СѓР№ вњЌпёЏ РЎРІС–Р№ РїСЂРѕРјС‚.", aiMode === "video" ? videoMenu() : photoMenu());
      ctx.session.customPrompt     = suggested;
      ctx.session.customType       = aiMode === "video" ? `custom_video_${ctx.session.style || "seedance"}` : "custom_photo";
      ctx.session.awaitingCustomPrompt = false;
      const label = aiMode === "video" ? (ctx.session.style === "kling" ? "рџЋҐ Kling" : "рџЋ¬ Seedance") : "рџ–ј Р¤РѕС‚Рѕ";
      return ctx.reply(
        `рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ ${label}:\n\nрџ“ќ <code>${escapeHtml(suggested)}</code>\n\nРќР°РґС–С€Р»Рё С„РѕС‚Рѕ С‰Рµ СЂР°Р· вЂ” РїСЂРѕРјС‚ Р±СѓРґРµ Р·Р°СЃС‚РѕСЃРѕРІР°РЅРѕ.`,
        { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("вњ… Р—Р°СЃС‚РѕСЃСѓРІР°С‚Рё", `apply_ai_prompt_${aiMode}`)], [Markup.button.callback("рџ”„ РќРѕРІРёР№ РІР°СЂС–Р°РЅС‚", `regen_ai_prompt_${aiMode}`)]]).reply_markup }
      );
    } catch (e) {
      console.error("AI PROMPT HANDLER:", e.message);
      return ctx.reply("вќЊ РџРѕРјРёР»РєР° Р°РЅР°Р»С–Р·Сѓ. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.", aiMode === "video" ? videoMenu() : photoMenu());
    }
  }

  if (userGenerating.has(userId)) return ctx.reply("вЏі Р—Р°С‡РµРєР°Р№, С‚РІРѕС” С„РѕС‚Рѕ С‰Рµ РѕР±СЂРѕР±Р»СЏС”С‚СЊСЃСЏ...");

  if (!isAdmin(userId)) {
    const mode = ctx.session.mode;
    const secs = checkRateLimit(userId, mode === "video" ? "video" : "photo");
    if (secs > 0) return ctx.reply(`вЏі Р—Р°С‡РµРєР°Р№ С‰Рµ ${secs} СЃРµРє.`);
  }

  const MAX_QUEUE = 50;
  const currentQueue = ctx.session.mode === "video" ? videoQueue : photoQueue;
  if (currentQueue.length >= MAX_QUEUE) return ctx.reply("вљ пёЏ РЎРµСЂРІС–СЃ Р·Р°СЂР°Р· РїРµСЂРµРІР°РЅС‚Р°Р¶РµРЅРёР№. РЎРїСЂРѕР±СѓР№ С‡РµСЂРµР· РєС–Р»СЊРєР° С…РІРёР»РёРЅ.");

  userGenerating.add(userId);

  const genType = ctx.session.mode === "video" ? "video" : "photo";
  enqueueGeneration(userId, () => _processGeneration(ctx, user, userId, ctx.session.mode, photo), genType, ctx)
    .catch(e => {
      userGenerating.delete(userId);
      console.error("ENQUEUE ERROR:", e.message);
      ctx.reply("вќЊ РЎС‚Р°Р»Р°СЃСЏ РїРѕРјРёР»РєР°. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.").catch(() => {});
    });
});

// в”Ђв”Ђв”Ђ РџР РћР¦Р•РЎРРќР“ Р“Р•РќР•Р РђР¦Р†Р‡ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function _processGeneration(ctx, user, userId, mode, photo) {
  const cfg = loadSettings();
  let chargedFromBalance = false;
  const startMs          = Date.now();

  try {
    touchRateLimit(userId, mode === "video" ? "video" : "photo");

    // в•ђв•ђ Р’Р†Р”Р•Рћ в•ђв•ђ
    if (mode === "video") {
      const videoStyle = ctx.session.style;
      if (!videoStyle) { userGenerating.delete(userId); return ctx.reply("РћР±РµСЂРё РјРѕРґРµР»СЊ: рџЋ¬ Seedance Р°Р±Рѕ рџЋҐ Kling", videoMenu()); }
      if (ctx.session.awaitingCustomPrompt) { userGenerating.delete(userId); return ctx.reply("РЎРїРѕС‡Р°С‚РєСѓ РЅР°РїРёС€Рё РїСЂРѕРјС‚ С‚РµРєСЃС‚РѕРј.", videoMenu()); }

      if (!isAdmin(userId)) {
        const dailyErr = checkDailyVideoLimit(user, videoStyle);
        if (dailyErr) { userGenerating.delete(userId); return ctx.reply(dailyErr, videoMenu()); }
        const videoCost = videoStyle === "kling" ? PROMTI_PRICES.kling : PROMTI_PRICES.seedance;
        if ((user.promti || 0) < videoCost) {
          userGenerating.delete(userId);
          return ctx.reply(
            `вќЊ РќРµРґРѕСЃС‚Р°С‚РЅСЊРѕ Promti вњЁ\n\nРџРѕС‚СЂС–Р±РЅРѕ: ${videoCost} Promti вњЁ\nР‘Р°Р»Р°РЅСЃ: ${user.promti || 0} Promti вњЁ\n\nрџ’і РљСѓРїРё РїР°РєРµС‚ Promti`,
            videoStyle === "kling" ? klingMenu() : seedanceMenu()
          );
        }
        user.promti -= videoCost; chargedFromBalance = true; saveUsersSync();
      }

      const prompt       = ctx.session.customPrompt || prompts[videoStyle];
      const videoInputMode = ctx.session.videoInputMode || "image";
      const stopProgress = startVideoProgress(ctx);
      const modeLabel = videoInputMode === "text" ? "Р· С‚РµРєСЃС‚Сѓ" : "Р· С„РѕС‚Рѕ";
      await ctx.reply(`вЏі Р“РµРЅРµСЂСѓСЋ ${videoStyle === "seedance" ? "Seedance" : "Kling"} РІС–РґРµРѕ ${modeLabel}...\nР¦Рµ Р·Р°Р№РјРµ 1-8 С…РІ вЊ›`);

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
              throw new Error("imageUrl invalid or fallback base64 вЂ” upload failed");
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
        if (!videoUrl) throw new Error("fal РЅРµ РїРѕРІРµСЂРЅСѓРІ РІС–РґРµРѕ");

        if (!isAdmin(userId)) incrementDailyVideo(user, videoStyle);
        if (videoStyle === "seedance") user.seedanceGenerations = (user.seedanceGenerations || 0) + 1;
        else user.klingGenerations = (user.klingGenerations || 0) + 1;
        saveUsersSync();
        userGenerating.delete(userId);

        log("VIDEO_OK", userId, `model:${videoStyle} dur:${Date.now()-startMs}ms`);
        appendLog({ type: "video", model: videoStyle, userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });

        const caption = isAdmin(userId)
          ? `рџЋ¬ Р’С–РґРµРѕ РіРѕС‚РѕРІРµ вњЁ\nРњРѕРґРµР»СЊ: ${videoStyle}\nРђРґРјС–РЅ: Р±РµР·Р»С–РјС–С‚ вњ…`
          : `рџЋ¬ Р’С–РґРµРѕ РіРѕС‚РѕРІРµ вњЁ\nР—Р°Р»РёС€РёР»РѕСЃСЊ: ${user.promti || 0} Promti вњЁ`;

        await tgSendWithRetry(() => ctx.replyWithVideo({ url: videoUrl }, { caption }));

        if (!isAdmin(userId) && (user.promti || 0) <= 5) {
          await ctx.reply(
            `рџ’Ў Р—Р°Р»РёС€РёР»РѕСЃСЊ ${user.promti || 0} Promti вњЁ. РџРѕРїРѕРІРЅРё Р±Р°Р»Р°РЅСЃ!`,
            Markup.inlineKeyboard([[Markup.button.callback("рџ’Ћ РљСѓРїРёС‚Рё Promti вњЁ", "upsell_promti")]])
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

    // в•ђв•ђ Р¤РћРўРћ в•ђв•ђ
    const customType = ctx.session.customType;
    const photoMode  = ctx.session.photoMode || "edit";
    let prompt = "";
    let promptKeyForStats = null;

    if (customType === "custom_photo" || customType === "create_photo") {
      if (!ctx.session.customPrompt) { userGenerating.delete(userId); return ctx.reply("РЎРїРѕС‡Р°С‚РєСѓ РЅР°РїРёС€Рё РїСЂРѕРјС‚ С‚РµРєСЃС‚РѕРј.", photoMenu()); }
      prompt = ctx.session.customPrompt;
      const selectedStyleKey =
        ctx.session.currentStyleKey ||
        ctx.session.sourceStyleKey ||
        ctx.session.currentPromptKey ||
        ctx.session.sourcePromptKey ||
        user.sourceStyleKey ||
        user.sourcePromptKey;
      const selectedStyle = getStyle(selectedStyleKey);
      const selectedSelections =
        ctx.session.currentDynamicSelections ||
        ctx.session.sourceDynamicSelections ||
        user.sourceDynamicSelections ||
        {};
      if (selectedStyle) {
        const expectedPrompt = selectedStyle.type === "dynamic"
          ? buildDynamicPrompt(selectedStyle, selectedSelections)
          : selectedStyle.prompt;
        if (expectedPrompt === prompt) {
          promptKeyForStats = selectedStyle.key;
        }
      }
    } else {
      userGenerating.delete(userId);
      return ctx.reply("РћР±РµСЂРё СЂРµР¶РёРј: рџ–ј Р РµРґР°РіСѓРІР°С‚Рё С„РѕС‚Рѕ Р°Р±Рѕ вњЁ РЎС‚РІРѕСЂРёС‚Рё С„РѕС‚Рѕ", photoMenu());
    }

    if (!isAdmin(userId)) {
      const photoCost = PROMTI_PRICES.photo;
      if ((user.promti || 0) < photoCost) {
        userGenerating.delete(userId);
        return ctx.reply(
          `вќЊ РќРµРґРѕСЃС‚Р°С‚РЅСЊРѕ Promti вњЁ\n\nРџРѕС‚СЂС–Р±РЅРѕ: ${photoCost} Promti вњЁ\nР‘Р°Р»Р°РЅСЃ: ${user.promti || 0} Promti вњЁ\n\nрџ’і РљСѓРїРё РїР°РєРµС‚ Promti`,
          photoMenu()
        );
      }
      user.promti -= photoCost;
      chargedFromBalance = true;
      saveUsersSync();
    }

    let url = null;

    if (photoMode === "create") {
      await ctx.reply("вЏі РЎС‚РІРѕСЂСЋСЋ С„РѕС‚Рѕ Р· РЅСѓР»СЏ... (~45 СЃРµРє)");
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
      await ctx.reply("вЏі Р РµРґР°РіСѓСЋ С„РѕС‚Рѕ... (~45 СЃРµРє)");
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

    if (!url) throw new Error("fal РЅРµ РїРѕРІРµСЂРЅСѓРІ Р·РѕР±СЂР°Р¶РµРЅРЅСЏ");

    user.generations = (user.generations || 0) + 1;
    if (promptKeyForStats) markPromptGeneration(user, promptKeyForStats, ctx.session.currentDynamicSelections || ctx.session.sourceDynamicSelections || user.sourceDynamicSelections || null);
    saveUsersSync();
    userGenerating.delete(userId);
    log("PHOTO_OK", userId, `dur:${Date.now()-startMs}ms`);
    appendLog({ type: "photo", model: customType || "custom", userId, prompt, success: true, durationMs: Date.now() - startMs, createdAt: new Date().toISOString() });

    const caption = isAdmin(userId) ? "Р“РѕС‚РѕРІРѕ вњЁ\nРђРґРјС–РЅ: Р±РµР·Р»С–РјС–С‚ вњ…" : `Р“РѕС‚РѕРІРѕ вњЁ\nР—Р°Р»РёС€РёР»РѕСЃСЊ: ${user.promti || 0} Promti вњЁ`;
    await tgSendWithRetry(() => sendPhotoWithSafeCaption({
      photo: { url },
      text: caption,
      sendPhoto: (photo, options) => ctx.replyWithPhoto(photo, options),
      sendText: (message, options) => ctx.reply(message, options),
      logLabel: "generation.replyWithPhoto",
    }));

    if (!isAdmin(userId) && user.generations % 3 === 0) {
      await ctx.reply(
        "рџ’Ў РҐРѕС‡РµС€ РѕР¶РёРІРёС‚Рё С†Рµ С„РѕС‚Рѕ? РЎРїСЂРѕР±СѓР№ РІС–РґРµРѕ-РіРµРЅРµСЂР°С†С–СЋ!",
        Markup.inlineKeyboard([[Markup.button.callback("рџЋ¬ Seedance", "upsell_promti"), Markup.button.callback("рџЋҐ Kling", "upsell_promti")]])
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
    if (e.message === "FAL_TIMEOUT") return ctx.reply("вЏ± Р—Р°РЅР°РґС‚Рѕ РґРѕРІРіРѕ. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.");
    return ctx.reply("вќЊ РџРѕРјРёР»РєР° РіРµРЅРµСЂР°С†С–С—. РЎРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·.");
  }
}

// в”Ђв”Ђв”Ђ РҐР•РќР”Р›Р•Р  Р’Р†Р”Р•Рћ (РґР»СЏ AI-РїСЂРѕРјС‚Сѓ) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
bot.on(["video", "video_note"], async (ctx) => {
  ensureSession(ctx); touchUser(ctx);
  if (ctx.session.awaitingAiPrompt !== "video") {
    return ctx.reply("рџЋ¬ Р”Р»СЏ РіРµРЅРµСЂР°С†С–С— РїСЂРѕРјС‚Сѓ вЂ” РЅР°С‚РёСЃРЅРё рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ РІС–РґРµРѕ\nР”Р»СЏ РіРµРЅРµСЂР°С†С–С— вЂ” РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ.", videoMenu());
  }
  const videoObj = ctx.message.video || ctx.message.video_note;
  if ((videoObj.duration || 0) > 10) return ctx.reply("вќЊ Р’С–РґРµРѕ РґРѕ 10 СЃРµРє. РђР±Рѕ РЅР°РґС–С€Р»Рё С„РѕС‚Рѕ.", videoMenu());
  ctx.session.awaitingAiPrompt = null;
  await ctx.reply("рџЋ¬ РђРЅР°Р»С–Р·СѓСЋ РІС–РґРµРѕ...");
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
      return ctx.reply("вќЊ ffmpeg РЅРµРґРѕСЃС‚СѓРїРЅРёР№. РќР°РґС–С€Р»Рё С„РѕС‚Рѕ Р·Р°РјС–СЃС‚СЊ РІС–РґРµРѕ рџ“ё", videoMenu());
    }
    const frameBase64 = `data:image/jpeg;base64,${fs.readFileSync(tmpFrame).toString("base64")}`;
    try { fs.unlinkSync(tmpVideo); fs.unlinkSync(tmpFrame); } catch {}
    const suggested = await generateAiPrompt(frameBase64, "video");
    if (!suggested) return ctx.reply("вќЊ РќРµ РІРґР°Р»РѕСЃСЏ Р·РіРµРЅРµСЂСѓРІР°С‚Рё РїСЂРѕРјС‚. РЎРїСЂРѕР±СѓР№ РЅР°РґС–СЃР»Р°С‚Рё С„РѕС‚Рѕ.", videoMenu());
    ctx.session.customPrompt     = suggested;
    ctx.session.customType       = `custom_video_${ctx.session.style || "seedance"}`;
    ctx.session.awaitingCustomPrompt = false;
    const label = ctx.session.style === "kling" ? "рџЋҐ Kling" : "рџЋ¬ Seedance";
    return ctx.reply(
      `рџ¤– AI РїСЂРѕРјС‚ РґР»СЏ ${label}:\n\nрџ“ќ <code>${escapeHtml(suggested)}</code>\n\nвњ… РџСЂРѕРјС‚ Р·Р±РµСЂРµР¶РµРЅРѕ. РќР°РґС–С€Р»Рё С„РѕС‚Рѕ РґР»СЏ РіРµРЅРµСЂР°С†С–С— РІС–РґРµРѕ рџ“ё`,
      { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("вњ… Р—Р°СЃС‚РѕСЃСѓРІР°С‚Рё", "apply_ai_prompt_video")], [Markup.button.callback("рџ”„ РќРѕРІРёР№ РІР°СЂС–Р°РЅС‚", "regen_ai_prompt_video")]]).reply_markup }
    );
  } catch (e) {
    console.error("VIDEO AI PROMPT ERROR:", e.message);
    return ctx.reply("вќЊ РџРѕРјРёР»РєР° РѕР±СЂРѕР±РєРё РІС–РґРµРѕ. РЎРїСЂРѕР±СѓР№ РЅР°РґС–СЃР»Р°С‚Рё С„РѕС‚Рѕ.", videoMenu());
  }
});

// в”Ђв”Ђв”Ђ EXPRESS / HTTP в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
app.get("/admin",  (_, res) => res.sendFile(path.join(__dirname, "admin.html")));
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
      const imageUrl = saveLandingImageUpload(fileName, dataUrl);
      return res.json({ ok: true, imageUrl });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message || "UPLOAD_FAILED" });
    }
  }
);
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

// в”Ђв”Ђв”Ђ WAYFORPAY CALLBACK в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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

      log("CREDITED", userId, `pack:${packKey} +${promtiAmount} amount:${data.amount}РіСЂРЅ`);
      console.log(`вњ… CREDITED: user ${userId}, pack ${packKey}, +${promtiAmount}`);

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
              `рџЋ‰ РўРІС–Р№ РґСЂСѓРі Р·СЂРѕР±РёРІ РїРµСЂС€Сѓ РѕРїР»Р°С‚Сѓ!\n+${REFERRAL_PROMTI_BONUS} Promti вњЁ РЅР°СЂР°С…РѕРІР°РЅРѕ\nР‘Р°Р»Р°РЅСЃ: ${referrer.promti} Promti вњЁ`
            );
          } catch (e) { console.error("REFERRAL BONUS NOTIFY:", e.message); }
          log("REFERRAL_BONUS", user.referredBy, `from user:${userId} +${REFERRAL_PROMTI_BONUS} вњЁ`);
        }
      }

      try {
        await bot.telegram.sendMessage(
          userId,
          `вњ… РћРїР»Р°С‚Сѓ РїС–РґС‚РІРµСЂРґР¶РµРЅРѕ!\n\nвњЁ ${pack.title}\nРќР°СЂР°С…РѕРІР°РЅРѕ: +${promtiAmount} Promti вњЁ\nР‘Р°Р»Р°РЅСЃ: ${user.promti} Promti вњЁ`,
          mainMenu()
        );
      } catch (e) { console.error("SEND USER MSG:", e.message); }

      for (const adminId of ADMINS) {
        try {
          await bot.telegram.sendMessage(
            adminId,
            `вњ… РћРїР»Р°С‚Р°!\nUser: ${userId} @${user.username || "-"}\n${pack.title} | ${data.amount} РіСЂРЅ\n${data.orderReference}`
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

// в”Ђв”Ђв”Ђ Р—РђРџРЈРЎРљ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  const cfg = loadSettings();
  console.log(`рџЊђ HTTP on port ${PORT}`);
  console.log(`рџ“Ў WFP Callback: ${WAYFORPAY.serviceUrl || "РќР• Р—РђР”РђРќРћ!"}`);
  console.log(`вљ™пёЏ  maxWorkers: ${cfg.maxWorkers} | photoRL: ${cfg.photoRateLimitMs}ms | videoRL: ${cfg.videoRateLimitMs}ms`);
  console.log(`рџ“… Seedance limit/day: ${cfg.dailySeedanceLimit} | Kling: ${cfg.dailyKlingLimit}`);
  console.log(`рџ¤– AI РїСЂРѕРјС‚: ${cfg.aiPromptEnabled ? "вњ…" : "вќЊ"} | Anthropic key: ${process.env.ANTHROPIC_API_KEY ? "вњ…" : "вќЊ"}`);
});

// в”Ђв”Ђв”Ђ BACKUP РљРћР–РќР† 6 Р“РћР”РРќ в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
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
    console.log(`рџ’ѕ Backup done: ${ts}`);
  } catch (e) { console.error("BACKUP ERROR:", e.message); }
}

setInterval(runBackup, 6 * 60 * 60 * 1000);

bot.launch({
  dropPendingUpdates: true,
  allowedUpdates: ["message", "callback_query"],
})
  .then(() => {
    console.log("рџ”Ґ Р‘РѕС‚ Р·Р°РїСѓС‰РµРЅРёР№ (v5 fixed)");
    runBackup();
  })
  .catch(err => {
    console.error("BOT LAUNCH ERROR:", err.message);
    if (err.message && err.message.includes("timed out")) {
      console.log("рџ”„ Retrying bot launch in 5s...");
      setTimeout(() => {
        bot.launch({ dropPendingUpdates: true })
          .then(() => console.log("рџ”Ґ Р‘РѕС‚ Р·Р°РїСѓС‰РµРЅРёР№ РїС–СЃР»СЏ retry"))
          .catch(e => console.error("BOT RETRY ERROR:", e.message));
      }, 5000);
    }
  });

// в”Ђв”Ђв”Ђ GRACEFUL SHUTDOWN в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
async function gracefulShutdown(signal) {
  console.log(`вЏі ${signal} вЂ” С‡РµРєР°С”РјРѕ Р·Р°РІРµСЂС€РµРЅРЅСЏ РіРµРЅРµСЂР°С†С–Р№...`);

  for (const adminId of ADMINS) {
    bot.telegram.sendMessage(adminId, `вљ пёЏ Р‘РѕС‚ РїРµСЂРµР·Р°РїСѓСЃРєР°С”С‚СЊСЃСЏ (${signal})\nРђРєС‚РёРІРЅРёС… РіРµРЅРµСЂР°С†С–Р№: ${activeWorkers}`).catch(() => {});
  }

  const maxWait = 5 * 60 * 1000;
  const start   = Date.now();

  while (activeWorkers > 0 && Date.now() - start < maxWait) {
    console.log(`вЏі РђРєС‚РёРІРЅРёС… РіРµРЅРµСЂР°С†С–Р№: ${activeWorkers}, С‡РµРєР°С”РјРѕ...`);
    await new Promise(r => setTimeout(r, 3000));
  }

  if (activeWorkers > 0) {
    console.log(`вљ пёЏ РўР°Р№РјР°СѓС‚ РѕС‡С–РєСѓРІР°РЅРЅСЏ вЂ” Р·СѓРїРёРЅСЏС”РјРѕСЃСЊ Р· ${activeWorkers} Р°РєС‚РёРІРЅРёРјРё РіРµРЅРµСЂР°С†С–СЏРјРё`);
    for (const userId of userGenerating) {
      const user = users[userId];
      if (user) {
        bot.telegram.sendMessage(
          userId,
          "вљ пёЏ Р“РµРЅРµСЂР°С†С–СЋ РїРµСЂРµСЂРІР°РЅРѕ С‡РµСЂРµР· РѕРЅРѕРІР»РµРЅРЅСЏ Р±РѕС‚Р°.\nР‘Р°Р»Р°РЅСЃ Р·Р±РµСЂРµР¶РµРЅРѕ вЂ” СЃРїСЂРѕР±СѓР№ С‰Рµ СЂР°Р·!"
        ).catch(() => {});
      }
    }
    saveUsersSync();
  }

  console.log("вњ… Р—Р°РІРµСЂС€РµРЅРѕ вЂ” Р·СѓРїРёРЅСЏС”РјРѕСЃСЊ.");
  bot.stop(signal);
  process.exit(0);
}

process.once("SIGINT",  () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGUSR2", () => gracefulShutdown("SIGUSR2"));
