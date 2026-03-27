require("dotenv").config();

const fs = require("fs");
const path = require("path");
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

const LIQPAY_LINKS = {
  pack10:
    process.env.LIQPAY_PACK10_URL ||
    "https://www.liqpay.ua/uk/checkout/sandbox_i99667839774",
  pack20:
    process.env.LIQPAY_PACK20_URL ||
    "https://www.liqpay.ua/uk/checkout/sandbox_i99667839774",
  pack30:
    process.env.LIQPAY_PACK30_URL ||
    "https://www.liqpay.ua/uk/checkout/sandbox_i99667839774",
};

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

function getUserStatus(user) {
  if (isAdmin(user.id)) return "admin";

  const total = Number(user.generationsCount || 0);

  if (total >= 51) return "vip";
  if (total >= 21) return "premium";
  if (total >= 6) return "active";
  return "newbie";
}

function getStatusLabel(status) {
  switch (status) {
    case "admin":
      return "Адміністратор 🛠";
    case "vip":
      return "VIP 💠";
    case "premium":
      return "Premium 👑";
    case "active":
      return "Активний 🔥";
    default:
      return "Новачок 🆓";
  }
}

function getNextStatusInfo(totalGenerations) {
  if (totalGenerations < 6) {
    return {
      next: "Активний 🔥",
      left: 6 - totalGenerations,
    };
  }
  if (totalGenerations < 21) {
    return {
      next: "Premium 👑",
      left: 21 - totalGenerations,
    };
  }
  if (totalGenerations < 51) {
    return {
      next: "VIP 💠",
      left: 51 - totalGenerations,
    };
  }
  return null;
}

function formatMyStatusText(user) {
  const status = getUserStatus(user);
  const total = Number(user.generationsCount || 0);
  const next = getNextStatusInfo(total);

  if (status === "admin") {
    return `💎 Мій статус

Ваш поточний статус: Адміністратор 🛠

Ваші привілеї:
• повний доступ до функцій бота
• генерації без списання лімітів
• керування текстами, кнопками, режимами та промтами`;
  }

  if (status === "vip") {
    return `💎 Мій статус

Ваш поточний статус: VIP 💠

Ваші привілеї:
• максимальний пріоритет
• доступ до спеціальних режимів
• бонусні можливості
• першочерговий доступ до новинок

Ваш баланс: ${user.balance}
Всього генерацій: ${total}`;
  }

  if (status === "premium") {
    return `💎 Мій статус

Ваш поточний статус: Premium 👑

Ваші привілеї:
• пріоритетна обробка генерацій
• ексклюзивні режими
• ранній доступ до оновлень
• бонуси та спеціальні пропозиції

Ваш баланс: ${user.balance}
Всього генерацій: ${total}

До статусу VIP 💠 залишилось: ${next ? next.left : 0} генерацій`;
  }

  if (status === "active") {
    return `💎 Мій статус

Ваш поточний статус: Активний 🔥

Ваші привілеї:
• доступ до платних режимів
• повний функціонал стандартного користувача
• участь у системі статусів і бонусів

Ваш баланс: ${user.balance}
Всього генерацій: ${total}

До статусу Premium 👑 залишилось: ${next ? next.left : 0} генерацій`;
  }

  return `💎 Мій статус

Ваш поточний статус: Новачок 🆓

Ваші привілеї:
• 1 безкоштовна генерація
• доступ до базових режимів
• можливість протестувати якість сервісу

Ваш баланс: ${user.balance}
Всього генерацій: ${total}

До статусу Активний 🔥 залишилось: ${next ? next.left : 0} генерацій`;
}

function canUseSurprise(user) {
  const status = getUserStatus(user);
  return ["active", "premium", "vip", "admin"].includes(status);
}

function canUseSecretModes(user) {
  const status = getUserStatus(user);
  return ["premium", "vip", "admin"].includes(status);
}

function generatePromptFromIdea(userText) {
  const text = (userText || "").toLowerCase();

  if (text.includes("естет") || text.includes("гарно") || text.includes("красиво")) {
    return "dreamy aesthetic portrait, soft cinematic light, elegant composition, stylish social media vibe, realistic skin, preserve identity";
  }
  if (text.includes("ніж") || text.includes("романт") || text.includes("soft") || text.includes("пастел")) {
    return "soft romantic portrait, pastel tones, delicate beauty styling, dreamy atmosphere, elegant feminine mood, preserve identity";
  }
  if (text.includes("дорог") || text.includes("люкс") || text.includes("багат") || text.includes("premium")) {
    return "luxury editorial portrait, rich lifestyle aesthetic, expensive outfit, premium background, confident expression, preserve identity";
  }
  if (text.includes("темн") || text.includes("драма") || text.includes("dark") || text.includes("тін")) {
    return "dark cinematic portrait, moody shadows, dramatic contrast, mysterious atmosphere, elegant intensity, preserve identity";
  }
  if (text.includes("бізнес") || text.includes("ділов") || text.includes("linkedin") || text.includes("офіс")) {
    return "professional corporate portrait, polished business style, clean background, confident pose, high-end linkedin headshot, preserve identity";
  }
  if (text.includes("тренд") || text.includes("tiktok") || text.includes("viral") || text.includes("інста")) {
    return "viral social media trend portrait, glossy trendy styling, fashion-forward composition, modern tiktok aesthetic, preserve identity";
  }

  return "stylish high-end portrait, cinematic lighting, fashionable social media aesthetic, realistic face, preserve identity";
}

function findModeByLabel(label) {
  return Object.entries(db.modes).find(([, mode]) => mode.label === label);
}

function clearInteractiveStates(ctx) {
  ctx.session.awaitingWelcomeText = false;
  ctx.session.awaitingWelcomePhoto = false;
  ctx.session.awaitingInfoText = false;
  ctx.session.awaitingHelpText = false;
  ctx.session.awaitingPackagesText = false;
  ctx.session.awaitingStatusesText = false;
  ctx.session.awaitingIdeaPrompt = false;
  ctx.session.awaitingModeEdit = null;
  ctx.session.awaitingUiTextKey = null;
  ctx.session.selectedModeKey = null;
  ctx.session.mode = null;
  ctx.session.customPrompt = null;
}

// ===================== МЕНЮ =====================
function mainMenu() {
  return Markup.keyboard([
    [getUI("wowMenu"), getUI("classicMenu")],
    [getUI("surprise"), getUI("ideaToPrompt")],
    [getUI("customPrompt"), getUI("packages")],
    [getUI("buy"), getUI("balance")],
    [getUI("statuses"), getUI("info")],
    [getUI("promptIdeas"), getUI("support")],
  ]).resize();
}

function statusesMenu() {
  return Markup.keyboard([
    [getUI("myStatus"), getUI("statusesInfo")],
    [getUI("back")],
  ]).resize();
}

function buildModesMenu(group) {
  const rows = [];
  const list = Object.entries(db.modes).filter(([, mode]) => mode.group === group);

  for (let i = 0; i < list.length; i += 2) {
    const row = [list[i][1].label];
    if (list[i + 1]) row.push(list[i + 1][1].label);
    rows.push(row);
  }

  rows.push([getUI("surprise")]);
  rows.push([getUI("back")]);

  return Markup.keyboard(rows).resize();
}

function buyMenu() {
  return Markup.keyboard([
    ["10 фото — 99 грн", "20 фото — 179 грн"],
    ["30 фото — 249 грн"],
    [getUI("back")],
  ]).resize();
}

function adminMenu() {
  return Markup.keyboard([
    ["📈 Статистика", "👤 Мій ID"],
    ["➕ Видати фото", "👥 Користувачі"],
    ["📝 Змінити вітання", "🖼 Змінити фото"],
    ["ℹ️ Змінити інфо", "❓ Змінити help"],
    ["📦 Змінити пакети", "💳 Нарахувати покупку"],
    ["💎 Змінити статуси", "🎭 Керувати режимами"],
    ["🔤 Змінити тексти кнопок", "📋 Контент"],
    ["↩️ Назад"],
  ]).resize();
}

function adminModesMenu() {
  const rows = Object.entries(db.modes).map(([key, mode]) => [
    `${mode.label} | ${key}`,
  ]);
  rows.push(["↩️ Назад"]);
  return Markup.keyboard(rows).resize();
}

function adminModeActionsMenu() {
  return Markup.keyboard([
    ["👁 Показати поточний промт"],
    ["📝 Змінити промт"],
    ["✏️ Змінити назву кнопки"],
    ["🔐 Змінити доступ"],
    ["↩️ Назад"],
  ]).resize();
}

function adminUiTextsMenu() {
  return Markup.keyboard([
    ["wowMenu", "classicMenu"],
    ["surprise", "ideaToPrompt"],
    ["customPrompt", "packages"],
    ["buy", "balance"],
    ["promptIdeas", "support"],
    ["info", "statuses"],
    ["myStatus", "statusesInfo"],
    ["back"],
    ["↩️ Назад"],
  ]).resize();
}

function buyInlineButtons(packKey) {
  return Markup.inlineKeyboard([
    [Markup.button.url(`💳 Оплатити ${getPackageTitle(packKey)}`, LIQPAY_LINKS[packKey])],
    [Markup.button.callback("✅ Я оплатив(ла)", `paid_${packKey}`)],
    [Markup.button.url("🆘 Підтримка", SUPPORT_URL)],
  ]);
}

// ===================== TELEGRAM FILE -> DATA URL =====================
async function getImage(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120000,
  });

  return `data:image/jpeg;base64,${Buffer.from(res.data).toString("base64")}`;
}

// ===================== START =====================
bot.start(async (ctx) => {
  ensureSession(ctx);
  touchUser(ctx);
  clearInteractiveStates(ctx);

  const text = db.content.welcomeText;

  if (db.content.welcomePhoto) {
    return ctx.replyWithPhoto(db.content.welcomePhoto, {
      caption: text,
      ...mainMenu(),
    });
  }

  return ctx.reply(text, mainMenu());
});

// ===================== СЛУЖБОВІ КОМАНДИ =====================
bot.command("myid", (ctx) => {
  touchUser(ctx);
  return ctx.reply(`Твій Telegram ID: ${ctx.from.id}`);
});

bot.command("info", (ctx) => {
  touchUser(ctx);
  return ctx.reply(db.content.infoText, mainMenu());
});

bot.command("help", (ctx) => {
  touchUser(ctx);
  return ctx.reply(db.content.helpText, mainMenu());
});

bot.command("admin", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  clearInteractiveStates(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  return ctx.reply("Адмін-меню:", adminMenu());
});

bot.command("add", async (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  const userId = Number(parts[1]);
  const amount = Number(parts[2]);

  if (!userId || !amount) {
    return ctx.reply("Формат: /add ID КІЛЬКІСТЬ");
  }

  const user = getUser(userId);
  user.balance += amount;
  db.stats.totalManualCredits += amount;
  saveDB();

  await ctx.reply(`✅ Додано ${amount} фото користувачу ${userId}. Баланс: ${user.balance}`);

  try {
    await bot.telegram.sendMessage(
      userId,
      `🎉 Вам нараховано ${amount} фото.\nЗараз на балансі: ${user.balance}`,
      mainMenu()
    );
  } catch (e) {}
});

bot.command("sale", async (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const parts = ctx.message.text.trim().split(/\s+/);
  const userId = Number(parts[1]);
  const packKey = parts[2];

  if (!userId || !["pack10", "pack20", "pack30"].includes(packKey)) {
    return ctx.reply("Формат: /sale ID pack10|pack20|pack30");
  }

  const user = getUser(userId);
  const photos = getPackagePhotos(packKey);

  user.balance += photos;
  user.purchasedPhotos += photos;
  user.pendingPackage = null;
  user.pendingPaymentAt = null;

  db.stats.packageSales[packKey] += 1;
  db.payments.push({
    userId,
    packKey,
    photos,
    amountText: formatMoneyFromPackageKey(packKey),
    status: "manual_confirmed",
    createdAt: new Date().toISOString(),
    adminId: ctx.from.id,
  });

  saveDB();

  await ctx.reply(
    `✅ Підтверджено покупку для ${userId}: ${getPackageTitle(packKey)}. Баланс: ${user.balance}`
  );

  try {
    await bot.telegram.sendMessage(
      userId,
      `✅ Вашу оплату підтверджено.
Пакет: ${getPackageTitle(packKey)}
Додано фото: ${photos}

Зараз на балансі: ${user.balance}`,
      mainMenu()
    );
  } catch (e) {}
});

// ===================== АДМІН-ПАНЕЛЬ =====================
bot.hears("📈 Статистика", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const totalRevenue =
    db.stats.packageSales.pack10 * 99 +
    db.stats.packageSales.pack20 * 179 +
    db.stats.packageSales.pack30 * 249;

  const activeUsers = Object.values(db.users).filter((u) => u.generationsCount > 0).length;
  const totalBalance = Object.values(db.users).reduce((sum, u) => sum + (u.balance || 0), 0);

  const byLevels = {
    "Новачок 🆓": 0,
    "Активний 🔥": 0,
    "Premium 👑": 0,
    "VIP 💠": 0,
    "Адміністратор 🛠": 0,
  };

  Object.values(db.users).forEach((u) => {
    byLevels[getStatusLabel(getUserStatus(u))] += 1;
  });

  return ctx.reply(
    `📈 Статистика бота

👥 Усього користувачів: ${db.stats.totalUsers}
🙋 Активних користувачів: ${activeUsers}
🖼 Усього генерацій: ${db.stats.totalGenerations}
💳 Запитів на оплату: ${db.stats.totalPaymentsRequests}
➕ Ручно нараховано фото: ${db.stats.totalManualCredits}
📦 Залишок фото у всіх користувачів: ${totalBalance}

💰 Продажі пакетів:
10 фото — 99 грн: ${db.stats.packageSales.pack10}
20 фото — 179 грн: ${db.stats.packageSales.pack20}
30 фото — 249 грн: ${db.stats.packageSales.pack30}

💵 Умовний дохід: ${totalRevenue} грн

🏅 Рівні:
Новачок: ${byLevels["Новачок 🆓"]}
Активний: ${byLevels["Активний 🔥"]}
Premium: ${byLevels["Premium 👑"]}
VIP: ${byLevels["VIP 💠"]}
Адмін: ${byLevels["Адміністратор 🛠"]}`,
    adminMenu()
  );
});

bot.hears("👥 Користувачі", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const users = Object.values(db.users)
    .sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt))
    .slice(0, 15);

  if (!users.length) {
    return ctx.reply("Користувачів поки немає.", adminMenu());
  }

  const text = users
    .map((u, i) => {
      const name = u.firstName || u.username || "Без імені";
      return `${i + 1}. ${name} | ID: ${u.id}
Статус: ${getStatusLabel(getUserStatus(u))}
Баланс: ${u.balance}
Генерацій: ${u.generationsCount}
Остання активність: ${u.lastActiveAt}`;
    })
    .join("\n\n");

  return ctx.reply(`👥 Останні користувачі:\n\n${text}`, adminMenu());
});

bot.hears("📝 Змінити вітання", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  ctx.session.awaitingWelcomeText = true;
  return ctx.reply("Надішли новий вітальний текст одним повідомленням.");
});

bot.hears("🖼 Змінити фото", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  ctx.session.awaitingWelcomePhoto = true;
  return ctx.reply("Надішли нове вітальне фото одним зображенням.");
});

bot.hears("ℹ️ Змінити інфо", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  ctx.session.awaitingInfoText = true;
  return ctx.reply("Надішли новий текст для кнопки ℹ️ Інформація одним повідомленням.");
});

bot.hears("❓ Змінити help", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  ctx.session.awaitingHelpText = true;
  return ctx.reply("Надішли новий текст для /help одним повідомленням.");
});

bot.hears("📦 Змінити пакети", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  ctx.session.awaitingPackagesText = true;
  return ctx.reply("Надішли новий текст для кнопки 📦 Пакети одним повідомленням.");
});

bot.hears("💎 Змінити статуси", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  ctx.session.awaitingStatusesText = true;
  return ctx.reply(
  `Надішли новий текст для розділу статусів.

⚙️ Цей текст відображається в кнопці:
"ℹ️ Інформація про статус"

Його можна повністю змінювати через адмін-панель.

Поточний текст:

${db.content.statusesInfoText}`,
  );
});

bot.hears("🎭 Керувати режимами", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  return ctx.reply("Обери режим для редагування 👇", adminModesMenu());
});

bot.hears("🔤 Змінити тексти кнопок", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  clearInteractiveStates(ctx);
  return ctx.reply("Оберіть ключ кнопки, яку хочете змінити 👇", adminUiTextsMenu());
});

bot.hears("📋 Контент", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  return ctx.reply(
    `📋 Поточний контент

Вітання:
${db.content.welcomeText}

Інформація:
${db.content.infoText.substring(0, 500)}${db.content.infoText.length > 500 ? "..." : ""}

Help:
${db.content.helpText.substring(0, 400)}${db.content.helpText.length > 400 ? "..." : ""}

Пакети:
${db.content.packagesText.substring(0, 400)}${db.content.packagesText.length > 400 ? "..." : ""}

Статуси:
${db.content.statusesInfoText.substring(0, 400)}${db.content.statusesInfoText.length > 400 ? "..." : ""}

Фото:
${db.content.welcomePhoto ? "є" : "немає"}`,
    adminMenu()
  );
});

bot.hears("➕ Видати фото", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  return ctx.reply(
    `Щоб видати фото вручну, використай команду:

/add ID КІЛЬКІСТЬ

Наприклад:
/add 123456789 20`,
    adminMenu()
  );
});

bot.hears("💳 Нарахувати покупку", (ctx) => {
  touchUser(ctx);
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ Немає доступу");

  return ctx.reply(
    `Для ручного підтвердження оплати використай:

/sale ID pack10
/sale ID pack20
/sale ID pack30`,
    adminMenu()
  );
});

bot.hears("👤 Мій ID", (ctx) => {
  touchUser(ctx);
  return ctx.reply(`Твій Telegram ID: ${ctx.from.id}`, isAdmin(ctx.from.id) ? adminMenu() : mainMenu());
});

// ===================== КУПІВЛЯ =====================
async function sendLiqPayOffer(ctx, packKey) {
  const user = getUser(ctx.from.id);
  user.pendingPackage = packKey;
  user.pendingPaymentAt = new Date().toISOString();

  db.stats.totalPaymentsRequests += 1;
  db.stats.packageClicks[packKey] += 1;
  saveDB();

  return ctx.reply(
    `Обрано пакет:
${getPackageTitle(packKey)}

Натисни кнопку нижче для оплати.
Після оплати натисни "Я оплатив(ла)".
Якщо фото не зарахуються автоматично — напиши в підтримку.`,
    buyInlineButtons(packKey)
  );
}

bot.action(/^paid_(pack10|pack20|pack30)$/, async (ctx) => {
  try {
    const packKey = ctx.match[1];
    const user = getUser(ctx.from.id);

    user.pendingPackage = packKey;
    user.pendingPaymentAt = new Date().toISOString();
    saveDB();

    await ctx.answerCbQuery("Заявку зафіксовано");

    await ctx.reply(
      `✅ Я зафіксував твою заявку на перевірку оплати.

Пакет: ${getPackageTitle(packKey)}
Твій ID: ${ctx.from.id}

Якщо фото не нарахуються швидко, напиши в підтримку:
${SUPPORT_URL}`,
      mainMenu()
    );

    for (const adminId of ADMINS) {
      try {
        await bot.telegram.sendMessage(
          adminId,
          `💳 Нова заявка на перевірку оплати

Користувач: ${ctx.from.first_name || ""}
Username: ${ctx.from.username ? "@" + ctx.from.username : "-"}
ID: ${ctx.from.id}
Пакет: ${getPackageTitle(packKey)}

Для підтвердження:
/sale ${ctx.from.id} ${packKey}`
        );
      } catch (e) {}
    }
  } catch (e) {
    console.error("PAID ACTION ERROR:", e);
  }
});

// ===================== ОБРОБКА ТЕКСТУ =====================
bot.on("text", async (ctx, next) => {
  touchUser(ctx);
  ensureSession(ctx);

  const text = ctx.message.text;

  if (text === getUI("back") || text === "↩️ Назад") {
    clearInteractiveStates(ctx);

    if (isAdmin(ctx.from.id)) {
      return ctx.reply("Повертаю меню 👇", mainMenu());
    }

    return ctx.reply("Повертаю звичайне меню ✨", mainMenu());
  }

  // ---------- admin editing states ----------
  if (isAdmin(ctx.from.id)) {
    if (ctx.session.awaitingWelcomeText) {
      db.content.welcomeText = text;
      ctx.session.awaitingWelcomeText = false;
      saveDB();
      return ctx.reply("✅ Вітальний текст оновлено.", adminMenu());
    }

    if (ctx.session.awaitingInfoText) {
      db.content.infoText = text;
      ctx.session.awaitingInfoText = false;
      saveDB();
      return ctx.reply("✅ Текст інформації оновлено.", adminMenu());
    }

    if (ctx.session.awaitingHelpText) {
      db.content.helpText = text;
      ctx.session.awaitingHelpText = false;
      saveDB();
      return ctx.reply("✅ Текст help оновлено.", adminMenu());
    }

    if (ctx.session.awaitingPackagesText) {
      db.content.packagesText = text;
      ctx.session.awaitingPackagesText = false;
      saveDB();
      return ctx.reply("✅ Текст пакетів оновлено.", adminMenu());
    }

    if (ctx.session.awaitingStatusesText) {
      db.content.statusesInfoText = text;
      ctx.session.awaitingStatusesText = false;
      saveDB();
      return ctx.reply("✅ Текст статусів оновлено.", adminMenu());
    }

    if (ctx.session.awaitingUiTextKey) {
      const key = ctx.session.awaitingUiTextKey;
      db.uiTexts[key] = text;
      ctx.session.awaitingUiTextKey = null;
      saveDB();
      return ctx.reply(`✅ Текст кнопки "${key}" оновлено.`, adminMenu());
    }

    if (ctx.session.awaitingModeEdit) {
      const modeKey = ctx.session.selectedModeKey;

      const cancelTexts = [
        getUI("info"),
        getUI("statuses"),
        getUI("myStatus"),
        getUI("statusesInfo"),
        getUI("balance"),
        getUI("buy"),
        getUI("packages"),
        getUI("support"),
        getUI("wowMenu"),
        getUI("classicMenu"),
        getUI("customPrompt"),
        getUI("ideaToPrompt"),
        getUI("promptIdeas"),
      ];

      if (cancelTexts.includes(text)) {
        ctx.session.awaitingModeEdit = null;
        ctx.session.selectedModeKey = null;
        return next();
      }

      if (!modeKey || !db.modes[modeKey]) {
        ctx.session.awaitingModeEdit = null;
        ctx.session.selectedModeKey = null;
        return ctx.reply("❌ Режим не знайдено.", adminMenu());
      }

      if (ctx.session.awaitingModeEdit === "prompt") {
        db.modes[modeKey].prompt = text;
        ctx.session.awaitingModeEdit = null;
        saveDB();
        return ctx.reply("✅ Промт оновлено.", adminModeActionsMenu());
      }

      if (ctx.session.awaitingModeEdit === "label") {
        db.modes[modeKey].label = text;
        ctx.session.awaitingModeEdit = null;
        saveDB();
        return ctx.reply("✅ Назву кнопки оновлено.", adminModeActionsMenu());
      }

      if (ctx.session.awaitingModeEdit === "access") {
        const accessValue = text.trim().toLowerCase();

        if (!["all", "secret"].includes(accessValue)) {
          return ctx.reply('Доступ має бути тільки "all" або "secret".');
        }

        db.modes[modeKey].access = accessValue;
        ctx.session.awaitingModeEdit = null;
        saveDB();
        return ctx.reply("✅ Рівень доступу оновлено.", adminModeActionsMenu());
      }
    }
  }

  // ---------- custom prompt / idea ----------
  if (ctx.session.awaitingIdeaPrompt) {
    const generatedPrompt = generatePromptFromIdea(text);
    ctx.session.mode = "custom";
    ctx.session.customPrompt = generatedPrompt;
    ctx.session.awaitingIdeaPrompt = false;

    return ctx.reply(
      `🧠 Я зібрав для тебе промт:

${generatedPrompt}

Тепер надішли фото 📸`
    );
  }

  if (ctx.session.mode === "custom" && !text.startsWith("/") && !findModeByLabel(text)) {
    const reservedTexts = [
      getUI("wowMenu"),
      getUI("classicMenu"),
      getUI("surprise"),
      getUI("ideaToPrompt"),
      getUI("customPrompt"),
      getUI("packages"),
      getUI("buy"),
      getUI("balance"),
      getUI("promptIdeas"),
      getUI("support"),
      getUI("info"),
      getUI("statuses"),
      getUI("myStatus"),
      getUI("statusesInfo"),
      getUI("back"),
    ];

    if (!reservedTexts.includes(text)) {
      ctx.session.customPrompt = text;
      return ctx.reply("Промт збережено ✅\nТепер надішли фото.");
    }
  }

  // ---------- dynamic main buttons ----------
  if (text === getUI("info")) {
    incrementButtonStat("info");
    return ctx.reply(db.content.infoText, mainMenu());
  }

  if (text === getUI("packages")) {
    incrementButtonStat("packages");
    return ctx.reply(db.content.packagesText, mainMenu());
  }

  if (text === getUI("promptIdeas")) {
    incrementButtonStat("promptsIdeas");
    return ctx.reply(
      "💡 Ідеї промтів тут:",
      Markup.inlineKeyboard([[Markup.button.url("Перейти в канал", PROMPTS_CHANNEL_URL)]])
    );
  }

  if (text === getUI("support")) {
    incrementButtonStat("support");
    return ctx.reply(
      "🆘 Якщо щось пішло не так, напиши в підтримку:",
      Markup.inlineKeyboard([[Markup.button.url("Відкрити чат підтримки", SUPPORT_URL)]])
    );
  }

  if (text === getUI("balance")) {
    incrementButtonStat("balance");

    const user = getUser(ctx.from.id);

    if (isAdmin(ctx.from.id)) {
      return ctx.reply("📊 Статус: адмін\nГенерації: безліміт ✅", mainMenu());
    }

    return ctx.reply(
      `📊 Твій баланс

Фото: ${user.balance}
Статус: ${getStatusLabel(getUserStatus(user))}
Згенеровано: ${user.generationsCount}
Куплено фото: ${user.purchasedPhotos}
Безкоштовне фото використано: ${user.freeUsed ? "так" : "ні"}

Якщо ти вже оплатив(ла), але фото ще не зараховані — напиши в підтримку:
${SUPPORT_URL}`,
      mainMenu()
    );
  }

  if (text === getUI("buy")) {
    incrementButtonStat("buy");

    if (isAdmin(ctx.from.id)) {
      return ctx.reply("✅ Ти адмін, для тебе генерації безкоштовні.", mainMenu());
    }

    return ctx.reply(
      `💳 Пакети фото:

10 фото — 99 грн
20 фото — 179 грн
30 фото — 249 грн

Обери пакет:`,
      buyMenu()
    );
  }

  if (text === getUI("statuses")) {
    incrementButtonStat("statuses");
    return ctx.reply("Оберіть розділ 👇", statusesMenu());
  }

  if (text === getUI("myStatus")) {
    incrementButtonStat("myStatus");
    const user = getUser(ctx.from.id);
    return ctx.reply(formatMyStatusText(user), statusesMenu());
  }

  if (text === getUI("statusesInfo")) {
    incrementButtonStat("statusesInfo");
    return ctx.reply(db.content.statusesInfoText, statusesMenu());
  }

  if (text === getUI("wowMenu")) {
    incrementButtonStat("wow");
    return ctx.reply("✨ Обери ВАУ-режим:", buildModesMenu("wow"));
  }

  if (text === getUI("classicMenu")) {
    incrementButtonStat("classic");
    return ctx.reply("🎨 Обери класичний стиль:", buildModesMenu("classic"));
  }

  if (text === getUI("surprise")) {
    incrementButtonStat("surprise");
    const user = getUser(ctx.from.id);

    if (!canUseSurprise(user)) {
      return ctx.reply(
        "🔒 Режим сюрпризу відкривається з рівня Активний.\nЗроби ще кілька генерацій і він стане доступним ✨",
        mainMenu()
      );
    }

    const randomMode =
      WOW_RANDOM_MODES[Math.floor(Math.random() * WOW_RANDOM_MODES.length)];
    ctx.session.mode = randomMode;
    ctx.session.customPrompt = null;
    ctx.session.awaitingIdeaPrompt = false;

    return ctx.reply("🎲 Я обрав для тебе вау-режим. Надішли фото 📸");
  }

  if (text === getUI("customPrompt")) {
    clearInteractiveStates(ctx);
    ctx.session.mode = "custom";
    return ctx.reply("Напиши промт текстом, а потім надішли фото.");
  }

  if (text === getUI("ideaToPrompt")) {
    incrementButtonStat("promptIdea");
    clearInteractiveStates(ctx);
    ctx.session.mode = "idea_prompt";
    ctx.session.awaitingIdeaPrompt = true;

    return ctx.reply(
      `Напиши свою ідею простими словами.
Наприклад:
- хочу щось естетичне
- хочу дорогий стиль
- хочу ніжний образ
- хочу темну атмосферу`
    );
  }

  // ---------- packages buttons ----------
  if (text === "10 фото — 99 грн") return sendLiqPayOffer(ctx, "pack10");
  if (text === "20 фото — 179 грн") return sendLiqPayOffer(ctx, "pack20");
  if (text === "30 фото — 249 грн") return sendLiqPayOffer(ctx, "pack30");

  // ---------- admin: choose mode ----------
  if (isAdmin(ctx.from.id)) {
    const adminModeFound = Object.entries(db.modes).find(
      ([key, mode]) => text === `${mode.label} | ${key}`
    );

    if (adminModeFound) {
      const [modeKey] = adminModeFound;
      clearInteractiveStates(ctx);
      ctx.session.selectedModeKey = modeKey;

      return ctx.reply(
        `Режим: ${db.modes[modeKey].label}
Ключ: ${modeKey}
Доступ: ${db.modes[modeKey].access}

Оберіть дію 👇`,
        adminModeActionsMenu()
      );
    }

    if (text === "👁 Показати поточний промт") {
      const modeKey = ctx.session.selectedModeKey;
      if (!modeKey || !db.modes[modeKey]) {
        return ctx.reply("Спочатку обери режим 👇", adminModesMenu());
      }

      return ctx.reply(
        `Поточний промт для "${db.modes[modeKey].label}":

${db.modes[modeKey].prompt}`,
        adminModeActionsMenu()
      );
    }

    if (text === "📝 Змінити промт") {
      const modeKey = ctx.session.selectedModeKey;
      if (!modeKey || !db.modes[modeKey]) {
        return ctx.reply("Спочатку обери режим 👇", adminModesMenu());
      }

      ctx.session.awaitingModeEdit = "prompt";
      return ctx.reply(
        `Надішли новий промт для "${db.modes[modeKey].label}"

Поточний промт:
${db.modes[modeKey].prompt}`,
        Markup.removeKeyboard()
      );
    }

    if (text === "✏️ Змінити назву кнопки") {
      const modeKey = ctx.session.selectedModeKey;
      if (!modeKey || !db.modes[modeKey]) {
        return ctx.reply("Спочатку обери режим 👇", adminModesMenu());
      }

      ctx.session.awaitingModeEdit = "label";
      return ctx.reply(
        `Надішли нову назву кнопки для режиму "${db.modes[modeKey].label}"`,
        Markup.removeKeyboard()
      );
    }

    if (text === "🔐 Змінити доступ") {
      const modeKey = ctx.session.selectedModeKey;
      if (!modeKey || !db.modes[modeKey]) {
        return ctx.reply("Спочатку обери режим 👇", adminModesMenu());
      }

      ctx.session.awaitingModeEdit = "access";
      return ctx.reply(
        `Надішли новий доступ для "${db.modes[modeKey].label}"

Доступні значення:
all
secret`,
        Markup.removeKeyboard()
      );
    }

    const uiKeys = [
      "wowMenu",
      "classicMenu",
      "surprise",
      "ideaToPrompt",
      "customPrompt",
      "packages",
      "buy",
      "balance",
      "promptIdeas",
      "support",
      "info",
      "statuses",
      "myStatus",
      "statusesInfo",
      "back",
    ];

    if (uiKeys.includes(text)) {
      clearInteractiveStates(ctx);
      ctx.session.awaitingUiTextKey = text;
      return ctx.reply(
        `Поточне значення "${text}":
${getUI(text)}

Надішли новий текст:`,
        Markup.removeKeyboard()
      );
    }
  }

  // ---------- dynamic modes ----------
  const foundMode = findModeByLabel(text);
  if (foundMode) {
    const [modeKey, mode] = foundMode;
    const user = getUser(ctx.from.id);

    if (mode.access === "secret" && !canUseSecretModes(user)) {
      return ctx.reply(
        "🔒 Цей режим доступний від статусу Premium 👑\nГенеруй більше фото, щоб відкрити секретні стилі ✨",
        buildModesMenu(mode.group)
      );
    }

    clearInteractiveStates(ctx);
    ctx.session.mode = modeKey;

    return ctx.reply(`Обрано режим: ${mode.label}\nНадішли фото 📸`);
  }

  return next();
});

// ===================== ОБРОБКА ФОТО =====================
bot.on("photo", async (ctx) => {
  try {
    touchUser(ctx);
    ensureSession(ctx);

    const user = getUser(ctx.from.id);

    if (ctx.session.awaitingWelcomePhoto && isAdmin(ctx.from.id)) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      db.content.welcomePhoto = photo.file_id;
      ctx.session.awaitingWelcomePhoto = false;
      saveDB();
      return ctx.reply("✅ Вітальне фото оновлено.", adminMenu());
    }

    let prompt = "";

    if (ctx.session.mode === "custom") {
      if (!ctx.session.customPrompt) {
        return ctx.reply("Спочатку напиши промт текстом.");
      }
      prompt = ctx.session.customPrompt;
    } else {
      if (!ctx.session.mode || !db.modes[ctx.session.mode]) {
        return ctx.reply("Спочатку обери режим через /start");
      }
      prompt = db.modes[ctx.session.mode].prompt;
    }

    let spentPaidPhoto = false;
    let spentFreeTry = false;

    if (!isAdmin(ctx.from.id)) {
      if (!user.freeUsed) {
        user.freeUsed = true;
        spentFreeTry = true;
      } else if (user.balance <= 0) {
        saveDB();
        return ctx.reply(
          "❌ Ліміт вичерпано.\nНатисни 💳 Купити",
          Markup.keyboard([
            [getUI("buy"), getUI("balance")],
            [getUI("packages"), getUI("support")],
            [getUI("info"), getUI("back")],
          ]).resize()
        );
      } else {
        user.balance -= 1;
        spentPaidPhoto = true;
      }
    }

    saveDB();

    await ctx.reply("Генерую... ⏳");

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const image = await getImage(ctx, photo.file_id);

    const result = await fal.subscribe("fal-ai/nano-banana-2/edit", {
      input: {
        prompt,
        image_urls: [image],
        resolution: "1K",
      },
      logs: true,
    });

    const url = result?.data?.images?.[0]?.url;

    if (!url) {
      if (!isAdmin(ctx.from.id)) {
        if (spentPaidPhoto) user.balance += 1;
        if (spentFreeTry) user.freeUsed = false;
        saveDB();
      }
      return ctx.reply("Помилка: сервіс не повернув зображення");
    }

    user.generationsCount += 1;
    db.stats.totalGenerations += 1;
    saveDB();

    const statusLabel = getStatusLabel(getUserStatus(user));

    ctx.session.mode = null;
    ctx.session.customPrompt = null;
    ctx.session.awaitingIdeaPrompt = false;

    if (isAdmin(ctx.from.id)) {
      return ctx.replyWithPhoto(
        { url },
        { caption: `Готово ✨\n\nАдмін-режим: безліміт ✅` }
      );
    }

    return ctx.replyWithPhoto(
      { url },
      {
        caption: `Готово ✨

Статус: ${statusLabel}
Залишилось фото: ${user.balance}`,
      }
    );
  } catch (e) {
    console.error("FAL ERROR:", e);
    await ctx.reply("Сталася помилка генерації 😢");
  }
});

// ===================== STOP =====================
bot.catch((err) => {
  console.error("BOT ERROR:", err);
});

bot.launch();
console.log("🔥 AI бот запущений");