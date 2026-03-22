import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import { colors } from "../utils/constants";
import { getNumberEmoji } from "../utils/games";
import { embedBuilder, gameInteractionMessage, resultMessage } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage, GameInteractionMessage } from "../utils/types";

/**
 * The minesweeper game result.
 */
export interface MinesweeperResult extends GameResult {
    outcome: "win" | "lose" | "timeout";
    tilesTurned: number;
}

const defaultOptions = {
    embed: {
        title: "Minesweeper",
        color: colors.blurple,
        description: "Click on the buttons to reveal the blocks except mines.",
    },
    timeout: 120_000,
    winMessage: () => "You won the Game! You successfully avoided all the mines.",
    loseMessage: () => "You lost the Game! Beaware of the mines next time.",
    notPlayerMessage: (game: Minesweeper) => `Only ${game.player} can use this menu.`,
    mines: 5,
    emojis: {
        flag: "🚩",
        mine: "💣",
    },
};

export interface MinesweeperOptions {
    embed?: GameEmbed<Minesweeper>;
    endEmbed?: GameEndEmbed<Minesweeper, MinesweeperResult>;
    winMessage?: GameEndMessage<Minesweeper, MinesweeperResult>;
    loseMessage?: GameEndMessage<Minesweeper, MinesweeperResult>;
    notPlayerMessage?: GameInteractionMessage<Minesweeper>;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
    mines?: number;
    emojis?: {
        flag?: string;
        mine?: string;
    };
}

export const minesweeperOptions = z.object({
    embed: embedBuilder<[Minesweeper]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Minesweeper, MinesweeperResult]>().optional(),
    winMessage: resultMessage<MinesweeperResult, Minesweeper>()
        .optional()
        .default(() => defaultOptions.winMessage),
    loseMessage: resultMessage<MinesweeperResult, Minesweeper>()
        .optional()
        .default(() => defaultOptions.loseMessage),
    notPlayerMessage: gameInteractionMessage<Minesweeper>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
    mines: z.number().int().min(1).max(24).optional().default(defaultOptions.mines),
    emojis: z
        .object({
            flag: z.string().optional().default(defaultOptions.emojis.flag),
            mine: z.string().optional().default(defaultOptions.emojis.mine),
        })
        .optional()
        .default(defaultOptions.emojis),
});

/**
 * A game where the player needs to click on all tiles except the mines.
 *
 * @example
 * ```js
 * const game = new Minesweeper(interaction, {
 *     winMessage: "You won the Game! You successfully avoided all the mines."
 *     timeout: 120_000
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class Minesweeper extends Game<MinesweeperResult> {
    readonly options: z.output<typeof minesweeperOptions>;

    /**
     * The board of the game (5x5 array).
     *
     * - `true` : empty
     *
     * - `false` : mine
     *
     * - `number` : empty, with `n` mines around it
     */
    readonly board: (number | boolean)[] = [];

    /**
     * The width/height of the board
     */
    readonly size: number = 5;

    message: Message | null = null;

    constructor(context: GameContext, options?: MinesweeperOptions) {
        super(context);
        this.options = minesweeperOptions.parse(options || {});

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                this.board[y * this.size + x] = false;
            }
        }
    }

    override async start() {
        this.plantMines();
        this.showFirstBlock();

        const embed = await this.buildEmbed(this.options.embed);

        this.message = await this.sendMessage({ embeds: [embed], components: this.getComponents() });
        this.handleButtons(this.message);
    }

    private handleButtons(message: Message) {
        const collector = message.createMessageComponentCollector({ idle: this.options.timeout });

        collector.on("collect", async i => {
            if (!i.customId.startsWith("$gamecord")) return;
            if (!i.isButton()) return;

            if (i.user.id !== this.player.id) {
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

            const x = Number(i.customId.split("-").at(-2));
            const y = Number(i.customId.split("-").at(-1));
            const index = y * this.size + x;

            try {
                await i.deferUpdate();
            } catch (err) {
                this.emit("error", err);
                return;
            }

            if (this.board[index] === true) return collector.stop("$end");
            const mines = this.getMinesAround(x, y);
            this.board[index] = mines;

            if (this.hasFoundAllMines()) return collector.stop("$end");

            try {
                await i.editReply({ components: this.getComponents() });
            } catch (err) {
                this.emit("error", err);
            }
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "$end" || reason === "idle") {
                await this.gameOver(message, reason === "idle");
            }
        });
    }

    private async gameOver(message: Message, hasTimedOut: boolean) {
        const result = this.buildResult({
            outcome: hasTimedOut ? "timeout" : this.hasFoundAllMines() ? "win" : "lose",
            tilesTurned: this.board.filter(Number.isInteger).length,
        });
        this.emit("gameOver", result);

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const index = y * this.size + x;
                if (this.board[index] !== true) this.board[index] = this.getMinesAround(x, y);
            }
        }

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            description:
                result.outcome === "win"
                    ? this.options.winMessage(result, this)
                    : this.options.loseMessage(result, this),
        });

        try {
            await this.editContextOrMessage(message, {
                embeds: [embed],
                components: this.getComponents(true, result.outcome === "win", true),
            });
        } catch (err) {
            this.emit("error", err);
        }
    }

    private plantMines() {
        for (let i = 0; i <= this.options.mines; i++) {
            const x = Math.floor(Math.random() * 5);
            const y = Math.floor(Math.random() * 5);
            const index = y * this.size + x;

            if (this.board[index] !== true) {
                this.board[index] = true;
            } else {
                i -= 1;
            }
        }
    }

    private getMinesAround(x: number, y: number): number {
        let minesAround = 0;

        for (let row = -1; row < 2; row++) {
            for (let col = -1; col < 2; col++) {
                const block = { x: x + col, y: y + row };
                if (block.x < 0 || block.x >= 5 || block.y < 0 || block.y >= 5) continue;
                if (row === 0 && col === 0) continue;

                if (this.board[block.y * this.size + block.x] === true) minesAround += 1;
            }
        }
        return minesAround;
    }

    private showFirstBlock() {
        const emptyBlocks = [];
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y * this.size + x] === true) emptyBlocks.push({ x, y });
            }
        }

        const safeBlocks = emptyBlocks.filter(b => !this.getMinesAround(b.x, b.y));
        const blocks = safeBlocks.length ? safeBlocks : emptyBlocks;

        const rBlock = blocks[Math.floor(Math.random() * blocks.length)];
        this.board[rBlock.y * this.size + rBlock.x] = this.getMinesAround(rBlock.x, rBlock.y);
    }

    private hasFoundAllMines(): boolean {
        let found = true;
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y * this.size + x] === false) found = false;
            }
        }
        return found;
    }

    /**
     * Build the minesweeper grid using buttons.
     */
    getComponents(showMines = false, found = false, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
        const components = [];

        for (let y = 0; y < this.size; y++) {
            const row = new ActionRowBuilder<ButtonBuilder>();

            for (let x = 0; x < this.size; x++) {
                const block = this.board[y * this.size + x];
                const numberEmoji = typeof block === "number" && block > 0 ? getNumberEmoji(block) : null;
                const displayMine = block === true && showMines;

                const btn = new ButtonBuilder()
                    .setStyle(
                        displayMine
                            ? found
                                ? ButtonStyle.Success
                                : ButtonStyle.Danger
                            : typeof block === "number"
                              ? ButtonStyle.Secondary
                              : ButtonStyle.Primary,
                    )
                    .setCustomId(`$gamecord-minesweeper-${x}-${y}`)
                    .setDisabled(disabled);

                if (displayMine || numberEmoji)
                    btn.setEmoji(
                        displayMine ? (found ? this.options.emojis.flag : this.options.emojis.mine) : numberEmoji!,
                    );
                else {
                    btn.setLabel("\u200b");
                }

                row.addComponents(btn);
            }

            components.push(row);
        }

        return components;
    }
}
