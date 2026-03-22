import { createCanvas } from "@napi-rs/canvas";
import { AttachmentBuilder, Message, MessageCollector } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import words from "../data/wordle.json";
import { colors } from "../utils/constants";
import { getRandomElement } from "../utils/random";
import { embedBuilder, resultMessage } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage } from "../utils/types";

/**
 * The Wordle game result.
 */
export interface WordleResult extends GameResult {
    outcome: "win" | "lose" | "timeout";
    /**
     * {@inheritDoc Wordle.word}
     */
    word: string;
    guesses: string[];
}

const defaultOptions = {
    embed: {
        title: "Wordle",
        color: colors.blurple,
    },
    winMessage: (res: WordleResult) => `You won! The word was **${res.word}**.`,
    loseMessage: (res: WordleResult) => `You lost! The word was **${res.word}**.`,
    notOwnedMessage: (game: Wordle) => `Only ${game.player} can use this menu.`,
    timeout: 120_000,
};

export interface WordleOptions {
    embed?: GameEmbed<Wordle>;
    endEmbed?: GameEndEmbed<Wordle, WordleResult>;
    winMessage?: GameEndMessage<Wordle, WordleResult>;
    loseMessage?: GameEndMessage<Wordle, WordleResult>;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
    /**
     * {@inheritDoc Wordle.word}
     */
    word?: string;
}

export const wordleOptions = z.object({
    embed: embedBuilder<[Wordle]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Wordle, WordleResult]>().optional(),
    winMessage: resultMessage<WordleResult, Wordle>()
        .optional()
        .default(() => defaultOptions.winMessage),
    loseMessage: resultMessage<WordleResult, Wordle>()
        .optional()
        .default(() => defaultOptions.loseMessage),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
    word: z.string().length(5).optional(),
});

/**
 * A game where the player needs to guess the word.
 *
 * ## Permissions
 *
 * The bot needs to be able to read the messages of the current channel.
 *
 * ## Custom Display
 *
 * If you are using functions to create the embeds, use `attachment://board.png`
 * in the embed image URL to display the board.
 *
 * @example
 * ```js
 * const game = new Wordle(interaction, {
 *     timeout: 120_000
 *     // If you want to use your own words (5 letters):
 *     word: "house",
 *     // Otherwise, it will be random.
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class Wordle extends Game<WordleResult> {
    readonly options: z.output<typeof wordleOptions>;

    /**
     * The word to guess, in lowercase. Either the one specified or a random one.
     */
    readonly word: string;
    readonly guesses: string[] = [];

    message: Message | null = null;
    collector: MessageCollector | null = null;

    constructor(context: GameContext, options?: WordleOptions) {
        super(context);
        this.options = wordleOptions.parse(options || {});
        this.word = (this.options.word || getRandomElement(words)).toLowerCase();
    }

    /**
     * {@inheritDoc (Game:class).start}
     */
    override async start() {
        const embed = await this.buildEmbed(this.options.embed, {
            image: { url: "attachment://board.png" },
        });

        this.message = await this.sendMessage({ embeds: [embed], files: [await this.getBoardAttachment()] });
        const message = this.message;
        if (!message.channel.isSendable()) return;

        const collector = message.channel.createMessageCollector({
            idle: this.options.timeout,
            filter: msg => msg.author.id === this.player.id && msg.content.length === 5,
        });
        this.collector = collector;

        collector.on("collect", async msg => {
            const guess = msg.content.toLowerCase();

            if (msg.deletable) {
                try {
                    await msg.delete();
                } catch (err) {
                    this.emit("error", err);
                }
            }

            this.guesses.push(guess);
            if (this.word === guess || this.guesses.length > 5) return collector.stop("$end");

            try {
                await this.editContextOrMessage(message, { embeds: [embed], files: [await this.getBoardAttachment()] });
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

    private async gameOver(message: Message, isTimeout: boolean) {
        const result = this.buildResult({
            outcome: isTimeout ? "timeout" : this.guesses.includes(this.word) ? "win" : "lose",
            word: this.word,
            guesses: this.guesses,
        });
        this.emit("gameOver", result);

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            image: {
                url: "attachment://board.png",
            },
            fields: [
                {
                    name: "Game Over",
                    value:
                        result.outcome === "win"
                            ? this.options.winMessage(result, this)
                            : this.options.loseMessage(result, this),
                },
            ],
        });

        try {
            await this.editContextOrMessage(message, {
                embeds: [embed],
                files: [await this.getBoardAttachment()],
            });
        } catch (err) {
            this.emit("error", err);
        }
    }

    private async getBoardAttachment(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder(await this.getBoardImage(), { name: "board.png" });
    }

    private async getBoardImage(): Promise<Buffer> {
        const rows = 6;
        const cols = 5;
        const tile = 88;
        const gap = 12;
        const padding = 20;
        const width = padding * 2 + cols * tile + (cols - 1) * gap;
        const height = padding * 2 + rows * tile + (rows - 1) * gap;

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // palette
        const PALETTE = {
            green: "#6aaa64",
            yellow: "#c9b458",
            gray: "#3a3a3c",
            empty: "#121213",
            border: "#3a3a3c",
            bg: "#121213",
            textLight: "#ffffff",
        };

        ctx.fillStyle = PALETTE.bg;
        ctx.fillRect(0, 0, width, height);

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.floor(tile * 0.54)}px sans-serif`;

        /**
         * Score a single guess against the answer producing a color per position.
         * Uses standard Wordle rules (greens first, then yellows with letter counts).
         */
        function scoreGuess(guess: string, answer: string) {
            const res = Array(cols).fill(PALETTE.gray);
            const a = answer.split("");
            const g = guess.split("");

            // counts for non-green letters
            const counts: Record<string, number> = {};
            for (let i = 0; i < a.length; i++) counts[a[i]] = (counts[a[i]] || 0) + 1;

            // mark greens
            for (let i = 0; i < cols; i++) {
                if (g[i] === a[i]) {
                    res[i] = PALETTE.green;
                    counts[g[i]] = Math.max(0, counts[g[i]] - 1);
                }
            }

            // mark yellows/greys
            for (let i = 0; i < cols; i++) {
                if (res[i] === PALETTE.green) continue;
                const ch = g[i];
                if (counts[ch] && counts[ch] > 0) {
                    res[i] = PALETTE.yellow;
                    counts[ch]--;
                } else {
                    res[i] = PALETTE.gray;
                }
            }

            return res;
        }

        // draw grid
        for (let r = 0; r < rows; r++) {
            const guess = this.guesses[r];
            const colors = guess
                ? scoreGuess(guess.toLowerCase(), this.word.toLowerCase())
                : Array(cols).fill(PALETTE.empty);

            for (let c = 0; c < cols; c++) {
                const x = padding + c * (tile + gap);
                const y = padding + r * (tile + gap);

                // tile background
                ctx.fillStyle = colors[c] === PALETTE.empty ? PALETTE.empty : colors[c];
                // slight rounding
                const radius = 8;
                ctx.beginPath();
                ctx.moveTo(x + radius, y);
                ctx.lineTo(x + tile - radius, y);
                ctx.quadraticCurveTo(x + tile, y, x + tile, y + radius);
                ctx.lineTo(x + tile, y + tile - radius);
                ctx.quadraticCurveTo(x + tile, y + tile, x + tile - radius, y + tile);
                ctx.lineTo(x + radius, y + tile);
                ctx.quadraticCurveTo(x, y + tile, x, y + tile - radius);
                ctx.lineTo(x, y + radius);
                ctx.quadraticCurveTo(x, y, x + radius, y);
                ctx.closePath();
                ctx.fill();

                // border for empty tiles, subtle for colored
                ctx.lineWidth = 4;
                ctx.strokeStyle = colors[c] === PALETTE.empty ? PALETTE.border : colors[c];
                ctx.stroke();

                // letter
                const ch = guess ? (guess[c] || "").toUpperCase() : "";
                if (ch) {
                    ctx.fillStyle = PALETTE.textLight;
                    ctx.fillText(ch, x + tile / 2, y + tile / 2 + 2); // slight vertical adjustment
                }
            }
        }

        // return PNG buffer
        return canvas.toBuffer("image/png");
    }
}
