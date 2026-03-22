import { ActionRowBuilder, APIEmbed, ButtonBuilder, ButtonStyle, Message, User } from "discord.js";
import z from "zod";
import { colors } from "../utils/constants";
import { Awaitable, DeepRequired } from "../utils/types";
import { Game, GameContext, GameResult } from "./Game";

export interface VersusPlayers {
    player: User;
    opponent: User;
}

const defaultOptions = {
    timeout: 60_000,
    requestEmbed:
        (name: string) =>
        ({ player }: VersusPlayers) => ({
            color: colors.blue,
            description: `${player} has invited you for a round of **${name}**.`,
        }),
    rejectEmbed:
        (name: string) =>
        ({ opponent }: VersusPlayers) => ({
            color: colors.red,
            description: `The player ${opponent} denied your request for a round of **${name}**.`,
        }),
    timeoutEmbed: ({ opponent }: VersusPlayers) => ({
        color: colors.yellow,
        description: `Dropped the game as the player ${opponent} did not respond.`,
    }),
    buttons: {
        accept: "Accept",
        reject: "Reject",
    },
};

export interface VersusOptions {
    /**
     * The opponent.
     */
    opponent: User;
    /**
     * The amount of time the opponent has to accept or deny the versus request.
     */
    timeout?: number;
    requestEmbed?: (players: VersusPlayers) => APIEmbed;
    rejectEmbed?: (players: VersusPlayers) => APIEmbed;
    timeoutEmbed?: (players: VersusPlayers) => APIEmbed;
    buttons?: {
        accept?: string;
        reject?: string;
    };
}

export type VersusOptionsOutput = DeepRequired<VersusOptions>;

export const versusOptions = (name: string) =>
    z.object({
        opponent: z.custom<User>(val => val instanceof User, {
            error: "The opponent must be an instance of a discord.js User",
        }),
        timeout: z.number().int().optional().default(defaultOptions.timeout),
        requestEmbed: z
            .custom<(players: VersusPlayers) => APIEmbed>()
            .optional()
            .default(() => defaultOptions.requestEmbed(name)),
        rejectEmbed: z
            .custom<(players: VersusPlayers) => APIEmbed>()
            .optional()
            .default(() => defaultOptions.rejectEmbed(name)),
        timeoutEmbed: z
            .custom<(players: VersusPlayers) => APIEmbed>()
            .optional()
            .default(() => defaultOptions.timeoutEmbed),
        buttons: z
            .object({
                accept: z.string().optional().default(defaultOptions.buttons.accept),
                reject: z.string().optional().default(defaultOptions.buttons.reject),
            })
            .optional()
            .default(defaultOptions.buttons),
    });

/**
 * The base result data of a versus game.
 */
export interface VersusGameResult extends GameResult {
    opponent: User;
}

/**
 * The base class of a versus game.
 */
export abstract class VersusGame<Res extends VersusGameResult, Ctx extends GameContext = GameContext> extends Game<
    Res,
    Ctx
> {
    readonly versusOptions: VersusOptionsOutput;

    /**
     * The opponent user.
     */
    readonly opponent: User;

    constructor(context: Ctx, options: VersusOptionsOutput) {
        super(context);
        this.versusOptions = options;
        this.opponent = options.opponent;
    }

    protected async requestVersus(): Promise<Message | null> {
        const players = { player: this.player, opponent: this.opponent };

        // oxlint-disable-next-line no-async-promise-executor
        return new Promise(async resolve => {
            const row = new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                    .setLabel(this.versusOptions.buttons.accept)
                    .setCustomId("$gamecord-versus-accept")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setLabel(this.versusOptions.buttons.reject)
                    .setCustomId("$gamecord-versus-reject")
                    .setStyle(ButtonStyle.Danger),
            );

            const msg = await this.sendMessage({
                content: this.opponent.toString(),
                embeds: [this.versusOptions.requestEmbed(players)],
                components: [row],
                allowedMentions: { parse: ["users"] },
            });

            const collector = msg.createMessageComponentCollector({ time: this.versusOptions.timeout });

            collector.on("collect", async i => {
                try {
                    await i.deferUpdate();
                } catch (err) {
                    this.emit("error", err);
                }

                if (i.user.id === this.opponent.id) {
                    collector.stop(i.customId.split("-").at(-1));
                }
            });

            collector.on("end", async (_, reason) => {
                if (reason === "accept") return resolve(msg);

                const isTime = reason === "time";
                const embed = isTime ? this.versusOptions.timeoutEmbed : this.versusOptions.rejectEmbed;

                this.emit("versusReject", isTime);
                this.emit("end");

                try {
                    for (const btn of row.components) {
                        btn.setDisabled(true);
                    }

                    await this.editContextOrMessage(msg, {
                        embeds: [embed(players)],
                        components: [row],
                    });
                } catch (err) {
                    this.emit("error", err);
                }

                return resolve(null);
            });
        });
    }

    /**
     * Utility to build an embed from the options.
     */
    protected override async buildEmbed(
        embed: APIEmbed | ((game: this) => Awaitable<APIEmbed>),
        props?: APIEmbed,
    ): Promise<APIEmbed> {
        return await super.buildEmbed(embed, {
            author: undefined,
            footer: {
                text: `${this.player.displayName} vs ${this.opponent.displayName}`,
            },
            ...props,
        });
    }

    /**
     * Utility to build an end embed from the options.
     */
    protected override async buildEndEmbed(
        embed: APIEmbed | ((game: this) => Awaitable<APIEmbed>),
        endEmbed: APIEmbed | ((game: this, result: Res) => Awaitable<APIEmbed>) | undefined,
        result: Res,
        props?: APIEmbed,
    ): Promise<APIEmbed> {
        return await super.buildEndEmbed(embed, endEmbed, result, {
            author: undefined,
            footer: {
                text: `${this.player.displayName} vs ${this.opponent.displayName}`,
            },
            ...props,
        });
    }
}
