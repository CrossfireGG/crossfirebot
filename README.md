# FACEIT Discord Match Bot

This bot creates private Discord match channels from a FACEIT Crossfire bracket.

What it does:

- Reads matches from a FACEIT championship or tournament.
- Creates one Discord category per FACEIT round, such as `Round 1 Group Stage`.
- Creates one private channel per match inside the matching group category.
- Names group-stage match channels with the group letter, such as `a-team-one-vs-team-two`.
- Gives channel access to Discord roles whose names match the FACEIT team names.
- Gives match channel access to the two teams, Tournament Ops, and Producer.
- Optionally creates missing team roles using the FACEIT team names.
- Assigns members to team roles from a Google Sheet CSV export.
- Gives users in `Team Captain Discord ID` the `Team Captain` role.
- Lets team members propose and confirm a scheduled match time in Discord.
- Calls a FACEIT schedule adapter when a write endpoint is available.

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

For text commands like `!schedule`, `!propose`, `!reschedule`, `!accept`, `!decline`, and `!calladmin`, enable **Message Content Intent** in Discord Developer Portal > Bot.

For nickname updates, the bot needs **Manage Nicknames**, and its role must be above the players it is renaming.

For admin schedule alerts, set:

```env
ADMIN_SCHEDULE_CHANNEL_ID=your_admin_schedule_channel_id
ADMIN_ALERT_ROLE_IDS=1128907825167482900
MATCH_ACCESS_ROLE_IDS=1128907825167482900,1353921199016644700
MATCH_ACCESS_ROLE_NAMES=
```

When a team member runs `!accept`, the bot posts the admin schedule alert in `ADMIN_SCHEDULE_CHANNEL_ID` and pings `ADMIN_ALERT_ROLE_IDS`. If the channel env value is blank, the alert is posted in the match channel instead.

Optional round windows:

```env
ROUND_WINDOWS=Round of 16=2026-07-28..2026-07-30;Quarter Finals=2026-07-31..2026-08-02
```

## Invite Link

Use this link to invite the bot:

https://discord.com/oauth2/authorize?client_id=1523887433047867423&permissions=268561424&integration_type=0&scope=bot+applications.commands

Then run these in Discord:

- `/matches sync` creates/updates round categories and private match channels from FACEIT.
- `/matches status` checks how many matches the bot knows about.
- `/matches sample group:A round:1` creates a fake `a-team-one-vs-team-two` style match channel in `Round 1 Group Stage` for testing permissions and scheduling.
- `/teams sync` updates team roles, participant roles, captain roles, and nicknames from the Google Sheet.
- `/teams sync notify_captains:true` also DMs captains about missing players.
- After roster changes or team-name changes in the Google Sheet, run `/teams sync`; the bot fetches the latest sheet and removes stale team roles it previously managed.
- `/teams missing-players` shows which sheet players are missing from this Discord server, grouped by team.
- `/teams missing-captains` shows which sheet team captains are missing from this Discord server.

These slash commands are restricted to Discord admins, users with Manage Server, or configured match staff roles.

Inside each match channel:

- The pinned first message pings both team roles, shows the FACEIT room, the round window, and the default match day at 8:00 PM EST.
- The pinned first message explains the full schedule flow: one team member proposes with `!schedule`, a member from the other team confirms with `!accept`, then admins are alerted to schedule it on FACEIT.
- Scheduling is command-only in match rooms; the bot does not add a propose-time button.
- `!schedule 8/24/2026 3 PM EST`, `!schedule Tuesday 3 PM EST`, or `!schedule September 1 8 PM EST` proposes a match time, detects the timezone, and pings the other team to confirm.
- `!propose July 28 8:00 PM EST` also proposes a match time.
- `!reschedule July 29 8:00 PM EST` requests a reschedule.
- `!accept` lets a member from the other team accept it.
- `!decline` lets a member from the other team decline it.
- `!calladmin reason here` alerts admins with the match channel and FACEIT link.

Season 6 default round windows are built into the bot:

- Group Stage: August 31, 2026 - September 8, 2026
- Round 1: August 31, 2026 - September 2, 2026, default September 1, 2026 at 8:00 PM EST
- Round 2: September 3, 2026 - September 5, 2026, default September 4, 2026 at 8:00 PM EST
- Round 3: September 6, 2026 - September 8, 2026, default September 7, 2026 at 8:00 PM EST
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

- Reschedules must stay inside the configured round window.
- Reschedules within 24 hours of the current match time are flagged for admin override.
- Accepted schedules and reschedules are sent to admins to schedule manually on FACEIT.
- Group Stage teams may reschedule inside their round window by mutual agreement.
- Roster changes should go to `#make-a-ticket`.

## Important FACEIT Note

FACEIT Data API access is commonly read-focused. If your API key has organizer/admin write access for scheduling, add the endpoint to `FACEIT_SCHEDULE_ENDPOINT` and adjust `src/faceitSchedule.js` if the payload shape differs.

Until that is confirmed, Discord scheduling works and the bot records the agreed time locally, but FACEIT write-back is skipped safely.
