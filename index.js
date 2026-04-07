require("dotenv").config();

// ===== ГЛОБАЛЬНИЙ ЗАХИСТ — процес не падає якщо бот крашнувся =====
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

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

// ===== АДМІНИ =====
const ADMINS = [346101852, 688515215];

// ===== WAYFORPAY =====
const WAYFORPAY = {
  merchantAccount: process.env.WAYFORPAY_MERCHANT || "",
  secretKey: process.env.WAYFORPAY_SECRET || "",
  domainName: process.env.WAYFORPAY_DOMAIN || "",
  returnUrl: process.env.WAYFORPAY_RETURN_URL || "https://t.me/Promtiai_bot",
  serviceUrl: process.env.WAYFORPAY_SERVICE_URL || "",
};

// ===== ФАЙЛИ =====
const USERS_PATH = path.join(__dirname, "users.json");
const PROMPTS_PATH = path.join(__dirname, "prompts.json");
const CONTENT_PATH = path.join(__dirname, "content.json");
const PAYMENTS_PATH = path.join(__dirname, "payments.json");

// ===== ПОЧАТКОВІ ПРОМТИ =====
const DEFAULT_PROMPTS = {
  portrait: "ultra realistic portrait, studio lighting, preserve face, do not change identity",
  beauty: "beauty editorial, glossy skin, preserve face, do not change identity",
  fashion: "high fashion photoshoot, preserve face, do not change identity",
  art: "digital art, artistic portrait, preserve face, do not change identity",
  trend: "viral instagram aesthetic, preserve face, do not change identity",
};

// ===== ПОЧАТКОВІ ТЕКСТИ =====
const DEFAULT_CONTENT = {
  welcomeText: `Привіт ✨\n\n🎁 1 фото безкоштовно\n\n💳 Пакети:\n10 фото — 99 грн\n20 фото — 179 грн\n30 фото — 249 грн\n\nОбери режим:`,
  infoText: `PROMTI AI Bot\n\n🎁 1 фото безкоштовно\n💳 Пакети:\n10 фото — 99 грн\n20 фото — 179 грн\n30 фото — 249 грн\n\nНадішли фото та обери стиль.`,
  helpText: `Допомога:\n\n1. Обери режим\n2. Надішли фото\n3. Отримай результат\n\nЯкщо закінчився баланс — натисни "💳 Купити".\n\nЯкщо є проблема з оплатою або генерацією — напиши в підтримку.`,
  supportText: `Напиши в підтримку: https://t.me/promteamai?direct`,
};

// ===== ЗАВАНТАЖЕННЯ / ЗБЕРЕЖЕННЯ =====
function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
      return JSON.parse(JSON.stringify(fallback));
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(`LOAD JSON ERROR ${filePath}:`, e.message);
    return JSON.parse(JSON.stringify(fallback));
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

let users = loadJson(USERS_PATH, {});
let prompts = loadJson(PROMPTS_PATH, DEFAULT_PROMPTS);
let content = loadJson(CONTENT_PATH, DEFAULT_CONTENT);
let payments = loadJson(PAYMENTS_PATH, []);

prompts = { ...DEFAULT_PROMPTS, ...prompts };
content = { ...DEFAULT_CONTENT, ...content };

saveJson(PROMPTS_PATH, prompts);
saveJson(CONTENT_PATH, content);
saveJson(PAYMENTS_PATH, payments);

// ===== RATE LIMITING =====
const userLastGen = {};
const userGenerating = new Set();
const RATE_LIMIT_MS = 15000;

function checkRateLimit(userId) {
  const now = Date.now();
  if (userLastGen[userId] && now - userLastGen[userId] < RATE_LIMIT_MS) {
    const secondsLeft = Math.ceil((RATE_LIMIT_MS - (now - userLastGen[userId])) / 1000);
    return secondsLeft;
  }
  return 0;
}

// ===== НАДСИЛАННЯ ПОМИЛОК АДМІНУ =====
async function notifyAdminsError(message) {
  for (const adminId of ADMINS) {
    try {
      await bot.telegram.sendMessage(adminId, `⚠️ ПОМИЛКА БОТА:\n\n${message}`);
    } catch (e) {
      console.error("NOTIFY ADMIN ERROR:", e.message);
    }
  }
}

// ===== ДОПОМІЖНІ =====
function isAdmin(userId) {
  return ADMINS.includes(userId);
}

function ensureSession(ctx) {
  if (!ctx.session) ctx.session = {};
}

function resetAdminState(ctx) {
  ensureSession(ctx);
  ctx.session.awaitingPromptEditKey = null;
  ctx.session.awaitingTextEditKey = null;
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.customPrompt = null;
  ctx.session.mode = null;
}

function getUser(id) {
  if (!users[id]) {
    users[id] = {
      id,
      freeUsed: false,
      balance: 0,
      generations: 0,
      purchasedPhotos: 0,
      totalSpent: 0,
      username: "",
      firstName: "",
      lastPaymentRequest: null,
      pendingOrderReference: null,
      lastPaidAt: null,
      createdAt: new Date().toISOString(),
    };
    saveJson(USERS_PATH, users);
  }
  return users[id];
}

function touchUser(ctx) {
  const user = getUser(ctx.from.id);
  user.username = ctx.from.username || "";
  user.firstName = ctx.from.first_name || "";
  saveJson(USERS_PATH, users);
  return user;
}

function saveUsers() { saveJson(USERS_PATH, users); }
function savePrompts() { saveJson(PROMPTS_PATH, prompts); }
function saveContent() { saveJson(CONTENT_PATH, content); }
function savePayments() { saveJson(PAYMENTS_PATH, payments); }

// ===== ПАКЕТИ =====
const PACKAGES = {
  pack10: { key: "pack10", title: "10 фото", description: "Пакет на 10 генерацій фото", photos: 10, amount: 99, priceText: "99 грн" },
  pack20: { key: "pack20", title: "20 фото", description: "Пакет на 20 генерацій фото", photos: 20, amount: 179, priceText: "179 грн" },
  pack30: { key: "pack30", title: "30 фото", description: "Пакет на 30 генерацій фото", photos: 30, amount: 249, priceText: "249 грн" },
};

// ===== МЕНЮ =====
function mainMenu() {
  return Markup.keyboard([
    ["👩 Портрет", "💄 Б'юті"],
    ["📸 Fashion", "🎨 Арт"],
    ["🔥 Тренд", "✍️ Свій промт"],
    ["💳 Купити", "📊 Баланс"],
    ["ℹ️ Інфо", "❓ Допомога"],
    ["🆘 Підтримка"],
  ]).resize();
}

function buyMenu() {
  return Markup.keyboard([
    ["10 фото", "20 фото"],
    ["30 фото"],
    ["↩️ Назад"],
  ]).resize();
}

function adminMenu() {
  return Markup.keyboard([
    ["📊 Статус бота", "👤 Мій ID"],
    ["👥 Користувачі", "💳 Останні оплати"],
    ["✏️ Змінити промт", "📝 Поточні промти"],
    ["✏️ Змінити текст", "📝 Поточні тексти"],
    ["📊 Баланс", "💳 Купити"],
    ["↩️ Назад"],
  ]).resize();
}

function adminPromptsMenu() {
  return Markup.keyboard([
    ["portrait", "beauty"],
    ["fashion", "art"],
    ["trend"],
    ["↩️ Назад"],
  ]).resize();
}

function adminTextsMenu() {
  return Markup.keyboard([
    ["welcomeText", "infoText"],
    ["helpText", "supportText"],
    ["↩️ Назад"],
  ]).resize();
}

function paymentInlineKeyboard(payUrl, pack) {
  return Markup.inlineKeyboard([
    [Markup.button.url(`💳 Оплатити ${pack.title} — ${pack.priceText}`, payUrl)],
    [Markup.button.callback("🔄 Перевірити оплату", `checkpay_${pack.key}`)],
  ]);
}

// ===== ОТРИМАННЯ ФОТО =====
async function getImage(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
  return `data:image/jpeg;base64,${Buffer.from(res.data).toString("base64")}`;
}

// ===== WAYFORPAY HELPERS =====
function buildOrderReference(userId, packKey) {
  return `tg_${userId}_${packKey}_${Date.now()}`;
}

function parseOrderReference(orderReference) {
  const match = /^tg_(\d+)_(pack10|pack20|pack30)_\d+$/.exec(orderReference || "");
  if (!match) return null;
  return { userId: Number(match[1]), packKey: match[2] };
}

function signWfpPurchase({ merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency, productName, productCount, productPrice }) {
  const values = [
    merchantAccount, merchantDomainName, orderReference, orderDate,
    amount, currency, ...productName, ...productCount, ...productPrice,
  ];
  return crypto.createHmac("md5", WAYFORPAY.secretKey).update(values.join(";"), "utf8").digest("hex");
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
  return crypto.createHmac("md5", WAYFORPAY.secretKey).update(values.join(";"), "utf8").digest("hex");
}

function buildWfpAcceptResponse(orderReference) {
  const time = Math.floor(Date.now() / 1000);
  const status = "accept";
  const signature = crypto
    .createHmac("md5", WAYFORPAY.secretKey)
    .update([orderReference, status, time].join(";"), "utf8")
    .digest("hex");
  return { orderReference, status, time, signature };
}

function normalizeWayForPayCallbackBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  if (typeof body === "object" && !Array.isArray(body)) {
    if (body.merchantAccount && body.orderReference) return body;
    const keys = Object.keys(body);
    if (keys.length === 1) {
      const firstKey = keys[0];
      if (firstKey && firstKey.startsWith("{") && firstKey.endsWith("}")) {
        try { return JSON.parse(firstKey); } catch { return body; }
      }
    }
  }
  return body;
}

async function createWayForPayInvoice(userId, packKey) {
  const pack = PACKAGES[packKey];
  if (!pack) throw new Error("Unknown package");

  if (!WAYFORPAY.merchantAccount || !WAYFORPAY.secretKey || !WAYFORPAY.domainName || !WAYFORPAY.serviceUrl) {
    throw new Error("WayForPay environment variables are not fully configured");
  }

  const orderReference = buildOrderReference(userId, packKey);
  const orderDate = Math.floor(Date.now() / 1000);

  const payload = {
    transactionType: "CREATE_INVOICE",
    merchantAccount: WAYFORPAY.merchantAccount,
    merchantDomainName: WAYFORPAY.domainName,
    merchantAuthType: "SimpleSignature",
    apiVersion: 1,
    language: "UA",
    serviceUrl: WAYFORPAY.serviceUrl,
    returnUrl: WAYFORPAY.returnUrl,
    orderReference,
    orderDate,
    amount: pack.amount,
    currency: "UAH",
    productName: [pack.title],
    productPrice: [pack.amount],
    productCount: [1],
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

  console.log("WFP CREATE INVOICE payload:", JSON.stringify(payload, null, 2));

  const response = await axios.post("https://api.wayforpay.com/api", payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  const data = response.data || {};
  console.log("WFP CREATE INVOICE response:", JSON.stringify(data, null, 2));

  const invoiceUrl = data.invoiceUrl || data.url || data.href || null;
  if (!invoiceUrl) {
    throw new Error(`WayForPay did not return invoiceUrl: ${JSON.stringify(data)}`);
  }

  payments.push({
    provider: "wayforpay",
    orderReference,
    userId,
    packKey,
    amount: pack.amount,
    status: "created",
    createdAt: new Date().toISOString(),
    response: data,
  });
  savePayments();

  return { invoiceUrl, orderReference };
}

function hasCreditedPayment(orderReference) {
  return payments.some((p) => p.orderReference === orderReference && p.status === "credited");
}

function updatePaymentStatus(orderReference, data, status) {
  const existing = payments.find((p) => p.orderReference === orderReference);
  if (existing) {
    if (existing.status === "credited") return;
    existing.callback = data;
    existing.updatedAt = new Date().toISOString();
    existing.status = status || existing.status;
  } else {
    payments.push({
      provider: "wayforpay",
      orderReference,
      status: status || "callback_received",
      createdAt: new Date().toISOString(),
      callback: data,
    });
  }
  savePayments();
}

// ===== СТАТИСТИКА ДЛЯ АДМІНА =====
function getBotStats() {
  const allUsers = Object.values(users);
  const totalUsers = allUsers.length;
  const activeUsers = allUsers.filter((u) => u.generations > 0).length;
  const totalGenerations = allUsers.reduce((sum, u) => sum + (u.generations || 0), 0);
  const totalRevenue = payments
    .filter((p) => p.status === "credited")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalPaidOrders = payments.filter((p) => p.status === "credited").length;
  return { totalUsers, activeUsers, totalGenerations, totalRevenue, totalPaidOrders };
}

// ===== START =====
bot.start((ctx) => {
  ensureSession(ctx);
  touchUser(ctx);
  resetAdminState(ctx);
  return ctx.reply(content.welcomeText, mainMenu());
});

bot.command("help", (ctx) => {
  touchUser(ctx);
  return ctx.reply(content.helpText, mainMenu());
});

bot.command("info", (ctx) => {
  touchUser(ctx);
  return ctx.reply(content.infoText, mainMenu());
});

bot.command("myid", (ctx) => {
  touchUser(ctx);
  return ctx.reply(`Твій Telegram ID: ${ctx.from.id}`);
});

bot.command("add", async (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  const parts = ctx.message.text.trim().split(/\s+/);
  const userId = Number(parts[1]);
  const amount = Number(parts[2]);
  if (!userId || !amount) return ctx.reply("Формат: /add ID КІЛЬКІСТЬ");
  const user = getUser(userId);
  user.balance += amount;
  saveUsers();
  await ctx.reply(`✅ Додано ${amount} фото користувачу ${userId}`);
  bot.telegram.sendMessage(userId, `🎉 Вам нараховано ${amount} генерацій\n\nЗараз на балансі: ${user.balance}`, mainMenu()).catch(() => {});
});

bot.command("admin", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  resetAdminState(ctx);
  return ctx.reply("Адмін-меню:", adminMenu());
});

bot.hears("📊 Статус бота", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  const stats = getBotStats();
  return ctx.reply(
    `🤖 Статус бота:\n\n` +
    `✅ Бот працює\n` +
    `✅ Fal підключений\n` +
    `✅ Модель: nano-banana-2\n` +
    `✅ Автооплата увімкнена\n\n` +
    `📊 Статистика:\n` +
    `👥 Користувачів: ${stats.totalUsers}\n` +
    `🔥 Активних (з генераціями): ${stats.activeUsers}\n` +
    `🖼 Всього генерацій: ${stats.totalGenerations}\n` +
    `💰 Зароблено: ${stats.totalRevenue} грн\n` +
    `🧾 Успішних оплат: ${stats.totalPaidOrders}`,
    adminMenu()
  );
});

bot.hears("👤 Мій ID", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  return ctx.reply(`Твій Telegram ID: ${ctx.from.id}`, adminMenu());
});

bot.hears("👥 Користувачі", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  const allUsers = Object.values(users);
  if (!allUsers.length) return ctx.reply("Користувачів поки немає", adminMenu());
  const text = allUsers
    .slice(-20).reverse()
    .map((u) =>
      `ID: ${u.id}\nІм'я: ${u.firstName || "-"}\nUsername: @${u.username || "-"}\nБаланс: ${u.balance}\nКуплено фото: ${u.purchasedPhotos || 0}\nГенерацій: ${u.generations || 0}\nРеєстрація: ${u.createdAt ? u.createdAt.slice(0, 10) : "-"}`
    )
    .join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("💳 Останні оплати", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  if (!payments.length) return ctx.reply("Оплат поки немає", adminMenu());
  const text = payments
    .slice(-20).reverse()
    .map((p) =>
      `Order: ${p.orderReference || "-"}\nUser ID: ${p.userId || "-"}\nПакет: ${p.packKey || "-"}\nСума: ${p.amount || "-"}\nСтатус: ${p.status || "-"}\nЧас: ${p.updatedAt || p.createdAt || "-"}`
    )
    .join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("📝 Поточні промти", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  const text = Object.entries(prompts).map(([key, value]) => `${key}:\n${value}`).join("\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("✏️ Змінити промт", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  resetAdminState(ctx);
  return ctx.reply("Обери який промт змінити:", adminPromptsMenu());
});

bot.hears(["portrait", "beauty", "fashion", "art", "trend"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  if (!["portrait", "beauty", "fashion", "art", "trend"].includes(ctx.message.text)) return;
  ctx.session.awaitingPromptEditKey = ctx.message.text;
  return ctx.reply(
    `Ключ: ${ctx.message.text}\n\nПоточний промт:\n${prompts[ctx.message.text]}\n\nНадішли новий промт текстом.`,
    adminMenu()
  );
});

bot.hears("📝 Поточні тексти", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  const text = Object.entries(content).map(([key, value]) => `${key}:\n${value}`).join("\n\n====================\n\n");
  return ctx.reply(text, adminMenu());
});

bot.hears("✏️ Змінити текст", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");
  resetAdminState(ctx);
  return ctx.reply("Обери який текст змінити:", adminTextsMenu());
});

bot.hears(["welcomeText", "infoText", "helpText", "supportText"], (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return;
  if (!["welcomeText", "infoText", "helpText", "supportText"].includes(ctx.message.text)) return;
  ctx.session.awaitingTextEditKey = ctx.message.text;
  return ctx.reply(
    `Ключ: ${ctx.message.text}\n\nПоточний текст:\n${content[ctx.message.text]}\n\nНадішли новий текст.`,
    adminMenu()
  );
});

bot.hears("↩️ Назад", (ctx) => {
  touchUser(ctx);
  resetAdminState(ctx);
  return ctx.reply("Повертаю звичайне меню ✨", mainMenu());
});

bot.hears("ℹ️ Інфо", (ctx) => {
  touchUser(ctx);
  return ctx.reply(content.infoText, mainMenu());
});

bot.hears("❓ Допомога", (ctx) => {
  touchUser(ctx);
  return ctx.reply(content.helpText, mainMenu());
});

bot.hears("🆘 Підтримка", (ctx) => {
  touchUser(ctx);
  return ctx.reply(content.supportText, mainMenu());
});

bot.hears("📊 Баланс", (ctx) => {
  const user = touchUser(ctx);
  if (isAdmin(ctx.from.id)) {
    return ctx.reply("📊 Статус: адмін\nГенерації: безліміт ✅\nДоступ до всіх кнопок відкрито ✅", adminMenu());
  }
  return ctx.reply(
    `📊 Твій баланс:\nФото: ${user.balance}\nБезкоштовне фото використано: ${user.freeUsed ? "так" : "ні"}\nВсього генерацій: ${user.generations || 0}`,
    mainMenu()
  );
});

bot.hears("💳 Купити", (ctx) => {
  touchUser(ctx);
  if (isAdmin(ctx.from.id)) return ctx.reply("✅ Ти адмін, для тебе генерації безкоштовні.", adminMenu());
  return ctx.reply("Обери пакет:", buyMenu());
});

async function sendAutoPayment(ctx, packKey) {
  try {
    const user = touchUser(ctx);
    const pack = PACKAGES[packKey];
    const { invoiceUrl, orderReference } = await createWayForPayInvoice(ctx.from.id, packKey);
    user.pendingOrderReference = orderReference;
    user.lastPaymentRequest = { packKey, packageTitle: pack.title, createdAt: new Date().toISOString() };
    saveUsers();
    return ctx.reply(
      `Пакет: ${pack.title}\nЦіна: ${pack.priceText}\n\nНатисни кнопку для оплати.`,
      paymentInlineKeyboard(invoiceUrl, pack)
    );
  } catch (e) {
    console.error("AUTO PAYMENT ERROR:", e.response?.data || e.message || e);
    return ctx.reply("❌ Не вдалося створити рахунок на оплату.");
  }
}

bot.hears("10 фото", (ctx) => sendAutoPayment(ctx, "pack10"));
bot.hears("20 фото", (ctx) => sendAutoPayment(ctx, "pack20"));
bot.hears("30 фото", (ctx) => sendAutoPayment(ctx, "pack30"));

bot.action(/^checkpay_(pack10|pack20|pack30)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery("Якщо оплата вже пройшла, фото будуть зараховані автоматично");
  } catch (e) {
    console.error("CHECKPAY ERROR:", e.message);
  }
});

bot.hears("👩 Портрет", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "portrait"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("💄 Б'юті", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "beauty"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("📸 Fashion", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "fashion"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("🎨 Арт", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "art"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("🔥 Тренд", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "trend"; ctx.session.awaitingCustomPrompt = false; ctx.session.customPrompt = null;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("✍️ Свій промт", (ctx) => {
  touchUser(ctx); ensureSession(ctx);
  ctx.session.mode = "custom"; ctx.session.awaitingCustomPrompt = true; ctx.session.customPrompt = null;
  return ctx.reply("Напиши промт текстом, а потім надішли фото.", mainMenu());
});

bot.on("text", async (ctx, next) => {
  try {
    ensureSession(ctx);
    touchUser(ctx);
    const text = ctx.message.text;
    const menuButtons = [
      "👩 Портрет", "💄 Б'юті", "📸 Fashion", "🎨 Арт", "🔥 Тренд", "✍️ Свій промт",
      "💳 Купити", "📊 Баланс", "10 фото", "20 фото", "30 фото",
      "📊 Статус бота", "👤 Мій ID", "👥 Користувачі", "💳 Останні оплати",
      "✏️ Змінити промт", "📝 Поточні промти", "✏️ Змінити текст", "📝 Поточні тексти",
      "portrait", "beauty", "fashion", "art", "trend",
      "welcomeText", "infoText", "helpText", "supportText",
      "ℹ️ Інфо", "❓ Допомога", "🆘 Підтримка", "↩️ Назад",
    ];
    if (menuButtons.includes(text) || text.startsWith("/")) return next();
    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptEditKey) {
      const key = ctx.session.awaitingPromptEditKey;
      prompts[key] = text;
      savePrompts();
      ctx.session.awaitingPromptEditKey = null;
      return ctx.reply(`✅ Промт для ${key} оновлено і збережено.\n\nНовий промт:\n${prompts[key]}`, adminMenu());
    }
    if (isAdmin(ctx.from.id) && ctx.session.awaitingTextEditKey) {
      const key = ctx.session.awaitingTextEditKey;
      content[key] = text;
      saveContent();
      ctx.session.awaitingTextEditKey = null;
      return ctx.reply(`✅ Текст ${key} оновлено і збережено.\n\nНовий текст:\n${content[key]}`, adminMenu());
    }
    if (ctx.session.mode === "custom" && ctx.session.awaitingCustomPrompt) {
      ctx.session.customPrompt = text;
      ctx.session.awaitingCustomPrompt = false;
      return ctx.reply("Промт збережено ✅\nТепер надішли фото.", mainMenu());
    }
    return ctx.reply("Обери режим через меню або натисни /start", mainMenu());
  } catch (e) {
    console.error("TEXT HANDLER ERROR:", e.message);
    return ctx.reply("Сталася помилка 😢", mainMenu());
  }
});

bot.on("photo", async (ctx) => {
  let chargedFromBalance = false;
  let usedFree = false;
  try {
    ensureSession(ctx);
    const user = touchUser(ctx);
    const userId = ctx.from.id;
    if (userGenerating.has(userId)) {
      return ctx.reply("⏳ Зачекай, твоє фото ще генерується...");
    }
    if (!isAdmin(userId)) {
      const secondsLeft = checkRateLimit(userId);
      if (secondsLeft > 0) {
        return ctx.reply(`⏳ Зачекай ще ${secondsLeft} сек. перед наступною генерацією.`);
      }
    }
    if (!isAdmin(userId)) {
      if (!user.freeUsed) {
        user.freeUsed = true;
        usedFree = true;
      } else if (user.balance <= 0) {
        return ctx.reply(
          "❌ Ліміт вичерпано\nНатисни 💳 Купити",
          Markup.keyboard([["💳 Купити", "📊 Баланс"], ["↩️ Назад"]]).resize()
        );
      } else {
        user.balance -= 1;
        chargedFromBalance = true;
      }
      saveUsers();
    }
    let prompt = "";
    if (ctx.session.mode === "custom") {
      if (!ctx.session.customPrompt) return ctx.reply("Спочатку напиши свій промт текстом.");
      prompt = ctx.session.customPrompt;
    } else {
      if (!ctx.session.mode || !prompts[ctx.session.mode]) return ctx.reply("Спочатку обери режим через /start");
      prompt = prompts[ctx.session.mode];
    }
    userGenerating.add(userId);
    userLastGen[userId] = Date.now();
    await ctx.reply("Генерую... ⏳");
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const image = await getImage(ctx, photo.file_id);
    const falPromise = fal.subscribe("fal-ai/nano-banana-2/edit", {
      input: { prompt, image_urls: [image], resolution: "1K" },
      logs: true,
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("FAL_TIMEOUT")), 120000)
    );
    const result = await Promise.race([falPromise, timeoutPromise]);
    const url = result?.data?.images?.[0]?.url;
    if (!url) throw new Error("fal не повернув зображення");
    user.generations = (user.generations || 0) + 1;
    saveUsers();
    userGenerating.delete(userId);
    if (isAdmin(userId)) {
      return ctx.replyWithPhoto({ url }, { caption: "Готово ✨\nАдмін-режим: безліміт ✅" });
    }
    return ctx.replyWithPhoto({ url }, { caption: `Готово ✨\nЗалишилось фото: ${user.balance}` });
  } catch (e) {
    const userId = ctx.from.id;
    userGenerating.delete(userId);
    console.error("FAL ERROR:", e);
    const user = getUser(userId);
    if (!isAdmin(userId)) {
      if (chargedFromBalance) user.balance += 1;
      if (usedFree) user.freeUsed = false;
      saveUsers();
    }
    const errorMsg = e.message === "FAL_TIMEOUT"
      ? `FAL TIMEOUT: юзер ${userId}`
      : `FAL ERROR: юзер ${userId}\n${e.message}`;
    notifyAdminsError(errorMsg).catch(() => {});
    if (e.message === "FAL_TIMEOUT") {
      return ctx.reply("⏱ Генерація зайняла занадто багато часу. Спробуй ще раз.");
    }
    return ctx.reply("Сталася помилка генерації 😢 Спробуй ще раз.");
  }
});

// ===== EXPRESS =====
const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.status(200).send("Bot is running"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// ===== WAYFORPAY CALLBACK =====
app.post("/payment", async (req, res) => {
  try {
    const rawBody = req.body || {};
    const data = normalizeWayForPayCallbackBody(rawBody);

    console.log("=== WAYFORPAY CALLBACK RECEIVED ===");
    console.log("RAW BODY:", JSON.stringify(rawBody, null, 2));
    console.log("NORMALIZED:", JSON.stringify(data, null, 2));

    const expectedSignature = signWfpCallback(data);
    console.log("SIGNATURE CHECK:");
    console.log("  Expected:", expectedSignature);
    console.log("  Received:", data.merchantSignature);
    console.log("  Match:", expectedSignature === data.merchantSignature);

    if (expectedSignature !== data.merchantSignature) {
      console.error("WAYFORPAY SIGNATURE INVALID");
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const parsed = parseOrderReference(data.orderReference);
    if (!parsed) {
      console.error("WAYFORPAY PARSE ORDER REFERENCE FAILED:", data.orderReference);
      return res.status(200).json(buildWfpAcceptResponse(data.orderReference || "unknown"));
    }

    const { userId, packKey } = parsed;
    const pack = PACKAGES[packKey];
    const user = getUser(userId);

    const txStatus = (data.transactionStatus || "").toLowerCase();
    console.log("TRANSACTION STATUS:", txStatus);

    updatePaymentStatus(data.orderReference, data, txStatus || "callback_received");

    if (txStatus === "approved") {
      if (!hasCreditedPayment(data.orderReference)) {
        const payment = payments.find((p) => p.orderReference === data.orderReference);
        if (payment) {
          payment.status = "credited";
          payment.updatedAt = new Date().toISOString();
          payment.amount = Number(data.amount || 0);
          payment.callback = data;
        }
        user.balance += pack.photos;
        user.purchasedPhotos = (user.purchasedPhotos || 0) + pack.photos;
        user.totalSpent = (user.totalSpent || 0) + Number(data.amount || 0);
        user.pendingOrderReference = null;
        user.lastPaidAt = new Date().toISOString();
        saveUsers();
        savePayments();
        console.log(`✅ CREDITED: user ${userId}, pack ${packKey}, +${pack.photos} фото, balance: ${user.balance}`);
        try {
          await bot.telegram.sendMessage(
            userId,
            `✅ Оплату підтверджено автоматично\n\nПакет: ${pack.title}\nЗараховано: ${pack.photos} фото\nБаланс: ${user.balance}`,
            mainMenu()
          );
        } catch (e) {
          console.error("SEND USER PAYMENT MESSAGE ERROR:", e.message);
        }
        for (const adminId of ADMINS) {
          try {
            await bot.telegram.sendMessage(
              adminId,
              `✅ Автооплата підтверджена\n\nКористувач: ${userId} (@${user.username || "-"})\nПакет: ${pack.title}\nСума: ${data.amount} ${data.currency}\nOrderReference: ${data.orderReference}`
            );
          } catch (e) {
            console.error("SEND ADMIN PAYMENT MESSAGE ERROR:", e.message);
          }
        }
      } else {
        console.log("ALREADY CREDITED, SKIP:", data.orderReference);
      }
    }

    return res.status(200).json(buildWfpAcceptResponse(data.orderReference));
  } catch (error) {
    console.error("WAYFORPAY PAYMENT ERROR:", error);
    return res.status(200).json(buildWfpAcceptResponse("unknown"));
  }
});

// ===== ЗАПУСК EXPRESS ПЕРШИМ — він має бути живий завжди =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server started on port ${PORT}`);
  console.log(`📡 Callback URL: ${WAYFORPAY.serviceUrl || "НЕ ЗАДАНО!"}`);
  console.log(`🏪 Merchant: ${WAYFORPAY.merchantAccount || "НЕ ЗАДАНО!"}`);
  console.log(`🌐 Domain: ${WAYFORPAY.domainName || "НЕ ЗАДАНО!"}`);
});

// ===== ЗАПУСК БОТА ПІСЛЯ EXPRESS — помилка бота НЕ вбиває Express =====
bot.launch({ dropPendingUpdates: true })
  .then(() => {
    console.log("🔥 AI бот запущений");
    console.log("✅ Модель: fal-ai/nano-banana-2/edit");
  })
  .catch((err) => {
    // Бот впав — але Express продовжує працювати і приймати /payment !
    console.error("BOT LAUNCH ERROR:", err.message);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
process.once("SIGUSR2", () => bot.stop("SIGUSR2"));
