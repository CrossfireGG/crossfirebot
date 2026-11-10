import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApplicationCard, parseApplication } from '../src/casterApplications.js';

// The response tab's headers, in form order (two sections both ask "Channel link").
const HEADERS = [
  'Timestamp', 'Email Address', 'Discord username', 'Are you a:  ', 'Company name  ', 'Company Website',
  'List of individuals that will be covering this event. ', 'What team/teams are you covering?  ',
  'Channel Link', "Are you applying to stream on someone else's stream? If so, whose? (Org, players, team) ",
  'Channel sponsors, if any?  ', 'Org name', 'Contact name and email', '  Channel link  ',
  'Who will be covering the games on stream? ', 'Confirmation'
];
const row = (answers) => HEADERS.map((header) => answers[header] ?? '');
const SHEET = 'https://docs.google.com/spreadsheets/d/abc/edit?gid=37125937#gid=37125937';

test('a caster/streamer application: channel, other stream, sponsors; no email', () => {
  const app = parseApplication(HEADERS, row({
    Timestamp: '2026-11-11T02:42:00.000Z',
    'Email Address': 'someone@example.com',
    'Discord username': 'Peluso33',
    'Are you a:  ': 'Caster/Streamer',
    'Channel Link': 'https://www.twitch.tv/peluso33',
    "Are you applying to stream on someone else's stream? If so, whose? (Org, players, team) ": 'No',
    'Channel sponsors, if any?  ': 'No',
    Confirmation: 'I have read the guidelines'
  }));
  const card = buildApplicationCard(app, { memberId: '42', history: { approved: 0 }, sheetUrl: SHEET, rowNumber: 15 });
  assert.equal(card.title, '🎙️ New streaming application · Caster/Streamer');
  assert.equal(card.description, [
    '**Discord:** <@42> (Peluso33)',
    '**Channel:** [twitch.tv/peluso33](https://www.twitch.tv/peluso33)',
    "**On someone else's stream:** No",
    '**Sponsors:** No',
    '',
    'First application',
    `Submitted <t:${Date.parse('2026-11-11T02:42:00Z') / 1000}:f> · [Open sheet](${SHEET}&range=A15)`
  ].join('\n'));
  assert.doesNotMatch(card.description, /@example\.com|guidelines/);
});

test('sponsors get flagged; returning casters show their history; unknown members say so', () => {
  const app = parseApplication(HEADERS, row({
    'Discord username': 'Floofys', 'Are you a:  ': 'Caster/Streamer',
    'Channel Link': 'https://twitch.tv/floofys', 'Channel sponsors, if any?  ': 'GFuel'
  }));
  const returning = buildApplicationCard(app, { memberId: '7', history: { approved: 4, formsIn: 3, formsTotal: 3 } }).description;
  assert.match(returning, /\*\*Sponsors:\*\* GFuel \(check against the co-streaming guidelines\)/);
  assert.match(returning, /Returning: 4 approved casts · 3 of 3 post-cast forms in/);
  const stranger = buildApplicationCard(app).description;
  assert.match(stranger, /^\*\*Discord:\*\* Floofys \(not found in the server\)/);
  assert.doesNotMatch(stranger, /Returning|First application/);
});

test('org and broadcasting company applications show their own section; contact emails are dropped', () => {
  const org = buildApplicationCard(parseApplication(HEADERS, row({
    'Discord username': 'orgperson', 'Are you a:  ': 'Org', 'Org name': 'Omen Esports',
    'Contact name and email': 'Sam Smith - sam@omen.gg', '  Channel link  ': 'https://twitch.tv/omen',
    'Who will be covering the games on stream? ': 'Sam and Alex'
  })));
  assert.match(org.description, /\*\*Org:\*\* Omen Esports\n\*\*Channel:\*\* \[twitch\.tv\/omen\]\(https:\/\/twitch\.tv\/omen\)\n\*\*Covering the games:\*\* Sam and Alex\n\*\*Contact:\*\* Sam Smith/);
  assert.doesNotMatch(org.description, /@omen\.gg/);
  const company = buildApplicationCard(parseApplication(HEADERS, row({
    'Discord username': 'bc', 'Are you a:  ': 'Broadcasting company', 'Company name  ': 'CastCo',
    'Company Website': 'https://castco.tv', 'List of individuals that will be covering this event. ': 'A, B',
    'What team/teams are you covering?  ': 'All'
  })));
  assert.equal(company.title, '🎙️ New streaming application · Broadcasting company');
  assert.match(company.description, /\*\*Company:\*\* CastCo\n\*\*Website:\*\* \[castco\.tv\]\(https:\/\/castco\.tv\)\n\*\*Individuals covering:\*\* A, B\n\*\*Teams covering:\*\* All/);
});
