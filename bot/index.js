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
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  Events
} = require("discord.js");

const express = require("express");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS accepted_by_discord_id VARCHAR(50);`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS guild_id VARCHAR(50);`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) NOT NULL DEFAULT 'STANDARD';`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS fields_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS duties_json JSONB NOT NULL DEFAULT '[]'::jsonb;`);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_contract_approver_members (
      guild_id VARCHAR(50) NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_contract_payment_members (
      guild_id VARCHAR(50) NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  console.log("PostgreSQL database connected");
  console.log("Contract Bot database schema ready");
}

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Contract Bot is running."));
app.listen(PORT, "0.0.0.0", () => console.log(`Web server running on port ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingContracts = new Map();
const pendingGroupContracts = new Map();

function pendingKey(guildId, userId) { return `${guildId}:${userId}`; }
function getPending(map, guildId, userId) { return map.get(pendingKey(guildId, userId)); }
function setPending(map, guildId, userId, value) { map.set(pendingKey(guildId, userId), value); }
function clearPending(map, guildId, userId) { map.delete(pendingKey(guildId, userId)); }

const contractCommand = new SlashCommandBuilder()
  .setName("contract")
  .setDescription("Open the Contract Bot contract manager.");
const contractSetupCommand = new SlashCommandBuilder()
  .setName("contractsetup")
  .setDescription("Configure Contract Bot roles, members, and channels.");
const createContractChannelsCommand = new SlashCommandBuilder()
  .setName("createcontractchannels")
  .setDescription("Create Contract Bot's three channels.");

function formatPayment(payment) {
  return `$${Number(payment || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStatus(status) {
  return {
    PENDING: "🟡 PENDING",
    ACCEPTED: "🟢 ACCEPTED",
    COMPLETED: "🔵 COMPLETED — payment confirmation required",
    PAYMENT_CONFIRMED: "✅ PAYMENT CONFIRMED"
  }[status] || status;
}

function safeJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; }
  }
  return fallback;
}

function fieldsText(contract) {
  const fields = safeJson(contract.fields_json, []);
  if (fields.length) return fields.map((f, i) => `${i + 1}. ${f}`).join("\n");
  return contract.field || "None";
}

function dutiesText(contract) {
  const duties = safeJson(contract.duties_json, []);
  if (!duties.length) return "None specified";
  return duties.map((d, i) => `${i + 1}. ${typeof d === "string" ? d : d.name}`).join("\n");
}

function buildContractDetailsEmbed(contract) {
  const isGroup = contract.contract_type === "GROUP";
  return new EmbedBuilder()
    .setTitle(isGroup ? "📋 Group Contract Details" : "📄 Contract Details")
    .addFields(
      { name: "📄 Contract ID", value: contract.contract_id, inline: true },
      { name: "📊 Status", value: formatStatus(contract.status), inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: isGroup ? "🌾 Fields" : "🌾 Field", value: fieldsText(contract), inline: false },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "🔨 Duties", value: dutiesText(contract), inline: false },
      { name: "📝 Description", value: contract.description || "None", inline: false },
      { name: "📌 Additional Terms", value: contract.terms || "None", inline: false }
    )
    .setFooter({ text: "Contract Bot • Permanent Database Record" })
    .setTimestamp(new Date(contract.created_at || Date.now()));
}

function buildReviewEmbed(contract, contractId) {
  const isGroup = contract.contract_type === "GROUP";
  return new EmbedBuilder()
    .setTitle(isGroup ? "📋 Group Contract Awaiting Review" : "📋 Contract Awaiting Review")
    .setDescription("A configured contract acceptor role or member can accept this contract.")
    .addFields(
      { name: "📄 Contract ID", value: contractId, inline: true },
      { name: "📊 Status", value: "🟡 PENDING", inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: isGroup ? "🌾 Fields" : "🌾 Field", value: fieldsText(contract), inline: false },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "🔨 Duties", value: dutiesText(contract), inline: false },
      { name: "📝 Description", value: contract.description || "None", inline: false },
      { name: "📌 Additional Terms", value: contract.terms || "None", inline: false }
    )
    .setFooter({ text: "Contract Bot • Approval Required" })
    .setTimestamp();
}

function buildApprovalButtons(contractId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`contract_accept:${contractId}`).setLabel("Accept Contract").setEmoji("✅").setStyle(ButtonStyle.Success)
  );
}

function buildCompletionButtons(contractId, duties, completed) {
  const rows = [];
  const list = safeJson(duties, []);
  for (let i = 0; i < list.length && i < 25; i++) {
    const duty = typeof list[i] === "string" ? { name: list[i], completed: completed[i] === true } : list[i];
    const rowIndex = Math.floor(i / 5);
    if (!rows[rowIndex]) rows[rowIndex] = new ActionRowBuilder();
    rows[rowIndex].addComponents(
      new ButtonBuilder()
        .setCustomId(`contract_duty:${contractId}:${i}`)
        .setLabel(`${duty.completed ? "✅" : "⬜"} ${String(duty.name).slice(0, 70)}`)
        .setStyle(duty.completed ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(Boolean(duty.completed))
    );
  }
  const finalRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`contract_complete:${contractId}`).setLabel("Contract Complete").setEmoji("🏁").setStyle(ButtonStyle.Primary)
  );
  if (rows.length >= 5) return rows.slice(0, 4).concat(finalRow);
  rows.push(finalRow);
  return rows;
}

function buildPaymentConfirmationButtons(contractId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`payment_confirm:${contractId}`).setLabel("Confirm Payment").setEmoji("💳").setStyle(ButtonStyle.Success)
  );
}

function buildCompletedContractEmbed(contract) {
  return new EmbedBuilder()
    .setTitle("💳 Contract Payment Confirmation Required")
    .setDescription("A configured payment-confirmer role or member must confirm payment for this completed contract.")
    .addFields(
      { name: "📄 Contract ID", value: contract.contract_id, inline: true },
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: contract.contract_type === "GROUP" ? "🌾 Fields" : "🌾 Field", value: fieldsText(contract), inline: false },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "🔨 Duties", value: dutiesText(contract), inline: false },
      { name: "📝 Description", value: contract.description || "None", inline: false },
      { name: "📌 Additional Terms", value: contract.terms || "None", inline: false }
    )
    .setFooter({ text: "Contract Bot • Payment Confirmation Required" })
    .setTimestamp();
}

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function getGuildSettings(guildId) {
  const result = await pool.query(
    `SELECT generator_channel_id, open_contracts_channel_id, completed_contracts_channel_id
     FROM guild_contract_settings WHERE guild_id = $1`, [guildId]
  );
  return result.rows[0] || null;
}

async function setGuildChannel(guildId, field, channelId) {
  const fields = new Set(["generator_channel_id", "open_contracts_channel_id", "completed_contracts_channel_id"]);
  if (!fields.has(field)) throw new Error("Invalid channel-setting field.");
  await pool.query(
    `INSERT INTO guild_contract_settings (guild_id, ${field}) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET ${field} = EXCLUDED.${field}`,
    [guildId, channelId]
  );
}

const roleTables = new Set(["guild_contract_approver_roles", "guild_contract_payment_roles"]);
const memberTables = new Set(["guild_contract_approver_members", "guild_contract_payment_members"]);

async function getIds(guildId, tableName, columnName) {
  if (!roleTables.has(tableName) && !memberTables.has(tableName)) throw new Error("Invalid permission table.");
  const result = await pool.query(`SELECT ${columnName} FROM ${tableName} WHERE guild_id = $1 ORDER BY ${columnName}`, [guildId]);
  return result.rows.map(row => row[columnName]);
}

async function setIds(guildId, tableName, columnName, ids) {
  if (!roleTables.has(tableName) && !memberTables.has(tableName)) throw new Error("Invalid permission table.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(`DELETE FROM ${tableName} WHERE guild_id = $1`, [guildId]);
    for (const id of ids) await db.query(`INSERT INTO ${tableName} (guild_id, ${columnName}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [guildId, id]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

function formatChannel(id) { return id ? `<#${id}>` : "Not set"; }
function formatRoleList(ids) { return ids.length ? ids.map(id => `<@&${id}>`).join(", ") : "Not set"; }
function formatMemberList(ids) { return ids.length ? ids.map(id => `<@${id}>`).join(", ") : "Not set"; }

async function getPermissionConfig(guildId) {
  const [approverRoles, approverMembers, paymentRoles, paymentMembers] = await Promise.all([
    getIds(guildId, "guild_contract_approver_roles", "role_id"),
    getIds(guildId, "guild_contract_approver_members", "user_id"),
    getIds(guildId, "guild_contract_payment_roles", "role_id"),
    getIds(guildId, "guild_contract_payment_members", "user_id")
  ]);
  return { approverRoles, approverMembers, paymentRoles, paymentMembers };
}

async function buildSetupPanel(guildId, page = "permissions") {
  const [settings, p] = await Promise.all([getGuildSettings(guildId), getPermissionConfig(guildId)]);
  const embed = new EmbedBuilder().setFooter({ text: "Changes save immediately." });
  let components;

  if (page === "channels") {
    embed.setTitle("⚙️ Contract Bot Setup • Channels").setDescription("Select the channels used by Contract Bot.")
      .addFields(
        { name: "Contract Generator", value: formatChannel(settings?.generator_channel_id), inline: false },
        { name: "Open Contracts", value: formatChannel(settings?.open_contracts_channel_id), inline: false },
        { name: "Completed Contracts", value: formatChannel(settings?.completed_contracts_channel_id), inline: false }
      );
    components = [
      new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("config_generator_channel").setPlaceholder("Select Contract Generator channel").setChannelTypes(ChannelType.GuildText).setMaxValues(1)),
      new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("config_open_contracts_channel").setPlaceholder("Select Open Contracts channel").setChannelTypes(ChannelType.GuildText).setMaxValues(1)),
      new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("config_completed_contracts_channel").setPlaceholder("Select Completed Contracts channel").setChannelTypes(ChannelType.GuildText).setMaxValues(1)),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setup_permissions").setLabel("Permissions").setEmoji("🛡️").setStyle(ButtonStyle.Primary))
    ];
  } else {
    embed.setTitle("⚙️ Contract Bot Setup • Permissions").setDescription("Acceptors and payment confirmers can be Discord roles, individual members, or a mix of both.")
      .addFields(
        { name: "✅ Contract Acceptor Roles", value: formatRoleList(p.approverRoles), inline: false },
        { name: "👤 Contract Acceptor Members", value: formatMemberList(p.approverMembers), inline: false },
        { name: "💳 Payment Confirmer Roles", value: formatRoleList(p.paymentRoles), inline: false },
        { name: "👤 Payment Confirmer Members", value: formatMemberList(p.paymentMembers), inline: false }
      );
    components = [
      new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("config_approver_roles").setPlaceholder("Select acceptor roles").setMinValues(0).setMaxValues(25)),
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("config_approver_members").setPlaceholder("Select individual acceptor members").setMinValues(0).setMaxValues(25)),
      new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("config_payment_roles").setPlaceholder("Select payment-confirmer roles").setMinValues(0).setMaxValues(25)),
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("config_payment_members").setPlaceholder("Select individual payment-confirmers").setMinValues(0).setMaxValues(25)),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("setup_channels").setLabel("Channels").setEmoji("📺").setStyle(ButtonStyle.Primary))
    ];
  }
  return { embeds: [embed], components };
}

async function isAuthorized(interaction, kind) {
  const p = await getPermissionConfig(interaction.guildId);
  const roleMatch = interaction.member?.roles?.cache?.some(role => (kind === "approver" ? p.approverRoles : p.paymentRoles).includes(role.id));
  const memberMatch = (kind === "approver" ? p.approverMembers : p.paymentMembers).includes(interaction.user.id);
  return Boolean(roleMatch || memberMatch);
}

async function saveContract(contract, creatorDiscordId, guildId) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock($1::bigint)", ["1127709345178714254"]);
    const numberResult = await db.query(`
      SELECT COALESCE(MAX(CAST(SUBSTRING(contract_id FROM 4) AS INTEGER)), 0) + 1 AS next_number
      FROM contracts WHERE contract_id ~ '^CB-[0-9]+$'
    `);
    const contractId = `CB-${String(numberResult.rows[0].next_number).padStart(6, "0")}`;
    const fields = safeJson(contract.fields, contract.field ? [contract.field] : []);
    const duties = safeJson(contract.duties, []);
    await db.query(
      `INSERT INTO contracts (contract_id,title,contractor,field,description,payment,terms,status,creator_discord_id,guild_id,contract_type,fields_json,duties_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10,$11,$12)`,
      [contractId, contract.title, contract.contractor, fields.join(", ") || contract.field || "Multiple Fields", contract.description || "", contract.payment, contract.terms || "None", creatorDiscordId, guildId, contract.contract_type || "STANDARD", JSON.stringify(fields), JSON.stringify(duties)]
    );
    await db.query("COMMIT");
    return contractId;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

async function getPermissionMentions(guildId, kind) {
  const p = await getPermissionConfig(guildId);
  const roles = kind === "approver" ? p.approverRoles : p.paymentRoles;
  const members = kind === "approver" ? p.approverMembers : p.paymentMembers;
  return {
    text: [...roles.map(id => `<@&${id}>`), ...members.map(id => `<@${id}>`)].join(" "),
    roles,
    members
  };
}

async function notifyPermissionTargets(guildId, kind, content) {
  const { members } = await getPermissionMentions(guildId, kind);
  for (const userId of members) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(content);
    } catch (e) {
      console.error(`Could not DM configured ${kind} member ${userId}:`, e.message);
    }
  }
}

function groupBuilderEmbed(contract) {
  const fields = contract.fields || [];
  const duties = contract.duties || [];
  return new EmbedBuilder()
    .setTitle("📋 Group Contract Builder")
    .setDescription("Add as many fields and custom duties as you need. There are no predefined duty chains.")
    .addFields(
      { name: "📄 Contract Title", value: contract.title, inline: true },
      { name: "👤 Contractor", value: contract.contractor, inline: true },
      { name: "💰 Payment", value: formatPayment(contract.payment), inline: true },
      { name: "🌾 Fields", value: fields.length ? fields.map((f, i) => `${i + 1}. ${f}`).join("\n") : "No fields added yet.", inline: false },
      { name: "🔨 Duties", value: duties.length ? duties.map((d, i) => `${i + 1}. ${d}`).join("\n") : "No duties added yet.", inline: false }
    );
}

function groupBuilderButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("group_add_field").setLabel("Add Field").setEmoji("🌾").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("group_add_duty").setLabel("Add Duty").setEmoji("➕").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("group_review").setLabel("Review Contract").setEmoji("📋").setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("group_cancel").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Danger)
    )
  ];
}

client.once(Events.ClientReady, async () => {
  console.log(`Contract Bot is online as ${client.user.tag}`);
  try {
    await client.application.commands.set([contractCommand, contractSetupCommand, createContractChannelsCommand]);
    console.log("Successfully registered Contract Bot global commands");
  } catch (error) { console.error("Failed to register Contract Bot commands:", error); }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId) return interaction.reply({ content: "❌ Contract Bot commands can only be used in a server.", ephemeral: true });

      if (interaction.commandName === "contractsetup") {
        if (!isAdministrator(interaction)) return interaction.reply({ content: "❌ You need the Manage Server permission to configure Contract Bot.", ephemeral: true });
        return interaction.reply({ ...(await buildSetupPanel(interaction.guildId, "permissions")), ephemeral: true });
      }

      if (interaction.commandName === "createcontractchannels") {
        if (!isAdministrator(interaction)) return interaction.reply({ content: "❌ You need the Manage Server permission to create Contract Bot channels.", ephemeral: true });
        try {
          const [generatorChannel, openContractsChannel, completedContractsChannel] = await Promise.all([
            interaction.guild.channels.create({ name: "contract-generator", type: ChannelType.GuildText }),
            interaction.guild.channels.create({ name: "open-contracts", type: ChannelType.GuildText }),
            interaction.guild.channels.create({ name: "completed-contracts", type: ChannelType.GuildText })
          ]);
          await Promise.all([
            setGuildChannel(interaction.guildId, "generator_channel_id", generatorChannel.id),
            setGuildChannel(interaction.guildId, "open_contracts_channel_id", openContractsChannel.id),
            setGuildChannel(interaction.guildId, "completed_contracts_channel_id", completedContractsChannel.id)
          ]);
          return interaction.reply({ content: `✅ Contract Bot channels created:\n${generatorChannel}\n${openContractsChannel}\n${completedContractsChannel}\n\nNext, run \`/contractsetup\` to configure acceptors and payment confirmers.`, ephemeral: true });
        } catch (error) {
          console.error("Failed to create Contract Bot channels:", error);
          return interaction.reply({ content: "❌ I couldn't create the channels. Check that I have the Manage Channels permission.", ephemeral: true });
        }
      }

      if (interaction.commandName !== "contract") return;
      const settings = await getGuildSettings(interaction.guildId);
      if (!settings?.generator_channel_id || !settings.open_contracts_channel_id || !settings.completed_contracts_channel_id) {
        return interaction.reply({ content: "❌ Contract Bot has not been configured yet. An administrator must run `/contractsetup`.", ephemeral: true });
      }
      if (interaction.channelId !== settings.generator_channel_id) return interaction.reply({ content: `📄 Use /contract in ${formatChannel(settings.generator_channel_id)}.`, ephemeral: true });

      const embed = new EmbedBuilder().setTitle("📄 Contract Manager")
        .setDescription("Create standard contracts or flexible group contracts with multiple fields and custom duties.")
        .addFields(
          { name: "➕ Create Contract", value: "Create a standard single-field contract.", inline: false },
          { name: "📋 Group Contract", value: "Create one contract containing multiple fields and as many custom duties as needed.", inline: false },
          { name: "🔎 View Contract", value: "Look up an existing contract by Contract ID.", inline: false },
          { name: "📊 My Contracts", value: "View contracts that you created or accepted.", inline: false }
        ).setFooter({ text: "Contract Bot • Contract Management System" }).setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("contract_create").setLabel("Create Contract").setEmoji("➕").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("group_contract_create").setLabel("Group Contract").setEmoji("📋").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("contract_view").setLabel("View Contract").setEmoji("🔎").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("contract_mine").setLabel("My Contracts").setEmoji("📊").setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (interaction.isRoleSelectMenu() || interaction.isUserSelectMenu() || interaction.isChannelSelectMenu()) {
      if (!isAdministrator(interaction)) return interaction.reply({ content: "❌ You need the Manage Server permission to change Contract Bot setup.", ephemeral: true });
      try {
        const id = interaction.values;
        const actions = {
          config_approver_roles: () => setIds(interaction.guildId, "guild_contract_approver_roles", "role_id", id),
          config_approver_members: () => setIds(interaction.guildId, "guild_contract_approver_members", "user_id", id),
          config_payment_roles: () => setIds(interaction.guildId, "guild_contract_payment_roles", "role_id", id),
          config_payment_members: () => setIds(interaction.guildId, "guild_contract_payment_members", "user_id", id),
          config_generator_channel: () => setGuildChannel(interaction.guildId, "generator_channel_id", id[0]),
          config_open_contracts_channel: () => setGuildChannel(interaction.guildId, "open_contracts_channel_id", id[0]),
          config_completed_contracts_channel: () => setGuildChannel(interaction.guildId, "completed_contracts_channel_id", id[0])
        };
        if (!actions[interaction.customId]) return;
        await actions[interaction.customId]();
        return interaction.update(await buildSetupPanel(interaction.guildId, interaction.customId.startsWith("config_") && interaction.customId.includes("channel") ? "channels" : "permissions"));
      } catch (error) {
        console.error("Failed to update Contract Bot setup:", error);
        return interaction.reply({ content: "❌ Something went wrong while saving that setup change.", ephemeral: true });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "setup_channels") return interaction.update(await buildSetupPanel(interaction.guildId, "channels"));
      if (interaction.customId === "setup_permissions") return interaction.update(await buildSetupPanel(interaction.guildId, "permissions"));

      if (interaction.customId === "contract_create") {
        const modal = new ModalBuilder().setCustomId("contract_basic_form").setTitle("Create Contract").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("contract_title").setLabel("Contract Title").setPlaceholder("Example: Soybean Harvest Contract").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("contractor").setLabel("Contractor").setPlaceholder("Enter the contractor's name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("field").setLabel("Field").setPlaceholder("Example: Field 42").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("payment").setLabel("Payment Amount").setPlaceholder("Example: 25000").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "group_contract_create") {
        const modal = new ModalBuilder().setCustomId("group_basic_form").setTitle("Create Group Contract").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("contract_title").setLabel("Contract Title").setPlaceholder("Example: Spring Field Work Package").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("contractor").setLabel("Contractor").setPlaceholder("Enter the contractor's name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("payment").setLabel("Total Payment Amount").setPlaceholder("Example: 75000").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "group_add_field") {
        const modal = new ModalBuilder().setCustomId("group_add_field_form").setTitle("Add Field").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("field_name").setLabel("Field / Location").setPlaceholder("Example: Field 42").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "group_add_duty") {
        const modal = new ModalBuilder().setCustomId("group_add_duty_form").setTitle("Add Duty").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("duty_name").setLabel("Duty / Task").setPlaceholder("Example: Fertilize Field 42").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "group_review") {
        const contract = getPending(pendingGroupContracts, interaction.guildId, interaction.user.id);
        if (!contract) return interaction.reply({ content: "❌ Your group-contract session expired. Please start again.", ephemeral: true });
        if (!contract.fields.length) return interaction.reply({ content: "❌ Add at least one field before reviewing the group contract.", ephemeral: true });
        if (!contract.duties.length) return interaction.reply({ content: "❌ Add at least one duty before reviewing the group contract.", ephemeral: true });
        return interaction.reply({ embeds: [groupBuilderEmbed(contract).setTitle("📋 Review Group Contract")], components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("group_confirm").setLabel("Create Group Contract").setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("group_cancel").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Danger)
        )], ephemeral: true });
      }

      if (interaction.customId === "group_confirm") {
        const contract = getPending(pendingGroupContracts, interaction.guildId, interaction.user.id);
        if (!contract) return interaction.reply({ content: "❌ Your group-contract session expired. Please start again.", ephemeral: true });
        if (!contract.fields.length || !contract.duties.length) return interaction.reply({ content: "❌ A group contract needs at least one field and one duty.", ephemeral: true });
        let contractId;
        try {
          contractId = await saveContract(contract, interaction.user.id, interaction.guildId);
          clearPending(pendingGroupContracts, interaction.guildId, interaction.user.id);
          const settings = await getGuildSettings(interaction.guildId);
          const reviewChannel = await client.channels.fetch(settings.open_contracts_channel_id);
          const acceptorMentions = await getPermissionMentions(interaction.guildId, "approver");
          await reviewChannel.send({ content: `${acceptorMentions.text || "📢 Configured acceptors"} — 📋 **New Group Contract** is available for acceptance.`, embeds: [buildReviewEmbed(contract, contractId)], components: [buildApprovalButtons(contractId)], allowedMentions: { roles: acceptorMentions.roles, users: acceptorMentions.members } });
          await notifyPermissionTargets(interaction.guildId, "approver", `📋 New ULA group contract **${contractId}** is available for acceptance. Check the Open Contracts channel.`);
          return interaction.update({ embeds: [new EmbedBuilder().setTitle("✅ Group Contract Created").setDescription(`Group contract **${contractId}** was saved and sent for approval.`).addFields({ name: "🌾 Fields", value: contract.fields.map((f, i) => `${i + 1}. ${f}`).join("\n") }, { name: "🔨 Duties", value: contract.duties.map((d, i) => `${i + 1}. ${d}`).join("\n") }, { name: "💰 Payment", value: formatPayment(contract.payment), inline: true })], components: [] });
        } catch (error) {
          console.error("Failed to save group contract:", error);
          return interaction.update({ content: contractId ? `⚠️ Contract ${contractId} was saved, but could not be posted for approval.` : "❌ Something went wrong while saving the group contract.", embeds: [], components: [] });
        }
      }

      if (interaction.customId === "group_cancel") {
        clearPending(pendingGroupContracts, interaction.guildId, interaction.user.id);
        return interaction.update({ content: "❌ Group contract creation cancelled.", embeds: [], components: [] });
      }

      if (interaction.customId === "contract_view") {
        const modal = new ModalBuilder().setCustomId("contract_view_form").setTitle("View Contract").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("contract_id").setLabel("Contract ID").setPlaceholder("Example: CB-000001").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "contract_mine") {
        try {
          const result = await pool.query(
            `SELECT contract_id,title,contractor,field,payment,status FROM contracts WHERE (creator_discord_id=$1 OR accepted_by_discord_id=$1) AND guild_id=$2 ORDER BY created_at DESC LIMIT 10`,
            [interaction.user.id, interaction.guildId]
          );
          if (!result.rowCount) return interaction.reply({ content: "📊 You have not created or accepted any contracts yet.", ephemeral: true });
          const embed = new EmbedBuilder().setTitle("📊 My Contracts").setDescription("Your 10 most recent created or accepted contracts.").addFields(result.rows.map(c => ({ name: `${c.contract_id} • ${formatStatus(c.status)}`, value: `**${c.title}**\nContractor: ${c.contractor}\nField(s): ${c.field} • ${formatPayment(c.payment)}`, inline: false }))).setTimestamp();
          return interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
          console.error("Failed to load user's contracts:", error);
          return interaction.reply({ content: "❌ Something went wrong while loading your contracts.", ephemeral: true });
        }
      }

      if (interaction.customId === "contract_details") {
        const contract = getPending(pendingContracts, interaction.guildId, interaction.user.id);
        if (!contract) return interaction.reply({ content: "❌ I couldn't find your contract information. Please start again with `/contract`.", ephemeral: true });
        const modal = new ModalBuilder().setCustomId("contract_details_form").setTitle("Contract Details").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("description").setLabel("Contract Description").setPlaceholder("Describe the work being performed.").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("terms").setLabel("Additional Terms").setPlaceholder("Enter any additional contract terms.").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "contract_confirm") {
        const contract = getPending(pendingContracts, interaction.guildId, interaction.user.id);
        if (!contract) return interaction.reply({ content: "❌ Your contract session has expired. Please start again.", ephemeral: true });
        let contractId;
        try {
          contractId = await saveContract(contract, interaction.user.id, interaction.guildId);
          clearPending(pendingContracts, interaction.guildId, interaction.user.id);
          const settings = await getGuildSettings(interaction.guildId);
          const reviewChannel = await client.channels.fetch(settings.open_contracts_channel_id);
          const acceptorMentions = await getPermissionMentions(interaction.guildId, "approver");
          await reviewChannel.send({ content: `${acceptorMentions.text || "📢 Configured acceptors"} — 📄 **New Contract** is available for acceptance.`, embeds: [buildReviewEmbed(contract, contractId)], components: [buildApprovalButtons(contractId)], allowedMentions: { roles: acceptorMentions.roles, users: acceptorMentions.members } });
          await notifyPermissionTargets(interaction.guildId, "approver", `📄 New ULA contract **${contractId}** is available for acceptance. Check the Open Contracts channel.`);
          return interaction.update({ embeds: [new EmbedBuilder().setTitle("✅ Contract Created").setDescription("Your contract has been created, permanently saved, and sent for approval.").addFields({ name: "📄 Contract ID", value: contractId, inline: true }, { name: "🌾 Field", value: contract.field, inline: true }, { name: "💰 Payment", value: formatPayment(contract.payment), inline: true })], components: [] });
        } catch (error) {
          console.error("Failed to save contract:", error);
          return interaction.update({ content: contractId ? `⚠️ Contract ${contractId} was saved, but could not be posted for approval.` : "❌ Something went wrong while saving the contract. Please try again.", embeds: [], components: [] });
        }
      }

      if (interaction.customId.startsWith("contract_accept:")) {
        if (!(await isAuthorized(interaction, "approver"))) return interaction.reply({ content: "❌ You do not have permission to accept contracts.", ephemeral: true });
        const [, contractId] = interaction.customId.split(":");
        try {
          const result = await pool.query(`UPDATE contracts SET status='ACCEPTED',accepted_by_discord_id=$1,updated_at=CURRENT_TIMESTAMP WHERE contract_id=$2 AND guild_id=$3 AND status='PENDING' RETURNING *`, [interaction.user.id, contractId, interaction.guildId]);
          if (!result.rowCount) return interaction.reply({ content: "❌ This contract has already been reviewed.", ephemeral: true });
          const contract = result.rows[0];
          const embed = EmbedBuilder.from(interaction.message.embeds[0]).setTitle("✅ Contract Accepted").setColor(0x57F287).setFooter({ text: `ACCEPTED by ${interaction.user.tag}` }).setTimestamp();
          await interaction.update({ content: `Accepted by ${interaction.user}`, embeds: [embed], components: [] });
          const duties = safeJson(contract.duties_json, []);
          const completed = duties.map(() => false);
          const completionRows = buildCompletionButtons(contractId, duties, completed);
          const messageContent = contract.contract_type === "GROUP"
            ? `You accepted group contract **${contractId}**. Mark each duty complete with the buttons below. Once all duties are complete, press **Contract Complete**.`
            : `You accepted contract **${contractId}**. Click **Contract Complete** when the work is finished.`;
          try {
            const dm = await interaction.user.send({ content: messageContent, embeds: [buildContractDetailsEmbed(contract)], components: completionRows });
            await pool.query(`UPDATE contracts SET duties_json=$1,updated_at=CURRENT_TIMESTAMP WHERE contract_id=$2 AND guild_id=$3`, [JSON.stringify(duties.map(d => typeof d === "string" ? { name: d, completed: false } : d)), contractId, interaction.guildId]);
            console.log(`Completion workflow sent for ${contractId} to ${interaction.user.tag}.`);
          } catch (dmError) { console.error("Could not send completion workflow by direct message:", dmError); }
          try { await interaction.followUp({ content: `✅ Contract **${contractId}** accepted. A completion workflow was sent to you by DM.`, ephemeral: true }); } catch {}
        } catch (error) {
          console.error("Failed to accept contract:", error);
          if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "❌ Something went wrong while updating this contract.", ephemeral: true });
        }
        return;
      }

      if (interaction.customId.startsWith("contract_duty:")) {
        const [, contractId, indexText] = interaction.customId.split(":");
        const index = Number(indexText);
        try {
          const result = await pool.query(`SELECT * FROM contracts WHERE contract_id=$1 AND guild_id=$2 AND status='ACCEPTED'`, [contractId, interaction.guildId || null]);
          let contract = result.rows[0];
          if (!contract) {
            const byId = await pool.query(`SELECT * FROM contracts WHERE contract_id=$1`, [contractId]);
            contract = byId.rows[0];
          }
          if (!contract || contract.accepted_by_discord_id !== interaction.user.id) return interaction.reply({ content: "❌ Only the member who accepted this contract can update its duties.", ephemeral: true });
          const duties = safeJson(contract.duties_json, []);
          if (!duties[index]) return interaction.reply({ content: "❌ That duty could not be found.", ephemeral: true });
          duties[index] = typeof duties[index] === "string" ? { name: duties[index], completed: true } : { ...duties[index], completed: true };
          await pool.query(`UPDATE contracts SET duties_json=$1,updated_at=CURRENT_TIMESTAMP WHERE contract_id=$2`, [JSON.stringify(duties), contractId]);
          const completed = duties.map(d => Boolean(typeof d === "string" ? false : d.completed));
          return interaction.update({ embeds: [buildContractDetailsEmbed({ ...contract, duties_json: duties })], components: buildCompletionButtons(contractId, duties, completed) });
        } catch (error) {
          console.error("Failed to update duty:", error);
          return interaction.reply({ content: "❌ Something went wrong while updating that duty.", ephemeral: true });
        }
      }

      if (interaction.customId.startsWith("contract_complete:")) {
        const [, contractId] = interaction.customId.split(":");
        try {
          const result = await pool.query(`SELECT * FROM contracts WHERE contract_id=$1`, [contractId]);
          const contract = result.rows[0];
          if (!contract || contract.accepted_by_discord_id !== interaction.user.id) return interaction.reply({ content: "❌ Only the person who accepted this contract can mark it complete.", ephemeral: true });
          const duties = safeJson(contract.duties_json, []);
          const incomplete = duties.filter(d => typeof d === "string" || !d.completed);
          if (contract.contract_type === "GROUP" && incomplete.length) return interaction.reply({ content: `❌ ${incomplete.length} duty/duties are still incomplete. Mark every duty complete before finishing the contract.`, ephemeral: true });
          const updated = await pool.query(`UPDATE contracts SET status='COMPLETED',updated_at=CURRENT_TIMESTAMP WHERE contract_id=$1 AND status='ACCEPTED' RETURNING *`, [contractId]);
          if (!updated.rowCount) return interaction.reply({ content: "❌ This contract is no longer available to mark complete.", ephemeral: true });
          const completedContract = updated.rows[0];
          let posted = true;
          try {
            const settings = await getGuildSettings(completedContract.guild_id);
            const channel = await client.channels.fetch(settings.completed_contracts_channel_id);
            const paymentMentions = await getPermissionMentions(completedContract.guild_id, "payment");
            await channel.send({ content: `${paymentMentions.text || "📢 Configured payment confirmers"} — Contract **${contractId}** has been marked complete by ${interaction.user}. Please confirm payment.`, embeds: [buildCompletedContractEmbed(completedContract)], components: [buildPaymentConfirmationButtons(contractId)], allowedMentions: { roles: paymentMentions.roles, users: paymentMentions.members } });
            await notifyPermissionTargets(completedContract.guild_id, "payment", `💳 ULA contract **${contractId}** is complete and awaiting payment confirmation. Check the Completed Contracts channel.`);
          } catch (e) { posted = false; console.error("Could not post completed contract:", e); }
          await interaction.update({ content: posted ? `✅ Contract **${contractId}** marked complete and sent for payment confirmation.` : `⚠️ Contract **${contractId}** is marked complete, but the payment notification could not be posted.`, embeds: [], components: [] });
        } catch (error) {
          console.error("Failed to complete contract:", error);
          return interaction.reply({ content: "❌ Something went wrong while completing this contract.", ephemeral: true });
        }
        return;
      }

      if (interaction.customId.startsWith("payment_confirm:")) {
        if (!(await isAuthorized(interaction, "payment"))) return interaction.reply({ content: "❌ You do not have permission to confirm payment.", ephemeral: true });
        const [, contractId] = interaction.customId.split(":");
        try {
          const result = await pool.query(`UPDATE contracts SET status='PAYMENT_CONFIRMED',updated_at=CURRENT_TIMESTAMP WHERE contract_id=$1 AND guild_id=$2 AND status='COMPLETED' RETURNING accepted_by_discord_id`, [contractId, interaction.guildId]);
          if (!result.rowCount) return interaction.reply({ content: "❌ Payment for this contract has already been confirmed.", ephemeral: true });
          const embed = EmbedBuilder.from(interaction.message.embeds[0]).setTitle("💳 Contract Payment Confirmed").setColor(0x57F287).setFooter({ text: `Payment confirmed by ${interaction.user.tag}` }).setTimestamp();
          await interaction.update({ embeds: [embed], components: [] });
          const acceptedBy = result.rows[0].accepted_by_discord_id;
          if (acceptedBy) {
            try { const user = await client.users.fetch(acceptedBy); await user.send(`💳 ULA County Rep confirmed payment for contract **${contractId}**.`); } catch (e) { console.error("Could not notify accepting user:", e.message); }
          }
        } catch (error) {
          console.error("Failed to confirm payment:", error);
          return interaction.reply({ content: "❌ Something went wrong while confirming payment.", ephemeral: true });
        }
        return;
      }

      if (interaction.customId === "contract_cancel") {
        clearPending(pendingContracts, interaction.guildId, interaction.user.id);
        return interaction.update({ content: "❌ Contract creation cancelled.", embeds: [], components: [] });
      }
      return;
    }

    if (!interaction.isModalSubmit()) return;

    if (interaction.customId === "contract_view_form") {
      const contractId = interaction.fields.getTextInputValue("contract_id").trim().toUpperCase();
      try {
        const result = await pool.query(`SELECT * FROM contracts WHERE contract_id=$1 AND guild_id=$2`, [contractId, interaction.guildId]);
        if (!result.rowCount) return interaction.reply({ content: `❌ No contract was found with ID **${contractId}**.`, ephemeral: true });
        return interaction.reply({ embeds: [buildContractDetailsEmbed(result.rows[0])], ephemeral: true });
      } catch (error) {
        console.error("Failed to load contract details:", error);
        return interaction.reply({ content: "❌ Something went wrong while loading that contract.", ephemeral: true });
      }
    }

    if (interaction.customId === "contract_basic_form") {
      const payment = Number(interaction.fields.getTextInputValue("payment").replace(/[$,\s]/g, ""));
      if (!Number.isFinite(payment) || payment < 0) return interaction.reply({ content: "❌ Enter a valid payment amount, such as `25000`.", ephemeral: true });
      const contract = { contract_type: "STANDARD", title: interaction.fields.getTextInputValue("contract_title"), contractor: interaction.fields.getTextInputValue("contractor"), field: interaction.fields.getTextInputValue("field"), fields: [interaction.fields.getTextInputValue("field")], duties: [], payment, creator: interaction.user.id };
      setPending(pendingContracts, interaction.guildId, interaction.user.id, contract);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle("📝 Contract Details").setDescription("Contract information saved. Add the description and any additional terms.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("contract_details").setLabel("Add Contract Details").setEmoji("📝").setStyle(ButtonStyle.Primary))], ephemeral: true });
    }

    if (interaction.customId === "contract_details_form") {
      const contract = getPending(pendingContracts, interaction.guildId, interaction.user.id);
      if (!contract) return interaction.reply({ content: "❌ Your contract session expired. Please start again with `/contract`.", ephemeral: true });
      contract.description = interaction.fields.getTextInputValue("description");
      contract.terms = interaction.fields.getTextInputValue("terms") || "None";
      setPending(pendingContracts, interaction.guildId, interaction.user.id, contract);
      return interaction.reply({ embeds: [buildReviewEmbed(contract, "Assigned when confirmed")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("contract_confirm").setLabel("Create Contract").setEmoji("✅").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("contract_cancel").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Danger))], ephemeral: true });
    }

    if (interaction.customId === "group_basic_form") {
      const payment = Number(interaction.fields.getTextInputValue("payment").replace(/[$,\s]/g, ""));
      if (!Number.isFinite(payment) || payment < 0) return interaction.reply({ content: "❌ Enter a valid payment amount, such as `75000`.", ephemeral: true });
      const contract = { contract_type: "GROUP", title: interaction.fields.getTextInputValue("contract_title"), contractor: interaction.fields.getTextInputValue("contractor"), payment, fields: [], duties: [], description: "", terms: "None" };
      setPending(pendingGroupContracts, interaction.guildId, interaction.user.id, contract);
      return interaction.reply({ embeds: [groupBuilderEmbed(contract)], components: groupBuilderButtons(), ephemeral: true });
    }

    if (interaction.customId === "group_add_field_form") {
      const contract = getPending(pendingGroupContracts, interaction.guildId, interaction.user.id);
      if (!contract) return interaction.reply({ content: "❌ Your group-contract session expired.", ephemeral: true });
      contract.fields.push(interaction.fields.getTextInputValue("field_name").trim());
      setPending(pendingGroupContracts, interaction.guildId, interaction.user.id, contract);
      return interaction.reply({ embeds: [groupBuilderEmbed(contract)], components: groupBuilderButtons(), ephemeral: true });
    }

    if (interaction.customId === "group_add_duty_form") {
      const contract = getPending(pendingGroupContracts, interaction.guildId, interaction.user.id);
      if (!contract) return interaction.reply({ content: "❌ Your group-contract session expired.", ephemeral: true });
      contract.duties.push(interaction.fields.getTextInputValue("duty_name").trim());
      setPending(pendingGroupContracts, interaction.guildId, interaction.user.id, contract);
      return interaction.reply({ embeds: [groupBuilderEmbed(contract)], components: groupBuilderButtons(), ephemeral: true });
    }
  } catch (error) {
    console.error("Unhandled interaction error:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: "❌ An unexpected error occurred. Please try again.", ephemeral: true }); } catch {}
    }
  }
});

initDatabase()
  .then(() => client.login(process.env.DISCORD_TOKEN))
  .catch(error => { console.error("Database connection failed:", error); process.exit(1); });
