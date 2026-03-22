import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import { colors } from "../utils/constants";
import { getRandomElement, shuffleArray } from "../utils/random";
import { embedBuilder, gameInteractionMessage, gameMessage, resultMessage } from "../utils/schemas";
import {
    Awaitable,
    GameEmbed,
    GameEndEmbed,
    GameEndMessage,
    GameInteractionMessage,
    GameMessage,
} from "../utils/types";

/**
 * The trivia game result.
 */
export interface TriviaResult extends GameResult {
    outcome: "win" | "lose" | "timeout";
    trivia: TriviaData;
    /**
     * Index in `trivia.options`.
     */
    selected: number;
}

/**
 * The data of the trivia. The `options` array contains all the choices, including the answer.
 *
 *
 * If you are using the `trivia` option, here is what you should know:
 *
 * ### When `mode` is `boolean`:
 *
 * - `answer` MUST be exactly either `"True"` or `"False"`.
 *
 * - `options` MUST be exactly `["True", "False"]`.
 *
 * The buttons labels will still use the `trueText` and `falseText` options.
 *
 * ### When `mode` is `multiple`:
 *
 * - `answer` MUST be exactly the same as one present in the `options`.
 *
 * - `options` can have 2 to 5 elements.
 */
export interface TriviaData {
    question: string;
    difficulty: string;
    category: string;
    answer: string;
    options: string[];
}

const triviaAPISchema = z.object({
    results: z.array(
        z.object({
            difficulty: z.string(),
            category: z.string(),
            question: z.string(),
            correct_answer: z.string(),
            incorrect_answers: z.array(z.string()),
        }),
    ),
});

const difficulties = ["easy", "medium", "hard"];

const defaultOptions = {
    embed: {
        title: "Trivia",
        color: colors.blurple,
        fields: [
            {
                name: "\u200b",
                value: "You have 60 seconds to guess the answer.",
            },
        ],
    },
    winMessage: (res: TriviaResult) => `You won! The correct answer was ${res.trivia.answer}.`,
    loseMessage: (res: TriviaResult) => `You lost! The correct answer was ${res.trivia.answer}.`,
    errorMessage: () => "Unable to fetch question data! Please try again.",
    notPlayerMessage: (game: Trivia) => `Only ${game.player} can use this menu.`,
    mode: "multiple" as const,
    timeout: 60_000,
    trueText: "True",
    falseText: "False",
};

export interface TriviaOptions {
    embed?: GameEmbed<Trivia>;
    endEmbed?: GameEndEmbed<Trivia, TriviaResult>;
    winMessage?: GameEndMessage<Trivia, TriviaResult>;
    loseMessage?: GameEndMessage<Trivia, TriviaResult>;
    notPlayerMessage?: GameInteractionMessage<Trivia>;
    /**
     * Message displayed when the API call to fetch the trivia fails.
     */
    errorMessage?: GameMessage<Trivia>;
    /**
     * "multiple" by default.
     *
     * When `mode` is `"boolean"`, the trivia is a true/false question.
     * When `mode` is `"multiple"`, it is a multi-choices trivia.
     */
    mode?: "multiple" | "boolean";
    /**
     * Random if not specified.
     */
    difficulty?: "easy" | "medium" | "hard";
    /**
     * Use this options if you want to provide your own questions.
     * If present, this will be used instead of the API.
     */
    trivia?: (game: Trivia) => Awaitable<TriviaData>;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
    /**
     * The button label for the "True" button. Only used when mode is "boolean".
     */
    trueText?: string;
    /**
     * The button label for the "False" button. Only used when mode is "boolean".
     */
    falseText?: string;
}

export const triviaOptions = z.object({
    embed: embedBuilder<[Trivia]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[Trivia, TriviaResult]>().optional(),
    winMessage: resultMessage<TriviaResult, Trivia>()
        .optional()
        .default(() => defaultOptions.winMessage),
    loseMessage: resultMessage<TriviaResult, Trivia>()
        .optional()
        .default(() => defaultOptions.loseMessage),
    errorMessage: gameMessage<Trivia>()
        .optional()
        .default(() => defaultOptions.errorMessage),
    notPlayerMessage: gameInteractionMessage<Trivia>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    mode: z.enum(["multiple", "boolean"]).optional().default(defaultOptions.mode),
    difficulty: z.enum(difficulties).optional(),
    trivia: z.custom<(game: Trivia) => Awaitable<TriviaData>>().optional(),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
    trueText: z.string().optional().default(defaultOptions.trueText),
    falseText: z.string().optional().default(defaultOptions.falseText),
});

/**
 * A game where the player needs to find the answer of a random question.
 *
 * When `mode` is `"boolean"`, the trivia is a true/false question.
 * When `mode` is `"multiple"`, it is a multi-choices trivia.
 *
 * ## API
 *
 * This game uses the `opentdb.com` API. If you want to use
 * your own questions, use the `trivia` option.
 *
 * @example
 * ```js
 * const game = new Trivia(interaction, {
 *     timeout: 30_000
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class Trivia extends Game<TriviaResult> {
    readonly options: z.output<typeof triviaOptions>;

    readonly difficulty: string;
    selected: number | null = null;
    trivia: TriviaData | null = null;

    message: Message | null = null;

    constructor(context: GameContext, options?: TriviaOptions) {
        super(context);
        this.options = triviaOptions.parse(options || {});
        this.difficulty = this.options.difficulty || getRandomElement(difficulties);
    }

    override async start() {
        this.trivia = await this.getTriviaQuestion();
        if (!this.trivia) {
            try {
                await this.sendMessage({
                    content: this.options.errorMessage(this),
                });
            } catch (err) {
                this.emit("error", err);
            }
            return;
        }

        const embed = await this.buildEmbed(this.options.embed, {
            description: `**${this.trivia.question}**\n\n**Difficulty:** ${this.trivia.difficulty}\n**Category:** ${this.trivia.category}`,
        });

        this.message = await this.sendMessage({ embeds: [embed], components: this.getComponents() });
        this.handleButtons(this.message);
    }

    private handleButtons(message: Message) {
        const trivia = this.trivia!;
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

            collector.stop();
            this.selected = Number(i.customId.split("-").at(-1));

            try {
                await i.deferUpdate();
            } catch (err) {
                this.emit("error", err);
            }

            await this.gameOver(message, trivia.options[this.selected] === trivia.answer);
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "idle") {
                await this.gameOver(message, false, true);
            }
        });
    }

    private async gameOver(message: Message, hasWon: boolean, hasTimedOut = false) {
        const trivia = this.trivia!;
        const result = this.buildResult({
            outcome: hasTimedOut ? "timeout" : hasWon ? "win" : "lose",
            trivia: trivia,
            selected: this.selected!,
        });
        this.emit("gameOver", result);

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            description: `**${trivia.question}**\n\n**Difficulty:** ${trivia.difficulty}\n**Category:** ${trivia.category}`,
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
                components: this.getComponents(true),
            });
        } catch (err) {
            this.emit("error", err);
        }
    }

    /**
     * Build the selection buttons.
     */
    getComponents(ended = false) {
        const trivia = this.trivia!;
        const row = new ActionRowBuilder<ButtonBuilder>();

        if (ended && this.selected === null) {
            this.selected = trivia.options.indexOf(trivia.answer);
        }

        if (this.options.mode === "multiple") {
            for (let i = 0; i < 4; i++) {
                row.addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Secondary)
                        .setCustomId(`$gamecord-trivia-${i}`)
                        .setLabel(trivia.options[i])
                        .setDisabled(ended),
                );
            }

            if (this.selected !== null) {
                if (trivia.answer !== trivia.options[this.selected]) {
                    row.components[this.selected].setStyle(ButtonStyle.Danger);
                } else {
                    row.components[this.selected].setStyle(ButtonStyle.Success);
                }
            }
        } else {
            row.setComponents(
                new ButtonBuilder()
                    .setStyle(
                        this.selected === 0
                            ? trivia.answer === "True"
                                ? ButtonStyle.Success
                                : ButtonStyle.Danger
                            : ButtonStyle.Secondary,
                    )
                    .setCustomId("$gamecord-trivia-0")
                    .setLabel(this.options.trueText)
                    .setDisabled(ended),
                new ButtonBuilder()
                    .setStyle(
                        this.selected === 1
                            ? trivia.answer === "False"
                                ? ButtonStyle.Success
                                : ButtonStyle.Danger
                            : ButtonStyle.Secondary,
                    )
                    .setCustomId("$gamecord-trivia-1")
                    .setLabel(this.options.falseText)
                    .setDisabled(ended),
            );
        }

        return [row];
    }

    private async getTriviaQuestion(): Promise<TriviaData | null> {
        if (this.options.trivia) {
            return await this.options.trivia(this);
        }

        const mode = this.options.mode;

        let data;
        try {
            const res = await fetch(
                `https://opentdb.com/api.php?amount=1&type=${mode}&difficulty=${this.difficulty}&encode=url3986`,
            );
            const json = await res.json();

            if (typeof json === "object" && json !== null && "response_code" in json && json.response_code === 5) {
                throw new Error("Ratelimited by opentdb");
            }

            data = triviaAPISchema.parse(json);
            data = data.results[0];
        } catch (err) {
            this.emit("error", err);
            return null;
        }

        if (!data) {
            return null;
        }

        const trivia: TriviaData = {
            question: decodeURIComponent(data.question),
            difficulty: decodeURIComponent(data.difficulty),
            category: decodeURIComponent(data.category),
            answer: decodeURIComponent(data.correct_answer),
            options: [],
        };

        if (mode === "multiple") {
            data.incorrect_answers.push(data.correct_answer);
            trivia.options = shuffleArray(data.incorrect_answers).map(a => decodeURIComponent(a));
        } else {
            trivia.options = ["True", "False"];
        }

        return trivia;
    }
}
