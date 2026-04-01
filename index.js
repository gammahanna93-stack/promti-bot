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

// ===== АДМІНИ =====
const ADMINS = [346101852, 688515215];

// ===== ФАЙЛИ =====
const USERS_PATH = path.join(__dirname, "users.json");
const PROMPTS_PATH = path.join(__dirname, "prompts.json");

// ===== ПОЧАТКОВІ ПРОМТИ =====
const DEFAULT_PROMPTS = {
  portrait:
    "ultra realistic portrait, studio lighting, preserve face, do not change identity",
  beauty:
    "beauty editorial, glossy skin, preserve face, do not change identity",
  fashion:
    "high fashion photoshoot, preserve face, do not change identity",
  art:
    "digital art, artistic portrait, preserve face, do not change identity",
  trend:
    "viral instagram aesthetic, preserve face, do not change identity",
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

// якщо у prompts.json чогось не вистачає — добиваємо дефолти
prompts = {
  ...DEFAULT_PROMPTS,
  ...prompts,
};
saveJson(PROMPTS_PATH, prompts);

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
  ctx.session.awaitingCustomPrompt = false;
  ctx.session.mode = null;
}

function getUser(id) {
  if (!users[id]) {
    users[id] = {
      id,
      freeUsed: false,
      balance: 0,
      generations: 0,
      username: "",
      firstName: "",
      lastPaymentRequest: null,
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

const PACKAGES = {
  pack10: {
    key: "pack10",
    title: "10 фото",
    description: "Пакет на 10 генерацій фото",
    photos: 10,
    priceText: "99 грн",
    payUrl: "https://secure.wayforpay.com/button/ba90217402320",
  },
  pack20: {
    key: "pack20",
    title: "20 фото",
    description: "Пакет на 20 генерацій фото",
    photos: 20,
    priceText: "179 грн",
    payUrl: "https://secure.wayforpay.com/button/bac9e55d000d0",
  },
  pack30: {
    key: "pack30",
    title: "30 фото",
    description: "Пакет на 30 генерацій фото",
    photos: 30,
    priceText: "249 грн",
    payUrl: "https://secure.wayforpay.com/button/bc10cd31f8c55",
  },
};

function mainMenu() {
  return Markup.keyboard([
    ["👩 Портрет", "💄 Б'юті"],
    ["📸 Fashion", "🎨 Арт"],
    ["🔥 Тренд", "✍️ Свій промт"],
    ["💳 Купити", "📊 Баланс"],
    ["ℹ️ Інфо", "🆘 Підтримка"],
    ["⚙️ Адмін"],
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
    ["👥 Користувачі", "📦 Останні заявки"],
    ["✏️ Змінити промт", "📝 Поточні промти"],
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

function paymentInlineKeyboard(pack) {
  return Markup.inlineKeyboard([
    [Markup.button.url(`💳 Оплатити ${pack.title} — ${pack.priceText}`, pack.payUrl)],
    [Markup.button.callback(`✅ Я оплатив(ла) ${pack.title}`, `paid_${pack.key}`)],
  ]);
}

async function getImage(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120000,
  });

  return `data:image/jpeg;base64,${Buffer.from(res.data).toString("base64")}`;
}

async function notifyAdminsAboutPaymentRequest(ctx, pack) {
  for (const adminId of ADMINS) {
    try {
      await bot.telegram.sendMessage(
        adminId,
        `🔔 Нова заявка на перевірку оплати

Користувач: ${ctx.from.id}
Ім'я: ${ctx.from.first_name || "-"}
Username: @${ctx.from.username || "-"}

Пакет: ${pack.title}
Ціна: ${pack.priceText}

Для зарахування:
 /add ${ctx.from.id} ${pack.photos}`
      );
    } catch (e) {
      console.error("ADMIN NOTIFY ERROR:", e.message);
    }
  }
}

// ===== START =====
bot.start((ctx) => {
  ensureSession(ctx);
  touchUser(ctx);
  resetAdminState(ctx);

  return ctx.reply(
    `Привіт ✨

🎁 1 фото безкоштовно

💳 Пакети:
10 фото — 99 грн
20 фото — 179 грн
30 фото — 249 грн

Обери режим:`,
    mainMenu()
  );
});

// ===== КОМАНДИ =====
bot.command("myid", (ctx) => {
  touchUser(ctx);
  return ctx.reply(`Твій Telegram ID: ${ctx.from.id}`);
});

// /add 123456789 20
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
  saveJson(USERS_PATH, users);

  await ctx.reply(`✅ Додано ${amount} фото користувачу ${userId}`);

  bot.telegram
    .sendMessage(
      userId,
      `🎉 Вам нараховано ${amount} генерацій

Зараз на балансі: ${user.balance}`,
      mainMenu()
    )
    .catch(() => {});
});

// ===== АДМІН =====
bot.command("admin", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  resetAdminState(ctx);
  return ctx.reply("Адмін-меню:", adminMenu());
});

bot.hears("⚙️ Адмін", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  resetAdminState(ctx);
  return ctx.reply("Адмін-меню:", adminMenu());
});

bot.hears("📊 Статус бота", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const usersCount = Object.keys(users).length;
  return ctx.reply(
    `Бот працює ✅
Fal підключений ✅
Модель: nano-banana-2 ✅
Користувачів: ${usersCount}`,
    adminMenu()
  );
});

bot.hears("👤 Мій ID", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  return ctx.reply(`Твій Telegram ID: ${ctx.from.id}`, adminMenu());
});

bot.hears("👥 Користувачі", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const allUsers = Object.values(users);
  if (!allUsers.length) {
    return ctx.reply("Користувачів поки немає", adminMenu());
  }

  const text = allUsers
    .slice(-20)
    .reverse()
    .map(
      (u) =>
        `ID: ${u.id}
Ім'я: ${u.firstName || "-"}
Username: @${u.username || "-"}
Баланс: ${u.balance}
Генерацій: ${u.generations || 0}`
    )
    .join("\n\n");

  return ctx.reply(text, adminMenu());
});

bot.hears("📦 Останні заявки", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const allUsers = Object.values(users)
    .filter((u) => u.lastPaymentRequest)
    .sort(
      (a, b) =>
        new Date(b.lastPaymentRequest.createdAt).getTime() -
        new Date(a.lastPaymentRequest.createdAt).getTime()
    )
    .slice(0, 20);

  if (!allUsers.length) {
    return ctx.reply("Заявок на оплату поки немає", adminMenu());
  }

  const text = allUsers
    .map(
      (u) =>
        `ID: ${u.id}
Ім'я: ${u.firstName || "-"}
Username: @${u.username || "-"}
Пакет: ${u.lastPaymentRequest.packageTitle}
Час: ${u.lastPaymentRequest.createdAt}`
    )
    .join("\n\n");

  return ctx.reply(text, adminMenu());
});

bot.hears("📝 Поточні промти", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  const text = Object.entries(prompts)
    .map(([key, value]) => `${key}:\n${value}`)
    .join("\n\n");

  return ctx.reply(text, adminMenu());
});

bot.hears("✏️ Змінити промт", (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ Немає доступу");
  }

  resetAdminState(ctx);
  return ctx.reply("Обери який промт змінити:", adminPromptsMenu());
});

bot.hears(["portrait", "beauty", "fashion", "art", "trend"], (ctx) => {
  touchUser(ctx);

  if (!isAdmin(ctx.from.id)) return;
  if (!["portrait", "beauty", "fashion", "art", "trend"].includes(ctx.message.text)) return;

  ctx.session.awaitingPromptEditKey = ctx.message.text;

  return ctx.reply(
    `Ключ: ${ctx.message.text}

Поточний промт:
${prompts[ctx.message.text]}

Надішли новий промт текстом.`,
    adminMenu()
  );
});

// ===== НАЗАД =====
bot.hears("↩️ Назад", (ctx) => {
  touchUser(ctx);
  resetAdminState(ctx);
  return ctx.reply("Повертаю звичайне меню ✨", mainMenu());
});

// ===== ІНФО / ПІДТРИМКА =====
bot.hears("ℹ️ Інфо", (ctx) => {
  touchUser(ctx);
  return ctx.reply(
    `PROMTI AI Bot

🎁 1 фото безкоштовно
💳 Пакети:
10 фото — 99 грн
20 фото — 179 грн
30 фото — 249 грн

Надішли фото та обери стиль.`,
    mainMenu()
  );
});

bot.hears("🆘 Підтримка", (ctx) => {
  touchUser(ctx);
  return ctx.reply("Напиши в підтримку: https://t.me/promteamai?direct", mainMenu());
});

// ===== БАЛАНС =====
bot.hears("📊 Баланс", (ctx) => {
  const user = touchUser(ctx);

  if (isAdmin(ctx.from.id)) {
    return ctx.reply(
      "📊 Статус: адмін\nГенерації: безліміт ✅\nДоступ до всіх кнопок відкрито ✅",
      mainMenu()
    );
  }

  return ctx.reply(
    `📊 Твій баланс:
Фото: ${user.balance}
Безкоштовне фото використано: ${user.freeUsed ? "так" : "ні"}
Всього генерацій: ${user.generations || 0}`,
    mainMenu()
  );
});

// ===== КУПІВЛЯ =====
bot.hears("💳 Купити", (ctx) => {
  touchUser(ctx);

  if (isAdmin(ctx.from.id)) {
    return ctx.reply(
      "✅ Ти адмін, для тебе генерації безкоштовні.",
      isAdmin(ctx.from.id) ? adminMenu() : mainMenu()
    );
  }

  return ctx.reply("Обери пакет:", buyMenu());
});

bot.hears("10 фото", (ctx) => {
  touchUser(ctx);
  return ctx.reply(
    `Пакет: ${PACKAGES.pack10.title}
Ціна: ${PACKAGES.pack10.priceText}`,
    paymentInlineKeyboard(PACKAGES.pack10)
  );
});

bot.hears("20 фото", (ctx) => {
  touchUser(ctx);
  return ctx.reply(
    `Пакет: ${PACKAGES.pack20.title}
Ціна: ${PACKAGES.pack20.priceText}`,
    paymentInlineKeyboard(PACKAGES.pack20)
  );
});

bot.hears("30 фото", (ctx) => {
  touchUser(ctx);
  return ctx.reply(
    `Пакет: ${PACKAGES.pack30.title}
Ціна: ${PACKAGES.pack30.priceText}`,
    paymentInlineKeyboard(PACKAGES.pack30)
  );
});

// ===== CALLBACK ОПЛАТИ =====
bot.action(/^paid_(pack10|pack20|pack30)$/, async (ctx) => {
  try {
    const packKey = ctx.match[1];
    const pack = PACKAGES[packKey];
    const user = getUser(ctx.from.id);

    user.lastPaymentRequest = {
      packKey: pack.key,
      packageTitle: pack.title,
      createdAt: new Date().toISOString(),
    };
    saveJson(USERS_PATH, users);

    await notifyAdminsAboutPaymentRequest(ctx, pack);
    await ctx.answerCbQuery("Запит відправлено адміну ✅");

    return ctx.reply(
      `✅ Заявку на перевірку оплати відправлено адміну.

Пакет: ${pack.title}
Після перевірки тобі зарахують ${pack.photos} фото.`,
      mainMenu()
    );
  } catch (e) {
    console.error("PAID ACTION ERROR:", e.message);
    try {
      await ctx.answerCbQuery("Помилка");
    } catch {}
  }
});

// ===== РЕЖИМИ =====
bot.hears("👩 Портрет", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  ctx.session.mode = "portrait";
  ctx.session.awaitingCustomPrompt = false;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("💄 Б'юті", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  ctx.session.mode = "beauty";
  ctx.session.awaitingCustomPrompt = false;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("📸 Fashion", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  ctx.session.mode = "fashion";
  ctx.session.awaitingCustomPrompt = false;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("🎨 Арт", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  ctx.session.mode = "art";
  ctx.session.awaitingCustomPrompt = false;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("🔥 Тренд", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  ctx.session.mode = "trend";
  ctx.session.awaitingCustomPrompt = false;
  return ctx.reply("Надішли фото 📸", mainMenu());
});

bot.hears("✍️ Свій промт", (ctx) => {
  touchUser(ctx);
  ensureSession(ctx);
  ctx.session.mode = "custom";
  ctx.session.awaitingCustomPrompt = true;
  return ctx.reply("Напиши промт текстом, а потім надішли фото.", mainMenu());
});

// ===== ОБРОБКА ТЕКСТУ =====
bot.on("text", async (ctx, next) => {
  try {
    ensureSession(ctx);
    touchUser(ctx);

    const text = ctx.message.text;

    const menuButtons = [
      "👩 Портрет",
      "💄 Б'юті",
      "📸 Fashion",
      "🎨 Арт",
      "🔥 Тренд",
      "✍️ Свій промт",
      "💳 Купити",
      "📊 Баланс",
      "10 фото",
      "20 фото",
      "30 фото",
      "📊 Статус бота",
      "👤 Мій ID",
      "👥 Користувачі",
      "📦 Останні заявки",
      "✏️ Змінити промт",
      "📝 Поточні промти",
      "portrait",
      "beauty",
      "fashion",
      "art",
      "trend",
      "ℹ️ Інфо",
      "🆘 Підтримка",
      "⚙️ Адмін",
      "↩️ Назад",
    ];

    if (menuButtons.includes(text) || text.startsWith("/")) {
      return next();
    }

    // редагування промту адміном
    if (isAdmin(ctx.from.id) && ctx.session.awaitingPromptEditKey) {
      const key = ctx.session.awaitingPromptEditKey;
      prompts[key] = text;
      saveJson(PROMPTS_PATH, prompts);
      ctx.session.awaitingPromptEditKey = null;

      return ctx.reply(
        `✅ Промт для ${key} оновлено і збережено.

Новий промт:
${prompts[key]}`,
        adminMenu()
      );
    }

    // свій промт користувача
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

// ===== ГЕНЕРАЦІЯ =====
bot.on("photo", async (ctx) => {
  let chargedFromBalance = false;
  let usedFree = false;

  try {
    ensureSession(ctx);
    const user = touchUser(ctx);

    // адмін має доступ до всього і не платить
    if (!isAdmin(ctx.from.id)) {
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
      saveJson(USERS_PATH, users);
    }

    let prompt = "";

    if (ctx.session.mode === "custom") {
      if (!ctx.session.customPrompt) {
        return ctx.reply("Спочатку напиши свій промт текстом.");
      }
      prompt = ctx.session.customPrompt;
    } else {
      if (!ctx.session.mode || !prompts[ctx.session.mode]) {
        return ctx.reply("Спочатку обери режим через /start");
      }
      prompt = prompts[ctx.session.mode];
    }

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
      throw new Error("fal не повернув зображення");
    }

    user.generations = (user.generations || 0) + 1;
    saveJson(USERS_PATH, users);

    if (isAdmin(ctx.from.id)) {
      return ctx.replyWithPhoto(
        { url },
        { caption: "Готово ✨\nАдмін-режим: безліміт ✅" }
      );
    }

    return ctx.replyWithPhoto(
      { url },
      { caption: `Готово ✨\nЗалишилось фото: ${user.balance}` }
    );
  } catch (e) {
    console.error("FAL ERROR:", e);

    const user = getUser(ctx.from.id);

    if (!isAdmin(ctx.from.id)) {
      if (chargedFromBalance) {
        user.balance += 1;
      }
      if (usedFree) {
        user.freeUsed = false;
      }
      saveJson(USERS_PATH, users);
    }

    return ctx.reply("Сталася помилка генерації 😢");
  }
});

bot.launch();
console.log("🔥 AI бот запущений");
console.log("✅ Модель: fal-ai/nano-banana-2/edit");