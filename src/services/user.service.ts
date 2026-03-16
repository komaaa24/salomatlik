import { Repository } from "typeorm";
import { User } from "../entities/User.js";
import { AppDataSource } from "../database/data-source.js";
import { BotLanguage } from "../types/language.js";
import { normalizeLanguage } from "./i18n.service.js";
import { LEGACY_BOT_USERNAME, normalizeBotUsername } from "./bot-context.service.js";

export class UserService {
    private userRepo: Repository<User>;

    constructor() {
        this.userRepo = AppDataSource.getRepository(User);
    }

    /**
     * Foydalanuvchini topish yoki yaratish
     */
    async findOrCreate(telegramId: number, botUsername: string, userData?: {
        username?: string;
        firstName?: string;
        lastName?: string;
        preferredLanguage?: string;
    }): Promise<User> {
        const scopedBotUsername = normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME;
        let user = await this.findScopedUser(telegramId, scopedBotUsername);

        const fallbackLanguage = normalizeLanguage(userData?.preferredLanguage);

        if (!user) {
            user = this.userRepo.create({
                telegramId,
                botUsername: scopedBotUsername,
                username: userData?.username,
                firstName: userData?.firstName,
                lastName: userData?.lastName,
                preferredLanguage: fallbackLanguage
            });
            await this.userRepo.save(user);
        } else if (userData) {
            const nextUsername = userData.username || user.username;
            const nextFirstName = userData.firstName || user.firstName;
            const nextLastName = userData.lastName || user.lastName;
            const nextLanguage = normalizeLanguage(user.preferredLanguage || fallbackLanguage);

            const hasChanges =
                nextUsername !== user.username ||
                nextFirstName !== user.firstName ||
                nextLastName !== user.lastName ||
                nextLanguage !== user.preferredLanguage;

            if (hasChanges) {
                user.username = nextUsername;
                user.firstName = nextFirstName;
                user.lastName = nextLastName;
                user.preferredLanguage = nextLanguage;
                await this.userRepo.save(user);
            }
        }

        return user;
    }

    /**
     * Foydalanuvchi to'lov qildimi?
     */
    async hasPaid(telegramId: number, botUsername: string): Promise<boolean> {
        const user = await this.findScopedUser(
            telegramId,
            normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME
        );
        return user?.hasPaid || false;
    }

    /**
     * Foydalanuvchini to'lagan deb belgilash
     */
    async markAsPaid(telegramId: number, botUsername: string): Promise<void> {
        const scopedBotUsername = normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME;
        await this.findOrCreate(telegramId, scopedBotUsername);
        await this.userRepo.update(
            { telegramId, botUsername: scopedBotUsername },
            { hasPaid: true, revokedAt: null }
        );
    }

    /**
     * Foydalanuvchi ma'lumotlarini yangilash
     */
    async update(telegramId: number, botUsername: string, data: Partial<User>): Promise<void> {
        const scopedBotUsername = normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME;
        await this.findOrCreate(telegramId, scopedBotUsername);
        await this.userRepo.update(
            { telegramId, botUsername: scopedBotUsername },
            data
        );
    }

    /**
     * Ko'rilgan g'oyalar sonini oshirish
     */
    async incrementViewedJokes(telegramId: number, botUsername: string): Promise<void> {
        const user = await this.findOrCreate(telegramId, botUsername);
        user.viewedJokes += 1;
        await this.userRepo.save(user);
    }

    async getPreferredLanguage(telegramId: number, botUsername: string): Promise<BotLanguage> {
        const user = await this.findScopedUser(
            telegramId,
            normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME
        );

        return normalizeLanguage(user?.preferredLanguage);
    }

    async setPreferredLanguage(telegramId: number, botUsername: string, language: BotLanguage): Promise<void> {
        const scopedBotUsername = normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME;
        await this.findOrCreate(telegramId, scopedBotUsername, {
            preferredLanguage: language
        });

        await this.userRepo.update(
            { telegramId, botUsername: scopedBotUsername },
            { preferredLanguage: normalizeLanguage(language) }
        );
    }

    private async findScopedUser(telegramId: number, botUsername: string): Promise<User | null> {
        const normalizedBotUsername = normalizeBotUsername(botUsername) || LEGACY_BOT_USERNAME;

        const scopedUser = await this.userRepo.findOne({
            where: { telegramId, botUsername: normalizedBotUsername }
        });

        if (scopedUser) {
            return scopedUser;
        }

        if (normalizedBotUsername === LEGACY_BOT_USERNAME) {
            return null;
        }

        const legacyUser = await this.userRepo.findOne({
            where: { telegramId, botUsername: LEGACY_BOT_USERNAME }
        });

        if (!legacyUser) {
            return null;
        }

        legacyUser.botUsername = normalizedBotUsername;
        return this.userRepo.save(legacyUser);
    }
}
