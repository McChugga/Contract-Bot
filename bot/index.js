const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder
} = require("discord.js");

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// Web Server
// ==============================

app.get("/", (req, res) => {
  res.send("Contract Bot is running.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

// ==============================
// Discord Bot
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// ==============================
// Contract Command
// ==============================

const contractCommand = new SlashCommandBuilder()
  .setName("contract")
  .setDescription("Open the Contract Bot contract manager.");

// ==============================
// Bot Ready
// ==============================

client.once("clientReady", async () => {
  console.log(`Contract Bot is online as ${client.user.tag}`);

  try {
    await client.application.commands.set(
      [contractCommand],
      "1127709345178714254"
    );

    console.log("Successfully registered /contract");
  } catch (error) {
    console.error("Failed to register /contract:", error);
  }
});

// ==============================
// Slash Command Handler
// ==============================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "contract") {
    await interaction.reply({
      content:
        "📄 **Contract Manager**\n\n" +
        "Contract Bot is ready!\n\n" +
        "The contract creation system is coming next.",
      ephemeral: true
    });
  }
});

// ==============================
// Login
// ==============================

client.login(process.env.DISCORD_TOKEN);
