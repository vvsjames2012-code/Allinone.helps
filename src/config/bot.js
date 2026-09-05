import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { botConfig, getColor } from '../config/botConfig.js';
import { logger } from '../utils/logger.js';

const TICKET_CHANNEL_ID = '1545841545486274570';

// =========================
// SLASH COMMAND: /ticket-panel
// =========================
export const data = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Post the ticket-opening panel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const targetChannel = await interaction.guild.channels
    .fetch(TICKET_CHANNEL_ID)
    .catch(() => null);

  if (!targetChannel) {
    return interaction.reply({
      content: `Could not find channel \`${TICKET_CHANNEL_ID}\`. Make sure it exists in this server and the bot can see it.`,
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Need help?')
    .setDescription('Click the button below to open a support ticket.')
    .setColor(getColor('primary'))
    .setFooter({ text: botConfig.embeds.footer.text });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('Open Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  );

  try {
    await targetChannel.send({ embeds: [embed], components: [row] });
    await interaction.reply({
      content: `Panel posted in <#${TICKET_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error('Failed to post ticket panel:', err);
    await interaction.reply({
      content: 'Failed to post the panel — check the bot has Send Messages/Embed Links there.',
      ephemeral: true,
    });
  }
}

// =========================
// BUTTON HANDLING (open / close ticket)
// Call handleTicketInteraction(interaction) from your interactionCreate router
// for any button interaction. Returns true if it handled the button.
// =========================
export async function handleTicketInteraction(interaction) {
  if (!interaction.isButton()) return false;

  if (interaction.customId === 'ticket_open') {
    await openTicket(interaction);
    return true;
  }

  if (interaction.customId === 'ticket_close_request') {
    await requestClose(interaction);
    return true;
  }

  if (interaction.customId === 'ticket_close_confirm') {
    await closeTicket(interaction);
    return true;
  }

  return false;
}

async function openTicket(interaction) {
  const { guild, user } = interaction;
  const cfg = botConfig.tickets;

  await interaction.deferReply({ ephemeral: true });

  const existing = guild.channels.cache.find(
    (c) => c.topic === `ticket-owner:${user.id}`,
  );
  if (existing) {
    return interaction.editReply({
      content: `You already have an open ticket: ${existing}`,
    });
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    ...cfg.supportRoles.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${user.username}`.toLowerCase().slice(0, 90),
      type: ChannelType.GuildText,
      parent: cfg.defaultCategory || undefined,
      topic: `ticket-owner:${user.id}`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    logger.error('Failed to create ticket channel:', err);
    return interaction.editReply({
      content: 'Something went wrong creating your ticket. Please try again or contact staff directly.',
    });
  }

  const priority = cfg.priorities[cfg.defaultPriority] || cfg.priorities.none;

  const embed = new EmbedBuilder()
    .setTitle('Ticket Opened')
    .setDescription(`Hi ${user}, thanks for reaching out. Support will be with you shortly.`)
    .addFields({ name: 'Priority', value: `${priority.emoji} ${priority.label}`, inline: true })
    .setColor(getColor('ticket.open'))
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_request')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  const ping = cfg.supportRoles.map((r) => `<@&${r}>`).join(' ');

  await channel.send({
    content: ping || undefined,
    embeds: [embed],
    components: [closeRow],
  });

  await interaction.editReply({ content: `Ticket created: ${channel}` });
}

async function requestClose(interaction) {
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_confirm')
      .setLabel('Confirm Close')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    content: 'Are you sure you want to close this ticket? This will archive the channel.',
    components: [confirmRow],
    ephemeral: true,
  });
}

async function closeTicket(interaction) {
  const { channel, guild } = interaction;
  const cfg = botConfig.tickets;

  await interaction.deferReply({ ephemeral: true });

  const ownerMatch = channel.topic?.match(/^ticket-owner:(\d+)$/);
  const ownerId = ownerMatch?.[1];

  const logEmbed = new EmbedBuilder()
    .setTitle('Ticket Closed')
    .addFields(
      { name: 'Channel', value: `#${channel.name}`, inline: true },
      { name: 'Closed by', value: `${interaction.user}`, inline: true },
      { name: 'Owner', value: ownerId ? `<@${ownerId}>` : 'Unknown', inline: true },
    )
    .setColor(getColor('ticket.closed'))
    .setTimestamp();

  if (cfg.logChannel) {
    const logChannel = await guild.channels.fetch(cfg.logChannel).catch(() => null);
    if (logChannel) {
      await logChannel.send({ embeds: [logEmbed] }).catch((err) =>
        logger.error('Failed to send ticket log:', err),
      );
    }
  }

  await interaction.editReply({ content: 'Closing ticket…' });

  try {
    if (cfg.archiveCategory) {
      await channel.setParent(cfg.archiveCategory, { lockPermissions: false });
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: false,
      });
      if (ownerId) {
        await channel.permissionOverwrites.edit(ownerId, {
          SendMessages: false,
        });
      }
      await channel.send({ embeds: [logEmbed] });
    } else {
      await channel.send({ content: 'This ticket will be deleted in 5 seconds.' });
      setTimeout(() => channel.delete().catch(() => {}), 5000);
    }
  } catch (err) {
    logger.error('Failed to close ticket channel:', err);
  }
}
