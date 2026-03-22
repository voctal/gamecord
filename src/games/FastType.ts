import { Message } from "discord.js";
import z from "zod";
import { Game, GameContext, GameResult } from "../core/Game";
import sentences from "../data/fast-type.json";
import { colors } from "../utils/constants";
import { getRandomElement } from "../utils/random";
import { embedBuilder, resultMessage } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage } from "../utils/types";

/**
 * The fast type game result.
 */
export interface FastTypeResult extends GameResult {
    outcome: "win" | "lose" | "timeout";
    sentence: string;
    timeTaken: number;
    secondsTaken: number;
    /**
     * Words per minute. Will be `0` if the player has lost.
     */
    wpm: number;
}

const defaultOptions = {
    embed: {
        title: "Fast Type",
        color: colors.blurple,
        description: `You have 30 seconds to type the sentence below.`,
    },
    winMessage: (res: FastTypeResult) =>
        `You won! You finished the type race in ${res.secondsTaken} seconds with word per minute of ${res.wpm}.`,
    loseMessage: () => "You lost! You didn't type the correct sentence in time.",
    timeout: 30_000,
};

export interface FastTypeOptions {
    embed?: GameEmbed<FastType>;
    endEmbed?: GameEndEmbed<FastType, FastTypeResult>;
    winMessage?: GameEndMessage<FastType, FastTypeResult>;
    loseMessage?: GameEndMessage<FastType, FastTypeResult>;
    /**
     * The sentence the player has to type. Random by default.
     */
    sentence?: string;
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
}

export const fastTypeOptions = z.object({
    embed: embedBuilder<[FastType]>()
        .optional()
        .default(() => defaultOptions.embed),
    endEmbed: embedBuilder<[FastType, FastTypeResult]>().optional(),
    winMessage: resultMessage<FastTypeResult, FastType>()
        .optional()
        .default(() => defaultOptions.winMessage),
    loseMessage: resultMessage<FastTypeResult, FastType>()
        .optional()
        .default(() => defaultOptions.loseMessage),
    sentence: z.string().optional(),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
});

/**
 * A game where the player needs to write a sentence as fast as possible.
 *
 * ## Permissions
 *
 * The bot needs to be able to read the messages of the current channel.
 *
 * @example
 * ```js
 * const game = new FastType(interaction, {
 *     // See the full list of options in the docs
 *     sentence: "Some really cool sentence to fast type.",
 *     winMessage: res => `You won! You finished the type race in ${res.secondsTaken} seconds with word per minute of ${res.wpm}.`
 *     timeout: 20_000
 * });
 *
 * game.on("error", err => console.error(err));
 * game.on("gameOver", result => console.log(result));
 *
 * await game.start();
 * ```
 */
export class FastType extends Game<FastTypeResult> {
    readonly options: z.output<typeof fastTypeOptions>;

    /**
     * The sentence the player has to type.
     */
    sentence: string;

    private timeTaken: number = 0;

    private wpm: number = 0;

    constructor(context: GameContext, options?: FastTypeOptions) {
        super(context);
        this.options = fastTypeOptions.parse(options || {});
        this.sentence = this.options.sentence || getRandomElement(sentences);
    }

    override async start() {
        const embed =
            typeof this.options.embed === "function"
                ? await this.options.embed(this)
                : {
                      author: {
                          name: this.player.displayName,
                          icon_url: this.player.displayAvatarURL(),
                      },
                      fields: [
                          {
                              name: "Sentence",
                              value: this.sentence
                                  .split(" ")
                                  .map(e => "`" + e.split("").join(" ") + "`")
                                  .join(" "),
                          },
                      ],
                      ...this.options.embed,
                  };

        const message = await this.sendMessage({ embeds: [embed] });
        if (!message.channel.isSendable()) return;

        const startTime = Date.now();

        const collector = message.channel.createMessageCollector({
            time: this.options.timeout,
            filter: m => m.author.id === this.player.id,
        });

        collector.on("collect", async msg => {
            this.timeTaken = Math.floor(Date.now() - startTime);
            this.wpm = Math.floor(msg.content.trim().length / ((this.timeTaken / 60000) % 60) / 5);

            const hasWon = msg.content?.toLowerCase().trim() === this.sentence.toLowerCase();
            collector.stop(hasWon ? "$win" : "$lose");
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (!this.timeTaken) {
                this.timeTaken = Math.floor(Date.now() - startTime);
            }

            if (reason === "$win" || reason === "$lose" || reason === "time") {
                await this.gameOver(message, reason === "$win" ? "win" : reason === "$lose" ? "lose" : "timeout");
            }
        });
    }

    private async gameOver(message: Message, outcome: "win" | "lose" | "timeout") {
        const result = this.buildResult({
            outcome,
            sentence: this.sentence,
            timeTaken: this.timeTaken,
            secondsTaken: Math.floor(this.timeTaken / 1000),
            wpm: this.wpm,
        });
        this.emit("gameOver", result);

        const embed = await this.buildEndEmbed(this.options.embed, this.options.endEmbed, result, {
            description:
                result.outcome === "win"
                    ? this.options.winMessage(result, this)
                    : this.options.loseMessage(result, this),
        });

        try {
            await this.editContextOrMessage(message, { embeds: [embed] });
        } catch (err) {
            this.emit("error", err);
        }
    }
}
