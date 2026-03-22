<div align="center">
<br />
    <h1>Gamecord</h1>
    <br />
    <p>
        <a href="https://voctal.dev/discord"><img src="https://img.shields.io/discord/1336303640725553213?color=5865F2&logo=discord&logoColor=white" alt="Discord server" /></a>
        <a href="https://www.npmjs.com/package/@voctal/gamecord"><img src="https://img.shields.io/npm/v/@voctal/gamecord.svg?maxAge=3600" alt="npm version" /></a>
        <a href="https://www.npmjs.com/package/@voctal/gamecord"><img src="https://img.shields.io/npm/dt/@voctal/gamecord.svg?maxAge=3600" alt="npm downloads" /></a>
        <a href="https://github.com/voctal/gamecord/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/voctal/gamecord?logo=github&logoColor=ffffff" /></a>
    </p>
</div>

## About

### Gamecord is a collection of games for your Discord bot.

This library was made as a replacement for [discord-gamecord](https://www.npmjs.com/package/discord-gamecord) which is unmaintained (and partially broken) and has no TypeScript support. While the game options are mostly similar, this library offers more features to customize and handle your games. Also, this module does not contain all games from the original.

The module supports both slash commands and message commands!

## Installation

Node.js 22 or newer is required.

```sh
npm install @voctal/gamecord
```

## Documentation

You can find the docs here: [https://docs.voctal.dev/docs/packages/gamecord/stable](https://docs.voctal.dev/docs/packages/gamecord/stable)

If you need help, ask on our [support server](https://voctal.dev/discord).

## Example usage

```js
const { Game2048 } = require("@voctal/gamecord");

const game = new Game2048(interaction, {
    embed: {
        title: "2048",
        color: 0x5865f2,
    },
    notPlayerMessage: game => `Only ${game.player} can use this menu.`,
    timeout: 60_000,
    emojis: {
        up: "🔼",
        down: "🔽",
        right: "▶️",
        left: "◀️"
    }
});

game.on("error", err => console.error("Error!", err));
game.on("gameOver", result => console.log("Result:", result));

await game.start();
```

## Some previews

Note: every embeds can be fully customized.

<img src="./.github/images/2048.png" alt="2048 game" width="300">
<img src="./.github/images/connect4.png" alt="connect4 game" width="300">
<img src="./.github/images/flood.png" alt="flood game" width="300">
<img src="./.github/images/memory.png" alt="memory game" width="300">
<img src="./.github/images/minesweeper.png" alt="minesweeper game" width="300">
<img src="./.github/images/rockpaperscissors.png" alt="rockpaperscissors game" width="300">
<img src="./.github/images/tictactoe.png" alt="tictactoe game" width="300">
<img src="./.github/images/trivia.png" alt="trivia game" width="300">
<img src="./.github/images/wordle.png" alt="wordle game" width="300">

## Notes

- The module expects you to pass function that will not error. If they do, the games can break (e.g. by never emitting the `end` or `gameOver` event).
- If you don't use `.on("error")`, errors will emit an `uncaughtException` in your process.
- Every component custom ID starts with `$gamecord-`.
- Most games don't need any permissions since they rely on interaction methods. However, if a game is too long (>= 15 mins), the interaction becomes invalid and the bot will need permission to view the channel and edit its messages.

## Links

- [Documentation](https://docs.voctal.dev/docs/packages/gdapi/stable)
- [Discord server](https://voctal.dev/discord)
- [GitHub](https://github.com/voctal/gamecord)
- [npm](https://npmjs.com/package/@voctal/gamecord)
- [Voctal](https://voctal.dev)

## Help

You need help with the module? Ask on our [support server!](https://voctal.dev/discord)
