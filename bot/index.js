const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
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
  intents: [GatewayIntentBits.Guilds]
});

// ==============================
// Slash Commands
// ==============================

const contractCommand = new SlashCommandBuilder()
  .setName("contract")
  .setDescription("Open the Contract Bot contract manager.");

// ==============================
// Bot Ready
// ==============================

client.once(Events.ClientReady, async () => {
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
// Interaction Handler
// ==============================

client.on(Events.InteractionCreate, async (interaction) => {

  // /contract command
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "contract") {

      const embed = new EmbedBuilder()
        .setTitle("📄 Contract Manager")
        .setDescription(
          "Welcome to **Contract Bot**!\n\n" +
          "Use the buttons below to create and manage contracts."
        )
        .addFields(
          {
            name: "➕ Create Contract",
            value: "Create a new contract and begin the approval process.",
            inline: false
          },
          {
            name: "🔎 View Contract",
            value: "Look up an existing contract by its Contract ID.",
            inline: false
          },
          {
            name: "📊 My Contracts",
            value: "View contracts that you created or are involved in.",
            inline: false
          }
        )
        .setFooter({
          text: "Contract Bot • Contract Management System"
        })
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
          .setCustomId("contract_create")
          .setLabel("Create Contract")
          .setEmoji("➕")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("contract_view")
          .setLabel("View Contract")
          .setEmoji("🔎")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("contract_mine")
          .setLabel("My Contracts")
          .setEmoji("📊")
          .setStyle(ButtonStyle.Secondary)

      );

      await interaction.reply({
        embeds: [embed],
        components: [buttons],
        ephemeral: true
      });

      return;
    }
  }

  // Create Contract button
  if (interaction.isButton()) {

    if (interaction.customId === "contract_create") {

      await interaction.reply({
        content:
          "➕ **Create Contract**\n\n" +
          "The contract creation form is the next part of the system.\n\n" +
          "We'll collect the contract information, generate a unique Contract ID, " +
          "and then create the contract record.",
        ephemeral: true
      });

      return;
    }

    // View Contract button
    if (interaction.customId === "contract_view") {

      await interaction.reply({
        content:
          "🔎 **View Contract**\n\n" +
          "The Contract ID lookup system is coming next.",
        ephemeral: true
      });

      return;
    }

    // My Contracts button
    if (interaction.customId === "contract_mine") {

      await interaction.reply({
        content:
          "📊 **My Contracts**\n\n" +
          "Your contract list will appear here once the database is connected.",
        ephemeral: true
      });

      return;
    }
  }
});

// ==============================
// Login
// ==============================

client.login(process.env.DISCORD_TOKEN);
