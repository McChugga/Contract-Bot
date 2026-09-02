const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events
} = require("discord.js");

const express = require("express");
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      contract_id VARCHAR(50) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      contractor TEXT NOT NULL,
      field TEXT NOT NULL,
      description TEXT,
      payment NUMERIC(12, 2),
      expires TEXT,
      terms TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      creator_discord_id VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("PostgreSQL database connected");
  console.log("Contracts table ready");
}
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
// Temporary Contract Storage
// ==============================

const pendingContracts = new Map();

let contractNumber = 1;

// ==============================
// Slash Command
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

  // ============================
  // /contract
  // ============================

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

  // ============================
  // Create Contract Button
  // ============================

  if (interaction.isButton()) {

    if (interaction.customId === "contract_create") {

      const modal = new ModalBuilder()
        .setCustomId("contract_basic_form")
        .setTitle("Create Contract");

      const titleInput = new TextInputBuilder()
        .setCustomId("contract_title")
        .setLabel("Contract Title")
        .setPlaceholder("Example: Soybean Harvest Contract")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const contractorInput = new TextInputBuilder()
        .setCustomId("contractor")
        .setLabel("Contractor")
        .setPlaceholder("Enter the contractor's name")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const fieldInput = new TextInputBuilder()
        .setCustomId("field")
        .setLabel("Field")
        .setPlaceholder("Example: Field 42")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const paymentInput = new TextInputBuilder()
        .setCustomId("payment")
        .setLabel("Payment Amount")
        .setPlaceholder("Example: 25000")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      const expiresInput = new TextInputBuilder()
        .setCustomId("expires")
        .setLabel("Contract Expires")
        .setPlaceholder("Example: 09/05/2026")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

      const row1 = new ActionRowBuilder().addComponents(titleInput);
      const row2 = new ActionRowBuilder().addComponents(contractorInput);
      const row3 = new ActionRowBuilder().addComponents(fieldInput);
      const row4 = new ActionRowBuilder().addComponents(paymentInput);
      const row5 = new ActionRowBuilder().addComponents(expiresInput);

      modal.addComponents(row1, row2, row3, row4, row5);

      await interaction.showModal(modal);

      return;
    }

    // ============================
    // View Contract
    // ============================

    if (interaction.customId === "contract_view") {

      await interaction.reply({
        content:
          "🔎 **View Contract**\n\n" +
          "The Contract ID lookup system will be added after the database is connected.",
        ephemeral: true
      });

      return;
    }

    // ============================
    // My Contracts
    // ============================

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

  // ============================
  // First Contract Form
  // ============================

  if (interaction.isModalSubmit()) {

    if (interaction.customId === "contract_basic_form") {

      const title =
        interaction.fields.getTextInputValue("contract_title");

      const contractor =
        interaction.fields.getTextInputValue("contractor");

      const field =
        interaction.fields.getTextInputValue("field");

      const payment =
        interaction.fields.getTextInputValue("payment");

      const expires =
        interaction.fields.getTextInputValue("expires");

      const contractId =
        `CB-${String(contractNumber).padStart(6, "0")}`;

      pendingContracts.set(interaction.user.id, {
        contractId,
        title,
        contractor,
        field,
        payment,
        expires,
        creator: interaction.user.id
      });

      const embed = new EmbedBuilder()
        .setTitle("📝 Contract Details")
        .setDescription(
          "Contract information saved!\n\n" +
          "Now add the description and any additional terms."
        )
        .addFields(
          {
            name: "Contract",
            value: contractId,
            inline: true
          },
          {
            name: "Title",
            value: title,
            inline: true
          }
        );

      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("contract_details")
          .setLabel("Add Contract Details")
          .setEmoji("📝")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        embeds: [embed],
        components: [button],
        ephemeral: true
      });

      return;
    }

    // ============================
    // Contract Details Form
    // ============================

    if (interaction.customId === "contract_details") {

      const contract = pendingContracts.get(interaction.user.id);

      if (!contract) {
        await interaction.reply({
          content:
            "❌ I couldn't find your contract information. Please start again with `/contract`.",
          ephemeral: true
        });

        return;
      }

      const descriptionInput = new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Contract Description")
        .setPlaceholder("Describe the work being performed.")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      const termsInput = new TextInputBuilder()
        .setCustomId("terms")
        .setLabel("Additional Terms")
        .setPlaceholder("Enter any additional contract terms.")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

      const modal = new ModalBuilder()
        .setCustomId("contract_details_form")
        .setTitle("Contract Details")
        .addComponents(
          new ActionRowBuilder().addComponents(descriptionInput),
          new ActionRowBuilder().addComponents(termsInput)
        );

      await interaction.showModal(modal);

      return;
    }

    // ============================
    // Final Contract Details
    // ============================

    if (interaction.customId === "contract_details_form") {

      const contract = pendingContracts.get(interaction.user.id);

      if (!contract) {
        await interaction.reply({
          content:
            "❌ Your contract session expired. Please start again with `/contract`.",
          ephemeral: true
        });

        return;
      }

      contract.description =
        interaction.fields.getTextInputValue("description");

      contract.terms =
        interaction.fields.getTextInputValue("terms") || "None";

      pendingContracts.set(interaction.user.id, contract);

      const embed = new EmbedBuilder()
        .setTitle("📋 Review Contract")
        .setDescription(
          "Please review the contract information below before creating the contract."
        )
        .addFields(
          {
            name: "📄 Contract ID",
            value: contract.contractId,
            inline: true
          },
          {
            name: "📄 Contract Title",
            value: contract.title,
            inline: true
          },
          {
            name: "👤 Contractor",
            value: contract.contractor,
            inline: true
          },
          {
            name: "🌾 Field",
            value: contract.field,
            inline: true
          },
          {
            name: "💰 Payment",
            value: `$${contract.payment}`,
            inline: true
          },
          {
            name: "⏳ Contract Expires",
            value: contract.expires,
            inline: true
          },
          {
            name: "📝 Description",
            value: contract.description,
            inline: false
          },
          {
            name: "📌 Additional Terms",
            value: contract.terms,
            inline: false
          }
        )
        .setFooter({
          text: "Review carefully before creating the contract."
        });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("contract_confirm")
          .setLabel("Create Contract")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("contract_cancel")
          .setLabel("Cancel")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [embed],
        components: [buttons],
        ephemeral: true
      });

      return;
    }
  }

// ============================
// Confirm / Cancel
// ============================

if (interaction.isButton()) {

  if (interaction.customId === "contract_confirm") {

    const contract = pendingContracts.get(interaction.user.id);

    if (!contract) {
      await interaction.reply({
        content: "❌ Your contract session has expired. Please start again.",
        ephemeral: true
      });
      return;
    }

    try {

      const numberResult = await pool.query(
        `SELECT COALESCE(
          MAX(CAST(SUBSTRING(contract_id FROM 4) AS INTEGER)),
          0
        ) + 1 AS next_number
        FROM contracts`
      );

      const nextNumber = numberResult.rows[0].next_number;

      const contractId =
        `CB-${String(nextNumber).padStart(6, "0")}`;

      await pool.query(
        `INSERT INTO contracts (
          contract_id,
          title,
          contractor,
          field,
          description,
          payment,
          expires,
          terms,
          status,
          creator_discord_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          contractId,
          contract.title,
          contract.contractor,
          contract.field,
          contract.description,
          contract.payment,
          contract.expires,
          contract.terms,
          "PENDING",
          interaction.user.id
        ]
      );

      pendingContracts.delete(interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle("✅ Contract Created")
        .setDescription(
          "Your contract has been created and permanently saved."
        )
        .addFields(
          {
            name: "📄 Contract ID",
            value: contractId,
            inline: true
          },
          {
            name: "📊 Status",
            value: "🟡 PENDING",
            inline: true
          },
          {
            name: "🌾 Field",
            value: contract.field,
            inline: true
          },
          {
            name: "💰 Payment",
            value: `$${contract.payment}`,
            inline: true
          },
          {
            name: "⏳ Contract Expires",
            value: contract.expires,
            inline: true
          }
        )
        .setFooter({
          text: "Contract Bot • Permanent Database Record"
        })
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      console.log(`Contract ${contractId} saved to PostgreSQL.`);

    } catch (error) {

      console.error("Failed to save contract:", error);

      await interaction.update({
        content:
          "❌ Something went wrong while saving the contract. Please try again.",
        embeds: [],
        components: []
      });
    }

    return;
  }

  if (interaction.customId === "contract_cancel") {

    pendingContracts.delete(interaction.user.id);

    await interaction.update({
      content: "❌ Contract creation cancelled.",
      embeds: [],
      components: []
    });

    return;
  }
}
// ==============================
// Login
// ==============================

initDatabase()
  .then(() => client.login(process.env.DISCORD_TOKEN))
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exit(1);
  });
