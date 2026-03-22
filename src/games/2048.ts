import { createCanvas } from "@napi-rs/canvas";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import { colors } from "../utils/constants";
import { moveInDirection, getOppositeDirection } from "../utils/games";
import { getRandomInt } from "../utils/random";
import { embedBuilder, gameInteractionMessage } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameInteractionMessage, Position } from "../utils/types";

/**
 * The 2048 game result.
 */
export interface Game2048Result extends GameResult {
    outcome: "over" | "timeout";
    score: number;
    /**
     * If the player reached 2048 or more.
     */
    hasWon: boolean;
}

const defaultOptions = {
    embed: {
        title: "2048",
        color: colors.blurple,
    },
    notPlayerMessage: (game: Game2048) => `Only ${game.player} can use this menu.`,
    timeout: 60_000,
    buttonStyle: ButtonStyle.Secondary,
    emojis: {
        up: "🔼",
        down: "🔽",
        right: "▶️",
        left: "◀️",
    },
};

export interface Game2048Options {
    embed?: GameEmbed<Game2048>;
    endEmbed?: GameEndEmbed<Game2048, Game2048Result>;
    notPlayerMessage?: GameInteractionMessage<Game2048>;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
    buttonStyle?: ButtonStyle;
    emojis?: {
        up?: string;
        down?: string;
        right?: string;
        left?: string;
    };
}

export const game2048Options = z.object({
    embed: embedBuilder<[Game2048]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Game2048, Game2048Result]>().optional(),
    notPlayerMessage: gameInteractionMessage<Game2048>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
    buttonStyle: z.number().int().optional().default(ButtonStyle.Secondary),
    emojis: z
        .object({
            up: z.string().optional().default(defaultOptions.emojis.up),
            down: z.string().optional().default(defaultOptions.emojis.down),
            right: z.string().optional().default(defaultOptions.emojis.right),
            left: z.string().optional().default(defaultOptions.emojis.left),
        })
        .optional()
        .default(defaultOptions.emojis),
});

/**
 * A game where the player needs to merge numbers until reaching 2048.
 *
 * ## Custom Display
 *
 * If you are using functions to create the embeds, use `attachment://board.png`
 * in the embed image URL to display the board.
 *
 * @example
 * ```js
 * const game = new Game2048(interaction, {
 *     timeout: 120_000
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class Game2048 extends Game<Game2048Result> {
    readonly options: z.output<typeof game2048Options>;

    /**
     * A 4x4 array representing the game.
     *
     * The numbers are stored as exponents (1 = 2, 2 = 4, etc.).
     */
    readonly gameboard: number[] = [];

    /**
     * The width of the board.
     */
    readonly length: number = 4;

    /**
     * The current score of the player.
     */
    score: number = 0;

    message: Message | null = null;

    private mergedPos: Position[] = [];

    constructor(context: GameContext, options?: Game2048Options) {
        super(context);
        this.options = game2048Options.parse(options || {});

        for (let y = 0; y < this.length; y++) {
            for (let x = 0; x < this.length; x++) {
                this.gameboard[y * this.length + x] = 0;
            }
        }
    }

    override async start() {
        this.placeRandomTile();
        this.placeRandomTile();

        const embed = await this.buildEmbed(this.options.embed, {
            image: {
                url: "attachment://board.png",
            },
            fields: [
                {
                    name: "Current Score",
                    value: this.score.toString(),
                },
            ],
        });

        this.message = await this.sendMessage({
            embeds: [embed],
            components: this.getComponents(),
            files: [await this.getBoardAttachment()],
        });
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

            let moved = false;
            this.mergedPos = [];
            const direction = i.customId.split("-").at(-1);

            try {
                await i.deferUpdate();
            } catch (err) {
                this.emit("error", err);
                return;
            }

            if (direction === "up" || direction === "down") moved = this.shiftVertical(direction);
            if (direction === "left" || direction === "right") moved = this.shiftHorizontal(direction);

            if (moved) this.placeRandomTile();
            if (this.isGameOver()) return collector.stop("$over");

            const embed = await this.buildEmbed(this.options.embed, {
                image: {
                    url: "attachment://board.png",
                },
                fields: [
                    {
                        name: "Current Score",
                        value: this.score.toString(),
                    },
                ],
            });

            try {
                await i.editReply({ embeds: [embed], files: [await this.getBoardAttachment()] });
            } catch (err) {
                this.emit("error", err);
            }
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "idle" || reason === "$over") {
                await this.gameOver(message, reason === "$over" ? "over" : "timeout");
            }
        });
    }

    private async gameOver(message: Message, outcome: "over" | "timeout") {
        const result = this.buildResult({ outcome, score: this.score, hasWon: !!this.gameboard.find(n => n >= 11) });
        this.emit("gameOver", result);

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            image: {
                url: "attachment://board.png",
            },
            fields: [
                {
                    name: "Total Score",
                    value: this.score.toString(),
                },
            ],
        });

        try {
            await this.editContextOrMessage(message, {
                embeds: [embed],
                components: this.getComponents(true),
                files: [await this.getBoardAttachment()],
            });
        } catch (err) {
            this.emit("error", err);
        }
    }

    private isGameOver() {
        let boardFull = true;
        let numMoves = 0;

        for (let y = 0; y < this.length; y++) {
            for (let x = 0; x < this.length; x++) {
                if (this.gameboard[y * this.length + x] === 0) boardFull = false;
                const posNum = this.gameboard[y * this.length + x];

                for (const dir of ["down", "left", "right", "up"]) {
                    const newPos = moveInDirection({ x, y }, dir);
                    if (
                        this.isInsideBlock(newPos) &&
                        (this.gameboard[newPos.y * this.length + newPos.x] === 0 ||
                            this.gameboard[newPos.y * this.length + newPos.x] === posNum)
                    ) {
                        numMoves++;
                    }
                }
            }
        }
        return boardFull && numMoves === 0;
    }

    private placeRandomTile() {
        let tilePos = { x: 0, y: 0 };

        do {
            tilePos = { x: getRandomInt(this.length), y: getRandomInt(this.length) };
        } while (this.gameboard[tilePos.y * this.length + tilePos.x] != 0);

        this.gameboard[tilePos.y * this.length + tilePos.x] = Math.random() > 0.8 ? 2 : 1;
    }

    /**
     * @returns Has moved
     */
    private shiftVertical(dir: string): boolean {
        let moved = false;
        for (let x = 0; x < this.length; x++) {
            if (dir === "up") {
                for (let y = 1; y < this.length; y++) moved = this.shift({ x, y }, "up") || moved;
            } else {
                for (let y = this.length - 2; y >= 0; y--) moved = this.shift({ x, y }, "down") || moved;
            }
        }
        return moved;
    }

    /**
     * @returns Has moved
     */
    private shiftHorizontal(dir: string): boolean {
        let moved = false;
        for (let y = 0; y < this.length; y++) {
            if (dir === "left") {
                for (let x = 1; x < this.length; x++) {
                    moved = this.shift({ x, y }, "left") || moved;
                }
            } else {
                for (let x = this.length - 2; x >= 0; x--) {
                    moved = this.shift({ x, y }, "right") || moved;
                }
            }
        }
        return moved;
    }

    private isInsideBlock(pos: Position) {
        return pos.x >= 0 && pos.y >= 0 && pos.x < this.length && pos.y < this.length;
    }

    /**
     * @returns Has moved
     */
    private shift(pos: Position, dir: string): boolean {
        let moved = false;
        const movingTile = this.gameboard[pos.y * this.length + pos.x];
        if (movingTile === 0) return false;

        let set = false;
        let moveTo = pos;
        while (!set) {
            moveTo = moveInDirection(moveTo, dir);
            const moveToTile = this.gameboard[moveTo.y * this.length + moveTo.x];

            if (
                !this.isInsideBlock(moveTo) ||
                (moveToTile !== 0 && moveToTile !== movingTile) ||
                !!this.mergedPos.find(p => p.x === moveTo.x && p.y === moveTo.y)
            ) {
                const moveBack = moveInDirection(moveTo, getOppositeDirection(dir));
                if (!(moveBack.x === pos.x && moveBack.y === pos.y)) {
                    this.gameboard[pos.y * this.length + pos.x] = 0;
                    this.gameboard[moveBack.y * this.length + moveBack.x] = movingTile;
                    moved = true;
                }
                set = true;
            } else if (moveToTile === movingTile) {
                moved = true;
                this.gameboard[moveTo.y * this.length + moveTo.x] += 1;
                this.score += Math.floor(Math.pow(this.gameboard[moveTo.y * this.length + moveTo.x], 2));
                this.gameboard[pos.y * this.length + pos.x] = 0;
                this.mergedPos.push(moveTo);
                set = true;
            }
        }

        return moved;
    }

    private getComponents(disabled = false) {
        const row1 = new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
                .setDisabled(true)
                .setLabel("\u200b")
                .setStyle(this.options.buttonStyle)
                .setCustomId("$gamecord-2048-none1"),
            new ButtonBuilder()
                .setDisabled(disabled)
                .setEmoji(this.options.emojis.up)
                .setStyle(this.options.buttonStyle)
                .setCustomId("$gamecord-2048-up"),
            new ButtonBuilder()
                .setDisabled(true)
                .setLabel("\u200b")
                .setStyle(this.options.buttonStyle)
                .setCustomId("$gamecord-2048-none2"),
        );

        const row2 = new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
                .setDisabled(disabled)
                .setEmoji(this.options.emojis.left)
                .setStyle(this.options.buttonStyle)
                .setCustomId("$gamecord-2048-left"),
            new ButtonBuilder()
                .setDisabled(disabled)
                .setEmoji(this.options.emojis.down)
                .setStyle(this.options.buttonStyle)
                .setCustomId("$gamecord-2048-down"),
            new ButtonBuilder()
                .setDisabled(disabled)
                .setEmoji(this.options.emojis.right)
                .setStyle(this.options.buttonStyle)
                .setCustomId("$gamecord-2048-right"),
        );

        return [row1, row2];
    }

    private async getBoardAttachment(): Promise<AttachmentBuilder> {
        return new AttachmentBuilder(await this.getBoardImage(), { name: "board.png" });
    }

    private async getBoardImage(): Promise<Buffer> {
        const rows = this.length;
        const cols = this.length;
        const tile = 88;
        const gap = 12;
        const padding = 20;
        const width = padding * 2 + cols * tile + (cols - 1) * gap;
        const height = padding * 2 + rows * tile + (rows - 1) * gap;

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext("2d");

        // 2048 palette
        const PALETTE = {
            bg: "#faf8ef",
            board: "#bbada0",
            empty: "#cdc1b4",
            textDark: "#776e65",
            textLight: "#f9f6f2",
            tiles: new Map<number, string>([
                [2, "#eee4da"],
                [4, "#ede0c8"],
                [8, "#f2b179"],
                [16, "#f59563"],
                [32, "#f67c5f"],
                [64, "#f65e3b"],
                [128, "#edcf72"],
                [256, "#edcc61"],
                [512, "#edc850"],
                [1024, "#edc53f"],
                [2048, "#edc22e"],
            ]),
        };

        // Fill background + board area
        ctx.fillStyle = PALETTE.bg;
        ctx.fillRect(0, 0, width, height);

        // board background
        const boardRadius = 8;
        const boardX = padding - 8;
        const boardY = padding - 8;
        const boardWidth = cols * tile + (cols - 1) * gap + 16;
        const boardHeight = rows * tile + (rows - 1) * gap + 16;

        // rounded rect helper
        function roundRect(x: number, y: number, w: number, h: number, r: number) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        ctx.fillStyle = PALETTE.board;
        roundRect(boardX, boardY, boardWidth, boardHeight, boardRadius);
        ctx.fill();

        // draw tiles
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = padding + c * (tile + gap);
                const y = padding + r * (tile + gap);

                // game stores exponents (1 => 2, 2 => 4, etc.)
                const exponent = this.gameboard[r * this.length + c] ?? 0;
                const value = exponent > 0 ? 2 ** exponent : 0;

                // tile background
                const bgColor = value === 0 ? PALETTE.empty : (PALETTE.tiles.get(value) ?? "#3c3a32");
                const radius = 6;
                ctx.fillStyle = bgColor;
                roundRect(x, y, tile, tile, radius);
                ctx.fill();

                // subtle inner stroke for empty tiles
                ctx.lineWidth = 2;
                ctx.strokeStyle = value === 0 ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.08)";
                ctx.stroke();

                // number
                if (value !== 0) {
                    const digits = value.toString().length;
                    // adjust font size based on digits
                    let fontSize = Math.floor(tile * 0.54);
                    if (digits >= 3) fontSize = Math.floor(tile * 0.46);
                    if (digits >= 4) fontSize = Math.floor(tile * 0.36);
                    ctx.font = `700 ${fontSize}px sans-serif`;

                    ctx.fillStyle = value <= 4 ? PALETTE.textDark : PALETTE.textLight;
                    ctx.fillText(value.toString(), x + tile / 2, y + tile / 2 + 2);
                }
            }
        }

        // return PNG buffer
        return canvas.toBuffer("image/png");
    }
}
