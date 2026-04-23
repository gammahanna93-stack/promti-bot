# PROMTI AI

Telegram bot for AI photo and video generation with:
- landing page on `/`
- admin panel on `/admin`
- internal virtual currency `Promti ✨`

## What's inside

- `index.js` — main Express + Telegram bot server
- `index.html` — public landing page
- `admin.html` — admin panel for editing landing content without code
- `landing-content.default.json` — default landing content structure
- `content.json` / `prompts.json` / `settings.json` — starter bot data files
- `telegram_bot_financial_model.py` — financial model helper script

## Features

- mobile-first landing page
- admin login with password
- edit landing texts, pricing, examples, contacts, and legal blocks
- upload example images from the admin panel
- landing content stored in runtime JSON

## Required environment variables

Create `.env` from `.env.example` and fill in your values.

Required:
- `BOT_TOKEN`
- `FAL_KEY`

Recommended:
- `ANTHROPIC_API_KEY`
- `ADMIN_LOGIN`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

Optional payment variables:
- `WAYFORPAY_MERCHANT`
- `WAYFORPAY_SECRET`
- `WAYFORPAY_DOMAIN`
- `WAYFORPAY_RETURN_URL`
- `WAYFORPAY_SERVICE_URL`

## Local run

```bash
npm install
npm start
```

Open:
- site: `http://localhost:3000/`
- admin: `http://localhost:3000/admin`

## Admin login

If you do not set custom credentials, the fallback defaults in code are:

- login: `admin`
- password: `promti123!`

Change them in production through environment variables.

## Runtime storage

The app stores working data in `/app/data`.

This includes:
- sessions
- users
- payments
- landing content
- uploaded landing images

For production, mount persistent storage for `/app/data`.

## Upload to GitHub

```bash
git init
git add .
git commit -m "Initial PROMTI AI landing and admin panel"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## Notes

- `.env` is ignored and should not be committed.
- `node_modules` is ignored.
- uploaded files and runtime data are ignored.
