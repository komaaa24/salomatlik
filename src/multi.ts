import "reflect-metadata";
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import { Bot } from "grammy";
import { AppDataSource } from "./database/data-source.js";
import { Payment } from "./entities/Payment.js";
import {
    handleStart,
    handleShowJokes,
    handleNext,
    handlePayment,
    handleCheckPayment,
    syncJokesFromAPI,
    handleLanguageMenu,
    handleSetLanguage
} from "./handlers/bot.handlers.js";
import { UserService } from "./services/user.service.js";
import { getMessages } from "./services/i18n.service.js";
import { handlePaymentWebhook } from "./handlers/webhook.handlers.js";
import { getBotUsernameFromContext, normalizeBotUsername } from "./services/bot-context.service.js";

function required(name: string): string {
    const v = (process.env[name] || "").trim();
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

function parseBotsEnv(): Array<{ key: string; token: string }> {
    const raw = (process.env.BOTS || "").trim();
    if (!raw) {
        return [{ key: "default", token: required("BOT_TOKEN") }];
    }

    // Format: key1:token1,key2:token2
    return raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((pair) => {
            const idx = pair.indexOf(":");
            if (idx === -1) throw new Error(`Invalid BOTS entry: ${pair} (expected key:token)`);
            const key = pair.slice(0, idx).trim();
            const token = pair.slice(idx + 1).trim();
            if (!key || !token) throw new Error(`Invalid BOTS entry: ${pair}`);
            return { key, token };
        });
}

async function wireBot(bot: Bot) {
    const userService = new UserService();

    bot.catch((err) => console.error("❌ Bot error:", err));

    bot.command("start", handleStart);
    bot.command("lang", handleLanguageMenu);
    bot.command("sync", async (ctx) => {
        const userId = ctx.from?.id;
        const adminIds = (process.env.ADMIN_IDS || "").split(",").map(Number);

        if (!userId || !adminIds.includes(userId)) {
            return ctx.reply("⛔️ Bu buyruqdan foydalanish uchun ruxsatingiz yo'q.");
        }

        const botUsername = getBotUsernameFromContext(ctx);
        const language = await userService.getPreferredLanguage(userId, botUsername);
        const messages = getMessages(language);

        await ctx.reply(messages.syncStarted);
        try {
            await syncJokesFromAPI();
            await ctx.reply(messages.syncCompleted);
        } catch (error) {
            console.error("❌ Sync command failed:", error);
            await ctx.reply(messages.syncFailed);
        }
    });

    bot.on("callback_query:data", async (ctx) => {
        const data = ctx.callbackQuery.data;

        try {
            if (data === "show_jokes") {
                await handleShowJokes(ctx);
            } else if (data === "lang:menu") {
                await handleLanguageMenu(ctx);
            } else if (data.startsWith("lang:set:")) {
                const language = data.replace("lang:set:", "");
                if (language === "uz" || language === "en" || language === "ru") {
                    await handleSetLanguage(ctx, language);
                } else {
                    await ctx.answerCallbackQuery();
                }
            } else if (data === "back_to_start") {
                await handleStart(ctx);
            } else if (data.startsWith("next:")) {
                const index = parseInt(data.replace("next:", ""), 10);
                await handleNext(ctx, index);
            } else if (data === "payment") {
                await handlePayment(ctx);
            } else if (data.startsWith("check_payment:")) {
                const paymentId = parseInt(data.replace("check_payment:", ""), 10);
                await handleCheckPayment(ctx, paymentId);
            } else if (data === "cancel_payment") {
                const botUsername = getBotUsernameFromContext(ctx);
                const language = await userService.getPreferredLanguage(ctx.from?.id || 0, botUsername);
                const messages = getMessages(language);
                await ctx.editMessageText(messages.paymentCancelled);
                await ctx.answerCallbackQuery();
            } else {
                await ctx.answerCallbackQuery();
            }
        } catch (error) {
            console.error("Callback query error:", error);
            await ctx.answerCallbackQuery({
                text: "❌ Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.",
                show_alert: true
            });
        }
    });
}

async function main() {
    const PORT = Number(process.env.PORT) || 8989;

    console.log("🚀 Starting Multi-Bot + Payment Gateway...");

    console.log("📦 Connecting to database...");
    await AppDataSource.initialize();
    console.log("✅ Database connected");

    const botsEnv = parseBotsEnv();
    const botsByKey: Record<string, Bot> = {};
    const botsByUsername: Record<string, Bot> = {};

    for (const { key, token } of botsEnv) {
        const bot = new Bot(token);
        await bot.init();
        await wireBot(bot);
        botsByKey[key] = bot;
        const botUsername = normalizeBotUsername(bot.botInfo?.username);
        if (botUsername) {
            botsByUsername[botUsername] = bot;
        }
    }

    const defaultBotKey = (process.env.DEFAULT_BOT_KEY || "").trim() || botsEnv[0]?.key;
    const defaultBot = botsByKey[defaultBotKey];

    const app = express();
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.get("/health", (req, res) => {
        res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
    });

    // Payment webhook endpoints (single port for all bots)
    app.post("/webhook/pay", async (req, res) => {
        try {
            const webhookBot = await resolveWebhookBot(String(req.body?.tx || ""), botsByUsername, defaultBot);
            await handlePaymentWebhook(req, res, webhookBot);
        } catch (error) {
            console.error("Webhook error:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/api/pay", async (req, res) => {
        try {
            const webhookBot = await resolveWebhookBot(String(req.body?.tx || ""), botsByUsername, defaultBot);
            await handlePaymentWebhook(req, res, webhookBot);
        } catch (error) {
            console.error("Webhook error:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.listen(PORT, () => console.log(`🌐 Gateway server running on port ${PORT}`));

    for (const [key, bot] of Object.entries(botsByKey)) {
        void bot.start({
            onStart: (botInfo) => console.log(`✅ Bot[${key}] @${botInfo.username} started`)
        });
    }

    const autoSync = (process.env.AUTO_SYNC_ON_STARTUP || "true").toLowerCase() !== "false";
    if (autoSync) {
        console.log("🔄 Background sync started...");
        void syncJokesFromAPI();
    }
}

async function resolveWebhookBot(
    transactionParam: string,
    botsByUsername: Record<string, Bot>,
    defaultBot: Bot
): Promise<Bot> {
    if (!transactionParam) {
        return defaultBot;
    }

    const paymentRepo = AppDataSource.getRepository(Payment);
    const payment = await paymentRepo.findOne({
        where: { transactionParam }
    });

    const botUsername = normalizeBotUsername(payment?.botUsername) || normalizeBotUsername(payment?.metadata?.botUsername);
    return (botUsername && botsByUsername[botUsername]) || defaultBot;
}

main().catch((err) => {
    console.error("❌ Fatal:", err);
    process.exit(1);
});
