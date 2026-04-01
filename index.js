require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const axios = require("axios");
const { Telegraf, Markup, session } = require("telegraf");
const { fal } = require("@fal-ai/client");

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

fal.config({
  credentials: process.env.FAL_KEY,
});

// ===================== НАЛАШТУВАННЯ =====================
const ADMINS = [346101852, 688515215];

const WAYFORPAY = {
  merchantAccount: process.env.WAYFORPAY_MERCHANT,
  secretKey: process.env.WAYFORPAY_SECRET,
  domainName: process.env.WAYFORPAY_DOMAIN || "https://promti-bot.onrender.com",
  returnUrl: process.env.WAYFORPAY_RETURN_URL || "https://t.me/Promtiai_bot",
  serviceUrl:
    process.env.WAYFORPAY_SERVICE_URL ||
    "https://promti-bot.onrender.com/payment",
};

if (!WAYFORPAY.merchantAccount || !WAYFORPAY.secretKey) {
  throw new Error("WAYFORPAY_MERCHANT and WAYFORPAY_SECRET are required");
}

const PROMPTS_CHANNEL_URL = "https://t.me/promteamai";
const SUPPORT_URL = "https://t.me/promteamai?direct";

const DB_PATH = path.join(__dirname, "bot_data.json");

// ===================== ПОЧАТКОВІ ТЕКСТИ =====================
const DEFAULT_INFO_TEXT = `ℹ️ Інформація про сервіс

Назва: PROMTI AI Bot

Опис:
Сервіс надає цифрові послуги з генерації зображень за допомогою штучного інтелекту.
Користувачі можуть створювати фото у різних стилях та сценаріях.

💳 Перелік послуг:
1. Генерація 10 зображень — 99 грн
Опис: пакет доступу до створення 10 AI-зображень у боті.

2. Генерація 20 зображень — 179 грн
Опис: пакет доступу до створення 20 AI-зображень у боті.

3. Генерація 30 зображень — 249 грн
Опис: пакет доступу до створення 30 AI-зображень у боті.

🎁 1 фото надається безкоштовно для тесту.

📍 Контактні дані:
Підтримка в Telegram: ${SUPPORT_URL}
Email: gammahanna93@gmail.com
Телефон: +380995211343
Адреса: Харківська обл., м. Дергачі, вул. Садова

👤 Інформація про власника:
ФОП Островерх Ганна Євгенівна
Статус: зареєстровано
Реєстраційний номер: 2010350000000480320
Дата реєстрації: 10.01.2024

📌 Важливо:
Послуга є цифровою.
Після оплати доступ до генерації надається миттєво або після підтвердження оплати адміністратором.

❓ Команди:
/start — запуск бота
/help — допомога
/info — інформація`;

const DEFAULT_HELP_TEXT = `❓ Допомога

Як користуватись ботом:

1. Обери режим генерації
2. Надішли фото
3. Отримай готовий результат

Розділи бота:
✨ ВАУ режими
🎨 Класичні стилі
✍️ Свій промт
🧠 Ідея → промт
📦 Пакети
💳 Купити
📊 Баланс
💎 Статуси

💳 Пакети:
10 фото — 99 грн
20 фото — 179 грн
30 фото — 249 грн

🎁 1 фото — безкоштовно для тесту

Якщо виникла проблема з оплатою або генерацією, напиши в чат допомоги:
${SUPPORT_URL}`;

const DEFAULT_PACKAGES_TEXT = `📦 Пакети послуг

1. 10 фото — 99 грн
Пакет доступу до створення 10 AI-зображень.

2. 20 фото — 179 грн
Пакет доступу до створення 20 AI-зображень.

3. 30 фото — 249 грн
Пакет доступу до створення 30 AI-зображень.

Для оплати натисни кнопку "💳 Купити".`;

const DEFAULT_STATUSES_INFO_TEXT = `✨ Статуси та привілеї

У нашому боті діє система статусів для активних користувачів.
Чим більше ви користуєтесь ботом, тим більше переваг відкривається.

🆓 Новачок
Після старту ви отримуєте:
• 1 безкоштовну генерацію
• доступ до базових режимів
• можливість протестувати якість сервісу

🔥 Активний
Після першої активності у боті та кількох генерацій ви отримуєте:
• доступ до платних режимів
• повний функціонал стандартного користувача
• участь у системі статусів і бонусів

👑 Premium
Для активних користувачів відкриваються:
• пріоритетна обробка генерацій
• ексклюзивні режими
• ранній доступ до оновлень
• бонуси та спеціальні пропозиції

💠 VIP
Найвищий рівень привілеїв:
• максимальний пріоритет
• доступ до спеціальних режимів
• бонусні можливості
• першочерговий доступ до новинок

Статуси надаються автоматично залежно від активності в боті:
• Новачок — до 5 генерацій
• Активний — від 6 генерацій
• Premium — від 21 генерації
• VIP — від 51 генерації

Важливо

Наявність статусу не скасовує правил користування ботом.
У разі технічних оновлень, змін тарифів або функціоналу перелік привілеїв може бути оновлений.`;

// ===================== UI ТЕКСТИ =====================
const DEFAULT_UI_TEXTS = {
  wowMenu: "✨ ВАУ режими",
  classicMenu: "🎨 Класичні стилі",
  surprise: "🎲 Здивуй мене",
  ideaToPrompt: "🧠 Ідея → промт",
  customPrompt: "✍️ Свій промт",
  packages: "📦 Пакети",
  buy: "💳 Купити",
  balance: "📊 Баланс",
  promptIdeas: "💡 Ідеї промтів",
  support: "🆘 Підтримка",
  info: "ℹ️ Інформація",
  statuses: "💎 Статуси",
  myStatus: "💎 Мій статус",
  statusesInfo: "ℹ️ Інформація про статус",
  back: "↩️ Назад",
};

// ===================== РЕЖИМИ =====================
const MODE_DEFAULTS = {
  portrait: {
    label: "👩 Портрет",
    prompt:
      "ultra realistic portrait, studio lighting, preserve face, do not change identity",
    group: "classic",
    access: "all",
  },
  beauty: {
    label: "💄 Б'юті",
    prompt:
      "beauty editorial, glossy skin, preserve face, do not change identity",
    group: "classic",
    access: "all",
  },
  fashion: {
    label: "📸 Fashion",
    prompt:
      "high fashion photoshoot, preserve face, do not change identity",
    group: "classic",
    access: "all",
  },
  art: {
    label: "🎨 Арт",
    prompt:
      "digital art, artistic portrait, preserve face, do not change identity",
    group: "classic",
    access: "all",
  },
  trend: {
    label: "🔥 Тренд",
    prompt:
      "viral instagram aesthetic, preserve face, do not change identity",
    group: "classic",
    access: "all",
  },

  heartbreak: {
    label: "💔 Після розставання",
    prompt:
      "cinematic emotional portrait after breakup, elegant sadness, soft dramatic light, aesthetic mood, realistic face, preserve identity",
    group: "wow",
    access: "all",
  },
  millionaire: {
    label: "👑 Як мільйонер",
    prompt:
      "luxury millionaire lifestyle portrait, premium interior, expensive aesthetic, confident look, high-end editorial style, preserve identity",
    group: "wow",
    access: "all",
  },
  dark_version: {
    label: "🎭 Темна версія мене",
    prompt:
      "dark alter ego portrait, moody shadows, dramatic cinematic contrast, mysterious atmosphere, preserve identity",
    group: "wow",
    access: "all",
  },
  soft_girl: {
    label: "🌸 Soft girl aesthetic",
    prompt:
      "soft girl aesthetic, pastel tones, dreamy lighting, delicate makeup, romantic mood, preserve identity",
    group: "wow",
    access: "all",
  },
  tiktok_trend: {
    label: "🔥 TikTok тренд",
    prompt:
      "viral TikTok trend portrait, trendy styling, glossy aesthetic, fashionable social media vibe, preserve identity",
    group: "wow",
    access: "all",
  },
  linkedin: {
    label: "💼 LinkedIn версія мене",
    prompt:
      "professional linkedin headshot, clean business style, confident expression, polished corporate portrait, preserve identity",
    group: "wow",
    access: "all",
  },
  magazine_cover: {
    label: "🪩 Обкладинка журналу",
    prompt:
      "high-end magazine cover portrait, luxury editorial styling, beauty campaign lighting, fashion publication aesthetic, preserve identity",
    group: "wow",
    access: "secret",
  },
  cosmic: {
    label: "🌌 Космічна версія мене",
    prompt:
      "cosmic fantasy portrait, galaxy glow, celestial atmosphere, elegant surreal styling, preserve identity",
    group: "wow",
    access: "secret",
  },
};

const WOW_RANDOM_MODES = [
  "heartbreak",
  "millionaire",
  "dark_version",
  "soft_girl",
  "tiktok_trend",
  "linkedin",
];

// ===================== БАЗА =====================
const defaultDB = {
  users: {},
  payments: [],
  stats: {
    totalUsers: 0,
    totalGenerations: 0,
    totalPaymentsRequests: 0,
    totalManualCredits: 0,
    buttons: {
      promptsIdeas: 0,
      support: 0,
      buy: 0,
      balance: 0,
      info: 0,
      wow: 0,
      classic: 0,
      surprise: 0,
      promptIdea: 0,
      packages: 0,
      statuses: 0,
      myStatus: 0,
      statusesInfo: 0,
    },
    packageClicks: {
      pack10: 0,
      pack20: 0,
      pack30: 0,
    },
    packageSales: {
      pack10: 0,
      pack20: 0,
      pack30: 0,
    },
  },
  content: {
    welcomeText: `Привіт ✨

🎁 1 фото безкоштовно

💳 Пакети:
10 фото — 99 грн
20 фото — 179 грн
30 фото — 249 грн

Спробуй ВАУ-режими, класичні стилі або створи власний промт 👇`,
    welcomePhoto: "",
    infoText: DEFAULT_INFO_TEXT,
    helpText: DEFAULT_HELP_TEXT,
    packagesText: DEFAULT_PACKAGES_TEXT,
    statusesInfoText: DEFAULT_STATUSES_INFO_TEXT,
  },
  uiTexts: { ...DEFAULT_UI_TEXTS },
  modes: { ...MODE_DEFAULTS },
};

function mergeModes(parsedModes = {}) {
  const merged = {};
  for (const [key, value] of Object.entries(MODE_DEFAULTS)) {
    merged[key] = {
      ...value,
      ...(parsedModes[key] || {}),
    };
  }
  return merged;
}

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB, null, 2), "utf8");
    return JSON.parse(JSON.stringify(defaultDB));
  }

  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...defaultDB,
      ...parsed,
      stats: {
        ...defaultDB.stats,
        ...(parsed.stats || {}),
        buttons: {
          ...defaultDB.stats.buttons,
          ...((parsed.stats && parsed.stats.buttons) || {}),
        },
        packageClicks: {
          ...defaultDB.stats.packageClicks,
          ...((parsed.stats && parsed.stats.packageClicks) || {}),
        },
        packageSales: {
          ...defaultDB.stats.packageSales,
          ...((parsed.stats && parsed.stats.packageSales) || {}),
        },
      },
      content: {
        ...defaultDB.content,
        ...(parsed.content || {}),
      },
      uiTexts: {
        ...DEFAULT_UI_TEXTS,
        ...(parsed.uiTexts || {}),
      },
      modes: mergeModes(parsed.modes || {}),
    };
  } catch (e) {
    console.error("DB LOAD ERROR:", e);
    return JSON.parse(JSON.stringify(defaultDB));
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

// ===================== ДОПОМІЖНІ =====================
function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
}

function isAdmin(userId) {
  return ADMINS.includes(userId);
}

function getUI(key) {
  return db.uiTexts[key] || DEFAULT_UI_TEXTS[key] || key;
}

function getUser(id) {
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username: "",
      firstName: "",
      freeUsed: false,
      balance: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      generationsCount: 0,
      purchasedPhotos: 0,
      pendingPackage: null,
      pendingPaymentAt: null,
      pendingOrderReference: null,
    };
    db.stats.totalUsers += 1;
    saveDB();
  }
  return db.users[id];
}

function touchUser(ctx) {
  const user = getUser(ctx.from.id);
  user.username = ctx.from.username || "";
  user.firstName = ctx.from.first_name || "";
  user.lastActiveAt = new Date().toISOString();
  saveDB();
  return user;
}

function incrementButtonStat(key) {
  if (!db.stats.buttons[key]) db.stats.buttons[key] = 0;
  db.stats.buttons[key] += 1;
  saveDB();
}

function formatMoneyFromPackageKey(packKey) {
  if (packKey === "pack10") return "99 грн";
  if (packKey === "pack20") return "179 грн";
  if (packKey === "pack30") return "249 грн";
  return "-";
}

function getPackagePhotos(packKey) {
  if (packKey === "pack10") return 10;
  if (packKey === "pack20") return 20;
  if (packKey === "pack30") return 30;
  return 0;
}

function getPackageTitle(packKey) {
  if (packKey === "pack10") return "10 фото — 99 грн";
  if (packKey === "pack20") return "20 фото — 179 грн";
  if (packKey === "pack30") return "30 фото — 249 грн";
  return "Пакет";
}

function getPackageAmount(packKey) {
  if (packKey === "pack10") return 99;
  if (packKey === "pack20") return 179;
  if (packKey === "pack30") return 249;
  return 0;
}

function buildOrderReference(userId, packKey) {
  return `tg_${userId}_${packKey}_${Date.now()}`;
}

function parseOrderReference(orderReference) {
  const match = /^tg_(\d+)_(pack10|pack20|pack30)_\d+$/.exec(orderReference || "");
  if (!match) return null;

  return {
    userId: Number(match[1]),
    packKey: match[2],
  };
}

function signWfpPurchase({
  merchantAccount,
  merchantDomainName,
  orderReference,
  orderDate,
  amount,
  currency,
  productName,
  productCount,
  productPrice,
}) {
  const values = [
    merchantAccount,
    merchantDomainName,
    orderReference,
    orderDate,
    amount,
    currency,
    ...productName,
    ...productCount,
    ...productPrice,
  ];

  return crypto
    .createHmac("md5", WAYFORPAY.secretKey)
    .update(values.join(";"), "utf8")
    .digest("hex");
}

function signWfpCallback(data) {
  const values = [
    data.merchantAccount || "",
    data.orderReference || "",
    data.amount || "",
    data.currency || "",
    data.authCode || "",
    data.cardPan || "",
    data.transactionStatus || "",
    data.reasonCode || "",
  ];

  return crypto
    .createHmac("md5", WAYFORPAY.secretKey)
    .update(values.join(";"), "utf8")
    .digest("hex");
}

function buildWfpAcceptResponse(orderReference) {
  const time = Math.floor(Date.now() / 1000);
  const status = "accept";

  const signature = crypto
    .createHmac("md5", WAYFORPAY.secretKey)
    .update([orderReference, status, time].join(";"), "utf8")
    .digest("hex");

  return {
    orderReference,
    status,
    time,
    signature,
  };
}

function normalizeWayForPayCallbackBody(body) {
  if (!body) return {};

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  if (typeof body === "object" && !Array.isArray(body)) {
    if (body.merchantAccount && body.orderReference) {
      return body;
    }

    const keys = Object.keys(body);

    if (keys.length === 1) {
      const firstKey = keys[0];

      if (firstKey && firstKey.startsWith("{") && firstKey.endsWith("}")) {
        try {
          return JSON.parse(firstKey);
        } catch {
          return body;
        }
      }
    }
  }

  return body;
}

async function createWayForPayPaymentUrl(userId, packKey) {
  const amount = getPackageAmount(packKey);
  const orderReference = buildOrderReference(userId, packKey);
  const orderDate = Math.floor(Date.now() / 1000);
  const currency = "UAH";
  const productName = [getPackageTitle(packKey)];
  const productCount = [1];
  const productPrice = [amount];

  const payload = {
  transactionType: "CREATE_INVOICE",
  merchantAccount: WAYFORPAY.merchantAccount,
  merchantDomainName: WAYFORPAY.domainName,

  merchantTransactionType: "AUTO",
  merchantAuthType: "SimpleSignature", // ✅ ВАЖЛИВО

  apiVersion: 1,
  language: "UA",

  serviceUrl: WAYFORPAY.serviceUrl,
  returnUrl: WAYFORPAY.returnUrl,

  orderReference,
  orderDate,
  amount,
  currency,

  productName,
  productPrice,
  productCount,
};

  payload.merchantSignature = signWfpPurchase({
    merchantAccount: payload.merchantAccount,
    merchantDomainName: payload.merchantDomainName,
    orderReference: payload.orderReference,
    orderDate: payload.orderDate,
    amount: payload.amount,
    currency: payload.currency,
    productName: payload.productName,
    productCount: payload.productCount,
    productPrice: payload.productPrice,
  });

  const response = await axios.post("https://api.wayforpay.com/api", payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  const data = response.data || {};

  const paymentUrl = data.invoiceUrl || data.url || data.href || null;

  if (!paymentUrl) {
    throw new Error(`WayForPay did not return payment URL: ${JSON.stringify(data)}`);
  }

  db.payments.push({
    provider: "wayforpay",
    orderReference,
    userId,
    packKey,
    amount,
    paymentUrl,
    status: "created",
    createdAt: new Date().toISOString(),
  });

  saveDB();

  return { paymentUrl, orderReference };
}

function getStatusByGenerations(count) {
  if (count >= 51) return { name: "VIP", emoji: "💠" };
  if (count >= 21) return { name: "Premium", emoji: "👑" };
  if (count >= 6) return { name: "Активний", emoji: "🔥" };
  return { name: "Новачок", emoji: "🆓" };
}

function isSecretUnlocked(user) {
  return user.generationsCount >= 20;
}

function getAllModesForDisplay() {
  return db.modes;
}

function modeInlineButtons(modeKey) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Обрати", `mode_${modeKey}`)],
    [Markup.button.callback(getUI("back"), "back_to_menu")],
  ]);
}

function buildModesKeyboard(group) {
  const rows = [];

  for (const [key, mode] of Object.entries(getAllModesForDisplay())) {
    if (mode.group !== group) continue;
    rows.push([Markup.button.callback(mode.label, `show_${key}`)]);
  }

  rows.push([Markup.button.callback(getUI("back"), "back_to_menu")]);
  return Markup.inlineKeyboard(rows);
}

function buyInlineButtons(paymentUrl, packKey) {
  return Markup.inlineKeyboard([
    [Markup.button.url(`💳 Оплатити ${getPackageTitle(packKey)}`, paymentUrl)],
    [Markup.button.callback("🔄 Перевірити оплату", `checkpay_${packKey}`)],
    [Markup.button.url("🆘 Підтримка", SUPPORT_URL)],
  ]);
}

function mainMenu() {
  return Markup.keyboard([
    [getUI("wowMenu"), getUI("classicMenu")],
    [getUI("surprise"), getUI("ideaToPrompt")],
    [getUI("customPrompt"), getUI("packages")],
    [getUI("buy"), getUI("balance")],
    [getUI("statuses"), getUI("support")],
    [getUI("info")],
  ]).resize();
}

function adminMenu() {
  return Markup.keyboard([
    ["📊 Статистика", "➕ Продаж вручну"],
    ["✏️ Редагувати /info", "✏️ Редагувати /help"],
    ["✏️ Редагувати пакети", "✏️ Редагувати статуси"],
    ["✏️ Редагувати тексти кнопок"],
    ["🎨 Редагувати класичні режими", "✨ Редагувати ВАУ режими"],
    ["⬅️ Назад в основне меню"],
  ]).resize();
}
function buildAdminModesKeyboard(group) {
  const rows = [];

  for (const [key, mode] of Object.entries(db.modes)) {
    if (mode.group !== group) continue;
    rows.push([`${mode.label} | ${key}`]);
  }

  rows.push(["⬅️ Назад в основне меню"]);
  return Markup.keyboard(rows).resize();
}

function parseAdminModeKey(text) {
  if (!text || !text.includes("|")) return null;
  const parts = text.split("|");
  return parts[1]?.trim() || null;
}
async function sendWelcome(ctx) {
  const text = db.content.welcomeText;
  const photo = db.content.welcomePhoto;

  if (photo) {
    try {
      await ctx.replyWithPhoto(photo, {
        caption: text,
        ...mainMenu(),
      });
      return;
    } catch (e) {
      console.error("WELCOME PHOTO ERROR:", e.message);
    }
  }

  await ctx.reply(text, mainMenu());
}

async function sendModePreview(ctx, modeKey) {
  const user = getUser(ctx.from.id);
  const mode = db.modes[modeKey];
  if (!mode) return;

  if (mode.access === "secret" && !isSecretUnlocked(user)) {
    return ctx.reply(
      "🔒 Цей режим відкривається після 20 генерацій.",
      mainMenu()
    );
  }

  return ctx.reply(
    `${mode.label}\n\nПромт:\n${mode.prompt}`,
    modeInlineButtons(modeKey)
  );
}

async function tryGenerateFromPhoto(ctx, photoFileId, promptText) {
  const user = getUser(ctx.from.id);

  let usedFreeGeneration = false;
let spentBalanceGeneration = false;

if (!user.freeUsed && user.balance <= 0) {
  user.freeUsed = true;
  usedFreeGeneration = true;
  saveDB();
} else if (user.balance > 0) {
  user.balance -= 1;
  spentBalanceGeneration = true;
  saveDB();
} else {
  return ctx.reply(
    "У тебе немає доступних генерацій. Купи пакет у меню 💳 Купити",
    mainMenu()
  );
}

  try {
    await ctx.reply("⏳ Генерую зображення, зачекай...");

    const file = await ctx.telegram.getFile(photoFileId);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

    const result = await fal.subscribe("fal-ai/flux-lora/image-to-image", {
      input: {
        image_url: url,
        prompt: promptText,
        strength: 0.8,
        num_inference_steps: 28,
        guidance_scale: 6,
        image_size: "portrait_4_3",
        num_images: 1,
      },
      logs: true,
    });

    const imageUrl =
      result?.data?.images?.[0]?.url ||
      result?.images?.[0]?.url ||
      result?.data?.output?.[0]?.url ||
      null;

    if (!imageUrl) throw new Error("No image in response");

    user.generationsCount += 1;
    db.stats.totalGenerations += 1;
    saveDB();

    await ctx.replyWithPhoto(imageUrl, {
      caption: `✅ Готово\n\nБаланс: ${user.balance}`,
      ...mainMenu(),
    });
  } catch (err) {
  console.error("GENERATE ERROR:", err?.response?.data || err.message);

  if (usedFreeGeneration) {
    user.freeUsed = false;
    saveDB();
  } else if (spentBalanceGeneration) {
    user.balance += 1;
    saveDB();
  }

  return ctx.reply(
    "❌ Не вдалося згенерувати фото. Спробуй ще раз трохи пізніше.",
    mainMenu()
  }
}

async function sendWayForPayOffer(ctx, packKey) {
  try {
    const user = getUser(ctx.from.id);

    db.stats.totalPaymentsRequests += 1;
    db.stats.packageClicks[packKey] += 1;

    const { paymentUrl, orderReference } = await createWayForPayPaymentUrl(
      ctx.from.id,
      packKey
    );

    user.pendingPackage = packKey;
    user.pendingPaymentAt = new Date().toISOString();
    user.pendingOrderReference = orderReference;
    saveDB();

    return ctx.reply(
      `Обрано пакет:\n${getPackageTitle(packKey)}\n\nНатисни кнопку нижче для оплати.\nПісля успішної оплати фото зарахуються автоматично.`,
      buyInlineButtons(paymentUrl, packKey)
    );
  } catch (error) {
    console.error("SEND WAYFORPAY OFFER ERROR:", error?.response?.data || error.message);

    return ctx.reply(
      "❌ Зараз не вдалося створити посилання на оплату. Спробуй ще раз трохи пізніше або напиши в підтримку.",
      mainMenu()
    );
  }
}

bot.start(async (ctx) => {
  touchUser(ctx);
  return sendWelcome(ctx);
});

bot.command("help", async (ctx) => {
  touchUser(ctx);
  return ctx.reply(db.content.helpText, mainMenu());
});

bot.command("info", async (ctx) => {
  touchUser(ctx);
  return ctx.reply(db.content.infoText, mainMenu());
});

bot.command("admin", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  return ctx.reply("Адмін-меню", adminMenu());
});

bot.command("sale", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;

  const parts = ctx.message.text.split(" ");
  const userId = Number(parts[1]);
  const packKey = parts[2];

  if (!userId || !["pack10", "pack20", "pack30"].includes(packKey)) {
    return ctx.reply("Формат: /sale USER_ID pack10|pack20|pack30");
  }

  const user = getUser(userId);
  const photos = getPackagePhotos(packKey);

  user.balance += photos;
  user.purchasedPhotos += photos;
  user.pendingPackage = null;
  user.pendingPaymentAt = null;
  user.pendingOrderReference = null;

  db.stats.totalManualCredits += 1;
  db.stats.packageSales[packKey] += 1;
  db.payments.push({
    provider: "manual",
    userId,
    packKey,
    photos,
    amountText: formatMoneyFromPackageKey(packKey),
    createdAt: new Date().toISOString(),
    byAdmin: ctx.from.id,
    status: "credited",
  });
  saveDB();

  try {
    await bot.telegram.sendMessage(
      userId,
      `✅ Тобі зараховано пакет ${getPackageTitle(packKey)}\nБаланс: ${user.balance}`,
      mainMenu()
    );
  } catch (e) {
    console.error("MANUAL CREDIT SEND ERROR:", e.message);
  }

  return ctx.reply("✅ Продаж зараховано.");
});

bot.on("text", async (ctx) => {
  ensureSession(ctx);
  const user = touchUser(ctx);
  const text = ctx.message.text;

  if (ctx.session.awaitingCustomPrompt) {
    ctx.session.awaitingCustomPrompt = false;
    ctx.session.customPrompt = text;
    return ctx.reply(
      "Тепер надішли фото для генерації за своїм промтом.",
      mainMenu()
    );
  }

  if (ctx.session.awaitingIdea) {
    ctx.session.awaitingIdea = false;

    const idea = text;
    const generatedPrompt = `Create an advanced high-quality AI photo prompt based on this idea: ${idea}. Preserve identity if a face is provided.`;

    return ctx.reply(`🧠 Готовий промт:\n\n${generatedPrompt}`, mainMenu());
  }

  if (isAdmin(ctx.from.id)) {
    if (text === "📊 Статистика") {
      const totalPayments = db.payments.length;
      const usersCount = Object.keys(db.users).length;

      return ctx.reply(
        `📊 Статистика\n\nКористувачів: ${usersCount}\nГенерацій: ${db.stats.totalGenerations}\nЗапитів на оплату: ${db.stats.totalPaymentsRequests}\nПродажів вручну: ${db.stats.totalManualCredits}\nВсього оплат у базі: ${totalPayments}`,
        adminMenu()
      );
    }

    if (text === "🎨 Редагувати класичні режими") {
      ctx.session.adminEditGroup = "classic";
      ctx.session.awaitingAdminModePick = true;
      ctx.session.awaitingAdminModePrompt = null;

      return ctx.reply(
        "Оберіть класичний режим:",
        buildAdminModesKeyboard("classic")
      );
    }

    if (text === "✨ Редагувати ВАУ режими") {
      ctx.session.adminEditGroup = "wow";
      ctx.session.awaitingAdminModePick = true;
      ctx.session.awaitingAdminModePrompt = null;

      return ctx.reply(
        "Оберіть ВАУ режим:",
        buildAdminModesKeyboard("wow")
      );
    }

    if (ctx.session.awaitingAdminModePick) {
      const modeKey = parseAdminModeKey(text);
      const mode = db.modes[modeKey];

      if (!mode) {
        return ctx.reply("Обери кнопку зі списку");
      }

      ctx.session.awaitingAdminModePick = false;
      ctx.session.awaitingAdminModePrompt = modeKey;

      return ctx.reply(
        `Обрано: ${mode.label}\n\nПоточний промт:\n${mode.prompt}\n\nНадішли новий промт`
      );
    }

    if (text === "⬅️ Назад в основне меню") {
  ctx.session.awaitingAdminModePick = false;
  ctx.session.awaitingAdminModePrompt = null;
  ctx.session.adminEditGroup = null;
  return ctx.reply("Повернення", mainMenu());
}

      if (!mode) {
        ctx.session.awaitingAdminModePrompt = null;
        return ctx.reply("Помилка", adminMenu());
      }

      mode.prompt = text;
      db.modes[modeKey] = mode;
      saveDB();

      ctx.session.awaitingAdminModePrompt = null;
      ctx.session.adminEditGroup = null;

      return ctx.reply(
        `✅ Оновлено: ${mode.label}\n\nНовий промт:\n${mode.prompt}`,
        adminMenu()
      );
    }

    if (text === "⬅️ Назад в основне меню") {
      ctx.session.awaitingAdminModePick = false;
      ctx.session.awaitingAdminModePrompt = null;
      ctx.session.adminEditGroup = null;
      return ctx.reply("Повернення", mainMenu());
    }
  }

  if (text === getUI("wowMenu")) {
    incrementButtonStat("wow");
    return ctx.reply("✨ ВАУ режими", buildModesKeyboard("wow"));
  }

  if (text === getUI("classicMenu")) {
    incrementButtonStat("classic");
    return ctx.reply("🎨 Класичні стилі", buildModesKeyboard("classic"));
  }
  if (text === getUI("surprise")) {
    incrementButtonStat("surprise");
    const randomKey = WOW_RANDOM_MODES[Math.floor(Math.random() * WOW_RANDOM_MODES.length)];
    return sendModePreview(ctx, randomKey);
  }

  if (text === getUI("ideaToPrompt")) {
    incrementButtonStat("promptIdea");
    ctx.session.awaitingIdea = true;
    return ctx.reply("Напиши ідею, і я перетворю її на промт.");
  }

  if (text === getUI("customPrompt")) {
    ctx.session.awaitingCustomPrompt = true;
    return ctx.reply("Напиши свій промт.");
  }

  if (text === getUI("packages")) {
    incrementButtonStat("packages");
    return ctx.reply(db.content.packagesText, mainMenu());
  }

  if (text === getUI("buy")) {
    incrementButtonStat("buy");
    return ctx.reply(
      "💳 Обери пакет:\n\n10 фото — 99 грн\n20 фото — 179 грн\n30 фото — 249 грн",
      Markup.keyboard([
        ["10 фото — 99 грн", "20 фото — 179 грн"],
        ["30 фото — 249 грн"],
        [getUI("back")],
      ]).resize()
    );
  }

  if (text === "10 фото — 99 грн") return sendWayForPayOffer(ctx, "pack10");
  if (text === "20 фото — 179 грн") return sendWayForPayOffer(ctx, "pack20");
  if (text === "30 фото — 249 грн") return sendWayForPayOffer(ctx, "pack30");

  if (text === getUI("balance")) {
    incrementButtonStat("balance");
    return ctx.reply(
      `📊 Твій баланс: ${user.balance}\nЗгенеровано всього: ${user.generationsCount}`,
      mainMenu()
    );
  }

  if (text === getUI("support")) {
    incrementButtonStat("support");
    return ctx.reply(`🆘 Підтримка: ${SUPPORT_URL}`, mainMenu());
  }

  if (text === getUI("info")) {
    incrementButtonStat("info");
    return ctx.reply(db.content.infoText, mainMenu());
  }

  if (text === getUI("statuses")) {
    incrementButtonStat("statuses");
    return ctx.reply(
      `💎 Статуси\n\n${getUI("myStatus")}\n${getUI("statusesInfo")}`,
      Markup.keyboard([
        [getUI("myStatus"), getUI("statusesInfo")],
        [getUI("back")],
      ]).resize()
    );
  }

  if (text === getUI("myStatus")) {
    incrementButtonStat("myStatus");
    const status = getStatusByGenerations(user.generationsCount);
    return ctx.reply(
      `${status.emoji} Твій статус: ${status.name}\n\nЗгенеровано: ${user.generationsCount}`,
      mainMenu()
    );
  }

  if (text === getUI("statusesInfo")) {
    incrementButtonStat("statusesInfo");
    return ctx.reply(db.content.statusesInfoText, mainMenu());
  }

  if (text === getUI("back")) {
    return ctx.reply("Повернення в меню", mainMenu());
  }

  return ctx.reply("Оберіть дію з меню 👇", mainMenu());
});

bot.on("photo", async (ctx) => {
  ensureSession(ctx);
  const user = touchUser(ctx);

  const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
  if (!photo) return;

  if (ctx.session.selectedModeKey) {
    const mode = db.modes[ctx.session.selectedModeKey];
    ctx.session.selectedModeKey = null;
    if (!mode) return;
    return tryGenerateFromPhoto(ctx, photo.file_id, mode.prompt);
  }

  if (ctx.session.customPrompt) {
    const prompt = ctx.session.customPrompt;
    ctx.session.customPrompt = null;
    return tryGenerateFromPhoto(ctx, photo.file_id, prompt);
  }

  return ctx.reply(
    "Спочатку обери режим або напиши свій промт.",
    mainMenu()
  );
});

bot.action(/^show_(.+)$/, async (ctx) => {
  try {
    const modeKey = ctx.match[1];
    await ctx.answerCbQuery();
    return sendModePreview(ctx, modeKey);
  } catch (e) {
    console.error("SHOW MODE ERROR:", e);
  }
});

bot.action(/^mode_(.+)$/, async (ctx) => {
  try {
    const modeKey = ctx.match[1];
    const mode = db.modes[modeKey];
    if (!mode) return;

    ctx.session.selectedModeKey = modeKey;
    await ctx.answerCbQuery("Режим обрано");
    return ctx.reply(
      `✅ Обрано режим: ${mode.label}\n\nТепер надішли фото.`,
      mainMenu()
    );
  } catch (e) {
    console.error("SELECT MODE ERROR:", e);
  }
});

bot.action("back_to_menu", async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply("Повернення в меню", mainMenu());
});

bot.action(/^checkpay_(pack10|pack20|pack30)$/, async (ctx) => {
  try {
    const packKey = ctx.match[1];
    const user = getUser(ctx.from.id);

    const lastPayment = [...db.payments]
      .reverse()
      .find(
        (p) =>
          p.userId === ctx.from.id &&
          p.packKey === packKey &&
          ["created", "approved", "credited"].includes(p.status)
      );

    if (!lastPayment) {
      await ctx.answerCbQuery("Платіж ще не знайдено");
      return;
    }

    if (lastPayment.status === "credited") {
      await ctx.answerCbQuery("Оплату вже підтверджено ✅");
      return ctx.reply(
        `✅ Оплата підтверджена.\nПакет ${getPackageTitle(packKey)} уже зараховано.\nБаланс: ${user.balance}`,
        mainMenu()
      );
    }

    await ctx.answerCbQuery("Оплата ще обробляється");
    return ctx.reply(
      `⏳ Платіж ще не підтверджений.\n\nЯкщо ти вже оплатив(ла), зачекай 10–30 секунд і натисни ще раз.\nЯкщо буде затримка — напиши в підтримку:\n${SUPPORT_URL}`,
      mainMenu()
    );
  } catch (e) {
    console.error("CHECKPAY ACTION ERROR:", e);
  }
});

bot.catch((err) => {
  console.error("BOT ERROR:", err);
});

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).send("Bot is running 🚀");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "promti-bot" });
});

app.post("/payment", async (req, res) => {
  try {
    const rawBody = req.body || {};
    const data = normalizeWayForPayCallbackBody(rawBody);

    console.log("WAYFORPAY CALLBACK RAW:", JSON.stringify(rawBody, null, 2));
    console.log("WAYFORPAY CALLBACK NORMALIZED:", JSON.stringify(data, null, 2));

    const expectedSignature = signWfpCallback(data);

   if (expectedSignature !== data.merchantSignature) {
  console.error("WAYFORPAY SIGNATURE INVALID");
  console.error("EXPECTED:", expectedSignature);
  console.error("RECEIVED:", data.merchantSignature);
  return res
    .status(200)
    .json(buildWfpAcceptResponse(data.orderReference || "unknown"));
}

    const parsed = parseOrderReference(data.orderReference);
    if (!parsed) {
      return res
        .status(200)
        .json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const { userId, packKey } = parsed;
    const user = getUser(userId);

    let payment = db.payments.find(
      (p) => p.orderReference === data.orderReference && p.status !== "credited"
    );

    if (!payment) {
      payment = {
        provider: "wayforpay",
        orderReference: data.orderReference,
        userId,
        packKey,
        amount: Number(data.amount || 0),
        status: "callback_received",
        createdAt: new Date().toISOString(),
      };
      db.payments.push(payment);
    }

    payment.callback = data;
    payment.updatedAt = new Date().toISOString();
    payment.status = (data.transactionStatus || "").toLowerCase();

    if ((data.transactionStatus || "").toLowerCase() === "approved") {
      const alreadyCredited = db.payments.some(
        (p) =>
          p.orderReference === data.orderReference &&
          p.status === "credited"
      );

      if (!alreadyCredited) {
        const photos = getPackagePhotos(packKey);

        user.balance += photos;
        user.purchasedPhotos += photos;
        user.pendingPackage = null;
        user.pendingPaymentAt = null;
        user.pendingOrderReference = null;

        db.stats.packageSales[packKey] += 1;

        db.payments.push({
          provider: "wayforpay",
          orderReference: data.orderReference,
          userId,
          packKey,
          photos,
          amountText: formatMoneyFromPackageKey(packKey),
          amount: Number(data.amount || 0),
          status: "credited",
          createdAt: new Date().toISOString(),
        });

        saveDB();

        try {
          await bot.telegram.sendMessage(
            userId,
            `✅ Оплату підтверджено автоматично\n\nПакет: ${getPackageTitle(packKey)}\nЗараховано: ${photos} фото\nБаланс: ${user.balance}`,
            mainMenu()
          );
        } catch (e) {
          console.error("SEND USER PAYMENT MESSAGE ERROR:", e);
        }

        for (const adminId of ADMINS) {
          try {
            await bot.telegram.sendMessage(
              adminId,
              `✅ WayForPay: автоматично зараховано\n\nКористувач: ${userId}\nПакет: ${getPackageTitle(packKey)}\nOrderReference: ${data.orderReference}\nСума: ${data.amount} ${data.currency}`
            );
          } catch (e) {}
        }
      }
    } else {
      saveDB();
    }

    return res
      .status(200)
      .json(buildWfpAcceptResponse(data.orderReference));
  } catch (error) {
    console.error("WAYFORPAY PAYMENT ERROR:", error);
    return res.status(200).json(buildWfpAcceptResponse("unknown"));
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 HTTP server started on port ${PORT}`);
});

bot.launch().then(() => {
  console.log("🔥 AI бот запущений");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
