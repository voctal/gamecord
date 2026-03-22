import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Message, MessageFlags, User } from "discord.js";
import z from "zod";
import { GameContext } from "../core/Game";
import { VersusGame, VersusGameResult, VersusOptions, versusOptions } from "../core/VersusGame";
import { colors } from "../utils/constants";
import { embedBuilder, gameInteractionMessage, resultMessage, var2Message } from "../utils/schemas";
import { GameEmbed, GameEndEmbed, GameEndMessage, GameInteractionMessage, GameTurnMessage } from "../utils/types";

/**
 * The RPS game result.
 */
export interface RockPaperScissorsResult extends VersusGameResult {
    outcome: "win" | "tie" | "timeout";
    /**
     * Only if `outcome` is `win`.
     */
    winner: User | null;
    playerChoice: string | null;
    opponentChoice: string | null;
}

const defaultOptions = {
    embed: {
        title: "Rock Paper Scissors",
        color: colors.blurple,
        description: "Press a button below to make a choice.",
    },
    winMessage: (res: RockPaperScissorsResult) => `**${res.winner}** won the Game! Congratulations!`,
    tieMessage: () => "The Game tied! No one won the Game!",
    timeoutMessage: () => "The Game went unfinished! No one won the Game!",
    choiceMessage: (emoji: string) => `You choose ${emoji}.`,
    notPlayerMessage: (game: RockPaperScissors) => `Only ${game.player} and ${game.opponent} can use this menu.`,
    buttons: {
        rock: "Rock",
        paper: "Paper",
        scissors: "Scissors",
    },
    emojis: {
        rock: "🌑",
        paper: "📰",
        scissors: "✂️",
    },
    timeout: 60_000,
};

export interface RockPaperScissorsOptions {
    versus: VersusOptions;
    embed?: GameEmbed<RockPaperScissors>;
    endEmbed?: GameEndEmbed<RockPaperScissors, RockPaperScissorsResult>;
    winMessage?: GameEndMessage<RockPaperScissors, RockPaperScissorsResult>;
    tieMessage?: GameEndMessage<RockPaperScissors, RockPaperScissorsResult>;
    timeoutMessage?: GameEndMessage<RockPaperScissors, RockPaperScissorsResult>;
    /**
     * The first argument is the emoji chosen by the player.
     */
    choiceMessage?: GameTurnMessage<RockPaperScissors, string>;
    notPlayerMessage?: GameInteractionMessage<RockPaperScissors>;
    buttonStyle?: ButtonStyle;
    buttons?: {
        rock?: string;
        paper?: string;
        scissors?: string;
    };
    emojis?: {
        rock?: string;
        paper?: string;
        scissors?: string;
    };
    /**
     * The max amount of time the player can be idle.
     */
    timeout?: number;
}

export const rockPaperScissorsOptions = z.object({
    versus: versusOptions("Rock Paper Scissors"),
    embed: embedBuilder<[RockPaperScissors]>().optional().default(defaultOptions.embed),
    endEmbed: embedBuilder<[RockPaperScissors, RockPaperScissorsResult]>().optional(),
    winMessage: resultMessage<RockPaperScissorsResult, RockPaperScissors>()
        .optional()
        .default(() => defaultOptions.winMessage),
    tieMessage: resultMessage<RockPaperScissorsResult, RockPaperScissors>()
        .optional()
        .default(() => defaultOptions.tieMessage),
    timeoutMessage: resultMessage<RockPaperScissorsResult, RockPaperScissors>()
        .optional()
        .default(() => defaultOptions.timeoutMessage),
    choiceMessage: var2Message<string, RockPaperScissors>()
        .optional()
        .default(() => defaultOptions.choiceMessage),
    notPlayerMessage: gameInteractionMessage<RockPaperScissors>()
        .optional()
        .default(() => defaultOptions.notPlayerMessage),
    buttonStyle: z.number().int().optional().default(ButtonStyle.Primary),
    buttons: z
        .object({
            rock: z.string().optional().default(defaultOptions.buttons.rock),
            paper: z.string().optional().default(defaultOptions.buttons.paper),
            scissors: z.string().optional().default(defaultOptions.buttons.scissors),
        })
        .optional()
        .default(defaultOptions.buttons),
    emojis: z
        .object({
            rock: z.string().optional().default(defaultOptions.emojis.rock),
            paper: z.string().optional().default(defaultOptions.emojis.paper),
            scissors: z.string().optional().default(defaultOptions.emojis.scissors),
        })
        .optional()
        .default(defaultOptions.emojis),
    timeout: z.number().int().optional().default(defaultOptions.timeout),
});

/**
 * The Rock Paper Scissors game.
 *
 * ## Errors
 *
 * Can emit `fatalError` if it fails to edit from the invitation embed to the game message.
 *
 * @example
 * ```js
 * const opponent = // The opponent (must be a discord.js User)
 *
 * const game = new RockPaperScissors(interaction, {
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
export class RockPaperScissors extends VersusGame<RockPaperScissorsResult> {
    readonly options: z.output<typeof rockPaperScissorsOptions>;

    playerChoice: string | null = null;
    opponentChoice: string | null = null;

    message: Message | null = null;

    constructor(context: GameContext, options?: RockPaperScissorsOptions) {
        const parsed = rockPaperScissorsOptions.parse(options || {});
        super(context, parsed.versus);
        this.options = parsed;
    }

    override async start() {
        this.message = await this.requestVersus();
        if (this.message) this.runGame(this.message);
    }

    private async runGame(message: Message) {
        try {
            const embed = await this.buildEmbed(this.options.embed);

            await this.editContextOrMessage(message, {
                content: null,
                embeds: [embed],
                components: [this.getActionRow()],
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

        const emojis = this.options.emojis;
        const choices = { r: emojis.rock, p: emojis.paper, s: emojis.scissors };

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

            const choice = choices[i.customId.split("-").at(-1) as keyof typeof choices];
            let replyChoice = false;

            if (i.user.id === this.player.id && !this.playerChoice) {
                this.playerChoice = choice;
                replyChoice = true;
            } else if (i.user.id === this.opponent.id && !this.opponentChoice) {
                this.opponentChoice = choice;
                replyChoice = true;
            }

            if (replyChoice) {
                try {
                    await i.reply({
                        content: this.options.choiceMessage(choice, this),
                        flags: MessageFlags.Ephemeral,
                    });
                } catch (err) {
                    this.emit("error", err);
                }
            }

            if (!i.replied) {
                try {
                    await i.deferUpdate();
                } catch (err) {
                    this.emit("error", err);
                    return;
                }
            }

            if (this.playerChoice && this.opponentChoice) return collector.stop("$end");
        });

        collector.on("end", async (_, reason) => {
            this.emit("end");

            if (reason === "idle" || reason === "$end") {
                await this.gameOver(message);
            }
        });
    }

    private getResult() {
        if (!this.playerChoice && !this.opponentChoice) return "timeout";
        else if (this.playerChoice === this.opponentChoice) return "tie";
        else return "win";
    }

    private hasPlayer1Won() {
        const r = this.options.emojis.rock;
        const p = this.options.emojis.paper;
        const s = this.options.emojis.scissors;

        return (
            (this.playerChoice === s && this.opponentChoice === p) ||
            (this.playerChoice === r && this.opponentChoice === s) ||
            (this.playerChoice === p && this.opponentChoice === r)
        );
    }

    private getActionRow(disabled = false) {
        return new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
                .setStyle(this.options.buttonStyle)
                .setEmoji(this.options.emojis.rock)
                .setCustomId("$gamecord-rps-r")
                .setLabel(this.options.buttons.rock)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setStyle(this.options.buttonStyle)
                .setEmoji(this.options.emojis.paper)
                .setCustomId("$gamecord-rps-p")
                .setLabel(this.options.buttons.paper)
                .setDisabled(disabled),
            new ButtonBuilder()
                .setStyle(this.options.buttonStyle)
                .setEmoji(this.options.emojis.scissors)
                .setCustomId("$gamecord-rps-s")
                .setLabel(this.options.buttons.scissors)
                .setDisabled(disabled),
        );
    }

    private async gameOver(message: Message) {
        const outcome = this.getResult();
        const result = this.buildResult({
            opponent: this.opponent,
            outcome,
            winner: outcome === "win" ? (this.hasPlayer1Won() ? this.player : this.opponent) : null,
            playerChoice: this.playerChoice,
            opponentChoice: this.opponentChoice,
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
            fields: [
                {
                    name: this.player.displayName,
                    value: this.playerChoice ?? "❔",
                    inline: true,
                },
                {
                    name: "VS",
                    value: "⚡",
                    inline: true,
                },
                {
                    name: this.opponent.displayName,
                    value: this.opponentChoice ?? "❔",
                    inline: true,
                },
            ],
        });

        try {
            await this.editContextOrMessage(message, {
                embeds: [embed],
                components: [this.getActionRow(true)],
            });
        } catch (err) {
            this.emit("error", err);
        }
    }
}
