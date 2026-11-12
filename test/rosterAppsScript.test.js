import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Runs the Apps Script's roster functions (docs/schedule-log-apps-script.gs) on a fake
// "Roster Tracking" tab laid out like the real one: 11-row team blocks (header row, Team Info row,
// Player Info row, Starter 1-5, Sub 1-2, Coach), player columns B-I: IGN, Discord, Twitter, FACEIT,
// HLTV, Nationality, SteamID64, Full Name.
function loadScript(grid, links = {}, { merged = [] } = {}) {
  const formats = {};
  const merges = [];
  const formatCopies = [];
  const partialLinks = {};
  // Cells that are the top-left of a merge across 6 columns ("row:col"), like the history box rows.
  const mergedAt = new Set(merged);
  const width = () => Math.max(...grid.map((row) => row.length));
  const ensure = (r) => { while (grid.length < r) grid.push(Array(width()).fill('')); };
  const sheet = {
    getLastRow: () => {
      for (let i = grid.length - 1; i >= 0; i--) if (grid[i].some((cell) => String(cell).trim())) return i + 1;
      return 0;
    },
    getLastColumn: () => width(),
    getMaxRows: () => grid.length,
    insertRowsAfter: (_after, count) => ensure(grid.length + count),
    getRange: (r, c, nr = 1, nc = 1) => ({
      r,
      c,
      nr,
      nc,
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
      getRichTextValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ({ getLinkUrl: () => links[`${r + i}:${c + j}`] || null }))),
      getRichTextValue: () => ({ getLinkUrl: () => links[`${r}:${c}`] || null }),
      setValues: (vals) => {
        ensure(r + vals.length - 1);
        vals.forEach((row, i) => row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; delete links[`${r + i}:${c + j}`]; }));
        const chain = { setFontWeight: () => chain, setHorizontalAlignment: () => chain };
        return chain;
      },
      merge: () => { merges.push(`${r}:${c}:${nr}x${nc}`); mergedAt.add(`${r}:${c}`); },
      getMergedRanges: () => (mergedAt.has(`${r}:${c}`) ? [{ getNumColumns: () => 6 }] : []),
      setValue: (v) => { grid[r - 1][c - 1] = v; },
      setNumberFormat: (format) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) formats[`${r + i}:${c + j}`] = format; },
      setRichTextValue: (rich) => { grid[r - 1][c - 1] = rich.text; if (rich.partial) partialLinks[`${r}:${c}`] = rich.partial; else links[`${r}:${c}`] = rich.url; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { grid[r - 1 + i][c - 1 + j] = ''; delete links[`${r + i}:${c + j}`]; } },
      clear: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { grid[r - 1 + i][c - 1 + j] = ''; delete links[`${r + i}:${c + j}`]; } },
      copyTo: (dest, type) => {
        ensure(dest.r + (dest.nr || nr) - 1);
        if (type === 'format') {
          formatCopies.push({ from: `${r}:${c}`, to: `${dest.r}:${dest.c}`, rows: dest.nr || nr, cols: dest.nc || nc });
          return;
        }
        for (let i = 0; i < nr; i++) {
          for (let j = 0; j < nc; j++) {
            grid[dest.r - 1 + i][dest.c - 1 + j] = grid[r - 1 + i][c - 1 + j];
            const link = links[`${r + i}:${c + j}`];
            if (link) links[`${dest.r + i}:${dest.c + j}`] = link;
            else delete links[`${dest.r + i}:${dest.c + j}`];
          }
        }
      }
    })
  };
  // A second tab the script can create: Roster History.
  const history = { rows: [], links: {}, formats: {}, created: false, frozen: 0 };
  const historySheet = {
    getLastRow: () => history.rows.length,
    setFrozenRows: (count) => { history.frozen = count; },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (history.rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: (vals) => { vals.forEach((row, i) => { history.rows[r - 1 + i] = row.slice(); }); return { setFontWeight: () => {} }; },
      setNumberFormat: (format) => { for (let i = 0; i < nr; i++) history.formats[`${r + i}:${c}`] = format; },
      setRichTextValue: (rich) => { history.rows[r - 1][c - 1] = rich.text; history.links[`${r}:${c}`] = rich.url; }
    })
  };
  globalThis.SpreadsheetApp = {
    openById: () => ({
      getSheetByName: (name) => (name === 'Roster Tracking' ? sheet : name === 'Roster History' && history.created ? historySheet : null),
      insertSheet: (name) => { if (name === 'Roster History') history.created = true; return historySheet; }
    }),
    CopyPasteType: { PASTE_FORMAT: 'format' },
    newRichTextValue: () => {
      const rich = { text: '', url: null };
      const builder = { setText: (text) => { rich.text = text; return builder; }, setLinkUrl: (...args) => { if (args.length === 3) rich.partial = { start: args[0], end: args[1], url: args[2] }; else rich.url = args[0]; return builder; }, build: () => rich };
      return builder;
    }
  };
  globalThis.ContentService = { createTextOutput: (text) => ({ setMimeType: () => ({ text }), text }), MimeType: { JSON: 'json' } };
  const source = fs.readFileSync(new URL('../docs/schedule-log-apps-script.gs', import.meta.url), 'utf8');
  const fns = new Function(`${source}; return { readRosterTeam, applyRosterOps };`)();
  const call = (name, body) => JSON.parse(fns[name]({ spreadsheetId: 'x', sheetName: 'Roster Tracking', ...body }).text);
  return { call, formats, history, merges, formatCopies, partialLinks };
}

function block(team, teamId, players, captain = '') {
  const player = (alias) => (alias
    ? [alias, `${alias}#disc`, '', 'https://faceit.com/p', 'https://hltv.org/p', 'USA', '76561198000000000', `Name ${alias}`]
    : ['', '', '', '', '', '', '', '']);
  return [
    ['', 'Team', 'Captian', 'Twitter', 'FACEIT', 'HLTV', 'VRS', 'Abbreviation', 'Logo', ''],
    ['Team Info', team, captain, 'x.com/t', `https://www.faceit.com/en/team-home/${teamId}/overview`, '', '', 'T', '', ''],
    ['Player Info', 'IGN', 'Discord', 'Twitter', 'FACEIT', 'HLTV', 'Nationality', 'SteamID64', 'Full Name', ''],
    ...['Starter 1:', 'Starter 2:', 'Starter 3:', 'Starter 4:', 'Starter 5:', 'Sub 1:', 'Sub 2:', 'Coach:'].map((label, index) => [label, ...player(players[index]), ''])
  ];
}

const NEW = { alias: 'newguy', discord: 'newguy', twitter: 'https://x.com/newguy', faceit: 'https://faceit.com/n', hltv: 'https://hltv.org/n', nationality: 'Canada', steamId: '76561198000000009', fullName: 'New Guy' };

function setup() {
  const grid = [
    ...block('Alpha', '11111111-1111-1111-1111-111111111111', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', '', 'coachA'], 'a1'),
    ...block('Beta', '22222222-2222-2222-2222-222222222222', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'], 'betaboss')
  ];
  // Beta's FACEIT cell shows "faceit.com/..." with the team link behind it, like the real tab.
  grid[12][4] = 'faceit.com/...';
  const links = { '13:5': 'https://www.faceit.com/en/teams/22222222-2222-2222-2222-222222222222', '5:5': 'https://faceit.com/a2-link' };
  return { grid, links, ...loadScript(grid, links) };
}

test('roster sheet: finds a team by FACEIT ID (also behind the cell), name or captain', () => {
  const { call } = setup();
  assert.equal(call('readRosterTeam', { faceitTeamId: '22222222-2222-2222-2222-222222222222' }).team.teamName, 'Beta', 'found through the link behind the cell');
  assert.equal(call('readRosterTeam', { faceitTeamId: '11111111-1111-1111-1111-111111111111' }).team.teamName, 'Alpha');
  assert.equal(call('readRosterTeam', { teamName: 'ALPHA' }).team.headerRow, 2, 'the Team Info row');
  assert.equal(call('readRosterTeam', { captainDiscord: '@BetaBoss' }).team.teamName, 'Beta', 'captain cell holds their Discord username');
  assert.equal(call('readRosterTeam', { captainDiscord: 'a1#disc' }).team.teamName, 'Alpha', 'captain cell holds their IGN');
  assert.equal(call('readRosterTeam', { teamName: 'Gamma' }).team, null);
  const alpha = call('readRosterTeam', { teamName: 'Alpha' }).team;
  assert.deepEqual(alpha.slots.map((slot) => slot.label), ['Starter 1', 'Starter 2', 'Starter 3', 'Starter 4', 'Starter 5', 'Sub 1', 'Sub 2', 'Coach']);
});

test('roster sheet: move to sub copies with links, then the new player is written with hyperlinks', () => {
  const { grid, links, call, formats } = setup();
  const res = call('applyRosterOps', {
    teamName: 'Alpha', headerRow: 2, linkLabel: '…', logLine: 'Alpha: "a2" to sub +"newguy"',
    expect: [{ row: 5, alias: 'a2' }, { row: 10, alias: '' }],
    ops: [{ op: 'copy', from: 5, to: 10 }, { op: 'write', row: 5, player: NEW }]
  });
  assert.deepEqual([res.ok, res.applied, res.logged], [true, 2, false], 'no CHANGES column on this tab, so no log line');
  assert.equal(grid[9][1], 'a2', 'the old starter is now Sub 2');
  assert.equal(links['10:5'], 'https://faceit.com/a2-link', 'and keeps their FACEIT hyperlink');
  assert.deepEqual(grid[4].slice(1, 9), ['newguy', 'newguy', '…', '…', '…', 'Canada', '76561198000000009', 'New Guy']);
  assert.deepEqual([links['5:4'], links['5:5'], links['5:6']], ['https://x.com/newguy', 'https://faceit.com/n', 'https://hltv.org/n']);
  assert.deepEqual(grid[1].slice(0, 3), ['Team Info', 'Alpha', 'a1'], 'team info untouched');
  assert.equal(formats['5:8'], '@', 'SteamID64 written as plain text so Sheets keeps all 17 digits');
});

test('roster sheet: clear, swap (links included) and the CHANGES log', () => {
  const { grid, links, call } = setup();
  assert.equal(call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [{ row: 6, alias: 'a3' }], ops: [{ op: 'clear', row: 6 }] }).ok, true);
  assert.deepEqual(grid[5].slice(1, 9), ['', '', '', '', '', '', '', '']);
  const rowsBefore = grid.length;
  const swap = call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [{ row: 9, alias: 'a6' }, { row: 5, alias: 'a2' }], ops: [{ op: 'swap', a: 9, b: 5 }] });
  assert.equal(swap.ok, true);
  assert.equal(grid[4][1], 'a6', 'the sub is now Starter 2');
  assert.equal(grid[8][1], 'a2', 'the starter is now Sub 1');
  assert.equal(links['9:5'], 'https://faceit.com/a2-link', 'the swapped starter keeps their link');
  assert.equal(links['5:5'], undefined);
  assert.ok(grid.slice(rowsBefore).every((row) => row.every((cell) => !String(cell).trim())), 'the temporary row is cleared');

  grid[0][9] = '*****CHANGES*****';
  grid[1][9] = 'Beta: -old +new';
  const logged = call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [{ row: 7, alias: 'a4' }], ops: [{ op: 'clear', row: 7 }], logLine: 'Alpha: -"a4"' });
  assert.equal(logged.logged, true);
  assert.equal(grid[2][9], 'Alpha: -"a4"', 'under the last CHANGES line');
});

test('roster sheet: refuses stale rows, the coach row, other teams and a moved block', () => {
  const { call } = setup();
  assert.match(call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [{ row: 5, alias: 'someone' }], ops: [{ op: 'clear', row: 5 }] }).error, /changed on the sheet/);
  assert.match(call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [], ops: [{ op: 'clear', row: 11 }] }).error, /not a starter or sub/, 'the coach row');
  assert.match(call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [], ops: [{ op: 'clear', row: 15 }] }).error, /not a starter or sub/, "Beta's row");
  assert.match(call('applyRosterOps', { teamName: 'Alpha', headerRow: 13, expect: [], ops: [] }).error, /moved on the sheet/);
});

test('roster sheet: with no history box, changes go on a Roster History tab, player names linked to FACEIT', () => {
  const { call, history } = setup();
  // Starter 2 (a2) has a FACEIT link behind its "…" cell (5:5); the new player brings their own.
  const res = call('applyRosterOps', {
    teamName: 'Alpha', headerRow: 2, linkLabel: '…', requestedBy: 'Alpha Captain', when: '2026-11-12T02:42:00.000Z',
    expect: [{ row: 5, alias: 'a2' }],
    ops: [{ op: 'write', row: 5, player: NEW }],
    history: [
      { action: 'Removed', player: 'a2', spot: 'Starter 2', faceitRow: 5 },
      { action: 'Added', player: 'newguy', spot: 'Starter 2', faceit: 'https://faceit.com/n' }
    ]
  });
  assert.equal(res.ok, true);
  assert.equal(res.historyRows, 2);
  assert.equal(history.created, true, 'the tab is made the first time');
  assert.equal(history.frozen, 1);
  assert.deepEqual(history.rows[0], ['Date', 'Team', 'Action', 'Player', 'Role/Spot', 'Requested by']);
  assert.deepEqual(history.rows.slice(1).map((row) => row.slice(1)), [
    ['Alpha', 'Removed', 'a2', 'Starter 2', 'Alpha Captain'],
    ['Alpha', 'Added', 'newguy', 'Starter 2', 'Alpha Captain']
  ]);
  assert.equal(history.rows[1][0].toISOString(), '2026-11-12T02:42:00.000Z', 'Date is a real date');
  assert.equal(history.formats['2:1'], 'mmm d, yyyy h:mm am/pm');
  assert.equal(history.links['2:4'], 'https://faceit.com/a2-link', 'the removed player links to the FACEIT link read off the roster before the change');
  assert.equal(history.links['3:4'], 'https://faceit.com/n', 'the new player links to theirs');

  // A change sent to an admin (no roster change) is still recorded, under the existing header.
  const sent = call('applyRosterOps', { teamName: 'Alpha', headerRow: 2, expect: [], ops: [], requestedBy: 'Alpha Captain', history: [{ action: 'Sent to admin: move to sub (subs full)', player: 'a3', spot: 'Starter 3 → sub', faceitRow: 6 }] });
  assert.deepEqual([sent.ok, sent.applied, sent.historyRows], [true, 0, 1]);
  assert.equal(history.rows.length, 4);
  assert.equal(history.rows[3][2], 'Sent to admin: move to sub (subs full)');
  assert.equal(history.links['4:4'], 'https://faceit.com/p', 'a FACEIT link typed as plain text in the cell is used too');
});

test('roster sheet: history goes in the ROSTER CHANGE HISTORY box, one line per player in its merged rows', () => {
  const grid = [
    ...block('Alpha', '11111111-1111-1111-1111-111111111111', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', '', 'coachA'], 'a1'),
    ...block('Beta', '22222222-2222-2222-2222-222222222222', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'], 'betaboss')
  ];
  // Like the real tab: title in K1, rows 1-4 of the box each merged across K:P (a short box, to test
  // what happens past it).
  for (const row of grid) while (row.length < 16) row.push('');
  grid[0][10] = 'ROSTER CHANGE HISTORY';
  const links = { '5:5': 'https://faceit.com/a2-link' };
  const merged = ['1:11', '2:11', '3:11', '4:11'];
  const { call, history, merges, formatCopies, partialLinks } = loadScript(grid, links, { merged });
  const first = call('applyRosterOps', {
    teamName: 'Alpha', headerRow: 2, linkLabel: '…', requestedBy: 'krakenshort', whenText: 'Nov 11, 9:42 PM EST',
    expect: [{ row: 5, alias: 'a2' }, { row: 10, alias: '' }],
    ops: [{ op: 'copy', from: 5, to: 10 }, { op: 'clear', row: 5 }],
    history: [{ action: 'Moved to sub', player: 'a2', spot: 'Starter 2 → Sub 2', faceitRow: 5 }]
  });
  assert.equal(first.ok, true);
  assert.equal(history.created, false, 'no separate tab when the box is there');
  assert.equal(grid[1][10], 'Nov 11, 9:42 PM EST · Alpha · Moved to sub · a2 · Starter 2 → Sub 2 · by krakenshort', 'one line, right under the title (row 2)');
  const line = grid[1][10];
  assert.deepEqual(partialLinks['2:11'], { start: line.indexOf('a2 ·'), end: line.indexOf('a2 ·') + 2, url: 'https://faceit.com/a2-link' }, 'only the player name is linked, to their FACEIT');
  assert.deepEqual(grid[1].slice(0, 2), ['Team Info', 'Alpha'], 'the roster block beside it is untouched');

  // Two players in one change take two lines; the one past the drawn box gets its look and is merged.
  const second = call('applyRosterOps', {
    teamName: 'Beta', headerRow: 13, requestedBy: 'tatmcs', whenText: 'Nov 12, 6:10 PM EST',
    expect: [{ row: 15, alias: 'b1' }],
    ops: [{ op: 'clear', row: 15 }],
    history: [{ action: 'Removed', player: 'b1', spot: 'Starter 1', faceitRow: 15 }, { action: 'Added', player: 'newguy', spot: 'Starter 1', faceit: 'https://faceit.com/n' }]
  });
  assert.deepEqual([second.ok, second.historyRows], [true, 2]);
  assert.equal(grid[2][10], 'Nov 12, 6:10 PM EST · Beta · Removed · b1 · Starter 1 · by tatmcs');
  assert.equal(grid[3][10], 'Nov 12, 6:10 PM EST · Beta · Added · newguy · Starter 1 · by tatmcs');
  assert.equal(partialLinks['4:11'].url, 'https://faceit.com/n');
  assert.ok(!formatCopies.some((copy) => copy.to === '3:11' || copy.to === '4:11'), 'rows inside the drawn box are left as they are');
  call('applyRosterOps', { teamName: 'Beta', headerRow: 13, requestedBy: 'tatmcs', whenText: 'Nov 12, 6:15 PM EST', expect: [], ops: [], history: [{ action: 'Sent to admin: move to sub (subs full)', player: 'b2', spot: 'Starter 2 → sub', faceitRow: 16 }] });
  assert.equal(grid[4][10], 'Nov 12, 6:15 PM EST · Beta · Sent to admin: move to sub (subs full) · b2 · Starter 2 → sub · by tatmcs');
  assert.ok(formatCopies.some((copy) => copy.from === '2:11' && copy.to === '5:11' && copy.cols === 6), 'row 5 (past the box) gets the look of the box');
  assert.ok(merges.includes('5:11:1x6'), 'and is merged across K:P');
});
