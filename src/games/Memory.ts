import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import { colors } from "../utils/constants";
import { removeEmoji } from "../utils/games";
import { shuffleArray } from "../utils/random";
import { embedBuilder, gameInteractionMessage, resultMessage } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage, GameInteractionMessage } from "../utils/types";

export const jokerEmoji = "🃏";

export interface MemoryEmojiPosition {
    x: number;
    y: number;
    index: number;
}

/**
 * The memory game result.
 */
export interface MemoryResult extends GameResult {
    outcome: "win" | "timeout";
    tilesTurned: number;
    remainingPairs: number;
}

const defaultOptions = {
    embed: {
        title: "Memory",
        color: colors.blurple,
        description: "**Click on the buttons to match emojis with their pairs.**",
    },
    winMessage: (res: MemoryResult) => `**You won the Game! You turned a total of \`${res.tilesTurned}\` tiles.**`,
    loseMessage: (res: MemoryResult) => `**You lost the Game! You turned a total of \`${res.tilesTurned}\` tiles.**`,
    notPlayerMessage: (game: Memory) => `Only ${game.player} can use this menu.`,
    timeout: 120_000,
    emojis: [
        "🍉",
        "🍇",
        "🍊",
        "🍋",
        "🥭",
        "🍎",
        "🍏",
        "🥝",
        "🥥",
        "🍓",
        "🍒",
        "🫐",
        "🍍",
        "🍅",
        "🍐",
        "🥔",
        "🌽",
        "🥕",
        "🥬",
        "🥦",
    ],
};

export interface MemoryOptions {
    embed?: GameEmbed<Memory>;
    endEmbed?: GameEndEmbed<Memory, MemoryResult>;
    winMessage?: GameEndMessage<Memory, MemoryResult>;
    loseMessage?: GameEndMessage<Memory, MemoryResult>;
    notPlayerMessage?: GameInteractionMessage<Memory>;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
    /**
     * 20 emojis used for the game.
     */
    emojis?: string[];
}

export const memoryOptions = z.object({
    embed: embedBuilder<[Memory]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Memory, MemoryResult]>().optional(),
    winMessage: resultMessage<MemoryResult, Memory>()
        .optional()
        .default(() => defaultOptions.winMessage),
    loseMessage: resultMessage<MemoryResult, Memory>()
        .optional()
        .default(() => defaultOptions.loseMessage),
    notPlayerMessage: gameInteractionMessage<Memory>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
    emojis: z.array(z.string()).length(20).optional().default(defaultOptions.emojis),
});

/**
 * A game where the player to find all the pairs.
 *
 * @example
 * ```js
 * const game = new Memory(interaction, {
 *     winMessage: res => `**You won the Game! You turned a total of \`${res.tilesTurned}\` tiles.**`
 *     timeout: 120_000
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class Memory extends Game<MemoryResult> {
    readonly options: z.output<typeof memoryOptions>;

    readonly emojis: string[];
    components: ActionRowBuilder<ButtonBuilder>[] = [];
    selected: MemoryEmojiPosition | null = null;
    remainingPairs: number = 12;
    tilesTurned: number = 0;
    readonly size: number = 5;

    message: Message | null = null;

    constructor(context: GameContext, options?: MemoryOptions) {
        super(context);
        this.options = memoryOptions.parse(options || {});

        this.emojis = [...this.options.emojis];
        this.emojis = shuffleArray(this.emojis).slice(0, 12);
        this.emojis.push(...this.emojis, jokerEmoji);
        this.emojis = shuffleArray(this.emojis);
    }

    override async start() {
        this.components = this.getComponents();

        const embed = await this.buildEmbed(this.options.embed);

        this.message = await this.sendMessage({ embeds: [embed], components: this.components });
        this.handleButtons(this.message);
    }

    /**
     * Get the positions of this emoji.
     */
    public getPairEmojiPositions(emoji: string): MemoryEmojiPosition[] {
        const emojis = [];
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const index = y * this.size + x;
                if (this.emojis[index] === emoji) emojis.push({ x, y, index });
            }
        }
        return emojis;
    }

    public getComponents(): ActionRowBuilder<ButtonBuilder>[] {
        const components = [];
        for (let y = 0; y < this.size; y++) {
            const row = new ActionRowBuilder<ButtonBuilder>();

            for (let x = 0; x < this.size; x++) {
                row.addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Secondary)
                        .setLabel("\u200b")
                        .setCustomId(`$gamecord-memory-${x}-${y}`),
                );
            }

            components.push(row);
        }
        return components;
    }

    private async gameOver(message: Message, hasTimedOut: boolean) {
        const result = this.buildResult({
            outcome: hasTimedOut ? "timeout" : "win",
            tilesTurned: this.tilesTurned,
            remainingPairs: this.remainingPairs,
        });
        this.emit("gameOver", result);

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            description:
                result.outcome === "win"
                    ? this.options.winMessage(result, this)
                    : this.options.loseMessage(result, this),
        });

        try {
            for (const row of this.components) {
                for (const btn of row.components) {
                    btn.setDisabled(true);
                }
            }

            await this.editContextOrMessage(message, {
                embeds: [embed],
                components: this.components,
            });
        } catch (err) {
            this.emit("error", err);
        }
    }

    private async handleButtons(message: Message) {
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

            const emoji = this.emojis[index];
            const emojiBtn = this.components[y].components[x];
            this.tilesTurned += 1;

            if (!this.selected) {
                this.selected = { x, y, index };
                emojiBtn.setEmoji(emoji).setStyle(ButtonStyle.Primary);
            } else if (this.selected.index === index) {
                this.selected = null;
                removeEmoji(emojiBtn).setStyle(ButtonStyle.Secondary);
            } else {
                const selectedEmoji = this.emojis[this.selected.index];
                const selectedBtn = this.components[this.selected.y].components[this.selected.x];
                const matched = emoji === selectedEmoji || selectedEmoji === jokerEmoji || emoji === jokerEmoji;

                if (selectedEmoji === jokerEmoji || emoji === jokerEmoji) {
                    const joker = emoji === jokerEmoji ? this.selected : { x, y, index };
                    const pair = this.getPairEmojiPositions(this.emojis[joker.index]).filter(
                        b => b.index !== joker.index,
                    )[0];
                    const pairBtn = this.components[pair.y].components[pair.x];

                    pairBtn.setEmoji(this.emojis[pair.index]).setStyle(ButtonStyle.Success).setDisabled(true);
                }

                emojiBtn
                    .setEmoji(emoji)
                    .setStyle(matched ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setDisabled(matched);
                selectedBtn
                    .setEmoji(selectedEmoji)
                    .setStyle(matched ? ButtonStyle.Success : ButtonStyle.Danger)
                    .setDisabled(matched);

                if (!matched) {
                    try {
                        await i.editReply({ components: this.components });
                    } catch (err) {
                        this.emit("error", err);
                    }

                    removeEmoji(emojiBtn).setStyle(ButtonStyle.Secondary);
                    removeEmoji(selectedBtn).setStyle(ButtonStyle.Secondary);

                    this.selected = null;
                    return;
                }

                this.remainingPairs -= 1;
                this.selected = null;
            }

            if (this.remainingPairs === 0) return collector.stop("$win");

            try {
                await i.editReply({ components: this.components });
            } catch (err) {
                this.emit("error", err);
            }
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "$win" || reason === "idle") {
                await this.gameOver(message, reason === "idle");
            }
        });
    }
}
