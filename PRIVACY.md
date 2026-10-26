# Privacy policy

Replay Altar runs on your own computer. It has no accounts, no analytics and no tracking, and its authors receive nothing from it.

## What stays on your computer

Your replays, the games and statistics made from them, your settings and the maps prepared for the simulation are kept in Replay Altar's own folders on your computer:

| What | Windows | Linux |
|---|---|---|
| Replays, games, statistics, maps prepared for the simulation, log | `%LOCALAPPDATA%\replay-altar` | `~/.local/share/replay-altar` |
| Settings | `%APPDATA%\replay-altar\config.json` | `~/.config/replay-altar/config.json` |

Replay Altar reads Warcraft III's game data and your maps and replays from your Warcraft III installation and your Documents folder. It never writes to them.

## What goes over the internet

Only these two things, and both can be turned off in **Settings → Behaviour**:

1. **W3Champions end-of-game statistics.** After each W3Champions game you play, Replay Altar asks the W3Champions website for that game's own end-of-game statistics (gold, lumber, experience, units killed). To find the game, it sends both players' battletags and the season to W3Champions, a few small requests per game, one game at a time. W3Champions' own privacy policy applies to these requests: https://www.w3champions.com.
2. **Update check.** Once a day, Replay Altar asks GitHub for the list of Replay Altar versions, to tell you when a new one is out. Nothing about you is sent beyond what any web request carries (your IP address). Updating is always your choice: when you press **Update**, the new installer is downloaded from GitHub. GitHub's privacy statement applies: https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement.

**Report a problem** and **Suggest an idea** (Settings → Help and feedback) only open a page on GitHub in your browser, with Replay Altar's version and your system filled in; nothing is sent unless you submit it there yourself.

## Pro statistics

The comparison with tournament players uses statistics that come with Replay Altar. The app never downloads tournament games itself.

## Changes to your system

On Windows, Replay Altar installs for your user only (no administrator rights) and, while its window is open, runs a small background program that saves each replay when a game ends. If you turn on Settings → Behaviour → Keep Replay Altar running after closing the window, that program keeps running and starts at login (an entry in your user's Run key, `ReplayAltarCollector`); turning the setting off removes the entry. Uninstalling (Settings → Apps → Replay Altar) removes the program and that entry; your games and statistics in `%LOCALAPPDATA%\replay-altar` are kept until you delete that folder.

## Contact

Questions about this policy: open an issue at https://github.com/bubunuh/replay-altar/issues.
