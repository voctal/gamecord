import { ButtonInteraction } from "discord.js";
import z from "zod";
import { Awaitable } from "./types";

/**
 * A discord.js {@link discord.js#APIEmbed | APIEmbed} schema. The `color` property can be an hex string.
 */
export const apiEmbed = () =>
    z
        .object({
            author: z.object({
                name: z.string(),
                url: z.string().optional(),
                icon_url: z.string().optional(),
            }),
            thumbnail: z.object({
                url: z.string(),
            }),
            title: z.string(),
            color: z.union([
                z.string().transform(val => {
                    return parseInt(val.slice(1), 16);
                }),
                z.number().int(),
            ]),
            description: z.string(),
            image: z.object({
                url: z.string(),
            }),
            footer: z.object({
                text: z.string(),
                icon_url: z.string().optional(),
            }),
        })
        .partial();

/**
 * Make a value also valid as a function return value.
 *
 * @example
 * `functionable(z.string())<[A, B]>()` = `z.string() | ((args_0: A, args_1: B) => z.string())`
 */
export const functionable =
    <T extends z.ZodType>(schema: T) =>
    <Args extends unknown[], Async = true>() =>
        z.union([schema, z.custom<(...args: Args) => Async extends true ? Awaitable<z.infer<T>> : z.infer<T>>()]);

export const embedBuilder = <Args extends unknown[]>() => functionable(apiEmbed())<Args>();

export const gameMessage = <T>() => z.union([z.string().transform(val => () => val), z.custom<(game: T) => string>()]);

export const gameInteractionMessage = <T, I = ButtonInteraction>() =>
    z.union([z.string().transform(val => () => val), z.custom<(game: T, i: I) => string>()]);

export const resultMessage = <R, T>() =>
    z.union([z.string().transform(val => () => val), z.custom<(result: R, game: T) => string>()]);

export const var2Message = <D, T>() =>
    z.union([z.string().transform(val => () => val), z.custom<(data: D, game: T) => string>()]);
