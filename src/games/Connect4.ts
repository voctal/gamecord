import z from "zod/v4";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags, User } from "discord.js";
import { GameContext } from "../core/Game";
import { VersusGame, VersusGameResult, VersusOptions, versusOptions } from "../core/VersusGame";
import { embedBuilder, gameInteractionMessage, resultMessage, var2Message } from "../utils/schemas";
import { colors } from "../utils/constants";
import { GameEmbed, GameEndEmbed, GameEndMessage, GameInteractionMessage, GameTurnMessage } from "../utils/types";

/**
 * The Connect 4 game result.
 */
export interface Connect4Result extends VersusGameResult {
    outcome: "win" | "tie" | "timeout";
    /**
     * Only if `outcome` is `win`.
     */
    winner: User | null;
    winnerEmoji: string | null;
}

/**
 * The data of a Connect 4 turn.
 */
export interface Connect4Turn {
    player: User;
    emoji: string;
}

const defaultOptions = {
    embed: {
        title: "Connect 4",
        color: colors.blurple,
    },
    winMessage: (res: Connect4Result) => `${res.winnerEmoji} | **${res.winner}** won the Connect 4 Game.`,
    tieMessage: () => "The Game tied! No one won the Game!",
    timeoutMessage: () => "The Game went unfinished! No one won the Game!",
    turnMessage: (turn: Connect4Turn) => `${turn.emoji} | It's player **${turn.player.displayName}**'s turn.`,
    notPlayerMessage: (game: Connect4) => `Only ${game.player} and ${game.opponent} can use this menu.`,
    statusText: "Game Status",
    emojis: {
        board: "⚫",
        player1: "🔴",
        player2: "🟡",
    },
    buttonStyle: ButtonStyle.Secondary,
    timeout: 60_000,
};

export interface Connect4Options {
    versus: VersusOptions;
    embed?: GameEmbed<Connect4>;
    endEmbed?: GameEndEmbed<Connect4, Connect4Result>;
    winMessage?: GameEndMessage<Connect4, Connect4Result>;
    tieMessage?: GameEndMessage<Connect4, Connect4Result>;
    timeoutMessage?: GameEndMessage<Connect4, Connect4Result>;
    turnMessage?: GameTurnMessage<Connect4, Connect4Turn>;
    notPlayerMessage?: GameInteractionMessage<Connect4>;
    statusText?: string;
    emojis?: {
        board?: string;
        player1?: string;
        player2?: string;
    };
    buttonStyle?: ButtonStyle;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
}

export const connect4Options = z.object({
    versus: versusOptions("Connect 4"),
    embed: embedBuilder<[Connect4]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Connect4, Connect4Result]>().optional(),
    winMessage: resultMessage<Connect4Result, Connect4>()
        .optional()
        .default(() => defaultOptions.winMessage),
    tieMessage: resultMessage<Connect4Result, Connect4>()
        .optional()
        .default(() => defaultOptions.tieMessage),
    timeoutMessage: resultMessage<Connect4Result, Connect4>()
        .optional()
        .default(() => defaultOptions.timeoutMessage),
    turnMessage: var2Message<Connect4Turn, Connect4>()
        .optional()
        .default(() => defaultOptions.turnMessage),
    notPlayerMessage: gameInteractionMessage<Connect4>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    statusText: z.string().optional().default(defaultOptions.statusText),
    emojis: z
        .object({
            board: z.string().optional().default(defaultOptions.emojis.board),
            player1: z.string().optional().default(defaultOptions.emojis.player1),
            player2: z.string().optional().default(defaultOptions.emojis.player2),
        })
        .optional()
        .default(defaultOptions.emojis),
    buttonStyle: z.number().int().optional().default(defaultOptions.buttonStyle),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
});

/**
 * The Connect 4 game.
 *
 * ## Errors
 *
 * Can emit `fatalError` if it fails to edit from the invitation embed to the game message.
 *
 * @example
 * ```js
 * const opponent = // The opponent (must be a discord.js User)
 *
 * const game = new Connect4(interaction, {
 *     versus: {
 *         opponent
 *     }
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("versusReject", () => console.log("Opponent rejected the invitation to play"));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class Connect4 extends VersusGame<Connect4Result> {
    readonly options: z.output<typeof connect4Options>;

    /**
     * A 6*7 elements array.
     *
     * - `0` : empty
     *
     * - `1` : player 1
     *
     * - `2` : player 2
     */
    readonly gameboard: number[] = [];

    isPlayer1Turn: boolean = true;

    message: Message | null = null;

    private locked = false;

    constructor(context: GameContext, options?: Connect4Options) {
        const parsed = connect4Options.parse(options || {});
        super(context, parsed.versus);
        this.options = parsed;

        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 7; x++) {
                this.gameboard[y * 7 + x] = 0;
            }
        }
    }

    override async start() {
        this.message = await this.requestVersus();
        if (this.message) this.runGame(this.message);
    }

    private async runGame(message: Message) {
        try {
            const embed = await this.buildEmbed(this.options.embed, {
                description: this.getBoardContent(),
                fields: [
                    {
                        name: this.options.statusText,
                        value: this.options.turnMessage(this.getPlayerTurnData(), this),
                    },
                ],
            });

            await this.editContextOrMessage(message, {
                content: null,
                embeds: [embed],
                components: this.getComponents(),
            });
        } catch (err) {
            this.emit("fatalError", err);
            this.emit("end");
            return;
        }

        this.handleButtons(message);
    }

    private handleButtons(message: Message) {
        const collector = message.createMessageComponentCollector({ idle: this.options.timeout });

        collector.on("collect", async i => {
            if (!i.customId.startsWith("$gamecord")) return;
            if (!i.isButton()) return;

            if (i.user.id !== this.player.id && i.user.id !== this.opponent.id) {
                if (this.options.notPlayerMessage) {
                    try {
                        await i.reply({
                            content: this.options.notPlayerMessage(this, i),
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (err) {
                        this.emit("error", err);
                    }
                }
                return;
            }

            try {
                await i.deferUpdate();
            } catch (err) {
                this.emit("error", err);
                return;
            }

            if (this.locked) return;
            this.locked = true;

            try {
                if (i.user.id !== (this.isPlayer1Turn ? this.player : this.opponent).id) return;

                const column = Number(i.customId.split("-").at(-1));
                const block = { x: -1, y: -1 };

                for (let y = 6 - 1; y >= 0; y--) {
                    const number = this.gameboard[column + y * 7];
                    if (number === 0) {
                        this.gameboard[column + y * 7] = this.getPlayerNumber();
                        block.x = column;
                        block.y = y;
                        break;
                    }
                }

                if (this.isWinAt(block.x, block.y)) return collector.stop("$win");
                if (this.isBoardFull()) return collector.stop("$tie");
                this.isPlayer1Turn = !this.isPlayer1Turn;

                const embed = await this.buildEmbed(this.options.embed, {
                    description: this.getBoardContent(),
                    fields: [
                        {
                            name: this.options.statusText,
                            value: this.options.turnMessage(this.getPlayerTurnData(), this),
                        },
                    ],
                });

                try {
                    await i.editReply({ embeds: [embed], components: this.getComponents() });
                } catch (err) {
                    this.emit("error", err);
                }
            } finally {
                this.locked = false;
            }
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "$win" || reason === "$tie") {
                return await this.gameOver(message, reason === "$win" ? "win" : "tie");
            }

            if (reason === "idle") {
                return await this.gameOver(message, "timeout");
            }
        });
    }

    private async gameOver(message: Message, outcome: "win" | "tie" | "timeout") {
        const winner = this.isPlayer1Turn ? this.player : this.opponent;
        const winnerEmoji = this.isPlayer1Turn ? this.options.emojis.player1 : this.options.emojis.player2;

        const result = this.buildResult({
            opponent: this.opponent,
            outcome,
            winner: outcome === "win" ? winner : null,
            winnerEmoji: outcome === "win" ? winnerEmoji : null,
        });
        this.emit("gameOver", result);

        let getMessage;
        switch (outcome) {
            case "win": {
                getMessage = this.options.winMessage;
                break;
            }
            case "tie": {
                getMessage = this.options.tieMessage;
                break;
            }
            case "timeout": {
                getMessage = this.options.timeoutMessage;
                break;
            }
        }

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            description: this.getBoardContent(),
            fields: [
                {
                    name: this.options.statusText,
                    value: getMessage(result, this),
                },
            ],
        });

        try {
            await this.editContextOrMessage(message, {
                embeds: [embed],
                components: this.getComponents(true),
            });
        } catch (err) {
            this.emit("error", err);
        }
    }

    private getPlayerTurnData() {
        return this.isPlayer1Turn
            ? { player: this.player, emoji: this.options.emojis.player1 }
            : { player: this.opponent, emoji: this.options.emojis.player2 };
    }

    /**
     * Get the formatted board content.
     */
    getBoardContent() {
        let board = "";
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 7; x++) {
                board += this.getEmoji(this.gameboard[y * 7 + x]);
            }
            board += "\n";
        }
        board += "1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣";
        return board;
    }

    /**
     * Get the current player number (`1` or `2`).
     */
    getPlayerNumber() {
        return this.isPlayer1Turn ? 1 : 2;
    }

    isBoardFull() {
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 7; x++) {
                if (this.gameboard[y * 7 + x] === 0) return false;
            }
        }
        return true;
    }

    /**
     * Get the emoji of a number of the game board (`0`, `1` or `2`).
     */
    getEmoji(number: number) {
        if (number === 1) return this.options.emojis.player1;
        if (number === 2) return this.options.emojis.player2;
        return this.options.emojis.board;
    }

    isWinAt(x: number, y: number) {
        const number = this.getPlayerNumber();

        // Horizontal Check
        for (let i = Math.max(0, x - 3); i <= x; i++) {
            const adj = i + y * 7;
            if (i + 3 < 7) {
                if (
                    this.gameboard[adj] === number &&
                    this.gameboard[adj + 1] === number &&
                    this.gameboard[adj + 2] === number &&
                    this.gameboard[adj + 3] === number
                )
                    return true;
            }
        }

        // Vertical Check
        for (let i = Math.max(0, y - 3); i <= y; i++) {
            const adj = x + i * 7;
            if (i + 3 < 6) {
                if (
                    this.gameboard[adj] === number &&
                    this.gameboard[adj + 7] === number &&
                    this.gameboard[adj + 2 * 7] === number &&
                    this.gameboard[adj + 3 * 7] === number
                )
                    return true;
            }
        }

        // Ascending Check
        for (let i = -3; i <= 0; i++) {
            const block = { x: x + i, y: y + i };
            const adj = block.x + block.y * 7;
            if (block.x + 3 < 7 && block.y + 3 < 6) {
                if (
                    this.gameboard[adj] === number &&
                    this.gameboard[adj + 7 + 1] === number &&
                    this.gameboard[adj + 2 * 7 + 2] === number &&
                    this.gameboard[adj + 3 * 7 + 3] === number
                )
                    return true;
            }
        }

        // Descending Check
        for (let i = -3; i <= 0; i++) {
            const block = { x: x + i, y: y - i };
            const adj = block.x + block.y * 7;
            if (block.x + 3 < 7 && block.y - 3 >= 0 && block.x >= 0) {
                if (
                    this.gameboard[adj] === number &&
                    this.gameboard[adj - 7 + 1] === number &&
                    this.gameboard[adj - 2 * 7 + 2] === number &&
                    this.gameboard[adj - 3 * 7 + 3] === number
                )
                    return true;
            }
        }
        return false;
    }

    isColumnFilled(x: number) {
        return this.gameboard[x] !== 0;
    }

    getComponents(disabled = false) {
        const row1 = new ActionRowBuilder<ButtonBuilder>().setComponents(
            ["1️⃣", "2️⃣", "3️⃣", "4️⃣"].map((e, i) =>
                new ButtonBuilder()
                    .setStyle(this.options.buttonStyle)
                    .setEmoji(e)
                    .setCustomId(`$gamecord-connect4-${i}`)
                    .setDisabled(disabled || this.isColumnFilled(i)),
            ),
        );
        const row2 = new ActionRowBuilder<ButtonBuilder>().setComponents(
            ["5️⃣", "6️⃣", "7️⃣"].map((e, i) =>
                new ButtonBuilder()
                    .setStyle(this.options.buttonStyle)
                    .setEmoji(e)
                    .setCustomId(`$gamecord-connect4-${i + 4}`)
                    .setDisabled(disabled || this.isColumnFilled(i + 4)),
            ),
        );

        return [row1, row2];
    }
}
