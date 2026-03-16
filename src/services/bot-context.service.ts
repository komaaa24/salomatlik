import { Context } from "grammy";

export const LEGACY_BOT_USERNAME = "__legacy__";

export function normalizeBotUsername(value?: string | null): string | undefined {
    const normalized = value?.trim().replace(/^@/, "");
    return normalized || undefined;
}

export function getBotUsernameFromContext(ctx: Pick<Context, "me">): string {
    const botUsername = normalizeBotUsername(ctx.me?.username);

    if (!botUsername) {
        throw new Error("Bot username is not available in the current context");
    }

    return botUsername;
}

export function buildScopedSessionKey(botUsername: string, telegramId: number): string {
    return `${botUsername}:${telegramId}`;
}
