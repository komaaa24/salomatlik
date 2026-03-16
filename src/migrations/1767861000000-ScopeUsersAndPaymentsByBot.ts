import {
    MigrationInterface,
    QueryRunner,
    TableColumn,
    TableUnique
} from "typeorm";
import { LEGACY_BOT_USERNAME } from "../services/bot-context.service.js";

export class ScopeUsersAndPaymentsByBot1767861000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        let usersTable = await queryRunner.getTable("users");

        if (!usersTable?.findColumnByName("botUsername")) {
            await queryRunner.addColumn(
                "users",
                new TableColumn({
                    name: "botUsername",
                    type: "varchar",
                    isNullable: false,
                    default: `'${LEGACY_BOT_USERNAME}'`
                })
            );
        }

        usersTable = await queryRunner.getTable("users");
        const legacyTelegramUnique = usersTable?.uniques.find((unique) =>
            unique.columnNames.length === 1 && unique.columnNames[0] === "telegramId"
        );

        if (legacyTelegramUnique) {
            await queryRunner.dropUniqueConstraint("users", legacyTelegramUnique);
        }

        usersTable = await queryRunner.getTable("users");
        const scopedUserUnique = usersTable?.uniques.find((unique) =>
            unique.columnNames.length === 2 &&
            unique.columnNames.includes("telegramId") &&
            unique.columnNames.includes("botUsername")
        );

        if (!scopedUserUnique) {
            await queryRunner.createUniqueConstraint(
                "users",
                new TableUnique({
                    name: "UQ_users_telegram_bot",
                    columnNames: ["telegramId", "botUsername"]
                })
            );
        }

        const paymentsTable = await queryRunner.getTable("payments");
        if (!paymentsTable?.findColumnByName("botUsername")) {
            await queryRunner.addColumn(
                "payments",
                new TableColumn({
                    name: "botUsername",
                    type: "varchar",
                    isNullable: false,
                    default: `'${LEGACY_BOT_USERNAME}'`
                })
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const usersTable = await queryRunner.getTable("users");
        const scopedUserUnique = usersTable?.uniques.find((unique) => unique.name === "UQ_users_telegram_bot");

        if (scopedUserUnique) {
            await queryRunner.dropUniqueConstraint("users", scopedUserUnique);
        }

        if (usersTable?.findColumnByName("botUsername")) {
            await queryRunner.dropColumn("users", "botUsername");
        }

        const refreshedUsersTable = await queryRunner.getTable("users");
        const legacyTelegramUnique = refreshedUsersTable?.uniques.find((unique) =>
            unique.columnNames.length === 1 && unique.columnNames[0] === "telegramId"
        );

        if (!legacyTelegramUnique) {
            await queryRunner.createUniqueConstraint(
                "users",
                new TableUnique({
                    name: "UQ_users_telegramId",
                    columnNames: ["telegramId"]
                })
            );
        }

        const paymentsTable = await queryRunner.getTable("payments");
        if (paymentsTable?.findColumnByName("botUsername")) {
            await queryRunner.dropColumn("payments", "botUsername");
        }
    }
}
