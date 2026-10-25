const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

const data = new SlashCommandBuilder()
  .setName("guildconfig")
  .setDescription("View or update this server's Guild Guide information.")
  .addSubcommand(sub => sub.setName("view").setDescription("View the saved server information."))
  .addSubcommand(sub => sub.setName("set-description").setDescription("Set the server description (Manage Server required).")
    .addStringOption(option => option.setName("text").setDescription("Description shown as server information").setRequired(true).setMaxLength(1000)))
  .addSubcommand(sub => sub.setName("set-welcome").setDescription("Set the server welcome text (Manage Server required).")
    .addStringOption(option => option.setName("text").setDescription("Welcome information for members").setRequired(true).setMaxLength(2000)))
  .addSubcommand(sub => sub.setName("set-rules-channel").setDescription("Choose the server's rules channel (Manage Server required).")
    .addChannelOption(option => option.setName("channel").setDescription("Rules channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand(sub => sub.setName("set-info-channel").setDescription("Choose the server's information channel (Manage Server required).")
    .addChannelOption(option => option.setName("channel").setDescription("Information channel").addChannelTypes(ChannelType.GuildText).setRequired(true)));

async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "Guild configuration is available inside a server.", ephemeral: true });
  }
  const action = interaction.options.getSubcommand();
  if (action !== "view" && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "You need Manage Server permission to change server information.", ephemeral: true });
  }

  try {
    const service = interaction.client.services.guild;
    if (action === "view") {
      const config = await service.getConfig(interaction.guildId);
      return interaction.reply({ content: [
        `**${config?.guild_name || interaction.guild.name}**`,
        `Description: ${config?.description || "Not set"}`,
        `Welcome: ${config?.welcome_message || "Not set"}`,
        `Rules channel: ${config?.rules_channel_id ? `<#${config.rules_channel_id}>` : "Not set"}`,
        `Information channel: ${config?.info_channel_id ? `<#${config.info_channel_id}>` : "Not set"}`
      ].join("\n"), ephemeral: true });
    }

    let patch;
    if (action === "set-description") patch = { description: interaction.options.getString("text").trim() };
    if (action === "set-welcome") patch = { welcome_message: interaction.options.getString("text").trim() };
    if (action === "set-rules-channel") patch = { rules_channel_id: interaction.options.getChannel("channel").id };
    if (action === "set-info-channel") patch = { info_channel_id: interaction.options.getChannel("channel").id };
    await service.updateConfig(interaction.guildId, { guild_name: interaction.guild.name, ...patch });
    return interaction.reply({ content: "Guild Guide server information saved.", ephemeral: true });
  } catch (error) {
    console.error("Guild configuration command failed:", error);
    return interaction.reply({ content: "I couldn't update the server information. Please try again.", ephemeral: true });
  }
}

module.exports = { data, execute };
