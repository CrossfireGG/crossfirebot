# FACEIT Discord Match Bot

This bot creates private Discord match channels from a FACEIT Crossfire bracket.

What it does:

- Reads matches from a FACEIT championship or tournament.
- Creates one Discord category per FACEIT playoff round, such as `Upper Bracket - Round 1` or `Lower Bracket - Round 1`.
- Creates one private channel per match inside the matching round category.
- Names match channels from the teams, preserving group-letter prefixes only for old group-stage matches.
- Adds `🟡-` to a match channel name when it is scheduled and `🟢-` when FACEIT reports it finished.
- Gives channel access to exact configured team role IDs first, then falls back to Discord roles whose names match the FACEIT team names.
- Gives match channel access to the two teams, Tournament Ops, and Producer.
- Uses the built-in Crossfire team role ID registry, including aliases like `surge` -> `New Legends` and `Life's A Game` -> `LAG`.
- Optionally creates missing roster/team roles only when explicitly enabled.
- Assigns members to team roles from a Google Sheet CSV export.
- Removes stale team, participant, and captain roles when the Google Sheet changes.
- Gives users in `Team Captain Discord ID` the `Team Captain` role.
- Lets team members propose and confirm a scheduled match time in Discord.
- Lets Tournament Ops submit a schedule without waiting for team acceptance; an admin must still approve or deny it in the internal Discord.
- Calls a FACEIT schedule adapter when a write endpoint is available.
- Accepts SCL `demo_ready` webhooks and maintains one ordered Discord message per match with clean, hyperlinked 2D demo links for every ready map.

## What I Need From You

1. Discord bot token.
2. Discord application client ID.
3. Discord server ID.
4. FACEIT API key.
5. FACEIT championship or tournament ID.
6. Whether your FACEIT source is a `championship` or `tournament`.
7. Confirmation that Discord roles already exist with the exact team names, or permission for the bot to create missing roles.
8. The FACEIT write/schedule endpoint or docs, if your API account has one.
9. Optional Google Sheet CSV export URL with `Team Name`, starter/sub/coach Discord ID columns, and `Team Captain Discord ID`.
10. Optional SCL API key and SCL webhook secret if you want automatic 2D demo posts.

Do not paste secrets in public channels. Put them in `.env`.

## Setup

```bash
npm install
copy .env.example .env
npm start
```

## Railway Hosting

Use Railway when the bot should stay online even while your PC is off.

1. Push this folder to GitHub.
2. In Railway, create a new project from the GitHub repo.
3. Add the values from `.env` in Railway's **Variables** tab.
4. Railway should detect the Node app automatically and run `npm start`.

Do not commit `.env`. Keep real tokens/API keys only in Railway Variables.

After code changes, push to GitHub and Railway will redeploy:

```bash
git add .
git commit -m "Update bot"
git push
```

For text commands like `!schedule`, `!propose`, `!reschedule`, `!accept`, `!decline`, `!cancel`, `!admin`, and `!calladmin`, enable **Message Content Intent** in Discord Developer Portal > Bot.

For nickname updates, the bot needs **Manage Nicknames**, and its role must be above the players it is renaming.

For admin schedule alerts, set:

```env
ADMIN_SCHEDULE_CHANNEL_ID=1541647371405107232
CALL_ADMIN_CHANNEL_ID=1541647392447664158
ADMIN_ALERT_ROLE_IDS=1474118305169019163
DISCORD_COMMAND_GUILD_IDS=1128905368018354277,1473173377005912074
MATCH_ACCESS_ROLE_IDS=1128907825167482900,1353921199016644700
SCHEDULE_OVERRIDE_ROLE_IDS=1128907825167482900
MATCH_ACCESS_ROLE_NAMES=
```

When a team member runs `!accept`, the bot posts the admin schedule alert in `ADMIN_SCHEDULE_CHANNEL_ID` and pings `ADMIN_ALERT_ROLE_IDS`. `!admin` and `!calladmin` post in `CALL_ADMIN_CHANNEL_ID`. These channels can be in a private staff Discord server as long as the bot has joined that server. `DISCORD_COMMAND_GUILD_IDS` controls which Discord servers receive the `/cf` slash commands.

For SCL 2D demo posting, set these Railway variables after SCL issues them:

```env
SCL_API_KEY=your_scl_api_key
SCL_WEBHOOK_SECRET=your_scl_webhook_secret
SCL_WEBHOOK_PATH=/webhooks/scl
```

Give SCL this callback URL:

```text
https://your-railway-domain.up.railway.app/webhooks/scl
```

SCL sends `demo_ready` once per map. The bot verifies the SCL JWT, calls SCL for the FACEIT match, posts each ready `viewer_url` into the saved Discord match channel, and avoids reposting the same map link if SCL retries the webhook.

Optional round windows. Prefer `/cf season action:rounds` (see "Seasons and round dates"); this variable is only a fallback for rounds the current season does not list:

```env
ROUND_WINDOWS=Upper Bracket - Round 1=2026-09-12..2026-09-14;Lower Bracket - Round 1=2026-09-15..2026-09-17
```

Optional manually-created match channel mapping:

```env
MATCH_CHANNEL_IDS=Team A|Team B=channel_id;Other Team A|Other Team B=channel_id
```

Optional manually-created round category mapping:

```env
ROUND_CATEGORY_IDS=Upper Bracket - Round 1=1548120902154068039;Lower Bracket - Round 1=channel_category_id
```

## Invite Link

Use this link to invite the bot:

https://discord.com/oauth2/authorize?client_id=1523887433047867423&permissions=268561424&integration_type=0&scope=bot+applications.commands

Then run these in Discord:

- `/cf sync target:matches` creates/updates round categories and private match channels from FACEIT.
- `/cf sync target:matches round:Upper Bracket - Round 1` creates/updates only that playoff round window.
- `/cf sync target:teams` updates team roles, participant roles, captain roles, and nicknames from the Google Sheet.
- `/cf sync target:teams notify_captains:true` also DMs captains about missing players.
- `/cf audit target:matches` checks FACEIT match channels, team role mappings, and permissions without creating channels.
- `/cf audit target:matches fix:true` repairs channel names, stored match links, pinned messages, and permissions.
- `/cf audit target:players` shows which sheet players are missing from this Discord server, grouped by team.
- `/cf audit target:captains` shows which sheet team captains are missing from this Discord server.
- `/cf refresh` checks FACEIT and refreshes existing match channel names: finished matches get `🟢-`, scheduled matches get `🟡-`, and no channels or permissions are created.
- `/cf status` checks how many matches the bot knows about.
- `/cf commands` shows the admin command list inside Discord.
- `/cf create link:<FACEIT room link>` creates/updates one match chat from a FACEIT room link.
- `/cf sample` creates a fake match channel for testing permissions and scheduling.
- If `!schedule`, `!propose`, `!accept`, `!decline`, `!admin`, or `!calladmin` is used in an unlinked match room, the bot tries to recover the match from the channel topic/name and reports what it could not recognize.
- After roster changes or team-name changes in the Google Sheet, run `/cf sync target:teams`; the bot fetches the latest sheet and removes stale team roles it previously managed.

These slash commands are restricted to Discord admins, users with Manage Server, or configured match staff roles.

Inside each match channel:

- The pinned first message pings both team roles, shows the FACEIT room, the scheduling window, and the default round date at 8:00 PM EDT for playoffs.
- Playoff match messages use the FACEIT playoff bracket side and round, such as `Upper Bracket - Round 1` or `Lower Bracket - Round 1`.
- If FACEIT already has a scheduled time, the pinned message shows that below the FACEIT room link.
- The pinned first message explains the full schedule flow: one team member proposes with `!schedule`, a member from the other team confirms with `!accept`, then admins are alerted to schedule it on FACEIT.
- Scheduling is command-only in match rooms; the bot does not add a propose-time button.
- `!schedule November 2 8 PM ET`, `!schedule Tuesday 3 PM ET`, or `!schedule November 2 9 PM ET` proposes a match time, detects the timezone, and pings the other team to confirm.
- `!propose November 2 8:00 PM ET` also proposes a match time.
- `!reschedule November 2 9:00 PM ET` requests a reschedule.
- `!accept` lets a member from the other team accept it.
- `!decline` lets a member from the other team decline it.
- `!cancel` lets the original proposer withdraw an open proposal before acceptance; authorized staff can also cancel it.
- Users with a role in `SCHEDULE_OVERRIDE_ROLE_IDS` can run `!schedule` without both teams accepting, but the request still requires admin approval.
- `!admin reason here` or `!calladmin reason here` alerts admins with the match channel and FACEIT link.
- Old schedule buttons are disabled. Scheduling is command-only inside match rooms.

The active FACEIT source is the Season 7 Group Stage championship. Before FACEIT publishes matches, `/cf sync target:matches` safely reports that there is nothing to create. Once matches exist, it detects group letters and round numbers from FACEIT and creates categories such as `Group Stage - Round 1` in bracket order.

Run `/cf sync target:teams` before syncing match rooms so the new Season 7 role mappings exist. The Season 7 mapping scope does not reuse hard-coded Season 6 channel or category IDs.

Match sync checks every selected FACEIT team role before creating channels. If a mapping is missing, it creates no channels and reports the unresolved team names so a round cannot be left half-created.

Round windows and default match times come from the current season (below). Season 7 Group Stage round windows are November 2-4, November 5-7, and November 8-11, with defaults on November 3, 6, and 9 at 8:00 PM ET. Teams in any Group Stage round may mutually schedule anywhere inside the extended November 2-11 Group Stage window.

### Seasons and round dates

Staff manage seasons with `/cf season`. Each season has a name, a start date, an optional end date, and its rounds. All dates are Eastern time.

- `action:list` shows every season and the current season's rounds.
- `action:start name:"Season 8" start:1/10/2027 end:3/15/2027` adds a season. A running season with no end date is closed the day before the new one starts. Seasons may not overlap or share a name.
- `action:rounds` opens a form with the season's rounds, one per line, already filled in:

  ```
  Group Stage | 11/2 - 11/11 | 11/6
  Round 1 | 11/2 - 11/4 | 11/3 8:00 PM
  Upper Bracket - Round 1 | 12/1 - 12/3 | 12/2 8:00 PM
  Grand Final (BO5) | 1/8 - 1/10 | 1/9 8:00 PM
  ```

  The columns are the round name, its scheduling window, and an optional default match date and time. A date without a year that would land far in the past is read as next year. Nothing is saved if any line has an error; the reply lists the problems and echoes what was typed so it can be copied back. FACEIT's alternative names (`WB Round of 32`, `Losers Final`, `Grand Final`) match the same round. A `Playoff Stage` row covers any playoff round that is not listed.
- `action:edit` renames a season or changes its dates (`end:none` removes the end date). `action:end` sets the end date to today, or to `end:`. `action:delete season:<name>` removes a season.
- `season:` picks the season to change; it defaults to the current one.

The current season is the one running today, or the next to start when none is running. Finished seasons are never current. `!schedule` checks use new round dates right away. Run `/cf sync target:matches` to rewrite the pinned intro in existing match rooms. `ROUND_WINDOWS` still works as a fallback for rounds the season does not list.

The first time this version starts with no saved seasons, it copies the Season 7 Group Stage dates above into the data store, so nothing changes until staff edit them. Season 7 playoff rounds have no dates until staff add them. Every season change is written to the audit log.

Reschedule rules:

- Schedules and reschedules must stay inside the configured scheduling window.
- Reschedules within 24 hours of the current match time are flagged for admin override.
- Accepted schedules and reschedules are sent to admins to schedule manually on FACEIT.
- When admins approve a schedule request in the staff channel, the bot reacts to that admin alert with a checkmark.
- Playoff teams may schedule or reschedule during their assigned three-day round window by mutual agreement.

### Google Sheet schedule log

Every confirmed schedule is written to the `Game Schedules` tab of the "CF Game and Staff Schedule" spreadsheet: DATE & TIME, TEAM 1, VS, TEAM 2, MATCH (the FACEIT link), ROUND, GROUP in columns A to G, then the staff columns (STREAM, Stats Collected? and checkboxes). DATE & TIME is one real date-time value in Eastern time, shown as `Thu, Nov 12 · 9:30 PM ET`, so the tab sorts by it directly; staff adding a row by hand can type e.g. `11/12/2026 9:30 PM` there. The bot fills the first seven columns; of the staff columns it only writes `STREAM`, `Stats Collected?` and a `Result` column. One row per match, matched on the FACEIT room ID behind the MATCH column: a reschedule updates the existing row. After every write the tab is sorted by column A. A tab still on the old layout (separate Date and TIME columns) is converted once by running `combineDateAndTime` in the Apps Script editor, which first copies the tab to a hidden backup; until then the web app refuses to write to it. Rows are written when staff approve a schedule or reschedule in the staff channel, and when Tournament Ops sets a time directly with `!schedule`. A proposed time the bot can't read (no date, or no time) is turned back to the team with an example instead of being sent on; the reader handles zones written against the time (`8:30est`, `8:30pmest`), `p.m.`, `8p`, ordinals and misspelled months and days (`Novemeber`, `Thrusday`, `tmrw`). Tournament Ops can still send an unreadable time with `--force reason`. Every 30 minutes until the match, approved schedules are also checked against FACEIT: an approved time the bot couldn't read takes FACEIT's time once it is set (and the sheet row is rewritten, so results and crew stats work too); a sheet write that failed is retried; and if FACEIT shows a different time, or still no time within 24 hours of the match, staff are alerted once in the admin schedule channel. Audit events: `schedule_time_from_faceit`, `schedule_faceit_mismatch`, `schedule_faceit_missing`.

When a community caster's stream request is approved (and the website publish succeeds), the bot appends the caster's stream to the `STREAM` cell of that match's row, one per line, skipping links already there. The column is found by its header text (`STREAM`, or the older `Stream Link/s`), so it can be moved. Stream links must be channel pages: the bot turns away search, directory, category and single-video links when the request is made, saves them in one clean form (`https://twitch.tv/<channel>`, `https://kick.com/<channel>`, `https://www.youtube.com/@<handle>`), and re-checks older pending requests when staff press Approve. Casters can only request confirmed matches, so the row is expected to exist; if it does not, or the request's FACEIT link could not be parsed, the sheet is left alone and the approver is told to add the link by hand. When a caster withdraws or staff revoke an approval, that one link is removed from the cell again and any other links there are kept.

### Telling the teams they are being covered

At the same moment an approval goes through, the bot posts a "This match will be covered by a community caster" embed in the match channel the two teams share: caster tag (plain text, no mention), stream link and platform, match and time, and the FACEIT room. The channel is found from the request's FACEIT match id, falling back to a team-name lookup of stored matches and then of guild channels. Manual approvals have no match id and unprovisioned matches have no channel; in both cases the teams are not told and the approver's reply says so. The notice is posted once per request (its message id is stored on the request as `coverageMessageId`), so the **Retry website publish** button does not repeat it. When the caster withdraws, staff revoke the approval, or FACEIT cancels the match, the original embed is edited to a grey "Community coverage cancelled" state and a one-line follow-up is posted saying whether another approved caster still has the match. A finished match needs no message. Audit events: `stream_coverage_posted` and `stream_coverage_cancelled`.

### "Live now" board

Set `LIVE_NOW_CHANNEL_ID` to a channel (for example `#live-now`) that should only ever contain currently-live community broadcasts. When it is set, the approval DM carries a **🔴 Going live** button next to **Withdraw from this cast**. Pressing it posts one plain embed to the board (caster tag, stream link and platform, match and time, started-at as a relative timestamp, FACEIT room) with no mentions of any kind, and swaps the button to **⏹️ End broadcast**, which deletes the message again. Only the caster of an `approved` request can press either. Going live twice edits the existing message rather than posting another, and a FACEIT reschedule edits it in place. The message is also removed when the caster withdraws, staff cancel or revoke, or FACEIT cancels the match, and as a stale guard the bot ends any broadcast still marked live three hours after its FACEIT match finished. On startup the bot re-syncs the board: live requests whose message is missing are re-posted, and any other message of the bot's in that channel is deleted. Audit events: `stream_live_started` and `stream_live_ended` (with `reason`). Platform detection (Twitch EventSub / YouTube) can later call the same start/end functions keyed on the request's stream URL.

### Post-cast stats form gate

After a cast's match finishes on FACEIT, the caster is DMed the post-cast stats form with the form's required **Request ID** question pre-filled from `POST_CAST_FORM_PREFILL_URL`. The next time that caster tries to open the stream request form, the bot checks whether their most recent finished cast has a response: it asks the Apps Script (`postCastForms` action), which reads the form's response tab (`Season 7` in the "CF Streams & Streamers" spreadsheet) and matches on the Request ID column. No response means the request form does not open; the caster gets the pre-filled link and is told to try again afterwards. A found response is remembered on the request, so the lookup happens at most once per cast. If FACEIT never reports a result (or the link could not be tracked), an approved cast still gets the form 12 hours after its match time; casts before `POST_CAST_FORM_GATE_SINCE` are left alone.

Only the most recent finished cast is checked, casts that finished before `POST_CAST_FORM_GATE_SINCE` are exempt, and `POST_CAST_FORM_GATE=false` turns the block off. If the sheet lookup fails or the sheet is in log-only mode the caster is let through and the staff request card shows a "could not verify" note instead. Staff can clear a caster who filled the form without the request ID from `/cf forms` (pick the caster, then **Mark a form received**); approved request cards show the form as received, outstanding, or marked received by staff.

### Upcoming Matches (`/request open` and the daily post)

`/request open` shows every confirmed upcoming match in date and time order. Only the caster sees the reply, and it follows the same channel rule as `/request stream`. A match is listed when it has an approved match time in the future and is not finished or canceled.

- **🔥 Tonight** (highlighted, orange): today's matches (Eastern date).
- **📅 Coming up**: everything after today, under a heading per day (for example **Friday, November 6**).
- Each line shows the time (in the viewer's local time), matchup, coverage and Matchroom link. Coverage tags: **❗ needs a caster**, **🎙️ N casters** approved, **⏳ N pending** review, **📺 main stream**. A match the caster already requested or is approved for says so.
- One button per match casters can request (up to 25, soonest first; main stream matches get none). It opens the normal request form with the FACEIT link filled in, and the post-cast form block still applies. Blue buttons are matches nobody is on yet; grey ones would be a co-cast. Tonight's buttons have a 🔥.
- Very long lists are cut to fit one message and say how many more there are.

**Daily post.** Every day at `OPEN_MATCHES_POST_TIME` (default 17:00 Eastern) the bot posts the same list, headed **Upcoming Matches**, in `OPEN_MATCHES_CHANNEL_ID` (default: the community casters channel) and pings `COMMUNITY_CASTER_ROLE_ID` (default: the Community Caster role). The post is just the list, with no buttons; casters use `/request open` to request a match. It posts once per day, even across restarts; if the bot is down from 5 PM until 7 PM Eastern, that day is skipped instead of posting late. On a day with no confirmed upcoming matches nothing is posted and nobody is pinged. Staff can post it any time with `/cf upcoming`: the reply (only they see it) has **Post & ping Community Casters** and **Post without ping** buttons. It posts in the same channel and does not replace the 5 PM post. The bot needs permission to mention the role (or the role must be set to mentionable).

### My casts (`/request mine`)

`/request mine` shows a caster their own casts. Only they see the reply, and it works in any channel.

- **Upcoming** approved casts, soonest first, with the match time, a Matchroom link, and whether the connection details were sent (or failed because their DMs were closed).
- **Past casts**, the 10 most recent, each marked ✅ form received, ☑️ marked received by staff, ❌ form missing, or ▫️ no form needed (finished before the form DM existed). Each missing form gets a button that opens the form with the request ID already filled in.

The reply starts with the caster's stats for the season running today (all time between seasons): casts finished, and the share of post-cast forms received. Only casts that got the form DM count toward that rate, and forms staff marked received count as in. A **Share my stats** button posts a public card in that channel with the season, cast count, form rate and the matches covered. It never shows upcoming games, connection status or links, and only the caster can press it.

Before it answers, the bot checks the form sheet for any missing forms in the list (the same `postCastForms` lookup the form gate uses), so a form sent since the last check shows as received. If the sheet cannot be reached, the reply says so. FACEIT-canceled matches are not listed, and a cast whose match time passed more than six hours ago counts as past even if FACEIT never reported a result.

### Post-cast forms (`/cf forms`)

`/cf forms` shows staff the totals (submitted and missing) and one line per caster who owes forms, with how many are missing and their form rate. It covers casts whose form DM went out on or after `POST_CAST_FORM_GATE_SINCE`. The bot checks the form sheet for the missing ones first, so a form that just came in shows as submitted.

- **Pick a caster** (menu): opens that caster's view in the same message: their form rate, every missing form with its date and request ID, and their latest submitted forms. Casters who owe forms are listed first.
  - **Nudge** DMs them one message listing every form they still owe, each with its own pre-filled link. Staff can nudge the same caster once an hour; the button is greyed out until then.
  - **Mark a form received** (menu, only their missing casts) is for a form that came in without its request ID.
  - **Back** returns to the main view.
- **Nudge all** nudges every caster who owes forms in one press, skipping anyone staff nudged in the last hour, and reports who could not be DMed.

A staff nudge also counts as the automatic 48-hour nudge. Form DMs, forms found on the sheet and nudges are all recorded in `/cf auditlog`.

### Caster reminders

- **30 minutes before game time** every approved caster gets a DM with the match time, Matchroom link, whether the connection details were sent, any co-casters, and the **Going live** button when the live board is on. It goes once per scheduled time, so a reschedule sends a fresh one. Casters approved inside those 30 minutes are skipped because they just got the approval DM. If the bot was down at the 30-minute mark, it still sends the reminder as long as the match has not started.
- **48 hours after the post-cast form DM**, if the form is still missing, the caster gets one more DM with the pre-filled form link. The bot asks the form sheet first. A form found there is recorded and no nudge goes out. If the sheet cannot be reached, nobody is nudged and the check is retried an hour later. Casts whose form DM went out before `POST_CAST_FORM_GATE_SINCE` are never nudged.

Both reminders are recorded on the request and in the audit log, including whether the DM was delivered.

### Casters pulling out

A caster can leave a request at any time with the **Cancel Request** button on their submission confirmation, with `/request cancel` (which autocompletes their own active requests), or, once approved, with the **Withdraw from this cast** button on the approval DM and the public approval post. A pending request is simply canceled. Withdrawing from an approved cast asks for an optional reason, then: the request becomes `withdrawn`, the website is told to delist the stream, the link is removed from the Google Sheet, the community channel is told the cast is off (and whether other approved casters remain), and the staff review channel is pinged with the match, time and reason. If the match is under 24 hours away the staff ping is marked as a late withdrawal. The event is audit logged as `stream_request_withdrawn`.

Setup:

1. Open the target spreadsheet, go to Extensions > Apps Script, and paste `docs/schedule-log-apps-script.gs`. Set `SHARED_SECRET` to a long random string. If the script is a standalone project instead, also set `SPREADSHEET_ID` to the ID from the spreadsheet URL.
2. Deploy > New deployment > Web app, Execute as **Me**, Who has access **Anyone**. Copy the `/exec` URL. Opening it in a browser should show `ok`.
3. Set `SCHEDULE_SHEET_WEBHOOK_URL` to that URL and `SCHEDULE_SHEET_SECRET` to the same secret.

Without `SCHEDULE_SHEET_WEBHOOK_URL` the bot runs in log-only mode. Sheet requests allow 45 seconds by default because Apps Script may wait for its document lock and sort the schedule tab. A failed sheet write never blocks the Discord approval; the approving staff member sees a warning and the failure is audit logged as `schedule_sheet_failed` (schedules) or `stream_link_sheet_failed` (stream links). Edits to the script need a new deployment version before the live URL picks them up.

## Persistent operations workflows

The JSON database is migrated in place. Set `BOT_DATA_PATH=/data/bot-data.json` when the Railway service has a volume mounted at `/data`; otherwise Railway filesystem replacement can remove bot state during deployment.

Set `AUTHORIZED_STAFF_ROLE_IDS` to the exact staff role IDs from every server where staff buttons or `/cf` are used. Administrator/Manage Server permissions are also accepted; role names are never trusted. `SCHEDULE_OVERRIDE_ROLE_IDS` separately lists Tournament Operations roles that may schedule directly.

Team identities are scoped by Discord guild plus `TEAM_MAPPING_SEASON_ID`. Sheet sync prefers `FACEIT Team ID` or a UUID found in `FACEIT Team URL`, then falls back to an exact normalized team name. Similar names are never merged automatically.

For a season rollover, assign a brand-new `TEAM_MAPPING_SEASON_ID`, set `CREATE_MISSING_TEAM_ROLES=true`, and set `CREATE_NEW_SEASON_TEAM_ROLES=true`. The first sync creates fresh team roles even when old roles have the same names; later syncs reuse only the mappings saved in that season scope. Old-season roles are not deleted.

- `/cf sync target:teams dry_run:true` previews roster changes without changing Discord.
- `/cf mappings action:list` lists persistent team-role mappings.
- `/cf mappings action:inspect team:<name-or-id>` inspects one mapping.
- `/cf mappings action:link team:<name> faceit_team_id:<uuid> role:<role>` links or corrects a mapping while preserving aliases.
- `/cf mappings action:repair` reapplies mapped roles and private permissions to linked match rooms.

Authorized staff can submit a schedule inside a match room without team confirmation. Normal scheduling is `!schedule November 3 8 PM ET`. To bypass the configured window, a reason is mandatory: `!schedule November 11 9 PM ET --force production conflict`. Every staff submission is sent to the internal Discord with **Admin approve** and **Admin deny** buttons; the channel is marked yellow and Google Sheets is updated only after approval.

Veto setup requires the playoff championship ID in `PLAYOFF_SOURCE_IDS`, exactly seven maps in `VETO_MAP_POOL`, and actual tournament seeds in `VETO_SEEDS`. The FACEIT Open API match payload does not provide a verified tournament seed, so the bot never substitutes Elo, standings, or bracket position. `/cf veto action:seeds` stores a persistent per-match override; for the Grand Final, also set `advantage_team` to the actual upper-bracket winner (or configure `VETO_ADVANTAGE_TEAM`). `/cf veto action:start|inspect|reset|cancel` manages a linked playoff room. BO3 uses ban, ban, pick, pick, ban, ban, decider. Grand Final uses two bans and four picks; the remaining map is awarded to the explicitly configured upper-bracket winner for a 1-0 start and is not played. Veto output is Discord-only and must be entered into FACEIT by staff.

Streamers use `/request stream`. Typing the old `!request` gets a reply pointing to `/request stream`. Requests require only a FACEIT matchroom link, a Twitch/YouTube/Kick channel URL, and an X/Twitter profile URL. Any number of casters may be approved for the same match. The bot reads the matchup and schedule from FACEIT, prevents duplicate active requests from the same caster, and gives the requester a one-click cancel button. Valid FACEIT links are grouped by match ID and checked every `STREAM_SCHEDULE_CHECK_MINUTES` (15-30 minutes); newly posted schedules, reschedules, removed schedules, cancellations, and completion update every active request. A schedule change is sent only to the casters who requested that match (pending or approved), by DM or, if their DMs are closed, in the channel they requested from. Tournament Ops are not pinged; the staff card is edited in place to show the new time. Invalid links remain reviewable but are clearly marked as ineligible for grouping, automatic schedule monitoring, and connection delivery. `STREAM_REQUEST_CHANNEL_ID` receives race-safe Approve/Deny controls, and FACEIT is refreshed immediately before approval.

At the scheduled time, staff receive one prompt per FACEIT match to submit either the CSTV connect command or official CROSSFIRE Twitch link. The value is DMed only to approved casters and is never posted to their source channel. `STREAM_STAFF_GUILD_ID` and `STREAM_STAFF_ROLE_IDS` explicitly authorize the internal Tournament Operations role to approve requests and deliver connection details. Staff can use `!sendip FACEIT_MATCHROOM_LINK MESSAGE` to immediately DM any connection details or instructions, or `!sendip FACEIT_MATCHROOM_LINK` alone to repost the IP prompt. The bot deletes a valid `!sendip` command message when it has permission so its contents are not left in the channel. Verified FACEIT completion sends the configured post-cast form once; delivery state is persisted.

Operations reporting:

- `/crossfire upcoming`, `/crossfire team`, `/crossfire rounds`, `/crossfire veto`, `/crossfire help` expose only information visible to the requesting user.
- `/cf status` summarizes pending schedules, tickets, stream requests, mappings, and vetoes for staff.
- `/cf auditlog` shows recent persistent scheduling and operations events.
- Roster changes should go to `#make-a-ticket`.
- Set `ROSTER_TICKET_CHANNEL_ID=1418725495545004175` so pinned match messages link directly to the roster ticket channel.

## Community caster streams and website publishing

Casters request to stream a match from the community server, staff approve or deny from the staff channel, approved streams are pushed to the Crossfire website, and decisions are posted back where the request came from.

Flow:

| Step | What happens |
|---|---|
| Caster runs `/request stream` | Modal with a FACEIT matchroom link, a stream channel URL (Twitch, YouTube or Kick), and an X/Twitter profile URL. Matchup and schedule are read from FACEIT. Every validation error is listed at once. If `STREAM_COMMUNITY_CHANNEL_IDS` is set, requests only work in those channels. |
| Duplicate check | The same caster cannot have two active requests for the same FACEIT match. Different casters may each request the same match. |
| Posted to `STREAM_REQUEST_CHANNEL_ID` | Request saved as `pending` and posted with **Approve** / **Deny** buttons. If the staff channel is unreachable, the request is kept and re-posted automatically on the next tick or restart. |
| **Approve** | FACEIT is re-checked (finished or canceled matches cannot be approved), then the request moves atomically `pending -> approving`; a second staff member gets "already decided by @X". The website publish runs with retries. Success -> `approved`: card turns green, the caster is DMed, and an approval embed is posted in the originating channel tagging the caster. Failure -> `publish_failed`: card turns red with the error and a **Retry website publish** button, staff are pinged, and the caster is **not** told until it succeeds. |
| **Deny** | Modal requiring a 5-400 character reason. A denial embed with the reason is posted in the originating channel tagging the caster (DM fallback). |
| Schedule monitoring | FACEIT is polled every `STREAM_SCHEDULE_CHECK_MINUTES`. Schedule changes edit the staff card in place without pinging staff, notify only the casters who requested the match, and re-publish already-published streams to the website. Cancels, revokes and completed matches are also sent to the website as status updates. |
| Restart | Buttons keep working. Anything stuck in `approving` becomes `publish_failed` with a retry button and a staff alert. The bot audits that it can see and post in the stream channels and reports problems to staff. |

### Who gets the connection details

Every caster approved for the match gets their own DM, one per caster. That includes casters whose FACEIT link could not be verified when they submitted (matched on the room in their link) and casters whose website publish is still failing. A caster approved after the IP was already entered is DMed the saved details at approval, and the approver is told. When a DM fails (DMs closed or the bot blocked), staff are told which caster by name so it can be sent another way.

### #request-ip (`REQUEST_IP_CHANNEL_ID`)

When `REQUEST_IP_CHANNEL_ID` is set, that channel is the one place for match IPs. The **Caster Connection Needed** and **Main Stream Connection Needed** prompts are posted there instead of `STREAM_REQUEST_CHANNEL_ID`, and every CSTV connect or IP staff enter for any match (prompt or `!sendip`) is posted there in a copyable line, tagged with who entered it, whether the main stream is covering the match, and how many approved casters it was DMed to. Entering new details for a match posts them again. The official Twitch link is never posted. Audit event: `request_ip_posted` (the value itself is never logged). Because the prompt buttons check the Tournament Ops role in `STREAM_STAFF_GUILD_ID`, the channel should live in that server; admins can press them anywhere.

### Main stream (`/cf mainstream`)

When the official CROSSFIRE broadcast covers a match, stream staff run `/cf mainstream match:<FACEIT link>` (or leave out `match:` inside the match channel). Typing the old `!request mainstream` gets a pointer to the slash command.

| Option | What it does |
|---|---|
| `match` | FACEIT matchroom link. Optional inside the match channel. |
| `stream` | Which CROSSFIRE stream (autocomplete from `MAIN_STREAM_URLS`; default the first). |
| `caster1`, `producer` | Needed before the crew is posted in the Schedule channel. |
| `caster2`, `observer`, `admin`, `social` | Optional crew. |
| `remove` | `True` takes the match off the main stream. |

Running it again for a match that is already on the main stream updates it: only the options given change, so `/cf mainstream match:<link> producer:@someone` swaps just the producer, and `stream:` moves it to another channel. The reply (only staff see it) also has the stream dropdown and the **Add/Edit production crew** button.

`remove:True` undoes everything for that match: the teams' notice is changed to "🚫 No longer on the main stream" (saying whether community casters still have it) with a short follow-up, the Schedule post is deleted (or marked **CANCELLED** if the bot can't delete it) and the crew is pinged in the Schedule channel, a cancellation note goes in #request-ip, the stream link comes off the Google Sheet and the row turns orange (community casters left) or is cleared, and the match shows normally again in Upcoming Matches. Audit event: `main_stream_removed`.

For the IP: the bot cannot read server IPs from FACEIT, so it forwards what staff enter: if the CSTV connect or IP has already been entered for that match (connection prompt or `!sendip`), it is posted to `REQUEST_IP_CHANNEL_ID` straight away; otherwise it is posted there the moment it is entered. **CSTV password:** set it once per season with `/cf season action:set CSTV password password:<pw>` (`password:none` removes it; `/cf season action:list` shows whether one is set, never the value). The Submit CSTV Connect form then asks only for the server `IP:PORT` (`connect IP:PORT;` also works) and has a password box prefilled `Yes`; the bot sends `connect IP:PORT; password "<pw>"`. Type `No` to leave the password off for that match. `!sendip LINK IP:PORT` does the same; add `nopw` at the end to leave it off. A full line typed by hand, or instructions, are sent as typed. The password is never written to the audit log.

A match with no approved community casters gets a **Main Stream Connection Needed** prompt at match time (the same time the caster prompt goes out), once, using the same Submit CSTV Connect modal; it is skipped if the details were already entered. `!sendip` still sends them sooner. Entering new details later posts them again. The official Twitch link delivery type is never posted there. Keep `#request-ip` private to the production crew; the post contains the connect command. Audit events: `main_stream_requested` and `request_ip_posted` (the connection value is never logged).

It also tells the two teams in their match channel, once per match: a red "📺 This match will be on the main stream!" embed saying the match **will be casted live by** the official stream (the picked stream's channel name), with the approved match time, a Watch link and the FACEIT Matchroom. Running the command again does not repost it. If no match channel is found, the staff reply says so. Audit event: `main_stream_coverage_posted`.

**Production crew.** Set the crew with the command options above, or with the reply's buttons. The reply has a **Which stream?** dropdown and an **Add production crew** button (stream staff only). The dropdown lists `MAIN_STREAM_URLS` (default `playcrossfire`, `playcrossfirecs`, `playcrossfirecs2`; the first is preselected). Changing it later updates the schedule post and the teams' notice if they are already up. The button opens a form with user pickers: **Casters** (one or two: Caster 1 and Caster 2, required), **Producer** (required), **Observer**, **Admin** and **Social Media**. Once Caster 1 and Producer are set, the match is posted in `PRODUCTION_SCHEDULE_CHANNEL_ID` (default: the Schedule channel) in the usual format, pinging the crew:

```
Thursday, November 5, 2026
9:30 PM

Celestial Esports    VS    FUELED BY HATE

https://www.faceit.com/en/cs2/room/...

Casters: @Caster1 & @Caster2

Prod: @Producer
Obs: @Observer

Streams: https://twitch.tv/playcrossfire
```

The date and time are the approved match time as Discord timestamps, so everyone sees them in their own time zone ("Date and time TBD" if there is none). Roles left empty are left out. `Streams` is the stream picked in the dropdown. Press the button again (it then reads **Edit production crew**) to change the crew: the form opens with the current picks and the existing post is edited, not reposted. When the connection details are posted in #request-ip for a main stream match, the post pings the crew. If the IP was posted before the crew was set, saving the crew sends a short ping in #request-ip linking the IP post; on later edits only newly added people are pinged. Everyone on the crew also gets a DM when the match is first posted: the match, their role(s), the time in their local time, the stream, the FACEIT room and a link to the Schedule post. People added later by an edit get the same DM; people already DMed for that match are not DMed again. Someone taken off the crew by an edit (or replaced, e.g. `producer:@someone-else`) gets a DM saying so, if they had been told they were on it; adding them back later sends a fresh DM. If someone's DMs are closed, the staff reply says so. Audit events: `main_stream_crew_set`, `main_stream_crew_dmed`, `main_stream_crew_removed_dmed`.

#### Social info (Social Media team)

Facts for the Social Media team to write their own posts, in `SOCIAL_CHANNEL_ID`, with no pings:

- **Daily at `SOCIAL_POST_TIME` (4 PM ET): "Tonight on stream".** Main stream games with time, both teams (with their X handles), the stream and the production crew (casters, producer, observer), then every community-cast game tonight with its caster channels (co-casts together). Posted once something is on stream that day; edited when a crew, cast or time changes.
- **`SOCIAL_CARD_LEAD_MINUTES` (2 hours) before each main stream match: "Social info".** Time in ET and CT, stream, crew, round, team tags ("none on file" when missing), storylines and players to watch from the prep pack, and maps (filled in when they lock). A "🔴 LIVE NOW" line is added at the start, and the final result with map scores and the match's top player (most kills) when FACEIT finishes it.
- **Mondays at the same time:** "This week on stream" (every main stream and community-cast game this week, by day) and "Last week on stream" (last Monday-Sunday's streamed results and the top performer by K/D, at least 2 maps).

Team X handles come from an **X** column on the Team Info tab (a handle like `@team` or an x.com link); `/crossfire teamnotes team: x:` sets it. They are left out of the prep pack notes and links.

#### Caster prep packs

Every main stream match gets a prep pack in `PREP_CHANNEL_ID` (default the match stats channel) `PREP_LEAD_MINUTES` (45) before the start, mentioning its casters. Until 2 hours after the start the bot checks the lineups and maps every minute and, when one changes, edits the post with an "Updated: maps are in / a lineup changed" line. The Maps section is just the picks and bans: during a bot-run (playoff) veto it lists each ban and pick as it happens; once the maps lock, a **Map facts** reply goes under the post (per map: each team's record, last result and best current player on it, and head-to-head on it), pinging the casters, producer and observer. If there are still no maps 10 minutes before the start, a reply pings the producer. `/cf prep match:<link>` builds one for any match on demand.

A pack has a match card (time, round and group, what's at stake, maps with each team's record on them and the bans when the bot ran the veto, head-to-head this season, talking points such as unbeaten runs, streaks, maps never lost, stand-ins, a hot player, first meeting or rematch, and links) and a card per team (roster with 👑 captain and stand-ins; Record: match and map record, streak, group standing, round differential (rounds won minus lost), overtimes and the closest map; the season's results (newest first, up to 8) with map scores; Map pool, most played first; top players by K/D with kills, deaths, ADR and HS%; FACEIT, HLTV and Liquipedia links). A team's pronunciation and notes from the Team Info tab are posted as their own reply under the pack, only when the team has some. Season data comes from the FACEIT championship matches (cached 10 minutes) and each finished match's stats, stored once and filled in the background a few per minute. Team links and notes come from the **Team Info** tab (Name, HLTV, Liquipedia, plus Pronunciation and Notes added by `/crossfire teamnotes`; names match FACEIT loosely, e.g. "Celestial" = "Celestial Esports"), read every 30 minutes.

#### Crew availability (staff schedule sheet)

The bot reads the **PROD SCHEDULE** and **Admin Schedule** tabs of the "CF Game and Staff Schedule" spreadsheet through the same Apps Script web app (`availability` action), every `CREW_AVAILABILITY_SYNC_MINUTES` (default 10). Nothing about the tabs has to change:

- **Layout:** a header row with dates across the top (`Monday 11/09/2026`) and names down the column to its left. Several week blocks per tab are fine.
- **Day colours** are matched to the legend on the tab itself (Can Work = free, Could Work = maybe, Cant Work = busy, Free for partial a day = use the text), so a colour change in the legend just works; slightly different shades still match. With no legend, any green is free, yellow maybe, red busy.
- **Day text** refines it: `8:00PM START` (latest start), `After 7 EST`, `8-10pm`, `7-8 EST//After 9:30EST`, `9pm-12am`. Busy words (`Team Prac`, `LAN`, `busy`) with times mean busy then; without times, busy all day. CST/MST/PST are converted. A blank, uncoloured cell is "not filled in".
- **Roles** come from the name cell's colour and the role legend (PRODUCER ONLY, PLAY BY PLAY / COLOR = caster, OBSERVER ONLY, Match Admin, SMM Admin = social, Match & SMM Admin). No role colour = any production role on PROD SCHEDULE, Admin on an admin tab.
- **Discord accounts:** names are matched to members by username, display name or nickname. `/cf crewlink` lists anyone it couldn't match and links them by hand.
- A match is assumed to run `CREW_MATCH_LENGTH_MINUTES` (default 180), so "free 8-10pm" is only partly free for a 9:30 match. Someone already on another main stream crew within that time counts as busy.

What it drives:

- **Crew form:** each dropdown lists only people free for that match who can do the role, free first, then partly free and maybe, each with how many main stream matches they've worked this week (fewest first). Current picks always appear. A role with nobody free falls back to the normal user picker.
- **`/cf mainstream` crew options** suggest the same list as you type (typing a name searches everyone). Picking someone not marked free, or already on another crew then, works but adds a warning to the reply.
- **`/cf whosfree when:<Thurs 9:30pm | 11/12 9pm | today 9pm | FACEIT link>`** shows who is free, partly free or maybe for every role at that time. `length:` overrides the match length. A day with no time (`today`, `tomorrow`, `Thurs`, `11/12`, `Nov 12`; empty = today) shows everyone's whole day instead: all day, part of the day (`8 PM–10 PM`, `after 7 PM`, `latest start 8 PM`), maybe and not filled in, plus who is already booked on a main stream crew that day.
- **"Can't make it" button** on every crew DM: after a confirm, the person is taken off the crew, the Schedule post is edited, and staff get an alert listing who is free to replace them.
- **Availability changed after booking:** if a booked crew member's day turns busy on the sheet, staff get an alert (once per change) with replacements. They stay on the crew until staff change it.
- **Sunday reminder** at `CREW_REMINDER_TIME` (default 18:00 ET): everyone who hasn't filled in any day of next week gets a DM with the sheet link (`AVAILABILITY_SHEET_URL`). If next week isn't on a tab yet, nobody on that tab is nagged and the summary says so.

Alerts go to `CREW_ALERTS_CHANNEL_ID`, pinging whoever set the crew; without it they are DMed to that person. `CREW_AVAILABILITY=off` turns all of this off. Audit events: `main_stream_crew_dropped`, `main_stream_crew_availability_changed`, `crew_availability_reminders_sent`, `crew_name_linked`.

**Google Sheet.** `/cf mainstream` adds the picked stream's Twitch link to the match's `STREAM` cell (picking a different stream in the dropdown swaps it). The bot also tells the sheet how to colour the match row (columns A–N): cornflower blue for a CROSSFIRE main stream game, orange for a community cast, and the colour is cleared when the last caster drops off. Main stream wins when a match has both. Row colours need the updated `docs/schedule-log-apps-script.gs` deployed (Deploy > Manage deployments > Edit > New version); an older script still adds the links but leaves the colours alone.

**Results and Stats Collected.** Every 10 minutes the bot also:
- writes the result of finished matches into a **Result** column (found by header, created after the last column if missing), e.g. `Celestial Esports won 13-7 (Mirage)` or `Celestial Esports won 2-1 (Mirage 13-7, Inferno 10-13, Nuke 13-11)`. It checks scheduled matches from 45 minutes after their start time, going back 14 days, a few at a time. Canceled matches get no result.
- ticks **Stats Collected?** on the match row once a caster's post-cast form for that match is in (or staff marked it received). A checkbox cell gets checked; otherwise ✅ is written. Only casts since `POST_CAST_FORM_GATE_SINCE` count.

The MATCH column (FACEIT link) shows the word **Link**, hyperlinked to the match page (rows are still found by the link behind it), and each stream in `STREAM` shows as its channel name (e.g. `playcrossfire`), hyperlinked to the stream, one per line. Notes staff type in that cell are kept. To convert rows already on the sheet, run `convertLinksToLabels` once from the Apps Script editor.

Each is written once per match. Both need the updated Apps Script; with an older script the bot retries every 6 hours. Audit events: `sheet_result_written`, `sheet_stats_collected`.

Staff management (admins and the stream staff role):

| Command | What it does |
|---|---|
| `/cf streams action:list` | Every active request: waiting for review, approved, and approved casts the website did not accept (each with a **Retry** button). |
| `/cf streams action:inspect request_id:` | Everything about one request. |
| `/cf streams action:cancel` | Cancels pending or approved requests by `request_id:`, `match:` (FACEIT link) or `caster:`, with an optional `reason:` sent to each caster. |
| `/cf upcoming` | Post the Upcoming Matches list now, with a choice of **Post & ping Community Casters** or **Post without ping**. |
| `/cf forms` | Who owes post-cast forms. Pick a caster to see their casts, **Nudge** them or **Mark a form received**; **Nudge all** nudges everyone who owes. |
| `!sendip FACEIT_LINK MESSAGE` | DMs connection details to every approved caster now. Without a message it reposts the IP prompt. |
| `/cf mainstream match:<link>` | Puts a match on the official stream (teams told, sheet updated, IP to #request-ip); `stream:` and crew options set or change it; `remove:True` takes it off. |
| `!addgame <FACEIT link> [time]` (or `!add game`) | Fixes a match the automatic flow missed: adds or updates its sheet row and re-adds its main stream and approved caster stream links, and confirms the match in the bot (so it shows in `/request open`, the Upcoming Matches post, crew planning and IP prompts) when the bot had no readable approved time. Time: the one typed after the link (e.g. `11/9 8:30 PM ET`), else the approved time, else FACEIT's. Staff only. |
| `/cf prep match:<link>` | Caster prep pack for any match (only to you): both rosters (captain, FACEIT level, stand-ins), season records, last 3 results, map pool, top players, closest maps, group standing, head-to-head, maps/veto, talking points, team notes and links. Production role and stream staff. |
| `/crossfire teamnotes team: [pronunciation:] [notes:] [hltv:] [liquipedia:] [x:]` | Production role and stream staff: see or set a team's row on the Team Info tab (`none` clears a field). Shown in every prep pack for that team. |
| `/cf crewstats [user:] [season:]` | Season counts: main stream matches per person per role (casters, producer, observer, admin, social) and community casts per caster; `user:` shows one person's matches. Played matches count; booked ones show as (+N). |
| `/cf crewimport` | Reads this season's Schedule channel crew posts (the bot's and hand-made ones: `Casters: @A & @B / Prod: @C / Obs: @D …` with the FACEIT link) so crews from before the bot kept them count in `/cf crewstats`. Shows a preview first; nothing is saved until **Import**, and nobody is pinged. Safe to run again. |
| `/cf whosfree when:<time or link>` | Who on the production/admin crew is free then, by role, from the staff schedule sheet. |
| `/cf crewlink [name:] [user:]` | Lists staff schedule names not matched to Discord; with `name:` and `user:` links one by hand. |

The retired `!cancelreq` and `!resendip` reply with a pointer to their replacements. Embeds use Discord timestamps so each viewer sees the match time in their own time zone.

### Website contract

Leave `WEBSITE_ENDPOINT` empty for **log-only mode**: approvals succeed and the payload is printed to the log, so the Discord flow can be tested before the site integration exists. Set `WEBSITE_ENDPOINT` and `WEBSITE_API_KEY` to publish for real.

The bot sends one HTTP request per approval, per retry, and per later status or schedule update:

```
POST {WEBSITE_ENDPOINT}
Authorization: Bearer {WEBSITE_API_KEY}
Content-Type: application/json
Idempotency-Key: caster-request-{request_id}
```

```json
{
  "version": 1,
  "source": "crossfirebot",
  "request_id": "stream-abc123-xyz",
  "status": "approved",
  "event": { "title": "Team Alpha vs Team Beta", "starts_at": "2026-11-04T19:00:00.000Z" },
  "match": {
    "faceit_match_id": "1-0000...",
    "faceit_url": "https://www.faceit.com/en/cs2/room/1-0000...",
    "faceit_verified": true,
    "faceit_status": "SCHEDULED",
    "team_a": "Team Alpha",
    "team_b": "Team Beta",
    "scheduled_at": "2026-11-04T19:00:00.000Z"
  },
  "stream": {
    "url": "https://twitch.tv/somecaster",
    "platform": "twitch",
    "caster": { "discord_id": "1234", "discord_name": "somecaster", "social_url": "https://x.com/somecaster" }
  },
  "approved_at": "2026-10-30T15:41:12.000Z",
  "approved_by_discord_id": "9876",
  "sent_at": "2026-10-30T15:41:14.000Z"
}
```

- `status` is `approved`, `canceled`, `revoked`, or `completed`. The site should **upsert on `request_id`** and hide streams that are no longer `approved`.
- `starts_at` and `scheduled_at` are `null` until FACEIT schedules the match; a follow-up `approved` payload arrives when it does.
- Reply `2xx`, optionally `{"id": "..."}` which is stored on the request for audit. `5xx`, `429`, and timeouts are retried with exponential backoff up to `WEBSITE_MAX_ATTEMPTS`; any other `4xx` is a hard failure surfaced to staff immediately.
- To swap the integration, implement another publisher in `src/websitePublisher.js` with a single `publish(request, context)` method and select it in `createWebsitePublisher`. Nothing in the Discord code changes.

## Important FACEIT Note

The documented FACEIT Data API exposes public read operations; no documented schedule-write or veto-write operation was verified for this bot. Keep `FACEIT_SCHEDULE_ENDPOINT` unset. Discord scheduling and vetoes are stored locally, and staff must enter them into FACEIT manually.
