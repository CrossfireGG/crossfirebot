import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Runs the Apps Script's roster functions (docs/schedule-log-apps-script.gs) on a fake
// "Roster Tracking" tab laid out like the real one: 11-row team blocks (header row, Team Info row,
// Player Info row, Starter 1-5, Sub 1-2, Coach), player columns B-I: IGN, Discord, Twitter, FACEIT,
// HLTV, Nationality, SteamID64, Full Name.
function loadScript(grid, links = {}) {
  const sheet = {
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map((row) => row.length)),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getRichTextValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ({ getLinkUrl: () => links[`${r + i}:${c + j}`] || null }))),
      setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; })),
      setValue: (v) => { grid[r - 1][c - 1] = v; },
      setRichTextValue: (rich) => { grid[r - 1][c - 1] = rich.text; links[`${r}:${c}`] = rich.url; },
      copyTo: (dest) => {
        for (let i = 0; i < nr; i++) {
          for (let j = 0; j < nc; j++) {
            grid[dest.r - 1 + i][dest.c - 1 + j] = grid[r - 1 + i][c - 1 + j];
            links[`${dest.r + i}:${dest.c + j}`] = links[`${r + i}:${c + j}`];
          }
        }
      },
      r,
      c
    })
  };
  globalThis.SpreadsheetApp = {
    openById: () => ({ getSheetByName: (name) => (name === 'Roster Tracking' ? sheet : null) }),
    newRichTextValue: () => {
      const rich = { text: '', url: null };
      const builder = { setText: (text) => { rich.text = text; return builder; }, setLinkUrl: (url) => { rich.url = url; return builder; }, build: () => rich };
      return builder;
    }
  };
  globalThis.ContentService = { createTextOutput: (text) => ({ setMimeType: () => ({ text }), text }), MimeType: { JSON: 'json' } };
  const source = fs.readFileSync(new URL('../docs/schedule-log-apps-script.gs', import.meta.url), 'utf8');
  const fns = new Function(`${source}; return { readRosterTeam, writeRosterChange };`)();
  const call = (name, body) => JSON.parse(fns[name]({ spreadsheetId: 'x', sheetName: 'Roster Tracking', ...body }).text);
  return { call, links };
}

function block(team, teamId, players, captain = '') {
  const player = (alias) => (alias
    ? [alias, `${alias}#disc`, '', 'https://faceit.com/p', 'https://hltv.org/p', 'USA', '76561198000000000', `Name ${alias}`]
    : ['', '', '', '', '', '', '', '']);
  return [
    ['', 'Team', 'Captian', 'Twitter', 'FACEIT', 'HLTV', 'VRS', 'Abbreviation', 'Logo'],
    ['Team Info', team, captain, 'x.com/t', `https://www.faceit.com/en/team-home/${teamId}/overview`, '', '', 'T', ''],
    ['Player Info', 'IGN', 'Discord', 'Twitter', 'FACEIT', 'HLTV', 'Nationality', 'SteamID64', 'Full Name'],
    ...['Starter 1:', 'Starter 2:', 'Starter 3:', 'Starter 4:', 'Starter 5:', 'Sub 1:', 'Sub 2:', 'Coach:'].map((label, index) => [label, ...player(players[index])])
  ];
}

test('roster sheet: finds a team by FACEIT ID, name or captain; moves to sub; refuses stale writes and the coach row', () => {
  const grid = [
    ...block('Alpha', '11111111-1111-1111-1111-111111111111', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', '', 'coachA'], 'a1'),
    ...block('Beta', '22222222-2222-2222-2222-222222222222', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'], 'betaboss')
  ];
  // Beta's FACEIT cell shows "faceit.com/..." with the team link behind it, like the real tab.
  grid[12][4] = 'faceit.com/...';
  const { call, links } = loadScript(grid, { '13:5': 'https://www.faceit.com/en/teams/22222222-2222-2222-2222-222222222222', '5:5': 'https://faceit.com/a2-link' });

  assert.equal(call('readRosterTeam', { faceitTeamId: '22222222-2222-2222-2222-222222222222' }).team.teamName, 'Beta', 'found through the link behind the cell');
  assert.equal(call('readRosterTeam', { faceitTeamId: '11111111-1111-1111-1111-111111111111' }).team.teamName, 'Alpha', 'a plain link in the cell works too');
  assert.equal(call('readRosterTeam', { teamName: 'ALPHA' }).team.headerRow, 2, 'the Team Info row');
  assert.equal(call('readRosterTeam', { captainDiscord: '@BetaBoss' }).team.teamName, 'Beta', 'captain cell holds their Discord username');
  assert.equal(call('readRosterTeam', { captainDiscord: 'a1#disc' }).team.teamName, 'Alpha', 'captain cell holds their IGN');
  assert.equal(call('readRosterTeam', { teamName: 'Gamma' }).team, null);

  const alpha = call('readRosterTeam', { teamName: 'Alpha' }).team;
  assert.deepEqual(alpha.slots.map((slot) => slot.label), ['Starter 1', 'Starter 2', 'Starter 3', 'Starter 4', 'Starter 5', 'Sub 1', 'Sub 2', 'Coach']);
  const starter2 = alpha.slots.find((slot) => slot.label === 'Starter 2');
  assert.deepEqual([starter2.alias, starter2.discord, starter2.faceit, starter2.hltv, starter2.nationality, starter2.steamId, starter2.fullName],
    ['a2', 'a2#disc', 'https://faceit.com/p', 'https://hltv.org/p', 'USA', '76561198000000000', 'Name a2']);

  const player = { alias: 'newguy', discord: 'newguy', twitter: '@newguy', faceit: 'https://faceit.com/n', hltv: 'https://hltv.org/n', nationality: 'Canada', steamId: '76561198000000009', fullName: 'New Guy' };
  const moved = call('writeRosterChange', { teamName: 'Alpha', headerRow: alpha.headerRow, targetRow: starter2.row, expectedAlias: 'a2', mode: 'sub', player: { ...player, twitter: 'https://x.com/newguy' }, linkLabel: '…', logLine: 'Alpha: +"newguy"' });
  assert.deepEqual([moved.ok, moved.movedTo, moved.logged], [true, 'Sub 2', false], 'no CHANGES column on this tab, so no log line');
  const after = call('readRosterTeam', { teamName: 'Alpha' }).team.slots;
  const sub2 = after.find((slot) => slot.label === 'Sub 2');
  assert.equal(sub2.alias, 'a2', 'the old starter is now Sub 2');
  assert.equal(links[`${sub2.row}:5`], 'https://faceit.com/a2-link', 'and keeps their FACEIT hyperlink');
  assert.deepEqual(grid[4].slice(1, 9), ['newguy', 'newguy', '…', '…', '…', 'Canada', '76561198000000009', 'New Guy'], 'B-I in the tab order, links shown as …');
  assert.deepEqual([links['5:4'], links['5:5'], links['5:6']], ['https://x.com/newguy', 'https://faceit.com/n', 'https://hltv.org/n'], 'Twitter, FACEIT and HLTV are hyperlinks');
  assert.deepEqual(grid[1].slice(0, 5), ['Team Info', 'Alpha', 'a1', 'x.com/t', 'https://www.faceit.com/en/team-home/11111111-1111-1111-1111-111111111111/overview'], 'team info untouched');

  assert.match(call('writeRosterChange', { teamName: 'Alpha', headerRow: alpha.headerRow, targetRow: starter2.row, expectedAlias: 'a2', mode: 'replace', player }).error, /changed on the sheet/);
  const coach = alpha.slots.find((slot) => slot.label === 'Coach');
  assert.match(call('writeRosterChange', { teamName: 'Alpha', headerRow: alpha.headerRow, targetRow: coach.row, expectedAlias: 'coachA', mode: 'replace', player }).error, /not a starter or sub/);
  const beta = call('readRosterTeam', { teamName: 'Beta' }).team;
  assert.match(call('writeRosterChange', { teamName: 'Beta', headerRow: beta.headerRow, targetRow: beta.slots[0].row, expectedAlias: 'b1', mode: 'sub', player }).error, /both sub slots are full/);
  assert.match(call('writeRosterChange', { teamName: 'Alpha', headerRow: beta.headerRow, targetRow: beta.slots[0].row, expectedAlias: 'b1', mode: 'replace', player }).error, /moved on the sheet/);

  // With a CHANGES column the line goes under the last entry.
  grid[0][9] = '*****CHANGES*****';
  grid[1][9] = 'Beta: -old +new';
  const sub1 = call('readRosterTeam', { teamName: 'Alpha' }).team.slots.find((slot) => slot.label === 'Sub 1');
  const logged = call('writeRosterChange', { teamName: 'Alpha', headerRow: alpha.headerRow, targetRow: sub1.row, expectedAlias: 'a6', mode: 'replace', player: { ...player, alias: 'other' }, logLine: 'Alpha: -"a6" +"other"' });
  assert.equal(logged.logged, true);
  assert.equal(grid[2][9], 'Alpha: -"a6" +"other"');
});
