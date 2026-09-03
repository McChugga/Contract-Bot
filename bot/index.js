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
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
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

  await pool.query(`
    ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS guild_id VARCHAR(50);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_contract_settings (
      guild_id VARCHAR(50) PRIMARY KEY,
      generator_channel_id VARCHAR(50),
      open_contracts_channel_id VARCHAR(50),
      completed_contracts_channel_id VARCHAR(50)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_contract_approver_roles (
      guild_id VARCHAR(50) NOT NULL,
      role_id VARCHAR(50) NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_contract_payment_roles (
      guild_id VARCHAR(50) NOT NULL,
      role_id VARCHAR(50) NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
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

function pendingContractKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

const contractCommand = new SlashCommandBuilder()
  .setName("contract")
  .setDescription("Open the Contract Bot contract manager.");

const contractSetupCommand = new SlashCommandBuilder()
  .setName("contractsetup")
  .setDescription("Configure Contract Bot roles and channels.");

const createContractChannelsCommand = new SlashCommandBuilder()
  .setName("createcontractchannels")
  .setDescription("Create Contract Bot's three channels.");

function formatPayment(payment) {
  return `$${Number(payment).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatStatus(status) {
  const labels = {
    PENDING: "🟡 PENDING",
    ACCEPTED: "🟢 ACCEPTED",
    COMPLETED: "🔵 COMPLETED — payment confirmation required",
    PAYMENT_CONFIRMED: "✅ PAYMENT CONFIRMED"
  };

  return labels[status] || status;
}

function buildContractDetailsEmbed(contract) {
  return new EmbedBuilder()
    .setTitle("📄 Contract Details")
    .addFields(
      { name: "📄 Contract ID", value: contract.contract_id, inline: true },
      { name: "📊 Status", value: formatStatus(contract.status), inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: "🌾 Field", value: contract.field, inline: true },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "📝 Description", value: contract.description || "None", inline: false },
      { name: "📌 Additional Terms", value: contract.terms || "None", inline: false }
    )
    .setFooter({ text: "Contract Bot • Permanent Database Record" })
    .setTimestamp(new Date(contract.created_at));
}

function buildReviewEmbed(contract, contractId) {
  return new EmbedBuilder()
    .setTitle("📋 Contract Awaiting Review")
    .setDescription("A selected contract-acceptor role must accept this contract.")
    .addFields(
      { name: "📄 Contract ID", value: contractId, inline: true },
      { name: "📊 Status", value: "🟡 PENDING", inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: "🌾 Field", value: contract.field, inline: true },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
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

function buildCompleteButton(contractId, acceptedByUserId, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`contract_complete:${contractId}:${acceptedByUserId}:${guildId}`)
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
    .setDescription("A selected payment-confirmer role must confirm payment for this completed contract.")
    .addFields(
      { name: "📄 Contract ID", value: contract.contract_id, inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: "🌾 Field", value: contract.field, inline: true },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "📝 Description", value: contract.description || "None", inline: false },
      { name: "📌 Additional Terms", value: contract.terms || "None", inline: false }
    )
    .setFooter({ text: "Contract Bot • County Rep Payment Confirmation Required" })
    .setTimestamp();
}

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function getGuildSettings(guildId) {
  const result = await pool.query(
    `SELECT generator_channel_id, open_contracts_channel_id,
            completed_contracts_channel_id
     FROM guild_contract_settings
     WHERE guild_id = $1`,
    [guildId]
  );
  return result.rows[0] || null;
}

async function setGuildChannel(guildId, field, channelId) {
  const fields = new Set([
    "generator_channel_id",
    "open_contracts_channel_id",
    "completed_contracts_channel_id"
  ]);

  if (!fields.has(field)) {
    throw new Error("Invalid channel-setting field.");
  }

  await pool.query(
    `INSERT INTO guild_contract_settings (guild_id, ${field})
     VALUES ($1, $2)
     ON CONFLICT (guild_id)
     DO UPDATE SET ${field} = EXCLUDED.${field}`,
    [guildId, channelId]
  );
}

async function getGuildRoleIds(guildId, tableName) {
  const tables = new Set([
    "guild_contract_approver_roles",
    "guild_contract_payment_roles"
  ]);

  if (!tables.has(tableName)) {
    throw new Error("Invalid role-setting table.");
  }

  const result = await pool.query(
    `SELECT role_id FROM ${tableName} WHERE guild_id = $1 ORDER BY role_id`,
    [guildId]
  );
  return result.rows.map((row) => row.role_id);
}

async function setGuildRoleIds(guildId, tableName, roleIds) {
  const tables = new Set([
    "guild_contract_approver_roles",
    "guild_contract_payment_roles"
  ]);

  if (!tables.has(tableName)) {
    throw new Error("Invalid role-setting table.");
  }

  const databaseClient = await pool.connect();
  try {
    await databaseClient.query("BEGIN");
    await databaseClient.query(
      `DELETE FROM ${tableName} WHERE guild_id = $1`,
      [guildId]
    );
    for (const roleId of roleIds) {
      await databaseClient.query(
        `INSERT INTO ${tableName} (guild_id, role_id) VALUES ($1, $2)`,
        [guildId, roleId]
      );
    }
    await databaseClient.query("COMMIT");
  } catch (error) {
    await databaseClient.query("ROLLBACK");
    throw error;
  } finally {
    databaseClient.release();
  }
}

function formatChannel(channelId) {
  return channelId ? `<#${channelId}>` : "Not set";
}

function formatRoleList(roleIds) {
  return roleIds.length > 0 ? roleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "Not set";
}

async function buildSetupPanel(guildId) {
  const [settings, approverRoles, paymentRoles] = await Promise.all([
    getGuildSettings(guildId),
    getGuildRoleIds(guildId, "guild_contract_approver_roles"),
    getGuildRoleIds(guildId, "guild_contract_payment_roles")
  ]);

  const embed = new EmbedBuilder()
    .setTitle("⚙️ Contract Bot Setup")
    .setDescription(
      "Choose the roles and existing text channels for this server. " +
      "Use `/createcontractchannels` to have the bot create the three channels."
    )
    .addFields(
      { name: "Contract Generator", value: formatChannel(settings?.generator_channel_id), inline: false },
      { name: "Open Contracts", value: formatChannel(settings?.open_contracts_channel_id), inline: false },
      { name: "Completed Contracts", value: formatChannel(settings?.completed_contracts_channel_id), inline: false },
      { name: "Contract Acceptors", value: formatRoleList(approverRoles), inline: false },
      { name: "Payment Confirmers", value: formatRoleList(paymentRoles), inline: false }
    )
    .setFooter({ text: "Changes save immediately." });

  const components = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("config_approver_roles")
        .setPlaceholder("Select roles that can accept contracts")
        .setMinValues(0)
        .setMaxValues(25)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("config_payment_roles")
        .setPlaceholder("Select roles that can confirm payment")
        .setMinValues(0)
        .setMaxValues(25)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("config_generator_channel")
        .setPlaceholder("Select the Contract Generator channel")
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("config_open_contracts_channel")
        .setPlaceholder("Select the Open Contracts channel")
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("config_completed_contracts_channel")
        .setPlaceholder("Select the Completed Contracts channel")
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    )
  ];

  return { embeds: [embed], components };
}

async function isApprover(interaction) {
  const roleIds = await getGuildRoleIds(
    interaction.guildId,
    "guild_contract_approver_roles"
  );
  return roleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

async function isPaymentConfirmer(interaction) {
  const roleIds = await getGuildRoleIds(
    interaction.guildId,
    "guild_contract_payment_roles"
  );
  return roleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

async function saveContract(contract, creatorDiscordId, guildId) {
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
        terms,
        status,
        creator_discord_id,
        guild_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        contractId,
        contract.title,
        contract.contractor,
        contract.field,
        contract.description,
        contract.payment,
        contract.terms,
        "PENDING",
        creatorDiscordId,
        guildId
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
    await client.application.commands.set([
      contractCommand,
      contractSetupCommand,
      createContractChannelsCommand
    ]);

    console.log("Successfully registered Contract Bot global commands");
  } catch (error) {
    console.error("Failed to register Contract Bot commands:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // ============================
  // /contract
  // ============================

  if (interaction.isChatInputCommand()) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ Contract Bot commands can only be used in a server.",
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "contractsetup") {
      if (!isAdministrator(interaction)) {
        await interaction.reply({
          content: "❌ You need the Manage Server permission to configure Contract Bot.",
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        ...(await buildSetupPanel(interaction.guildId)),
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === "createcontractchannels") {
      if (!isAdministrator(interaction)) {
        await interaction.reply({
          content: "❌ You need the Manage Server permission to create Contract Bot channels.",
          ephemeral: true
        });
        return;
      }

      try {
        const [generatorChannel, openContractsChannel, completedContractsChannel] = await Promise.all([
          interaction.guild.channels.create({
            name: "contract-generator",
            type: ChannelType.GuildText
          }),
          interaction.guild.channels.create({
            name: "open-contracts",
            type: ChannelType.GuildText
          }),
          interaction.guild.channels.create({
            name: "completed-contracts",
            type: ChannelType.GuildText
          })
        ]);

        await Promise.all([
          setGuildChannel(interaction.guildId, "generator_channel_id", generatorChannel.id),
          setGuildChannel(interaction.guildId, "open_contracts_channel_id", openContractsChannel.id),
          setGuildChannel(interaction.guildId, "completed_contracts_channel_id", completedContractsChannel.id)
        ]);

        await interaction.reply({
          content:
            "✅ Contract Bot channels created:\n" +
            `${generatorChannel}\n${openContractsChannel}\n${completedContractsChannel}\n\n` +
            "Next, run `/contractsetup` to select contract acceptors and payment confirmers.",
          ephemeral: true
        });
      } catch (error) {
        console.error("Failed to create Contract Bot channels:", error);
        await interaction.reply({
          content: "❌ I couldn't create the channels. Check that I have the Manage Channels permission.",
          ephemeral: true
        });
      }
      return;
    }

    if (interaction.commandName !== "contract") {
      return;
    }

    const settings = await getGuildSettings(interaction.guildId);
    if (!settings?.generator_channel_id || !settings.open_contracts_channel_id || !settings.completed_contracts_channel_id) {
      await interaction.reply({
        content: "❌ Contract Bot has not been configured yet. An administrator must run `/contractsetup`.",
        ephemeral: true
      });
      return;
    }

    if (interaction.channelId !== settings.generator_channel_id) {
      await interaction.reply({
        content: `📄 Use /contract in ${formatChannel(settings.generator_channel_id)}.`,
        ephemeral: true
      });
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

  if (interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
    if (!isAdministrator(interaction)) {
      await interaction.reply({
        content: "❌ You need the Manage Server permission to change Contract Bot setup.",
        ephemeral: true
      });
      return;
    }

    try {
      if (interaction.customId === "config_approver_roles") {
        await setGuildRoleIds(
          interaction.guildId,
          "guild_contract_approver_roles",
          interaction.values
        );
      } else if (interaction.customId === "config_payment_roles") {
        await setGuildRoleIds(
          interaction.guildId,
          "guild_contract_payment_roles",
          interaction.values
        );
      } else if (interaction.customId === "config_generator_channel") {
        await setGuildChannel(interaction.guildId, "generator_channel_id", interaction.values[0]);
      } else if (interaction.customId === "config_open_contracts_channel") {
        await setGuildChannel(interaction.guildId, "open_contracts_channel_id", interaction.values[0]);
      } else if (interaction.customId === "config_completed_contracts_channel") {
        await setGuildChannel(interaction.guildId, "completed_contracts_channel_id", interaction.values[0]);
      } else {
        return;
      }

      await interaction.update(await buildSetupPanel(interaction.guildId));
    } catch (error) {
      console.error("Failed to update Contract Bot setup:", error);
      await interaction.reply({
        content: "❌ Something went wrong while saving that setup change.",
        ephemeral: true
      });
    }
    return;
  }

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

      const modal = new ModalBuilder()
        .setCustomId("contract_basic_form")
        .setTitle("Create Contract")
        .addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(contractorInput),
          new ActionRowBuilder().addComponents(fieldInput),
          new ActionRowBuilder().addComponents(paymentInput)
        );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "contract_view") {
      const contractIdInput = new TextInputBuilder()
        .setCustomId("contract_id")
        .setLabel("Contract ID")
        .setPlaceholder("Example: CB-000001")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50);

      const modal = new ModalBuilder()
        .setCustomId("contract_view_form")
        .setTitle("View Contract")
        .addComponents(
          new ActionRowBuilder().addComponents(contractIdInput)
        );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === "contract_mine") {
      try {
        const result = await pool.query(
          `SELECT contract_id, title, contractor, field, payment, status
           FROM contracts
           WHERE (creator_discord_id = $1 OR accepted_by_discord_id = $1)
             AND guild_id = $2
           ORDER BY created_at DESC
           LIMIT 10`,
          [interaction.user.id, interaction.guildId]
        );

        if (result.rowCount === 0) {
          await interaction.reply({
            content: "📊 You have not created or accepted any contracts yet.",
            ephemeral: true
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("📊 My Contracts")
          .setDescription("Your 10 most recent created or accepted contracts.")
          .addFields(
            result.rows.map((contract) => ({
              name: `${contract.contract_id} • ${formatStatus(contract.status)}`,
              value:
                `**${contract.title}**\n` +
                `Contractor: ${contract.contractor}\n` +
                `Field: ${contract.field} • ${formatPayment(contract.payment)}`,
              inline: false
            }))
          )
          .setFooter({ text: "Use View Contract for full details." })
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (error) {
        console.error("Failed to load the user's contracts:", error);
        await interaction.reply({
          content: "❌ Something went wrong while loading your contracts.",
          ephemeral: true
        });
      }
      return;
    }

    if (interaction.customId === "contract_details") {
      const contract = pendingContracts.get(pendingContractKey(interaction.guildId, interaction.user.id));

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
      const contract = pendingContracts.get(pendingContractKey(interaction.guildId, interaction.user.id));

      if (!contract) {
        await interaction.reply({
          content: "❌ Your contract session has expired. Please start again.",
          ephemeral: true
        });
        return;
      }

      let contractId;

      try {
        contractId = await saveContract(
          contract,
          interaction.user.id,
          interaction.guildId
        );
        pendingContracts.delete(pendingContractKey(interaction.guildId, interaction.user.id));

        const settings = await getGuildSettings(interaction.guildId);
        const reviewChannel = await client.channels.fetch(settings?.open_contracts_channel_id);
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
            { name: "💰 Payment", value: formatPayment(contract.payment), inline: true }
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
      if (!(await isApprover(interaction))) {
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
           WHERE contract_id = $2 AND guild_id = $3 AND status = 'PENDING'
           RETURNING contract_id`,
          [interaction.user.id, contractId, interaction.guildId]
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
            components: [buildCompleteButton(contractId, interaction.user.id, interaction.guildId)]
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
      const [, contractId, acceptedByUserId, contractGuildId] = interaction.customId.split(":");

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
           WHERE contract_id = $1 AND guild_id = $2 AND status = 'ACCEPTED'
           RETURNING *`,
          [contractId, contractGuildId]
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
          const settings = await getGuildSettings(contractGuildId);
          const completedContractsChannel = await client.channels.fetch(
            settings?.completed_contracts_channel_id
          );
          if (!completedContractsChannel?.isTextBased()) {
            throw new Error("The configured completed-contracts channel is not a text channel.");
          }

          await completedContractsChannel.send({
            content: `Contract **${contractId}** has been marked complete by ${interaction.user}. Please confirm payment.`,
            embeds: [buildCompletedContractEmbed(result.rows[0])],
            components: [buildPaymentConfirmationButtons(contractId)]
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
      if (!(await isPaymentConfirmer(interaction))) {
        await interaction.reply({
          content: "❌ You do not have permission to confirm payment.",
          ephemeral: true
        });
        return;
      }

      const [, contractId] = interaction.customId.split(":");

      try {
        const result = await pool.query(
          `UPDATE contracts
           SET status = 'PAYMENT_CONFIRMED', updated_at = CURRENT_TIMESTAMP
           WHERE contract_id = $1 AND guild_id = $2 AND status = 'COMPLETED'
           RETURNING accepted_by_discord_id`,
          [contractId, interaction.guildId]
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
      pendingContracts.delete(pendingContractKey(interaction.guildId, interaction.user.id));
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

  if (interaction.customId === "contract_view_form") {
    const contractId = interaction.fields
      .getTextInputValue("contract_id")
      .trim()
      .toUpperCase();

    try {
      const result = await pool.query(
        `SELECT contract_id, title, contractor, field, description, payment,
                terms, status, created_at
         FROM contracts
         WHERE contract_id = $1 AND guild_id = $2`,
        [contractId, interaction.guildId]
      );

      if (result.rowCount === 0) {
        await interaction.reply({
          content: `❌ No contract was found with ID **${contractId}**.`,
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        embeds: [buildContractDetailsEmbed(result.rows[0])],
        ephemeral: true
      });
    } catch (error) {
      console.error("Failed to load contract details:", error);
      await interaction.reply({
        content: "❌ Something went wrong while loading that contract.",
        ephemeral: true
      });
    }
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
      creator: interaction.user.id
    };

    pendingContracts.set(pendingContractKey(interaction.guildId, interaction.user.id), contract);

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
    const contract = pendingContracts.get(pendingContractKey(interaction.guildId, interaction.user.id));

    if (!contract) {
      await interaction.reply({
        content: "❌ Your contract session expired. Please start again with `/contract`.",
        ephemeral: true
      });
      return;
    }

    contract.description = interaction.fields.getTextInputValue("description");
    contract.terms = interaction.fields.getTextInputValue("terms") || "None";
    pendingContracts.set(pendingContractKey(interaction.guildId, interaction.user.id), contract);

    const embed = new EmbedBuilder()
      .setTitle("📋 Review Contract")
      .setDescription("Please review the contract information below before creating the contract.")
      .addFields(
        { name: "📄 Contract ID", value: "Assigned when confirmed", inline: true },
        { name: "📄 Contract Title", value: contract.title, inline: true },
        { name: "👤 Contractor", value: contract.contractor, inline: true },
        { name: "🌾 Field", value: contract.field, inline: true },
        { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
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
