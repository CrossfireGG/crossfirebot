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
- Lets Tournament Ops schedule directly from a match channel without waiting for team acceptance.
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

For text commands like `!schedule`, `!propose`, `!reschedule`, `!accept`, `!decline`, `!admin`, and `!calladmin`, enable **Message Content Intent** in Discord Developer Portal > Bot.

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

Optional round windows:

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
- Users with a role in `SCHEDULE_OVERRIDE_ROLE_IDS` can run `!schedule` in a match room to set the schedule directly without both teams accepting.
- `!admin reason here` or `!calladmin reason here` alerts admins with the match channel and FACEIT link.
- Old schedule buttons are disabled. Scheduling is command-only inside match rooms.

The active FACEIT source is the Season 7 Group Stage championship. Before FACEIT publishes matches, `/cf sync target:matches` safely reports that there is nothing to create. Once matches exist, it detects group letters and round numbers from FACEIT and creates categories such as `Group Stage - Round 1` in bracket order.

Run `/cf sync target:teams` before syncing match rooms so the new Season 7 role mappings exist. The Season 7 mapping scope does not reuse hard-coded Season 6 channel or category IDs.

Season 7 round windows are not guessed. Configure them with `ROUND_WINDOWS` after the official dates are announced. Until then, match-room intros use FACEIT's scheduled time when available and tell admins that the scheduling window still requires verification.

Reschedule rules:

- Schedules and reschedules must stay inside the configured scheduling window.
- Reschedules within 24 hours of the current match time are flagged for admin override.
- Accepted schedules and reschedules are sent to admins to schedule manually on FACEIT.
- When admins approve a schedule request in the staff channel, the bot reacts to that admin alert with a checkmark.
- Playoff teams may schedule or reschedule during their assigned three-day round window by mutual agreement.

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

Authorized staff can schedule directly inside a match room. Normal direct scheduling is `!schedule September 28 8 PM ET`. To bypass the configured window, a reason is mandatory: `!schedule October 1 9 PM ET --force production conflict`. Direct staff schedules are approved immediately, audit logged, announced to both teams/staff, and retained over FACEIT status refreshes.

Veto setup requires the playoff championship ID in `PLAYOFF_SOURCE_IDS`, exactly seven maps in `VETO_MAP_POOL`, and actual tournament seeds in `VETO_SEEDS`. The FACEIT Open API match payload does not provide a verified tournament seed, so the bot never substitutes Elo, standings, or bracket position. `/cf veto action:seeds` stores a persistent per-match override; for the Grand Final, also set `advantage_team` to the actual upper-bracket winner (or configure `VETO_ADVANTAGE_TEAM`). `/cf veto action:start|inspect|reset|cancel` manages a linked playoff room. BO3 uses ban, ban, pick, pick, ban, ban, decider. Grand Final uses two bans and four picks; the remaining map is awarded to the explicitly configured upper-bracket winner for a 1-0 start and is not played. Veto output is Discord-only and must be entered into FACEIT by staff.

Streamers use `!request` or `/request stream`. Requests require only a FACEIT matchroom link, Twitch URL, and X/Twitter URL. The bot reads the matchup and schedule from FACEIT. Valid FACEIT links are grouped by match ID and checked every `STREAM_SCHEDULE_CHECK_MINUTES` (15-30 minutes); newly posted schedules and later schedule changes update every active request and DM approved casters. Invalid links remain reviewable but are clearly marked as ineligible for grouping, automatic schedule monitoring, and connection delivery. `STREAM_REQUEST_CHANNEL_ID` receives race-safe Approve/Deny controls.

At the scheduled time, staff receive one prompt per FACEIT match to submit either the CSTV connect command or official CROSSFIRE Twitch link. The value is DMed only to approved casters and is never posted to their source channel. `STREAM_STAFF_GUILD_ID` and `STREAM_STAFF_ROLE_IDS` explicitly authorize the internal Tournament Operations role to approve requests and deliver connection details. Staff can use `!sendip FACEIT_MATCHROOM_LINK MESSAGE` to immediately DM any connection details or instructions, plus `!cancelreq FACEIT_MATCHROOM_LINK`, `!cancelreq @caster`, `!resendip FACEIT_MATCHROOM_LINK`, or `/cf streams action:cancel|revoke|complete`. The bot deletes a valid `!sendip` command message when it has permission so its contents are not left in the channel. Verified FACEIT completion sends the configured post-cast form once; delivery state is persisted.

Operations reporting:

- `/crossfire upcoming`, `/crossfire team`, `/crossfire rounds`, `/crossfire veto`, `/crossfire help` expose only information visible to the requesting user.
- `/cf status` summarizes pending schedules, tickets, stream requests, mappings, and vetoes for staff.
- `/cf auditlog` shows recent persistent scheduling and operations events.
- Roster changes should go to `#make-a-ticket`.
- Set `ROSTER_TICKET_CHANNEL_ID=1418725495545004175` so pinned match messages link directly to the roster ticket channel.

## Important FACEIT Note

The documented FACEIT Data API exposes public read operations; no documented schedule-write or veto-write operation was verified for this bot. Keep `FACEIT_SCHEDULE_ENDPOINT` unset. Discord scheduling and vetoes are stored locally, and staff must enter them into FACEIT manually.
