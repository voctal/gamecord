import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import { colors } from "../utils/constants";
import { getRandomInt } from "../utils/random";
import { embedBuilder, gameInteractionMessage, resultMessage } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage, GameInteractionMessage } from "../utils/types";

/**
 * The flood game result.
 */
export interface FloodResult extends GameResult {
    outcome: "win" | "lose" | "timeout";
    turns: number;
    maxTurns: number;
    /**
     * The index (in `options.emojis`) of the last emoji that was chosen by the player.
     */
    boardEmojiIndex: number;
}

const defaultOptions = {
    embed: {
        title: "Flood",
        color: colors.blurple,
    },
    winMessage: (res: FloodResult) => `You won! You took **${res.turns}** turns.`,
    loseMessage: (res: FloodResult) => `You lost! You took **${res.turns}** turns.`,
    notPlayerMessage: (game: Flood) => `Only ${game.player} can use these buttons.`,
    size: 13,
    maxTurns: 25,
    timeout: 120_000,
    buttonStyle: ButtonStyle.Primary,
    emojis: ["🟥", "🟦", "🟧", "🟪", "🟩"],
};

export interface FloodOptions {
    embed?: GameEmbed<Flood>;
    endEmbed?: GameEndEmbed<Flood, FloodResult>;
    winMessage?: GameEndMessage<Flood, FloodResult>;
    loseMessage?: GameEndMessage<Flood, FloodResult>;
    notPlayerMessage?: GameInteractionMessage<Flood>;
    /**
     * The size (width) of the game board.
     */
    size?: number;
    /**
     * The max amount of turns the player can do.
     */
    maxTurns?: number;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
    buttonStyle?: ButtonStyle;
    /**
     * The 5 emojis of the game.
     */
    emojis?: string[];
}

export const floodOptions = z.object({
    embed: embedBuilder<[Flood]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Flood, FloodResult]>().optional(),
    winMessage: resultMessage<FloodResult, Flood>()
        .optional()
        .default(() => defaultOptions.winMessage),
    loseMessage: resultMessage<FloodResult, Flood>()
        .optional()
        .default(() => defaultOptions.loseMessage),
    notPlayerMessage: gameInteractionMessage<Flood>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    size: z.number().int().optional().default(defaultOptions.size),
    maxTurns: z.number().int().optional().default(defaultOptions.maxTurns),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
    buttonStyle: z.number().int().optional().default(defaultOptions.buttonStyle),
    emojis: z.array(z.string()).length(5).optional().default(defaultOptions.emojis),
});

/**
 * A game where the player needs to make the whole board a single emoji.
 *
 * ## Custom display
 *
 * If you are using functions to create the embeds, use {@link Flood#getBoardContent} to get the game board.
 *
 * @example
 * ```js
 * const game = new Flood(interaction, {
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
export class Flood extends Game<FloodResult> {
    readonly options: z.output<typeof floodOptions>;

    readonly board: number[] = [];

    /**
     * The current amount of turns.
     */
    turns: number = 0;

    message: Message | null = null;

    constructor(context: GameContext, options?: FloodOptions) {
        super(context);
        this.options = floodOptions.parse(options || {});

        for (let y = 0; y < this.options.size; y++) {
            for (let x = 0; x < this.options.size; x++) {
                this.board[y * this.options.size + x] = getRandomInt(this.options.emojis.length - 1);
            }
        }
    }

    override async start() {
        this.message = await this.sendMessage({ embeds: [await this.getEmbed()], components: [this.getActionRow()] });
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

            try {
                await i.deferUpdate();
            } catch (err) {
                this.emit("error", err);
                return;
            }

            const index = Number(i.customId.split("-").at(-1));
            const updateResult = this.updateGame(index);

            if (updateResult === "win") return collector.stop("$win");
            if (updateResult === "lose") return collector.stop("$lose");

            try {
                await i.editReply({ embeds: [await this.getEmbed()], components: [this.getActionRow()] });
            } catch (err) {
                this.emit("error", err);
            }
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "$win" || reason == "$lose" || reason === "idle") {
                await this.gameOver(message, reason === "$win" ? "win" : reason === "$lose" ? "lose" : "timeout");
            }
        });
    }

    /**
     * Get the formatted board content.
     */
    getBoardContent() {
        let board = "";
        for (let y = 0; y < this.options.size; y++) {
            for (let x = 0; x < this.options.size; x++) {
                const index = this.board[y * this.options.size + x];
                board += this.options.emojis[index];
            }
            board += "\n";
        }
        return board;
    }

    getActionRow(disabled = false) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let i = 0; i < 5; i++) {
            row.addComponents(
                new ButtonBuilder()
                    .setStyle(this.options.buttonStyle)
                    .setEmoji(this.options.emojis[i])
                    .setCustomId(`$gamecord-flood-${i}`)
                    .setDisabled(disabled),
            );
        }
        return row;
    }

    private async getEmbed() {
        return typeof this.options.embed === "function"
            ? await this.options.embed(this)
            : {
                  author: {
                      name: this.player.displayName,
                      icon_url: this.player.displayAvatarURL(),
                  },
                  fields: [{ name: "Turns", value: `${this.turns}/${this.options.maxTurns}` }],
                  ...this.options.embed,
                  description: this.getBoardContent(),
              };
    }

    private async gameOver(message: Message, outcome: "win" | "lose" | "timeout") {
        const result = this.buildResult({
            outcome,
            turns: this.turns,
            maxTurns: this.options.maxTurns,
            boardEmojiIndex: this.board[0],
        });
        this.emit("gameOver", result);

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            description: this.getBoardContent(),
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
            await this.editContextOrMessage(message, { embeds: [embed], components: [this.getActionRow(true)] });
        } catch (err) {
            this.emit("error", err);
        }
    }

    private updateGame(selected: number): "win" | "lose" | "none" {
        if (selected === this.board[0]) return "none";
        const firstBlock = this.board[0];
        const queue = [{ x: 0, y: 0 }];
        const visited: { x: number; y: number }[] = [];
        this.turns += 1;

        while (queue.length > 0) {
            const block = queue.shift();
            if (!block || visited.some(v => v.x === block.x && v.y === block.y)) continue;
            const index = block.y * this.options.size + block.x;

            visited.push(block);
            if (this.board[index] === firstBlock) {
                this.board[index] = selected;

                const up = { x: block.x, y: block.y - 1 };
                if (!visited.some(v => v.x === up.x && v.y === up.y) && up.y >= 0) queue.push(up);

                const down = { x: block.x, y: block.y + 1 };
                if (!visited.some(v => v.x === down.x && v.y === down.y) && down.y < this.options.size)
                    queue.push(down);

                const left = { x: block.x - 1, y: block.y };
                if (!visited.some(v => v.x === left.x && v.y === left.y) && left.x >= 0) queue.push(left);

                const right = { x: block.x + 1, y: block.y };
                if (!visited.some(v => v.x === right.x && v.y === right.y) && right.x < this.options.size)
                    queue.push(right);
            }
        }

        let gameOver = true;
        for (let y = 0; y < this.options.size; y++) {
            for (let x = 0; x < this.options.size; x++) {
                if (this.board[y * this.options.size + x] !== selected) gameOver = false;
            }
        }

        if (this.turns >= this.options.maxTurns && !gameOver) return "lose";
        if (gameOver) return "win";
        return "none";
    }
}
