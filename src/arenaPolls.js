// Arena votes: staff put a question to the Gladiators (the role for active Arena players,
// src/gladiator.js). The vote is posted in the Arena bulletin channel with one button per
// option. Only people who held Gladiator when it opened can vote, one vote each, changeable
// until it closes. The message shows the live split as bars, like a Discord poll; who voted
// for what is only ever shown to staff. Nothing here pings anyone.
//
//   /arena poll start question: option1: option2: [option3-5:] [hours:]
//   /arena poll close [id:]     close it now and show the result
//   /arena poll cancel [id:]    close it with no result
//   /arena poll votes [id:]     staff only: who voted for what

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { getArenaHubState, getArenaPoll, listArenaPolls, saveArenaPoll, updateArenaPoll } from './store.js';

export const POLL_DEFAULT_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;
const BAR_WIDTH = 15;
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const esc = (text) => String(text ?? '').replace(/([\\*_~`|>])/g, '\\$1');

// How a vote ended: [{ option, votes, share }] in the order asked, the leaders and the turnout.
export function pollResult(poll) {
  const counts = poll.options.map(() => 0);
  for (const choice of Object.values(poll.votes || {})) if (counts[choice] !== undefined) counts[choice] += 1;
  const total = counts.reduce((sum, count) => sum + count, 0);
  const top = Math.max(0, ...counts);
  return {
    rows: poll.options.map((option, index) => ({ option, votes: counts[index], share: total ? counts[index] / total : 0 })),
    total,
    eligible: (poll.eligible || []).length,
    winners: total ? counts.flatMap((count, index) => (count === top ? [index] : [])) : []
  };
}

// The vote's message (embed data + whether it still takes votes).
export function pollCard(poll) {
  const ends = Math.floor(Date.parse(poll.endsAt) / 1000);
  const result = pollResult(poll);
  const people = (count) => `${count} Gladiator${count === 1 ? '' : 's'}`;
  if (poll.status === 'cancelled') {
    return { title: 'Arena vote: cancelled', description: `**${esc(poll.question)}**\nThis vote was cancelled. No result.`, color: 0x95a5a6, open: false };
  }
  // One option like a Discord poll: its name, then a bar with the share and the votes.
  //   **Yes**
  //   ██████████░░░░░ 67% · 16 votes
  const bars = result.rows.flatMap((row) => {
    const filled = Math.round(row.share * BAR_WIDTH);
    return [`**${esc(row.option)}**`, `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)} ${Math.round(row.share * 100)}% · ${row.votes} vote${row.votes === 1 ? '' : 's'}`];
  });
  if (poll.status === 'closed') {
    const outcome = !result.total
      ? 'Nobody voted.'
      : result.winners.length > 1
        ? `Tied: ${result.winners.map((index) => esc(poll.options[index])).join(' and ')}.`
        : `Result: **${esc(poll.options[result.winners[0]])}**.`;
    return {
      title: 'Arena vote: closed',
      description: [`**${esc(poll.question)}**`, '', ...bars, '', outcome, `-# ${result.total} of ${people(result.eligible)} voted.`].join('\n').slice(0, 4096),
      color: 0x2ecc71,
      open: false
    };
  }
  return {
    title: 'Arena vote',
    description: [
      `**${esc(poll.question)}**`,
      '',
      ...bars,
      '',
      `Gladiators vote with the buttons below. One vote each, and you can change it until the vote closes <t:${ends}:R> (<t:${ends}:f>).`,
      `-# ${result.total} of ${people(result.eligible)} have voted.`
    ].join('\n').slice(0, 4096),
    color: 0x5865f2,
    open: true
  };
}

export function createArenaPolls({ client, config, isStaff = () => false, now = () => Date.now() }) {
  const enabled = () => Boolean(config.arenaEnabled && config.arenaGladiators);

  function payload(poll) {
    const card = pollCard(poll);
    const embed = new EmbedBuilder().setTitle(card.title).setDescription(card.description).setColor(card.color);
    const components = card.open
      ? [new ActionRowBuilder().addComponents(poll.options.map((option, index) => new ButtonBuilder()
          .setCustomId(`arenapoll:${poll.id}:${index}`)
          .setLabel(option.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)))]
      : [];
    return { embeds: [embed], components, allowedMentions: { parse: [] } };
  }

  async function pollMessage(poll) {
    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    return channel?.messages?.fetch ? channel.messages.fetch(poll.messageId).catch(() => null) : null;
  }

  async function refresh(poll) {
    const message = await pollMessage(poll);
    await message?.edit(payload(poll)).catch(() => null);
  }

  // The poll a staff command is about: the id given, else the newest open one.
  async function pick(interaction, { openOnly = true } = {}) {
    const id = interaction.options.getInteger('id');
    if (id) return getArenaPoll(id);
    const polls = (await listArenaPolls()).sort((a, b) => b.id - a.id);
    return polls.find((poll) => poll.status === 'open') || (openOnly ? null : polls[0] || null);
  }

  async function start(interaction) {
    const question = clean(interaction.options.getString('question'));
    const options = [1, 2, 3, 4, 5].map((number) => clean(interaction.options.getString(`option${number}`))).filter(Boolean);
    const hours = interaction.options.getInteger('hours') || POLL_DEFAULT_HOURS;
    if (!question || options.length < 2) {
      await interaction.reply({ content: 'A vote needs a question and at least two options.', ephemeral: true });
      return;
    }
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      await interaction.reply({ content: 'Two of the options are the same.', ephemeral: true });
      return;
    }
    const eligible = Object.keys((await getArenaHubState()).gladiatorByDiscord || {});
    if (!eligible.length) {
      await interaction.reply({ content: 'Nobody holds the Gladiator role yet, so nobody could vote.', ephemeral: true });
      return;
    }
    const channel = await client.channels.fetch(config.arenaPollChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      await interaction.reply({ content: `I can't post in <#${config.arenaPollChannelId}> (missing, or I can't see it).`, ephemeral: true });
      return;
    }
    const poll = await saveArenaPoll({
      question: question.slice(0, 300),
      options: options.map((option) => option.slice(0, 70)),
      createdBy: interaction.user.id,
      createdAt: new Date(now()).toISOString(),
      endsAt: new Date(now() + hours * HOUR_MS).toISOString(),
      channelId: channel.id,
      messageId: null,
      eligible,
      votes: {},
      status: 'open'
    });
    try {
      const message = await channel.send(payload(poll));
      await updateArenaPoll(poll.id, (saved) => ({ ...saved, messageId: message.id }));
    } catch (error) {
      await updateArenaPoll(poll.id, () => null);
      await interaction.reply({ content: `I couldn't post the vote in <#${channel.id}>: ${error.message}`, ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Vote ${poll.id} is open in <#${channel.id}> for ${hours} hour${hours === 1 ? '' : 's'}. ${eligible.length} Gladiator${eligible.length === 1 ? '' : 's'} can vote.`, ephemeral: true });
  }

  async function finish(id, status) {
    const poll = await updateArenaPoll(id, (saved) => (saved && saved.status === 'open' ? { ...saved, status, closedAt: new Date(now()).toISOString() } : saved));
    if (poll) await refresh(poll);
    return poll;
  }

  async function votes(interaction) {
    const poll = await pick(interaction, { openOnly: false });
    if (!poll) {
      await interaction.reply({ content: 'There is no vote to show.', ephemeral: true });
      return;
    }
    const lines = poll.options.map((option, index) => {
      const voters = Object.entries(poll.votes || {}).filter(([, choice]) => choice === index).map(([discordId]) => `<@${discordId}>`);
      return `**${index + 1}. ${esc(option)}** (${voters.length}): ${voters.join(', ') || 'nobody'}`;
    });
    const silent = (poll.eligible || []).filter((discordId) => poll.votes?.[discordId] === undefined).map((discordId) => `<@${discordId}>`);
    await interaction.reply({
      content: [`**Vote ${poll.id}** (${poll.status}): ${esc(poll.question)}`, ...lines, `**Not voted** (${silent.length}): ${silent.join(', ') || 'nobody'}`].join('\n').slice(0, 2000),
      ephemeral: true,
      allowedMentions: { parse: [] }
    });
  }

  // /arena poll ...
  async function handleCommand(interaction) {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: 'Only Staff and Arena Admins can run Arena votes.', ephemeral: true });
      return;
    }
    if (!enabled()) {
      await interaction.reply({ content: 'Arena votes need the Gladiator role, which is switched off (ARENA_GLADIATORS=false).', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') return start(interaction);
    if (sub === 'votes') return votes(interaction);
    const poll = await pick(interaction);
    if (!poll || poll.status !== 'open') {
      await interaction.reply({ content: 'There is no open vote to do that to.', ephemeral: true });
      return;
    }
    await finish(poll.id, sub === 'cancel' ? 'cancelled' : 'closed');
    await interaction.reply({ content: sub === 'cancel' ? `Vote ${poll.id} is cancelled.` : `Vote ${poll.id} is closed and the result is posted.`, ephemeral: true });
  }

  // A vote button.
  async function handleComponent(interaction) {
    const [, id, choice] = String(interaction.customId).split(':');
    const index = Number(choice);
    const userId = interaction.user.id;
    let outcome = 'gone';
    const poll = await updateArenaPoll(Number(id), (saved) => {
      if (!saved || saved.status !== 'open' || Date.parse(saved.endsAt) <= now()) return saved;
      if (!saved.eligible.includes(userId)) {
        outcome = 'no';
        return saved;
      }
      if (!saved.options[index]) return saved;
      outcome = saved.votes[userId] === index ? 'same' : saved.votes[userId] === undefined ? 'new' : 'changed';
      return { ...saved, votes: { ...saved.votes, [userId]: index } };
    });
    if (outcome === 'gone') {
      await interaction.reply({ content: 'This vote is closed.', ephemeral: true });
      return;
    }
    if (outcome === 'no') {
      const holds = Boolean((await getArenaHubState()).gladiatorByDiscord?.[userId]);
      await interaction.reply({
        content: holds
          ? 'You got the Gladiator role after this vote opened, so you can vote in the next one.'
          : 'Only Gladiators can vote. The role goes to active Arena players: 10 Arena games in total and 3 of the last 20, with your FACEIT account linked.',
        ephemeral: true
      });
      return;
    }
    // A vote that counted gets no message: the click is acknowledged and the bars move.
    await interaction.deferUpdate();
    if (outcome !== 'same') await refresh(poll);
  }

  // Closes votes whose time is up.
  async function tick() {
    if (!enabled()) return;
    for (const poll of await listArenaPolls()) {
      if (poll.status === 'open' && Date.parse(poll.endsAt) <= now()) await finish(poll.id, 'closed');
    }
  }

  return { handleCommand, handleComponent, tick };
}
