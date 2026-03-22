import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags, User } from "discord.js";
import z from "zod";
import { GameContext } from "../core/Game";
import { VersusGame, VersusGameResult, VersusOptions, versusOptions } from "../core/VersusGame";
import { colors } from "../utils/constants";
import { isID } from "../utils/games";
import { embedBuilder, gameInteractionMessage, resultMessage, var2Message } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage, GameInteractionMessage, GameTurnMessage } from "../utils/types";

/**
 * The Tic Tac Toe game result.
 */
export interface TicTacToeResult extends VersusGameResult {
    outcome: "win" | "tie" | "timeout";
    /**
     * Only if `outcome` is `win`.
     */
    winner: User | null;
    winnerEmoji: string | null;
}

/**
 * The data of a Tic Tac Toe turn.
 */
export interface TicTacToeTurn {
    player: User;
    emoji: string;
}

const defaultOptions = {
    embed: {
        title: "Tic Tac Toe",
        color: colors.blurple,
    },
    winMessage: (res: TicTacToeResult) =>
        `${isID(res.winnerEmoji || "") ? `<:_:${res.winnerEmoji}>` : res.winnerEmoji} | **${res.winner}** won the TicTacToe Game.`,
    tieMessage: () => "The Game tied! No one won the Game!",
    timeoutMessage: () => "The Game went unfinished! No one won the Game!",
    turnMessage: (turn: TicTacToeTurn) =>
        `${isID(turn.emoji || "") ? `<:_:${turn.emoji}>` : turn.emoji} | It's player **${turn.player.displayName}**'s turn.`,
    notPlayerMessage: (game: TicTacToe) => `Only ${game.player} and ${game.opponent} can use this menu.`,
    emojis: {
        xButton: "❌",
        oButton: "🔵",
    },
    styles: {
        xButton: ButtonStyle.Secondary,
        oButton: ButtonStyle.Secondary,
    },
    timeout: 60_000,
};

export interface TicTacToeOptions {
    versus: VersusOptions;
    embed?: GameEmbed<TicTacToe>;
    endEmbed?: GameEndEmbed<TicTacToe, TicTacToeResult>;
    winMessage?: GameEndMessage<TicTacToe, TicTacToeResult>;
    tieMessage?: GameEndMessage<TicTacToe, TicTacToeResult>;
    timeoutMessage?: GameEndMessage<TicTacToe, TicTacToeResult>;
    turnMessage?: GameTurnMessage<TicTacToe, TicTacToeTurn>;
    notPlayerMessage?: GameInteractionMessage<TicTacToe>;
    emojis?: {
        /**
         * You can also use an emoji ID.
         */
        xButton?: string;
        /**
         * You can also use an emoji ID.
         */
        oButton?: string;
    };
    styles?: {
        xButton?: ButtonStyle;
        oButton?: ButtonStyle;
    };
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
}

export const ticTacToeOptions = z.object({
    versus: versusOptions("Tic Tac Toe"),
    embed: embedBuilder<[TicTacToe]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[TicTacToe, TicTacToeResult]>().optional(),
    winMessage: resultMessage<TicTacToeResult, TicTacToe>()
        .optional()
        .default(() => defaultOptions.winMessage),
    tieMessage: resultMessage<TicTacToeResult, TicTacToe>()
        .optional()
        .default(() => defaultOptions.tieMessage),
    timeoutMessage: resultMessage<TicTacToeResult, TicTacToe>()
        .optional()
        .default(() => defaultOptions.timeoutMessage),
    turnMessage: var2Message<TicTacToeTurn, TicTacToe>()
        .optional()
        .default(() => defaultOptions.turnMessage),
    notPlayerMessage: gameInteractionMessage<TicTacToe>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    emojis: z
        .object({
            xButton: z.string().optional().default(defaultOptions.emojis.xButton),
            oButton: z.string().optional().default(defaultOptions.emojis.oButton),
        })
        .optional()
        .default(defaultOptions.emojis),
    styles: z
        .object({
            xButton: z.number().int().optional().default(defaultOptions.styles.xButton),
            oButton: z.number().int().optional().default(defaultOptions.styles.oButton),
        })
        .optional()
        .default(defaultOptions.styles),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
});

/**
 * The Tic Tac Toe game.
 *
 * ## Errors
 *
 * Can emit `fatalError` if it fails to edit from the invitation embed to the game message.
 *
 * @example
 * ```js
 * const opponent = // The opponent (must be a discord.js User)
 *
 * const game = new TicTacToe(interaction, {
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
export class TicTacToe extends VersusGame<TicTacToeResult> {
    readonly options: z.output<typeof ticTacToeOptions>;

    /**
     * A 9-elements array.
     *
     * - `0` : empty
     *
     * - `1` : X (player 1)
     *
     * - `2` : O (player 2)
     */
    readonly gameboard: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    isPlayer1Turn: boolean = true;

    message: Message | null = null;

    private locked = false;

    constructor(context: GameContext, options?: TicTacToeOptions) {
        const parsed = ticTacToeOptions.parse(options || {});
        super(context, parsed.versus);
        this.options = parsed;
    }

    override async start() {
        this.message = await this.requestVersus();
        if (this.message) this.runGame(this.message);
    }

    private async runGame(message: Message) {
        try {
            const embed = await this.buildEmbed(this.options.embed, {
                description: this.options.turnMessage(this.getPlayerTurnData(), this),
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

                const index = Number(i.customId.split("-").at(-1));

                if (this.gameboard[index] !== 0) return;
                this.gameboard[index] = this.isPlayer1Turn ? 1 : 2;

                if (this.hasWonGame(1) || this.hasWonGame(2)) return collector.stop("$win");
                if (!this.gameboard.includes(0)) return collector.stop("$tie");
                this.isPlayer1Turn = !this.isPlayer1Turn;

                const embed = await this.buildEmbed(this.options.embed, {
                    description: this.options.turnMessage(this.getPlayerTurnData(), this),
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
        const winner = this.hasWonGame(1) ? this.player : this.opponent;
        const winnerEmoji = this.hasWonGame(1) ? this.options.emojis.xButton : this.options.emojis.oButton;

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
            description: getMessage(result, this),
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

    private hasWonGame(player: 1 | 2) {
        if (
            this.gameboard[0] === this.gameboard[4] &&
            this.gameboard[0] === this.gameboard[8] &&
            this.gameboard[0] === player
        ) {
            return true;
        } else if (
            this.gameboard[6] === this.gameboard[4] &&
            this.gameboard[6] === this.gameboard[2] &&
            this.gameboard[6] === player
        ) {
            return true;
        }
        for (let i = 0; i < 3; ++i) {
            if (
                this.gameboard[i * 3] === this.gameboard[i * 3 + 1] &&
                this.gameboard[i * 3] === this.gameboard[i * 3 + 2] &&
                this.gameboard[i * 3] === player
            ) {
                return true;
            }
            if (
                this.gameboard[i] === this.gameboard[i + 3] &&
                this.gameboard[i] === this.gameboard[i + 6] &&
                this.gameboard[i] === player
            ) {
                return true;
            }
        }
        return false;
    }

    private getPlayerTurnData(): TicTacToeTurn {
        return this.isPlayer1Turn
            ? { player: this.player, emoji: this.options.emojis.xButton }
            : { player: this.opponent, emoji: this.options.emojis.oButton };
    }

    private getButtonData(player: number) {
        if (player === 1) return { emoji: this.options.emojis.xButton, style: this.options.styles.xButton };
        else if (player === 2) return { emoji: this.options.emojis.oButton, style: this.options.styles.oButton };
        else return { emoji: null, style: ButtonStyle.Secondary };
    }

    private getComponents(disabled = false) {
        const components = [];

        for (let x = 0; x < 3; x++) {
            const row = new ActionRowBuilder<ButtonBuilder>();
            for (let y = 0; y < 3; y++) {
                const index = y * 3 + x;
                const data = this.getButtonData(this.gameboard[index]);

                const btn = new ButtonBuilder().setStyle(data.style).setCustomId(`$gamecord-tictactoe-${index}`);

                if (data.emoji) {
                    btn.setEmoji(isID(data.emoji) ? { id: data.emoji } : data.emoji);
                } else {
                    btn.setLabel("\u200b");
                }
                if (this.gameboard[y * 3 + x] !== 0) btn.setDisabled(true);
                if (disabled) btn.setDisabled(true);

                row.addComponents(btn);
            }
            components.push(row);
        }
        return components;
    }
}
