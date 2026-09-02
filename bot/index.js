const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.send("Contract Bot is running.");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

client.once("ready", () => {
  console.log(`Contract Bot is online as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
