// Streaming applications (the "Streaming Application" Google Form): turns a response row into the
// card posted in the stream request channel. Pure functions; index.js reads the sheet and posts.

// "Are you applying to stream on someone else's stream? If so, whose? " -> "are you applying to stream on someone else's stream? if so, whose"
function normalizeHeader(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').replace(/[\s:?.]+$/, '').toLowerCase();
}

function clean(value) {
  return String(value ?? '').trim();
}

// Email addresses are left off the card (Discord messages get screenshotted); the sheet has them.
function withoutEmails(text) {
  return clean(text)
    .replace(/[^\s,;()<>]+@[^\s,;()<>]+\.[^\s,;()<>]+/g, '')
    .replace(/\(\s*\)|<\s*>/g, '')
    .replace(/\s*[,;/|-]\s*$/g, '')
    .replace(/^\s*[,;/|-]\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// headers: the response tab's first row; values: one response row. Questions with the same title
// in different sections (e.g. "Channel link") use the first answered one, since an applicant only
// fills in their own section.
export function parseApplication(headers, values) {
  const answers = (headers || []).map((header, index) => ({ key: normalizeHeader(header), header: clean(header), value: values?.[index] }));
  const pick = (...prefixes) => {
    for (const prefix of prefixes) {
      const hit = answers.find((answer) => answer.key.startsWith(prefix) && clean(answer.value));
      if (hit) return clean(hit.value);
    }
    return '';
  };
  const stamp = answers.find((answer) => answer.key === 'timestamp')?.value;
  const submittedMs = stamp instanceof Date ? stamp.getTime() : Date.parse(clean(stamp));
  return {
    submittedMs: Number.isFinite(submittedMs) ? submittedMs : null,
    discord: pick('discord username', 'discord'),
    type: pick('are you a'),
    companyName: pick('company name'),
    companyWebsite: pick('company website'),
    individuals: pick('list of individuals'),
    teams: pick('what team'),
    channel: pick('channel link'),
    otherStream: pick('are you applying to stream on someone else'),
    sponsors: pick('channel sponsors'),
    orgName: pick('org name'),
    contact: withoutEmails(pick('contact name')),
    covering: pick('who will be covering')
  };
}

function kindOf(type) {
  const text = clean(type).toLowerCase();
  if (text.includes('broadcast')) return 'company';
  if (text.startsWith('org')) return 'org';
  if (text.includes('caster') || text.includes('streamer')) return 'caster';
  return 'other';
}

const NO_ANSWER = /^(no|none|nope|n\/?a|-|nothing|not yet)\.?$/i;

function linkText(url) {
  const value = clean(url);
  if (!/^https?:\/\//i.test(value)) return value;
  const label = value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return `[${label}](${value})`;
}

// The card: { title, description }. `memberId` is the applicant's Discord account if their username
// was found in the server; `history` = { approved, formsIn, formsTotal } from their stream requests.
export function buildApplicationCard(app, { memberId = null, history = null, sheetUrl = null, rowNumber = null } = {}) {
  const kind = kindOf(app.type);
  const lines = [];
  lines.push(`**Discord:** ${memberId ? `<@${memberId}> (${app.discord})` : `${app.discord || 'not given'}${app.discord ? ' (not found in the server)' : ''}`}`);
  const add = (label, value) => {
    if (clean(value)) lines.push(`**${label}:** ${value}`);
  };
  if (kind === 'caster') {
    add('Channel', linkText(app.channel));
    add("On someone else's stream", app.otherStream);
    add('Sponsors', app.sponsors && !NO_ANSWER.test(app.sponsors) ? `${app.sponsors} (check against the co-streaming guidelines)` : app.sponsors);
  } else if (kind === 'org') {
    add('Org', app.orgName);
    add('Channel', linkText(app.channel));
    add('Covering the games', app.covering);
    add('Contact', app.contact);
  } else if (kind === 'company') {
    add('Company', app.companyName);
    add('Website', linkText(app.companyWebsite));
    add('Individuals covering', app.individuals);
    add('Teams covering', app.teams);
  } else {
    add('Channel', linkText(app.channel));
    add('Org', app.orgName);
    add('Company', app.companyName);
  }
  lines.push('');
  if (memberId && history) {
    lines.push(history.approved
      ? `Returning: ${history.approved} approved cast${history.approved === 1 ? '' : 's'}${history.formsTotal ? ` · ${history.formsIn} of ${history.formsTotal} post-cast forms in` : ''}`
      : 'First application');
  }
  const when = app.submittedMs ? `Submitted <t:${Math.floor(app.submittedMs / 1000)}:f>` : null;
  const sheet = sheetUrl ? `[Open sheet](${sheetUrl}${rowNumber ? `${sheetUrl.includes('#') ? '&' : '#'}range=A${rowNumber}` : ''})` : null;
  lines.push([when, sheet].filter(Boolean).join(' · '));
  return {
    title: `🎙️ New streaming application · ${clean(app.type) || 'Unknown type'}`.slice(0, 256),
    description: lines.filter((line, index, all) => !(line === '' && (index === all.length - 1 || all[index + 1] === ''))).join('\n').trim().slice(0, 4000)
  };
}
