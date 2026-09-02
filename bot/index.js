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

  await pool.query(`
    ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS accepted_by_discord_id VARCHAR(50);
  `);

  console.log("PostgreSQL database connected");
  console.log("Contracts table ready");
}

// ==============================
// Web Server
// ==============================

const app = express();
const PORT = process.env.PORT || 3000;

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

const pendingContracts = new Map();
const REVIEW_CHANNEL_ID = "1544537312967270451";
const APPROVER_ROLE_IDS = [
  "1540049091504119918", // Farmhand
  "1540049282554532060", // Farm Foreman
  "1540049456702038157", // Farm Manager
  "1540049706367852674"  // ULA Supervisors
];
const COUNTY_REP_ROLE_ID = "1544540665118068818"; // ULA County Rep
const COMPLETED_CONTRACTS_CHANNEL_ID = "1544543291738038382"; // ULA Completed Contracts

const contractCommand = new SlashCommandBuilder()
  .setName("contract")
  .setDescription("Open the Contract Bot contract manager.");

function formatPayment(payment) {
  return `$${Number(payment).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function buildReviewEmbed(contract, contractId) {
  return new EmbedBuilder()
    .setTitle("📋 Contract Awaiting Review")
    .setDescription("An authorized supervisor must accept or reject this contract.")
    .addFields(
      { name: "📄 Contract ID", value: contractId, inline: true },
      { name: "📊 Status", value: "🟡 PENDING", inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: "🌾 Field", value: contract.field, inline: true },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "⏳ Contract Expires", value: contract.expires, inline: true },
      { name: "📝 Description", value: contract.description, inline: false },
      { name: "📌 Additional Terms", value: contract.terms, inline: false }
    )
    .setFooter({ text: "Contract Bot • Approval Required" })
    .setTimestamp();
}

function buildApprovalButtons(contractId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`contract_accept:${contractId}`)
      .setLabel("Accept Contract")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
  );
}

function buildCompleteButton(contractId, acceptedByUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`contract_complete:${contractId}:${acceptedByUserId}`)
      .setLabel("Contract Complete")
      .setEmoji("🏁")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildPaymentConfirmationButtons(contractId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`payment_confirm:${contractId}`)
      .setLabel("Confirm Payment")
      .setEmoji("💳")
      .setStyle(ButtonStyle.Success)
  );
}

function buildCompletedContractEmbed(contract) {
  return new EmbedBuilder()
    .setTitle("💳 Contract Payment Confirmation Required")
    .setDescription("ULA County Rep must confirm payment for this completed contract.")
    .addFields(
      { name: "📄 Contract ID", value: contract.contract_id, inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: "🌾 Field", value: contract.field, inline: true },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "⏳ Contract Expires", value: contract.expires, inline: true },
      { name: "📝 Description", value: contract.description || "None", inline: false },
      { name: "📌 Additional Terms", value: contract.terms || "None", inline: false }
    )
    .setFooter({ text: "Contract Bot • County Rep Payment Confirmation Required" })
    .setTimestamp();
}

function isApprover(interaction) {
  return APPROVER_ROLE_IDS.some((roleId) =>
    interaction.member?.roles?.cache?.has(roleId)
  );
}

async function saveContract(contract, creatorDiscordId) {
  const databaseClient = await pool.connect();

  try {
    await databaseClient.query("BEGIN");

    // This lock prevents two confirmations from receiving the same CB number.
    await databaseClient.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      ["1127709345178714254"]
    );

    const numberResult = await databaseClient.query(`
      SELECT COALESCE(
        MAX(CAST(SUBSTRING(contract_id FROM 4) AS INTEGER)),
        0
      ) + 1 AS next_number
      FROM contracts
      WHERE contract_id ~ '^CB-[0-9]+$'
    `);

    const contractId = `CB-${String(numberResult.rows[0].next_number).padStart(6, "0")}`;

    await databaseClient.query(
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
        creatorDiscordId
      ]
    );

    await databaseClient.query("COMMIT");
    return contractId;
  } catch (error) {
    await databaseClient.query("ROLLBACK");
    throw error;
  } finally {
    databaseClient.release();
  }
}

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

client.on(Events.InteractionCreate, async (interaction) => {
  // ============================
  // /contract
  // ============================

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "contract") {
      return;
    }

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
      .setFooter({ text: "Contract Bot • Contract Management System" })
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

  // ============================
  // Buttons
  // ============================

  if (interaction.isButton()) {
    if (interaction.customId === "contract_create") {
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

      const modal = new ModalBuilder()
        .setCustomId("contract_basic_form")
        .setTitle("Create Contract")
        .addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(contractorInput),
          new ActionRowBuilder().addComponents(fieldInput),
          new ActionRowBuilder().addComponents(paymentInput),
          new ActionRowBuilder().addComponents(expiresInput)
        );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "contract_view") {
      await interaction.reply({
        content: "🔎 **View Contract**\n\nThe Contract ID lookup system will be added after the database is connected.",
        ephemeral: true
      });
      return;
    }

    if (interaction.customId === "contract_mine") {
      await interaction.reply({
        content: "📊 **My Contracts**\n\nYour contract list will appear here once the database is connected.",
        ephemeral: true
      });
      return;
    }

    if (interaction.customId === "contract_details") {
      const contract = pendingContracts.get(interaction.user.id);

      if (!contract) {
        await interaction.reply({
          content: "❌ I couldn't find your contract information. Please start again with `/contract`.",
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

    if (interaction.customId === "contract_confirm") {
      const contract = pendingContracts.get(interaction.user.id);

      if (!contract) {
        await interaction.reply({
          content: "❌ Your contract session has expired. Please start again.",
          ephemeral: true
        });
        return;
      }

      let contractId;

      try {
        contractId = await saveContract(contract, interaction.user.id);
        pendingContracts.delete(interaction.user.id);

        const reviewChannel = await client.channels.fetch(REVIEW_CHANNEL_ID);
        if (!reviewChannel?.isTextBased()) {
          throw new Error("The configured review channel is not a text channel.");
        }

        await reviewChannel.send({
          embeds: [buildReviewEmbed(contract, contractId)],
          components: [buildApprovalButtons(contractId)]
        });

        const embed = new EmbedBuilder()
          .setTitle("✅ Contract Created")
          .setDescription(
            "Your contract has been created, permanently saved, and sent for approval."
          )
          .addFields(
            { name: "📄 Contract ID", value: contractId, inline: true },
            { name: "📊 Status", value: "🟡 PENDING", inline: true },
            { name: "🌾 Field", value: contract.field, inline: true },
            { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
            { name: "⏳ Contract Expires", value: contract.expires, inline: true }
          )
          .setFooter({ text: "Contract Bot • Permanent Database Record" })
          .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
        console.log(`Contract ${contractId} saved to PostgreSQL.`);
      } catch (error) {
        console.error("Failed to save contract:", error);
        await interaction.update({
          content: contractId
            ? `⚠️ Contract ${contractId} was saved, but could not be posted for approval. Please contact an administrator.`
            : "❌ Something went wrong while saving the contract. Please try again.",
          embeds: [],
          components: []
        });
      }
      return;
    }

    if (interaction.customId.startsWith("contract_accept:")) {
      if (!isApprover(interaction)) {
        await interaction.reply({
          content: "❌ You do not have permission to accept contracts.",
          ephemeral: true
        });
        return;
      }

      const [, contractId] = interaction.customId.split(":");

      try {
        const result = await pool.query(
          `UPDATE contracts
           SET status = 'ACCEPTED',
               accepted_by_discord_id = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE contract_id = $2 AND status = 'PENDING'
           RETURNING contract_id`,
          [interaction.user.id, contractId]
        );

        if (result.rowCount === 0) {
          await interaction.reply({
            content: "❌ This contract has already been reviewed.",
            ephemeral: true
          });
          return;
        }

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setTitle("✅ Contract Accepted")
          .setColor(0x57F287)
          .setFooter({
            text: `ACCEPTED by ${interaction.user.tag}`
          })
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: []
        });

        try {
          await interaction.user.send({
            content: `You accepted contract **${contractId}**. Click the button below when the contract is complete.`,
            components: [buildCompleteButton(contractId, interaction.user.id)]
          });
        } catch (dmError) {
          console.error("Could not send the completion button by direct message:", dmError);
        }
      } catch (error) {
        console.error("Failed to update contract status:", error);
        await interaction.reply({
          content: "❌ Something went wrong while updating this contract.",
          ephemeral: true
        });
      }
      return;
    }

    if (interaction.customId.startsWith("contract_complete:")) {
      const [, contractId, acceptedByUserId] = interaction.customId.split(":");

      if (interaction.user.id !== acceptedByUserId) {
        await interaction.reply({
          content: "❌ Only the person who accepted this contract can mark it complete.",
          ephemeral: true
        });
        return;
      }

      try {
        const result = await pool.query(
          `UPDATE contracts
           SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
           WHERE contract_id = $1 AND status = 'ACCEPTED'
           RETURNING *`,
          [contractId]
        );

        if (result.rowCount === 0) {
          await interaction.reply({
            content: "❌ This contract is no longer available to mark complete.",
            ephemeral: true
          });
          return;
        }

        let completionPosted = true;
        try {
          const completedContractsChannel = await client.channels.fetch(
            COMPLETED_CONTRACTS_CHANNEL_ID
          );
          if (!completedContractsChannel?.isTextBased()) {
            throw new Error("The configured completed-contracts channel is not a text channel.");
          }

          await completedContractsChannel.send({
            content: `<@&${COUNTY_REP_ROLE_ID}> Contract **${contractId}** has been marked complete by ${interaction.user}. Please confirm payment.`,
            embeds: [buildCompletedContractEmbed(result.rows[0])],
            components: [buildPaymentConfirmationButtons(contractId)],
            allowedMentions: { roles: [COUNTY_REP_ROLE_ID] }
          });
        } catch (notificationError) {
          completionPosted = false;
          console.error("Could not post the completed contract:", notificationError);
        }

        await interaction.update({
          content: completionPosted
            ? `✅ Contract **${contractId}** marked complete and sent to ULA County Rep for payment confirmation.`
            : `⚠️ Contract **${contractId}** is marked complete, but could not be posted for payment confirmation.`,
          components: []
        });
      } catch (error) {
        console.error("Failed to complete contract:", error);
        await interaction.reply({
          content: "❌ Something went wrong while completing this contract.",
          ephemeral: true
        });
      }
      return;
    }

    if (interaction.customId.startsWith("payment_confirm:")) {
      if (!interaction.member?.roles?.cache?.has(COUNTY_REP_ROLE_ID)) {
        await interaction.reply({
          content: "❌ Only ULA County Rep can confirm payment.",
          ephemeral: true
        });
        return;
      }

      const [, contractId] = interaction.customId.split(":");

      try {
        const result = await pool.query(
          `UPDATE contracts
           SET status = 'PAYMENT_CONFIRMED', updated_at = CURRENT_TIMESTAMP
           WHERE contract_id = $1 AND status = 'COMPLETED'
           RETURNING accepted_by_discord_id`,
          [contractId]
        );

        if (result.rowCount === 0) {
          await interaction.reply({
            content: "❌ Payment for this contract has already been confirmed.",
            ephemeral: true
          });
          return;
        }

        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setTitle("💳 Contract Payment Confirmed")
          .setColor(0x57F287)
          .setFooter({
            text: `Payment confirmed by ${interaction.user.tag}`
          })
          .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });

        const acceptedByUserId = result.rows[0].accepted_by_discord_id;
        if (acceptedByUserId) {
          try {
            const acceptingUser = await client.users.fetch(acceptedByUserId);
            await acceptingUser.send(
              `💳 ULA County Rep confirmed payment for contract **${contractId}**.`
            );
          } catch (dmError) {
            console.error("Could not notify the accepting user:", dmError);
          }
        }
      } catch (error) {
        console.error("Failed to confirm contract payment:", error);
        await interaction.reply({
          content: "❌ Something went wrong while confirming payment.",
          ephemeral: true
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
    }
    return;
  }

  // ============================
  // Modal submissions
  // ============================

  if (!interaction.isModalSubmit()) {
    return;
  }

  if (interaction.customId === "contract_basic_form") {
    const paymentText = interaction.fields.getTextInputValue("payment");
    const payment = Number(paymentText.replace(/[$,\\s]/g, ""));

    if (!Number.isFinite(payment) || payment < 0) {
      await interaction.reply({
        content: "❌ Enter a valid payment amount, such as `25000`.",
        ephemeral: true
      });
      return;
    }

    const contract = {
      title: interaction.fields.getTextInputValue("contract_title"),
      contractor: interaction.fields.getTextInputValue("contractor"),
      field: interaction.fields.getTextInputValue("field"),
      payment,
      expires: interaction.fields.getTextInputValue("expires"),
      creator: interaction.user.id
    };

    pendingContracts.set(interaction.user.id, contract);

    const embed = new EmbedBuilder()
      .setTitle("📝 Contract Details")
      .setDescription("Contract information saved!\n\nNow add the description and any additional terms.")
      .addFields(
        { name: "Title", value: contract.title, inline: true },
        { name: "Contractor", value: contract.contractor, inline: true }
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

  if (interaction.customId === "contract_details_form") {
    const contract = pendingContracts.get(interaction.user.id);

    if (!contract) {
      await interaction.reply({
        content: "❌ Your contract session expired. Please start again with `/contract`.",
        ephemeral: true
      });
      return;
    }

    contract.description = interaction.fields.getTextInputValue("description");
    contract.terms = interaction.fields.getTextInputValue("terms") || "None";
    pendingContracts.set(interaction.user.id, contract);

    const embed = new EmbedBuilder()
      .setTitle("📋 Review Contract")
      .setDescription("Please review the contract information below before creating the contract.")
      .addFields(
        { name: "📄 Contract ID", value: "Assigned when confirmed", inline: true },
        { name: "📄 Contract Title", value: contract.title, inline: true },
        { name: "👤 Contractor", value: contract.contractor, inline: true },
        { name: "🌾 Field", value: contract.field, inline: true },
        { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
        { name: "⏳ Contract Expires", value: contract.expires, inline: true },
        { name: "📝 Description", value: contract.description, inline: false },
        { name: "📌 Additional Terms", value: contract.terms, inline: false }
      )
      .setFooter({ text: "Review carefully before creating the contract." });

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
  }
});

// ==============================
// Login
// ==============================

initDatabase()
  .then(() => client.login(process.env.DISCORD_TOKEN))
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exit(1);
  });
