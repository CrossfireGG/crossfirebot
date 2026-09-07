# FACEIT Discord Match Bot

This bot creates private Discord match channels from a FACEIT Crossfire bracket.

What it does:

- Reads matches from a FACEIT championship or tournament.
- Creates one Discord category per FACEIT round, such as `Group Stage - Round 1`.
- Creates one private channel per match inside the matching group category.
- Names group-stage match channels with the group letter, such as `a-team-one-vs-team-two`.
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
ROUND_WINDOWS=Round of 16=2026-07-28..2026-07-30;Quarter Finals=2026-07-31..2026-08-02
```

## Invite Link

Use this link to invite the bot:

https://discord.com/oauth2/authorize?client_id=1523887433047867423&permissions=268561424&integration_type=0&scope=bot+applications.commands

Then run these in Discord:

- `/cf sync target:matches` creates/updates round categories and private match channels from FACEIT.
- `/cf sync target:matches round:1` creates/updates only `Group Stage - Round 1`; use `round:2` or `round:3` for the other Group Stage rounds.
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
- `/cf sample group:A round:1` creates a fake `a-team-one-vs-team-two` style match channel for testing permissions and scheduling.
- If `!schedule`, `!propose`, `!accept`, `!decline`, `!admin`, or `!calladmin` is used in an unlinked match room, the bot tries to recover the match from the channel topic/name and reports what it could not recognize.
- After roster changes or team-name changes in the Google Sheet, run `/cf sync target:teams`; the bot fetches the latest sheet and removes stale team roles it previously managed.

These slash commands are restricted to Discord admins, users with Manage Server, or configured match staff roles.

Inside each match channel:

- The pinned first message pings both team roles, shows the FACEIT room, the scheduling window, and the default round date at 8:00 PM EST.
- Group Stage match messages show `Stage: Group Stage`, `Round: 1`, and `Group: A` instead of repeating the category name.
- If FACEIT already has a scheduled time, the pinned message shows that below the FACEIT room link.
- The pinned first message explains the full schedule flow: one team member proposes with `!schedule`, a member from the other team confirms with `!accept`, then admins are alerted to schedule it on FACEIT.
- Scheduling is command-only in match rooms; the bot does not add a propose-time button.
- `!schedule 8/24/2026 3 PM EST`, `!schedule Tuesday 3 PM EST`, or `!schedule September 1 8 PM EST` proposes a match time, detects the timezone, and pings the other team to confirm.
- `!propose July 28 8:00 PM EST` also proposes a match time.
- `!reschedule July 29 8:00 PM EST` requests a reschedule.
- `!accept` lets a member from the other team accept it.
- `!decline` lets a member from the other team decline it.
- Users with a role in `SCHEDULE_OVERRIDE_ROLE_IDS` can run `!schedule` in a match room to set the schedule directly without both teams accepting.
- `!admin reason here` or `!calladmin reason here` alerts admins with the match channel and FACEIT link.
- Old schedule buttons are disabled. Scheduling is command-only inside match rooms.

Season 6 schedule windows and default round dates are built into the bot:

- Group Stage scheduling window: August 31, 2026 - September 10, 2026
- Round 1: August 31, 2026 - September 2, 2026, default September 1, 2026 at 8:00 PM EST
- Round 2: September 3, 2026 - September 5, 2026, default September 4, 2026 at 8:00 PM EST
- Round 3: September 6, 2026 - September 10, 2026, default September 7, 2026 at 8:00 PM EST
- WB Round of 32: September 12, 2026 - September 14, 2026, default September 13, 2026 at 8:00 PM EST
- WB Round of 16 + Losers Round 1: September 15, 2026 - September 17, 2026, default September 16, 2026 at 8:00 PM EST
- WB Quarterfinals + Losers Round 2: September 18, 2026 - September 20, 2026, default September 19, 2026 at 8:00 PM EST
- Losers Round 3: September 21, 2026 - September 23, 2026, default September 22, 2026 at 8:00 PM EST
- WB Semifinals + Losers Round 4: September 24, 2026 - September 26, 2026, default September 25, 2026 at 8:00 PM EST
- Losers Round 5: September 27, 2026 - September 29, 2026, default September 28, 2026 at 8:00 PM EST
- WB Final + Losers Round 6: September 30, 2026 - October 2, 2026, default October 1, 2026 at 8:00 PM EST
- Losers Round 7: October 3, 2026 - October 5, 2026, default October 4, 2026 at 8:00 PM EST
- Losers Final: October 6, 2026 - October 8, 2026, default October 7, 2026 at 8:00 PM EST
- Grand Final (BO5): October 9, 2026 - October 11, 2026, default October 10, 2026 at 8:00 PM EST

Reschedule rules:

- Schedules and reschedules must stay inside the configured scheduling window.
- Reschedules within 24 hours of the current match time are flagged for admin override.
- Accepted schedules and reschedules are sent to admins to schedule manually on FACEIT.
- When admins approve a schedule request in the staff channel, the bot reacts to that admin alert with a checkmark.
- Group Stage teams may schedule or reschedule any Group Stage match from August 31, 2026 through September 10, 2026 by mutual agreement.
- Roster changes should go to `#make-a-ticket`.
- Set `ROSTER_TICKET_CHANNEL_ID=1418725495545004175` so pinned match messages link directly to the roster ticket channel.

## Important FACEIT Note

FACEIT Data API access is commonly read-focused. If your API key has organizer/admin write access for scheduling, add the endpoint to `FACEIT_SCHEDULE_ENDPOINT` and adjust `src/faceitSchedule.js` if the payload shape differs.

Until that is confirmed, Discord scheduling works and the bot records the agreed time locally, but FACEIT write-back is skipped safely.
