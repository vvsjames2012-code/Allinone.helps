// reset-commands.js
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { ticketCommands } from './commands/tickets.js';

const token = process.env.DISCORD_TOKEN || process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional — omit for global commands

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN/TOKEN or CLIENT_ID.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function run() {
  console.log('Wiping all global commands...');
  await rest.put(Routes.applicationCommands(clientId), { body: [] });

  if (guildId) {
    console.log(`Wiping all guild commands for ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
  }

  const body = ticketCommands.map((c) => c.data.toJSON());

  console.log('Registering /ticket-setup and /ticket-edit...');
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
  }

  console.log('Done — only /ticket-setup and /ticket-edit exist now.');
}

run().catch((err) => {
  console.error('Failed to reset commands:', err);
  process.exit(1);
});
