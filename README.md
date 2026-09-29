# SmartBot — Robocode Tank Royale

A Java bot for [Robocode Tank Royale](https://robocode.dev) (Bot API 1.3.x) that dodges and shoots precisely.

## How it works

| Part | Technique |
|------|-----------|
| **Radar** | Narrow lock with overshoot in 1v1, so every enemy shot is seen. Spins in melee. |
| **Dodging (1v1)** | **Wave surfing.** It spots enemy shots from their energy drop (0.1–3), then tracks each shot as an expanding wave. For each option (orbit left, orbit right, brake), it simulates the bot's physics until the wave arrives and picks the option with the lowest danger. Every hit it takes teaches it which guess factors the enemy aims at. |
| **Dodging (melee)** | **Minimum‑risk movement.** It scores random nearby points by closeness to enemies (weighted by their energy), heading alignment and closeness to the crowded center, then drives to the safest one. |
| **Walls** | Wall smoothing, with back‑as‑front driving so it never wastes turns rotating. |
| **Gun** | **Virtual guns.** Guess‑factor targeting (segmented on distance, lateral velocity and acceleration), circular targeting and linear targeting all run at the same time. Each real bullet is tracked as a wave, and each gun is scored on whether it *would* have hit. The bot aims with the best‑scoring gun. |
| **Firepower** | Set by distance and hit rate. It saves energy when low and uses only the power needed to finish off a weak enemy. |

Learned statistics (gun and surfing) are `static`, so they carry across rounds.

## Installing

1. Copy the `bots/SmartBot` folder into your Tank Royale bots directory, next to the sample bots. That directory has a `lib/` folder containing `robocode-tankroyale-bot-api-*.jar`.
2. In the Tank Royale GUI, add that bots directory under **Config → Bot Root Directories**, then start a battle and select **SmartBot**.

To run it by hand against a running server (default `ws://localhost:7654`), from the `SmartBot` folder:

```sh
./SmartBot.sh        # or SmartBot.cmd on Windows  (java -cp ../lib/* SmartBot.java)
```

## Battle‑testing locally

`tools/Arena.java` uses the official `robocode-tankroyale-runner`, which embeds a server, to run headless battles:

```sh
# jars from Maven Central: dev.robocode.tankroyale:robocode-tankroyale-runner:1.3.1
# arena dir = sample-bots-java-1.3.1.zip unpacked + a copy of bots/SmartBot
javac -cp runner.jar -d out tools/Arena.java
java -cp "out:runner.jar" Arena /path/to/arena classic 10 SmartBot SpinBot
java -cp "out:runner.jar" Arena /path/to/arena melee 20 SmartBot Walls Crazy Fire RamFire TrackFire VelociBot Corners SpinBot MyFirstBot
```

### Results against the official sample bots (Bot API 1.3.1)

- **1v1, 10 rounds each:** won 90/90 rounds against SpinBot, Walls, Crazy, Fire, RamFire, TrackFire, VelociBot, Corners and Target, taking at most 32 damage per 10 rounds.
- **10‑bot melee, 20 rounds:** 1st place, won 15/20 rounds, with a score of 16154 against 7928 for the runner‑up (Walls).
