# Milestone 2 operational acceptance report

Synthetic data only. Every number below was produced by `bench/acceptance.mjs` on the machine described here; nothing is asserted without a measurement.

## 0. Environment

- Node v24.16.0, win32 x64, AMD Ryzen 7 6800H with Radeon Graphics x16, 23.2 GiB RAM
- Optimizer seed 1, default budget (time cap 8 s, 30000 iterations per strategy)

# A. General-purpose synthetic multi-day stress test

Two days, 08:00-19:00, 10 courts, 20-minute slots with a separate 5-minute court turnover and a 15-minute recovery rule. This is a stress test kept separate from the Echelon regression test in part B: it is NOT the Echelon structure (no wildcards, no category windows, two days).

## 1. Scenario

| Item | Value |
| --- | --- |
| Courts | 10, 2 days, 08:00-19:00 each day |
| Categories x skill divisions | 4 x 3 = 12 divisions |
| Pools (brackets) of 4 teams | 40 (teams: 160) |
| Preliminary round-robin matches | 240 |
| Semifinals / medal matches | 24 / 24 |
| Total matches | 288 |
| Durations | preliminary and semifinal 20 min, medal 30 min, court turnover 5 min |
| Minimum recovery rule | 15 min |
| Category windows (mandatory) | Must: matches of categories SN finish by 17:00 each day. Must: matches of categories XD start no earlier than 09:00 each day. |
| Configuration valid | true |
| Feasibility (necessary conditions) | no_blocking_issue_found |


## 2. Three-option run

Status **ok**, 3 options, wall time **5.74 s** (target 10 s for typical events).

| Phase | Time |
| --- | --- |
| Construction (all strategies, outside the search cap) | 0.38 s |
| Local search | 5.32 s |
| Verification (independent validators) | 0.01 s |
| Diversification and finish pass | 0.00 s |
| Total | 5.74 s |

Construction method per strategy: fastest_finish=strategy_weights, balanced_operations=strategy_weights, player_first=strategy_weights. Time limited: true. Budget overrun: 0 ms.

## 3. Side-by-side comparison (measured)

| Measure | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Planned start | 2026-11-14 08:00 | 2026-11-14 08:00 | 2026-11-14 08:00 |
| Planned finish | 2026-11-15 14:10 | 2026-11-15 14:35 | 2026-11-15 15:10 |
| Total scheduling duration (first start to last end) | 30.2 h (17.2 h inside court open hours) | 30.6 h (17.6 h inside court open hours) | 31.2 h (18.2 h inside court open hours) |
| Matches successfully scheduled | 288 of 288 | 288 of 288 | 288 of 288 |
| Total idle court-minutes | 1020 | 1330 | 1430 |
| Overall court utilization | 58% | 57% | 55% |
| Recovery gaps measured | 368 | 368 | 368 |
| Back-to-back occurrences (gap < 25 min) | 32 | 0 | 0 |
| Teams / feeder links affected by back-to-backs | 31 | 0 | 0 |
| Recoveries below comfort (50 min) | 95 | 56 | 2 |
| Recovery min / average / max (min) | 15 / 245.6 / 1355 | 25 / 265.5 / 1205 | 25 / 140.8 / 860 |
| Recovery fairness (std dev of mean recovery, min) | 278.4 | 240.1 | 137.9 |
| Teams whose pool play is split across both days | 47 | 58 | 0 |
| Longest wait between a team's matches | 1305 min (Seniors Doubles Intermediate Team 1) | 1165 min (Seniors Doubles High Intermediate Team 5) | 485 min (Women's Doubles Intermediate Team 5) |
| Court switches between divisions | 183 | 177 | 173 |
| Warnings (risk / info) | 26 / 15 | 0 / 14 | 0 / 10 |


### Court utilization by court (busy minutes / available minutes inside the schedule span)

| Court | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Court 1 | 61% (30 matches, idle 85) | 62% (31 matches, idle 145) | 45% (23 matches, idle 105) |
| Court 2 | 55% (27 matches, idle 150) | 69% (34 matches, idle 120) | 61% (32 matches, idle 270) |
| Court 3 | 50% (25 matches, idle 85) | 55% (27 matches, idle 175) | 61% (32 matches, idle 90) |
| Court 4 | 54% (27 matches, idle 80) | 50% (25 matches, idle 145) | 61% (32 matches, idle 145) |
| Court 5 | 66% (32 matches, idle 180) | 47% (24 matches, idle 180) | 50% (26 matches, idle 105) |
| Court 6 | 62% (31 matches, idle 100) | 51% (27 matches, idle 140) | 58% (30 matches, idle 170) |
| Court 7 | 63% (31 matches, idle 140) | 50% (26 matches, idle 115) | 66% (34 matches, idle 195) |
| Court 8 | 41% (21 matches, idle 60) | 51% (27 matches, idle 130) | 49% (26 matches, idle 75) |
| Court 9 | 76% (37 matches, idle 45) | 70% (35 matches, idle 55) | 58% (31 matches, idle 110) |
| Court 10 | 53% (27 matches, idle 95) | 63% (32 matches, idle 125) | 43% (22 matches, idle 165) |


### Completion by category

| Category | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Men's Doubles | 2026-11-15 12:05 | 2026-11-15 11:45 | 2026-11-15 11:05 |
| Women's Doubles | 2026-11-15 13:50 | 2026-11-15 14:25 | 2026-11-15 11:40 |
| Mixed Doubles | 2026-11-15 11:20 | 2026-11-15 09:55 | 2026-11-15 09:30 |
| Seniors Doubles | 2026-11-15 14:10 | 2026-11-15 14:35 | 2026-11-15 15:10 |


### Completion by division, and preliminary-to-playoff transition (minutes between a semifinal starting and the last pool match it depends on ending; never below the rest rule)

| Division | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Advanced Men's Doubles | 2026-11-14 18:50; transition 15 min | 2026-11-14 18:35; transition 15 min | 2026-11-15 08:30; transition 20 min |
| High Intermediate Men's Doubles | 2026-11-15 12:05; transition 15 min | 2026-11-15 11:40; transition 790 min | 2026-11-14 17:50; transition 15 min |
| Intermediate Men's Doubles | 2026-11-15 10:05; transition 15 min | 2026-11-15 11:45; transition 15 min | 2026-11-15 11:05; transition 780 min |
| Advanced Women's Doubles | 2026-11-15 13:50; transition 30 min | 2026-11-15 14:25; transition 15 min | 2026-11-15 08:30; transition 90 min |
| High Intermediate Women's Doubles | 2026-11-15 11:05; transition 790 min | 2026-11-15 14:00; transition 30 min | 2026-11-15 11:05; transition 840 min |
| Intermediate Women's Doubles | 2026-11-15 13:00; transition 800 min | 2026-11-15 13:50; transition 80 min | 2026-11-15 11:40; transition 865 min |
| Advanced Mixed Doubles | 2026-11-15 10:30; transition 15 min | 2026-11-14 12:50; transition 15 min | 2026-11-14 18:20; transition 15 min |
| High Intermediate Mixed Doubles | 2026-11-15 10:05; transition 15 min | 2026-11-14 14:55; transition 15 min | 2026-11-15 09:30; transition 75 min |
| Intermediate Mixed Doubles | 2026-11-15 11:20; transition 15 min | 2026-11-15 09:55; transition 15 min | 2026-11-14 15:30; transition 15 min |
| Advanced Seniors Doubles | 2026-11-15 12:25; transition 15 min | 2026-11-15 13:00; transition 15 min | 2026-11-15 15:10; transition 15 min |
| High Intermediate Seniors Doubles | 2026-11-15 13:50; transition 15 min | 2026-11-15 14:35; transition 15 min | 2026-11-15 15:00; transition 15 min |
| Intermediate Seniors Doubles | 2026-11-15 14:10; transition 15 min | 2026-11-15 14:35; transition 15 min | 2026-11-15 14:25; transition 15 min |


### Teams with the shortest recovery (certain participants and feeder links)

**A Fastest Finish**

| Team / link | Gap (min) | Between |
| --- | --- | --- |
| Men's Doubles Advanced Team 15 | 15 | MD-ADV:pool:B:R1:M1 -> MD-ADV:pool:B:R2:M2 |
| Men's Doubles Advanced Team 16 | 15 | MD-ADV:pool:A:R1:M1 -> MD-ADV:pool:A:R2:M2 |
| Men's Doubles Advanced Team 7 | 15 | MD-ADV:pool:B:R1:M2 -> MD-ADV:pool:B:R2:M2 |
| Men's Doubles Advanced Team 8 | 15 | MD-ADV:pool:A:R1:M2 -> MD-ADV:pool:A:R2:M2 |
| Men's Doubles High Intermediate Team 10 | 15 | MD-HI:pool:B:R3:M2 -> MD-HI:pool:B:R2:M1 |

**B Balanced Operations**

| Team / link | Gap (min) | Between |
| --- | --- | --- |
| Men's Doubles Advanced Team 1 | 25 | MD-ADV:pool:A:R2:M1 -> MD-ADV:pool:A:R3:M1 |
| Men's Doubles Advanced Team 16 | 25 | MD-ADV:pool:A:R2:M2 -> MD-ADV:pool:A:R3:M2 |
| Mixed Doubles Advanced Team 1 | 25 | XD-ADV:pool:A:R1:M1 -> XD-ADV:pool:A:R2:M1 |
| Mixed Doubles Advanced Team 10 | 25 | XD-ADV:pool:B:R1:M2 -> XD-ADV:pool:B:R2:M1 |
| Mixed Doubles Advanced Team 10 | 25 | XD-ADV:pool:B:R2:M1 -> XD-ADV:pool:B:R3:M2 |

**C Player-First**

| Team / link | Gap (min) | Between |
| --- | --- | --- |
| Mixed Doubles Advanced Team 1 | 25 | XD-ADV:pool:A:R2:M1 -> XD-ADV:pool:A:R3:M1 |
| Mixed Doubles Advanced Team 1 | 35 | XD-ADV:pool:A:R3:M1 -> XD-ADV:pool:A:R1:M1 |
| Men's Doubles Advanced Team 1 | 50 | MD-ADV:pool:A:R2:M1 -> MD-ADV:pool:A:R3:M1 |
| Men's Doubles Advanced Team 10 | 50 | MD-ADV:pool:B:R1:M2 -> MD-ADV:pool:B:R2:M1 |
| Men's Doubles Advanced Team 2 | 50 | MD-ADV:pool:B:R2:M1 -> MD-ADV:pool:B:R1:M1 |


### Teams with the longest waits

**A Fastest Finish**

| Team | Longest gap (min) | Total waiting (min) | Matches |
| --- | --- | --- | --- |
| Seniors Doubles Intermediate Team 1 | 1305 | 1420 | 3 |
| Seniors Doubles Intermediate Team 5 | 1275 | 1410 | 3 |
| Seniors Doubles High Intermediate Team 9 | 1220 | 1285 | 3 |
| Seniors Doubles Intermediate Team 6 | 1210 | 1315 | 3 |
| Seniors Doubles Advanced Team 16 | 1145 | 1195 | 3 |

**B Balanced Operations**

| Team | Longest gap (min) | Total waiting (min) | Matches |
| --- | --- | --- | --- |
| Seniors Doubles High Intermediate Team 5 | 1165 | 1295 | 3 |
| Seniors Doubles High Intermediate Team 1 | 1145 | 1265 | 3 |
| Women's Doubles Advanced Team 5 | 1145 | 1200 | 3 |
| Women's Doubles Advanced Team 9 | 1145 | 1210 | 3 |
| Women's Doubles Advanced Team 16 | 1130 | 1200 | 3 |

**C Player-First**

| Team | Longest gap (min) | Total waiting (min) | Matches |
| --- | --- | --- | --- |
| Women's Doubles Intermediate Team 5 | 485 | 555 | 3 |
| Women's Doubles Intermediate Team 8 | 460 | 545 | 3 |
| Women's Doubles Intermediate Team 2 | 455 | 535 | 3 |
| Men's Doubles Advanced Team 11 | 380 | 445 | 3 |
| Mixed Doubles High Intermediate Team 16 | 355 | 410 | 3 |


### Warnings and operational risks

**A Fastest Finish**: BACK_TO_BACK x26, SHORT_RECOVERY x1, NO_SLACK x1, OVERNIGHT_SPLIT x1, LONG_WAIT x1, MEDAL_OVERRUN_RISK x1, TIGHT_PLAYOFF_TRANSITION x10
- info: 95 recoveries are below the 50-minute comfort level (32 of them are back-to-backs).
- info: 32 recovery gaps are within 5 minutes of the minimum rest rule, so a match overrunning its allocated time would breach it at the next start.
- info: 47 teams play their preliminary matches on more than one day, so they wait overnight between matches.
- info: 72 teams wait more than 240 minutes between two matches (longest: Seniors Doubles Intermediate Team 1, 1305 minutes).
- risk: Men's Doubles Advanced Team 15 has only 15 minutes of recovery between MD-ADV:pool:B:R1:M1 and MD-ADV:pool:B:R2:M2 (back-to-back threshold 25).
- risk: Men's Doubles Advanced Team 16 has only 15 minutes of recovery between MD-ADV:pool:A:R1:M1 and MD-ADV:pool:A:R2:M2 (back-to-back threshold 25).
- risk: Men's Doubles Advanced Team 7 has only 15 minutes of recovery between MD-ADV:pool:B:R1:M2 and MD-ADV:pool:B:R2:M2 (back-to-back threshold 25).

**B Balanced Operations**: SHORT_RECOVERY x1, OVERNIGHT_SPLIT x1, LONG_WAIT x1, MEDAL_OVERRUN_RISK x1, TIGHT_PLAYOFF_TRANSITION x10
- info: 56 recoveries are below the 50-minute comfort level (0 of them are back-to-backs).
- info: 58 teams play their preliminary matches on more than one day, so they wait overnight between matches.
- info: 89 teams wait more than 240 minutes between two matches (longest: Seniors Doubles High Intermediate Team 5, 1165 minutes).
- info: 15 of 24 medal matches have less than 10 minutes before their court is needed again. Medal matches have no hard time cap, so a prolonged match would delay the next one on that court.

**C Player-First**: SHORT_RECOVERY x1, LONG_WAIT x1, MEDAL_OVERRUN_RISK x1, TIGHT_PLAYOFF_TRANSITION x7
- info: 2 recoveries are below the 50-minute comfort level (0 of them are back-to-backs).
- info: 27 teams wait more than 240 minutes between two matches (longest: Women's Doubles Intermediate Team 5, 485 minutes).
- info: 14 of 24 medal matches have less than 10 minutes before their court is needed again. Medal matches have no hard time cap, so a prolonged match would delay the next one on that court.
- info: Advanced Men's Doubles: a first-round knockout match starts only 20 minutes after the last preliminary match it depends on ends, so a qualifier from that pool has little rest.


### Distinctness of the options

| Pair | Matches placed differently | Differs on | Pareto relation | Materially different |
| --- | --- | --- | --- | --- |
| fastest_finish vs balanced_operations | 97% | finish_time, idle_time, back_to_backs, short_recoveries, recovery_fairness | trade_off | true |
| fastest_finish vs player_first | 100% | finish_time, idle_time, back_to_backs, short_recoveries, recovery_fairness | trade_off | true |
| balanced_operations vs player_first | 99% | finish_time, short_recoveries, recovery_fairness | trade_off | true |

- Compared with Fastest Finish, Balanced Operations: finishes 25 min later; 310 min more court idle time; 59 fewer back-to-back matches; 76 fewer short recoveries; fairer recovery (spread 240.1 vs 278.4 min).
- Compared with Fastest Finish, Player-First: finishes 60 min later; 410 min more court idle time; 59 fewer back-to-back matches; 176 fewer short recoveries; fairer recovery (spread 137.9 vs 278.4 min).
- Compared with Balanced Operations, Player-First: finishes 35 min later; 100 fewer short recoveries; fairer recovery (spread 137.9 vs 240.1 min).


### Recommendation

**Recommended: balanced_operations.** Balanced Operations is the default recommendation. Compared with Fastest Finish, Balanced Operations: finishes 25 min later; 310 min more court idle time; 59 fewer back-to-back matches; 76 fewer short recoveries; fairer recovery (spread 240.1 vs 278.4 min).

Calculated basis:
- Finish: A 2026-11-15 14:10, B 2026-11-15 14:35, C 2026-11-15 15:10.
- Back-to-backs: A 32, B 0, C 0. Minimum recovery: A 15, B 25, C 25 min.
- Idle court-minutes: A 1020, B 1330, C 1430.
- Overall, B finishes 25 min after A and 35 min before C, with 32 fewer back-to-backs than A and 0 more than C.

## 4. Sample court-by-court schedule (Balanced Operations, day 1, first 8 matches per court)

- **Court 1**: 08:10-08:30 MD-ADV B-R1-1; 08:35-08:55 MD-INT A-R2-2; 09:00-09:20 XD-ADV B-R1-1; 09:45-10:05 XD-ADV A-R2-1; 10:30-10:50 WD-HI B-R1-2; 10:55-11:15 XD-ADV A-R3-2; 11:20-11:40 XD-HI C-R2-2; 11:45-12:05 MD-ADV C-R3-2
- **Court 2**: 08:00-08:20 MD-ADV A-R1-2; 08:25-08:45 WD-ADV B-R3-2; 09:00-09:20 XD-ADV C-R1-1; 09:45-10:05 XD-ADV A-R2-2; 10:10-10:30 XD-HI D-R1-1; 10:35-10:55 XD-ADV D-R3-1; 11:05-11:25 XD-ADV SF2; 11:30-11:50 XD-ADV SF1
- **Court 3**: 09:00-09:20 XD-ADV D-R1-1; 09:45-10:05 XD-ADV B-R2-1; 10:30-10:50 XD-INT A-R1-2; 10:55-11:15 XD-HI A-R3-2; 11:20-11:40 XD-HI D-R2-1; 12:05-12:25 MD-ADV B-R3-2; 12:30-12:50 XD-HI D-R3-1; 13:15-13:35 MD-ADV A-R2-1
- **Court 4**: 08:10-08:30 MD-INT B-R2-1; 08:35-08:55 SN-ADV B-R1-2; 09:00-09:20 XD-ADV A-R1-2; 09:45-10:05 XD-ADV B-R2-2; 10:30-10:50 XD-ADV B-R3-1; 10:55-11:15 XD-INT B-R1-2; 11:40-12:00 XD-INT A-R2-2; 12:25-12:45 XD-INT B-R3-1
- **Court 5**: 08:00-08:20 MD-ADV A-R1-1; 08:25-08:45 MD-ADV B-R1-2; 09:00-09:20 XD-ADV A-R1-1; 09:45-10:05 XD-ADV C-R2-1; 10:30-10:50 XD-ADV C-R3-2; 10:55-11:15 XD-INT B-R1-1; 11:40-12:00 MD-INT A-R2-1; 12:25-12:45 XD-INT B-R3-2
- **Court 6**: 08:00-08:20 MD-ADV D-R1-2; 08:25-08:45 MD-HI C-R1-2; 09:00-09:20 XD-ADV C-R1-2; 09:45-10:05 XD-ADV D-R2-2; 10:30-10:50 XD-ADV C-R3-1; 10:55-11:15 XD-ADV D-R3-2; 11:40-12:00 XD-INT B-R2-1; 12:25-12:45 XD-INT A-R3-1
- **Court 7**: 08:00-08:20 MD-ADV D-R1-1; 08:25-08:45 MD-HI B-R1-1; 09:00-09:20 XD-ADV D-R1-2; 09:45-10:05 XD-ADV D-R2-1; 10:30-10:50 XD-ADV B-R3-2; 10:55-11:15 XD-ADV A-R3-1; 11:40-12:00 MD-HI A-R3-2; 12:05-12:25 XD-HI C-R1-2
- **Court 8**: 08:10-08:30 MD-HI A-R2-1; 08:35-08:55 MD-HI D-R1-2; 09:00-09:20 XD-ADV B-R1-2; 09:45-10:05 XD-ADV C-R2-2; 10:10-10:30 XD-HI D-R1-2; 10:50-11:10 XD-HI B-R2-1; 11:15-11:35 MD-ADV A-R2-2; 11:40-12:00 XD-HI B-R1-2
- **Court 9**: 08:10-08:30 MD-ADV C-R1-2; 08:35-08:55 MD-HI D-R1-1; 09:10-09:30 XD-INT B-R2-2; 09:35-09:55 XD-HI A-R2-1; 10:00-10:20 SN-ADV C-R1-1; 10:25-10:45 XD-INT A-R1-1; 10:50-11:10 XD-HI B-R2-2; 11:15-11:35 XD-HI C-R2-1
- **Court 10**: 08:00-08:20 MD-INT B-R2-2; 08:25-08:45 MD-HI B-R1-2; 08:50-09:10 MD-HI C-R1-1; 09:15-09:35 XD-INT A-R2-1; 09:40-10:00 XD-HI A-R2-2; 10:05-10:25 XD-HI B-R1-1; 10:30-10:50 XD-HI C-R1-1; 10:55-11:15 XD-HI A-R3-1

## 5. Examples of short-rest and back-to-back warnings (recommended option)

- Men's Doubles Advanced Team 1: 25 minutes between MD-ADV:pool:A:R2:M1 and MD-ADV:pool:A:R3:M1.
- Men's Doubles Advanced Team 16: 25 minutes between MD-ADV:pool:A:R2:M2 and MD-ADV:pool:A:R3:M2.
- Mixed Doubles Advanced Team 1: 25 minutes between XD-ADV:pool:A:R1:M1 and XD-ADV:pool:A:R2:M1.
- Mixed Doubles Advanced Team 10: 25 minutes between XD-ADV:pool:B:R1:M2 and XD-ADV:pool:B:R2:M1.
- Mixed Doubles Advanced Team 10: 25 minutes between XD-ADV:pool:B:R2:M1 and XD-ADV:pool:B:R3:M2.

Recovery basis: {"recoveryMeasuredFrom":"end_of_allocated_court_time","courtTurnoverIncludedInRecovery":false,"backToBackThresholdMinutes":25,"comfortThresholdMinutes":50}. A match's allocated time already includes warm-up; court turnover (5 min) is a court buffer and is neither added to nor removed from player recovery. Recovery from the end of active play is therefore at least the figures above.

## 6. Structured special-instruction tests (instructions enforced on all returned options)

| Request (structured; times are explicit boundaries) | Result | Strength | Independent enforcement check | Time |
| --- | --- | --- | --- | --- |
| Advanced Men's must play in the morning (ends by 12:00 each day) | ok, 3 options | mandatory | A: enforced, valid (28 matches, latest end 11:55)<br>B: enforced, valid (28 matches, latest end 12:00)<br>C: enforced, valid (28 matches, latest end 12:00) | 5.71 s |
| Advanced Women's cannot start before 1 PM (13:00 each day) | ok, 3 options | mandatory | A: enforced, valid (28 matches, earliest start 13:00)<br>B: enforced, valid (28 matches, earliest start 13:00)<br>C: enforced, valid (28 matches, earliest start 13:00) | 5.70 s |
| Reserve Court 10 for medal matches | ok, 3 options | mandatory | A: enforced, valid (2 matches on Court 10, 0 of them not medal matches)<br>B: enforced, valid (1 matches on Court 10, 0 of them not medal matches)<br>C: enforced, valid (1 matches on Court 10, 0 of them not medal matches) | 5.71 s |
| High Intermediate only on Courts 1-4 | ok, 3 options | mandatory | A: enforced, valid (112 matches, 0 outside Courts 1-4)<br>B: enforced, valid (112 matches, 0 outside Courts 1-4)<br>C: enforced, valid (112 matches, 0 outside Courts 1-4) | 5.79 s |
| At least 20 minutes between a team's matches (High Intermediate) | ok, 3 options | mandatory | A: enforced, valid (shortest recovery among High Intermediate teams and feeder links: 20 minutes)<br>B: enforced, valid (shortest recovery among High Intermediate teams and feeder links: 20 minutes)<br>C: enforced, valid (shortest recovery among High Intermediate teams and feeder links: 30 minutes) | 6.19 s |
| Court 3 unavailable 12:00-13:30 on day 1 | ok, 3 options | mandatory | A: enforced, valid (0 matches overlap the Court 3 blackout)<br>B: enforced, valid (0 matches overlap the Court 3 blackout)<br>C: enforced, valid (0 matches overlap the Court 3 blackout) | 5.71 s |
| Lock Intermediate Men's pool A round 1 match 1 to Court 2 at 10:00 on day 1 | ok, 3 options | mandatory | A: enforced, valid (placed on C2 at 2026-11-14 10:00)<br>B: enforced, valid (placed on C2 at 2026-11-14 10:00)<br>C: enforced, valid (placed on C2 at 2026-11-14 10:00) | 5.71 s |
| Prefer Advanced divisions in consecutive blocks (weighted preference) | ok, 3 options | preference | A: enforced, valid (division-span overlap 435 minutes (4890 without the preference))<br>B: enforced, valid (division-span overlap 635 minutes (3605 without the preference))<br>C: enforced, valid (division-span overlap 2220 minutes (5475 without the preference)) | 5.71 s |


### Contradictory, impossible and unsupported requests

| Request | Expected | Actual | Match | Message returned to the organizer |
| --- | --- | --- | --- | --- |
| Lock a match to Court 3 at 12:30 on day 1 while Court 3 is blacked out 12:00-13:30 | invalid_instructions | invalid_instructions | PASS | [LOCKED_OUTSIDE_RULES] Locked match MD-INT A-R1-1 (lock-clash) on Court 3 at 12:30 on 2026-11-14 overlaps the blackout c3-blackout (12:00-13:30 on 2026-11-14). Move the lock or the blackout. |
| Women's Advanced starts no earlier than 14:00 but must finish by 12:00 | invalid_instructions | invalid_instructions | PASS | [CONTRADICTORY_BOUNDS] earliestStart is after latestEnd |
| Advanced Men's must finish by 08:10 (a 20-minute match cannot fit before the first slot ends) | proven_infeasible | proven_infeasible | PASS | No schedule exists: at least one necessary condition fails. This is a proof, not a search outcome. Each failed condition is listed in `proof`, with the remedies in `feasibility`. |
| Advanced Men's must finish by 09:00 each day (the preliminary-to-medal chain cannot fit) | not_found | not_found | PASS | No schedule was found. The construction heuristics, including any randomised retries the time budget allowed, did not place every match. This is NOT a proof that no schedule exists: relaxing mandatory windows or court rules, adding court time or day length, or raising the budget may succeed. |
| Divisions MUST be played in consecutive blocks (mandatory) | invalid_instructions | invalid_instructions | PASS | [UNSUPPORTED_MANDATORY] Consecutive blocks are supported as a preference only; a mandatory block rule is not implemented |
| Delay everything by 30 minutes if it rains (weather_delay) | invalid_instructions | invalid_instructions | PASS | [INVALID_VALUE] Unsupported instruction kind "weather_delay". It was not applied. Supported kinds: time_window, court_allowlist, court_reservation, court_blackout, min_rest, locked_placement, consecutive_blocks, same_day_preliminaries. |


## 7. Independent verification

| Option | validateSchedule violations | Instruction violations | Actual player collisions or rest breaches over 20 simulated outcomes |
| --- | --- | --- | --- |
| A Fastest Finish | 0 | 0 | 0 |
| B Balanced Operations | 0 | 0 | 0 |
| C Player-First | 0 | 0 | 0 |

- Deterministic reproduction (same seed, iteration budget, no time cap): **identical schedules on two runs**.
- Fastest Finish finishes at minute 2290; earliest among the options is 2290: **Fastest Finish has the earliest finish**.
- Overall duration versus idle: A idle 1020, B idle 1330, C idle 1430. Duration and idle time are separate measures: in this run Fastest Finish also happens to have the least idle time, which is not guaranteed.
- Report and optimizer metrics agree on finish and idle minutes for every option: **true**.

## 8. Tight configurations and failure classification

| Configuration | Outcome | Earliest finish | Construction | Why (first failed condition) | Time |
| --- | --- | --- | --- | --- | --- |
| 10 courts, days end 19:00 | scheduled | day 2 13:50 | strategy_weights | - | 0.70 s |
| 10 courts, days end 17:00 | scheduled | day 2 15:05 | strategy_weights | - | 0.81 s |
| 10 courts, days end 15:00 | scheduled | day 2 13:50 | strategy_weights+fastest_finish_weights | - | 1.01 s |
| 10 courts, days end 14:40 | scheduled | day 2 14:15 | strategy_weights+fastest_finish_weights | - | 1.30 s |
| 10 courts, days end 14:30 | not_found | - | - | no proof: heuristic did not place every match | 3.87 s |
| 10 courts, days end 14:10 | not_found | - | - | no proof: heuristic did not place every match | 3.88 s |
| 10 courts, days end 13:30 | proven_infeasible | - | - | 12 divisions need 7440 court-minutes (incl. turnover) on all courts, but only 6700 are available (short by 740) | 0.15 s |
| 10 courts, days end 12:00 | proven_infeasible | - | - | 12 divisions need 7440 court-minutes (incl. turnover) on all courts, but only 4900 are available (short by 2540) | 0.13 s |
| 6 courts, days end 19:00 | scheduled | day 2 17:55 | strategy_weights+fastest_finish_weights | - | 1.09 s |
| 4 courts, days end 19:00 | proven_infeasible | - | - | 12 divisions need 7440 court-minutes (incl. turnover) on all courts, but only 5320 are available (short by 2120) | 0.14 s |

`proven_infeasible` means a necessary condition fails (a proof). `not_found` means the bounded construction attempts failed and is explicitly not a proof.

# B. Echelon-structure, one-day regression test


## B1. Scenario (synthetic participants only)

| Item | Value |
| --- | --- |
| Event | 2026-11-21, 09:00-21:00, one day only, 10 courts |
| Category windows (mandatory) | Genderless Doubles 09:00-12:00; Men's Doubles 12:00-15:00; Mixed Doubles 15:00-18:00; Women's Doubles 18:00-21:00 |
| Brackets per category | Novice 3, Low Intermediate 4, High Intermediate 3 (10 brackets of 4 teams, single round robin) |
| Totals | 40 brackets, 160 teams, 240 preliminary + 24 semifinal + 24 medal = 288 matches |
| Progression | Novice and High Intermediate: 3 bracket winners + 1 wildcard (best second-placed team). Low Intermediate: 4 bracket winners. Then 2 semifinals, 1 bronze, 1 gold |
| Configuration valid | true |


## B2. Time-allocation model

| Quantity | Minutes | Meaning |
| --- | --- | --- |
| Active playing time | 15 | informational |
| Transition allowance (inside the slot) | 5 | already part of the slot; never added again |
| Scheduled court occupancy, preliminary and semifinal | 20 | 15 playing + 5 transition |
| Medal match planning estimate | 30 | an estimate only: medal matches have no hard time cap and must be won by two points |
| Additional turnover buffer | 0 | only when explicitly configured; 0 here |
| Court cycle (earliest next start on a court) | 20 | slot + additional turnover |
| Participant recovery (assumed, see B3) | 10 | between the end of an occupied slot and the same team's next start |
| Participant cycle | 30 | slot + recovery |

Capacity check, as given: 10 courts x 12 h = 7200 court-minutes against a nominal need of 6000 (264 x 20 + 24 x 30). This is a necessary condition only.

## B3. Practical feasibility with the approved windows (recovery assumed 10 minutes)

Result: **proven_infeasible**. No schedule exists: at least one necessary condition fails. This is a proof, not a search outcome. Each failed condition is listed in `proof`, with the remedies in `feasibility`.

| Category window check | Result |
| --- | --- |
| Divisions GD-NOV, GD-LI, GD-HI share the same courts and windows and need 1500 court-minutes of 1800 available | pass |
| Divisions MD-NOV, MD-LI, MD-HI share the same courts and windows and need 1500 court-minutes of 1800 available | pass |
| Divisions XD-NOV, XD-LI, XD-HI share the same courts and windows and need 1500 court-minutes of 1800 available | pass |
| Divisions WD-NOV, WD-LI, WD-HI share the same courts and windows and need 1500 court-minutes of 1800 available | pass |
| Divisions GD-NOV, GD-LI, GD-HI: all first-round matches cannot end before 2026-11-21 11:00 (court capacity) and the longest playoff chain (recovery plus dependent matches) then needs 70 more minutes, so they cannot finish before 2026-11-21 12:10, but their window ends at 2026-11-21 12:00 | FAIL |
| Divisions MD-NOV, MD-LI, MD-HI: all first-round matches cannot end before 2026-11-21 14:00 (court capacity) and the longest playoff chain (recovery plus dependent matches) then needs 70 more minutes, so they cannot finish before 2026-11-21 15:10, but their window ends at 2026-11-21 15:00 | FAIL |
| Divisions XD-NOV, XD-LI, XD-HI: all first-round matches cannot end before 2026-11-21 17:00 (court capacity) and the longest playoff chain (recovery plus dependent matches) then needs 70 more minutes, so they cannot finish before 2026-11-21 18:10, but their window ends at 2026-11-21 18:00 | FAIL |
| Divisions WD-NOV, WD-LI, WD-HI: all first-round matches cannot end before 2026-11-21 20:00 (court capacity) and the longest playoff chain (recovery plus dependent matches) then needs 70 more minutes, so they cannot finish before 2026-11-21 21:10, but their window ends at 2026-11-21 21:00 | FAIL |

Why the windows cannot be met: in each category the 60 pool matches alone need 1200 court-minutes, which 10 courts cannot play in less than 120 minutes. The last pool match must then be followed by the recovery gap, a 20-minute semifinal, another recovery gap and a 30-minute medal match. That chain is 70 minutes at 10 minutes of recovery, so no category can finish before 190 minutes against a 180-minute window.

### Smallest meaningful changes, each tested by running the optimizer (reduced budget; nothing here is applied automatically)

| Variant | Outcome | Earliest finish |
| --- | --- | --- |
| Approved windows, recovery 10 min (assumed) | PROVEN infeasible | - |
| Approved windows, recovery 9 min | PROVEN infeasible | - |
| Approved windows, recovery 8 min | PROVEN infeasible | - |
| Approved windows, recovery 7 min | PROVEN infeasible | - |
| Approved windows, recovery 6 min | PROVEN infeasible | - |
| Approved windows, recovery 5 min | schedule found | 21:00 (event day ends 21:00, slack 0 min) |
| Approved windows, recovery 0 min | schedule found | 20:50 (event day ends 21:00, slack 10 min) |
| Recovery 10 min, windows 185 min each (event ends 21:20) | PROVEN infeasible | - |
| Recovery 10 min, windows 190 min each (event ends 21:40) | schedule found | 21:40 (event day ends 21:40, slack 0 min) |
| Recovery 10 min, windows 200 min each (event ends 22:20) | schedule found | 22:10 (event day ends 22:20, slack 10 min) |
| Recovery 10 min, windows 210 min each (event ends 23:00) | schedule found | 22:40 (event day ends 23:00, slack 20 min) |
| Approved windows, recovery 10 min, 11 courts | no schedule found (not a proof) | - |
| Approved windows, recovery 10 min, 12 courts | schedule found | 21:00 (event day ends 21:00, slack 0 min) |
| Recovery 10 min, windows 200 min each, medal estimate 40 min (contingency for long medal matches) | schedule found | 22:20 (event day ends 22:20, slack 0 min) |
| No category windows (whole day shared), recovery 10 min | schedule found | 19:10 (event day ends 21:00, slack 110 min) |

Recovery of 5 minutes means at least 10 minutes between the end of active play and the next match, because each slot already contains a 5-minute transition.

## B4. Three-option run at the largest recovery the approved windows allow (5 minutes)

The recovery requirement is not part of the brief, and 10 minutes is infeasible, so this run uses the largest value for which a schedule is found. **It is a demonstration of what the engine does when the rules are feasible, not an approved configuration.**
Status **ok**, 3 options, wall time **2.72 s** (construction 0.29 s, search 0.37 s). Time limited: false.
| Measure | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Matches scheduled | 288 of 288 | 288 of 288 | 288 of 288 |
| Earliest and latest match time | 09:00 start, 21:00 end (event 09:00-21:00) | 09:00 start, 21:00 end (event 09:00-21:00) | 09:00 start, 21:00 end (event 09:00-21:00) |
| Every match inside its category window and on the event date | true | true | true |
| Teams with preliminary matches split across days | 0 | 0 | 0 |
| Total idle court-minutes | 950 | 950 | 950 |
| Overall court utilization | 83% | 83% | 83% |
| Recovery min / average / max (min) | 5 / 18.0 / 20 | 5 / 18.0 / 20 | 5 / 18.0 / 20 |
| Back-to-back occurrences (gap < 15 min), teams affected | 48, 48 | 48, 48 | 48, 48 |
| Longest wait between a team's matches | 20 min (Genderless Doubles High Intermediate Team 1) | 20 min (Genderless Doubles High Intermediate Team 1) | 20 min (Genderless Doubles High Intermediate Team 1) |
| Playoff progression delay after the pools it depends on (min / mean / max, minutes) | 5 / 10.0 / 20 | 5 / 10.0 / 20 | 5 / 10.0 / 20 |
| Medal matches with under 10 min before their court is needed again | 18 | 18 | 18 |
| Violated preferences | medals-on-feature-court: 20 matches; comfortable-recovery-15: 0 recoveries; pool-play-same-day: 0 teams | medals-on-feature-court: 20 matches; comfortable-recovery-15: 0 recoveries; pool-play-same-day: 0 teams | medals-on-feature-court: 20 matches; comfortable-recovery-15: 0 recoveries; pool-play-same-day: 0 teams |
| validateSchedule violations / instruction violations | 0 / 0 | 0 / 0 | 0 / 0 |


### Completion by category (window end and slack)

| Category (window) | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Genderless Doubles (09:00-12:00) | 12:00 (slack 0 min) | 12:00 (slack 0 min) | 12:00 (slack 0 min) |
| Men's Doubles (12:00-15:00) | 15:00 (slack 0 min) | 15:00 (slack 0 min) | 15:00 (slack 0 min) |
| Mixed Doubles (15:00-18:00) | 18:00 (slack 0 min) | 18:00 (slack 0 min) | 18:00 (slack 0 min) |
| Women's Doubles (18:00-21:00) | 21:00 (slack 0 min) | 21:00 (slack 0 min) | 21:00 (slack 0 min) |


### Court utilization by court

| Court | A Fastest Finish | B Balanced Operations | C Player-First |
| --- | --- | --- | --- |
| Court 1 (feature) | 94% (32 matches, idle 35) | 92% (31 matches, idle 55) | 94% (32 matches, idle 35) |
| Court 2 | 85% (29 matches, idle 110) | 88% (30 matches, idle 90) | 85% (29 matches, idle 110) |
| Court 3 | 82% (28 matches, idle 125) | 76% (27 matches, idle 165) | 94% (32 matches, idle 35) |
| Court 4 | 85% (29 matches, idle 110) | 90% (31 matches, idle 70) | 79% (28 matches, idle 150) |
| Court 5 | 79% (28 matches, idle 90) | 82% (28 matches, idle 70) | 74% (26 matches, idle 130) |
| Court 6 | 75% (27 matches, idle 120) | 74% (26 matches, idle 130) | 78% (27 matches, idle 100) |
| Court 7 | 83% (29 matches, idle 120) | 88% (30 matches, idle 90) | 92% (31 matches, idle 60) |
| Court 8 | 94% (32 matches, idle 40) | 90% (31 matches, idle 70) | 82% (28 matches, idle 130) |
| Court 9 | 78% (27 matches, idle 100) | 83% (29 matches, idle 60) | 76% (27 matches, idle 110) |
| Court 10 | 78% (27 matches, idle 100) | 71% (25 matches, idle 150) | 79% (28 matches, idle 90) |


### Distinctness of the options

| Pair | Matches placed differently | Differs on | Pareto relation | Materially different |
| --- | --- | --- | --- | --- |
| fastest_finish vs balanced_operations | 19% | - | equivalent | false |
| fastest_finish vs player_first | 28% | - | b_dominates | false |
| balanced_operations vs player_first | 26% | - | b_dominates | false |

- Balanced Operations is materially equivalent to Fastest Finish (19% of matches are placed differently but no headline measure differs beyond the thresholds).
- Player-First is materially equivalent to Fastest Finish (28% of matches are placed differently but no headline measure differs beyond the thresholds).
- Player-First is materially equivalent to Balanced Operations (26% of matches are placed differently but no headline measure differs beyond the thresholds).
- Up to 2 diversification attempts were made. Failing to find a materially different schedule within the budget does not prove none exists.

**Recommended: balanced_operations.** Balanced Operations is the default recommendation. Fastest Finish and Balanced Operations do not differ materially on any measured objective. Some options are materially equivalent to each other (see the comparison), so the choice makes little practical difference.

Warnings: A: 26 risk / 15 info; B: 26 risk / 15 info; C: 26 risk / 15 info.
- info: 368 recoveries are below the 30-minute comfort level (48 of them are back-to-backs).
- info: 48 recovery gaps are within 5 minutes of the minimum rest rule, so a match overrunning its allocated time would breach it at the next start.
- info: 18 of 24 medal matches have less than 10 minutes before their court is needed again. Medal matches have no hard time cap, so a prolonged match would delay the next one on that court.
- info: Genderless Doubles Novice: a first-round knockout match starts only 20 minutes after the last preliminary match it depends on ends, so a qualifier from that pool has little rest.
- info: Genderless Doubles Low Intermediate: a first-round knockout match starts only 5 minutes after the last preliminary match it depends on ends, so a qualifier from that pool has little rest.

## B5. Court matrix (Balanced Operations)

Cell code: category (G Genderless, M Men's, X Mixed, W Women's) + level (N Novice, L Low Intermediate, H High Intermediate) + kind (p pool, s semifinal, g gold, b bronze). Columns are 20-minute slots; a cell shows the match that starts in that slot. A medal match continues into the next slot (30 min).

| Court | 09:00 | 09:20 | 09:40 | 10:00 | 10:20 | 10:40 | 11:00 | 11:20 | 11:40 | 12:00 | 12:20 | 12:40 | 13:00 | 13:20 | 13:40 | 14:00 | 14:20 | 14:40 | 15:00 | 15:20 | 15:40 | 16:00 | 16:20 | 16:40 | 17:00 | 17:20 | 17:40 | 18:00 | 18:20 | 18:40 | 19:00 | 19:20 | 19:40 | 20:00 | 20:20 | 20:40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | GNp | GHp | GNp | GHp | GNp | GHp | . | GNg | . | MNp | MHp | MNp | MHp | MNp | MHp | MNs | MNg | . | XNp | XHp | XNp | XHp | XNp | XHp | XNs | XNg | . | WNp | WHp | WNp | WHp | WNp | WHp | WNs | WNg | . |
| C2 | GNp | GHp | GNp | GHp | GNp | GHp | GHs | GHg | . | MNp | MHp | MNp | MHp | MNp | MHp | MHs | . | . | XNp | XHp | XNp | XHp | XNp | XHp | . | XHb | . | WNp | WHp | WNp | WHp | WNp | WHp | WNs | WHb | . |
| C3 | GNp | GHp | GNp | GHp | GNp | GHp | . | . | . | MNp | MHp | MNp | MHp | MNp | MHp | . | . | . | XNp | XHp | XNp | XHp | XNp | XHp | XHs | . | . | WNp | WHp | WNp | WHp | WNp | WHp | WHs | WNb | . |
| C4 | GNp | GHp | GNp | GHp | GNp | GHp | GHs | . | . | MNp | MHp | MNp | MHp | MNp | MHp | MHs | MHg | . | XNp | XHp | XNp | XHp | XNp | XHp | XHs | XNb | . | WNp | WHp | WNp | WHp | WNp | WHp | WHs | WHg | . |
| C5 | GNp | GHp | GNp | GHp | GNp | GHp | GNs | GNb | . | MLp | MLp | MNp | MHp | MNp | MHp | . | MHb | . | XLp | XLp | XNp | XHp | XNp | XHp | . | XHg | . | WLp | WLp | WNp | WHp | WNp | WHp | . | . | . |
| C6 | GNp | GHp | GNp | GHp | GNp | GHp | . | GHb | . | MLp | MLp | MNp | MHp | MNp | MHp | . | . | . | XLp | XLp | XNp | XHp | XNp | XHp | XNs | . | . | WLp | WLp | WNp | WHp | WNp | WHp | . | . | . |
| C7 | GLp | GLp | GLp | GLp | GLp | GLp | GLs | GLg | . | MNp | MHp | MLp | MLp | MLp | MLp | MLs | MLg | . | XNp | XHp | XLp | XLp | XLp | XLp | . | . | . | WNp | WHp | WLp | WLp | WLp | WLp | WLs | WLg | . |
| C8 | GLp | GLp | GLp | GLp | GLp | GLp | GLs | GLb | . | MNp | MHp | MLp | MLp | MLp | MLp | MLs | . | . | XNp | XHp | XLp | XLp | XLp | XLp | XLs | XLb | . | WNp | WHp | WLp | WLp | WLp | WLp | WLs | WLb | . |
| C9 | GLp | GLp | GLp | GLp | GLp | GLp | GNs | . | . | MLp | MLp | MLp | MLp | MLp | MLp | MNs | MNb | . | XLp | XLp | XLp | XLp | XLp | XLp | XLs | XLg | . | WLp | WLp | WLp | WLp | WLp | WLp | . | . | . |
| C10 | GLp | GLp | GLp | GLp | GLp | GLp | . | . | . | MLp | MLp | MLp | MLp | MLp | MLp | . | MLb | . | XLp | XLp | XLp | XLp | XLp | XLp | . | . | . | WLp | WLp | WLp | WLp | WLp | WLp | . | . | . |


## B6. Which guarantees are proven and which are sampled

| Option | Divisions enumerated | Outcomes examined | Match pairs checked | Violations in any outcome | Skipped |
| --- | --- | --- | --- | --- | --- |
| A Fastest Finish | 12 | 22528 | 5844048 | 0 | 0 |
| B Balanced Operations | 12 | 22528 | 5844048 | 0 | 0 |
| C Player-First | 12 | 22528 | 5844048 | 0 | 0 |

| Option | Collisions over 20 sampled full-tournament outcomes (including the wildcard) |
| --- | --- |
| A Fastest Finish | 0 |
| B Balanced Operations | 0 |
| C Player-First | 0 |

Playoff matches: 48, of which **48 are provisional** (their participants depend on results that do not exist yet; a match with the wildcard can contain any of up to 16 teams).

| Guarantee | Basis |
| --- | --- |
| Court, window, dependency and recovery rules for every match whose participants are fixed (pool matches) | Structural: independent validator, every pair of matches |
| Recovery and collision safety for every possible playoff participant, including the wildcard | Structural: the validator treats every team that could reach a match as present. The exhaustive check above re-derives it by enumerating every reachable outcome and found no violation |
| Random full-tournament outcomes | Sampled only (20 outcomes per option): regression coverage, not proof. The exhaustive check is the proof for this format |
| Tiebreaker matches | NOT covered: the plan contains none (ties are broken by wins, head-to-head, game and point difference, then a deterministic draw) |
| Medal matches finishing on time | NOT guaranteed: the 30-minute slot is an estimate |


## B7. Contingency: ties and extra matches

The plan contains 288 matches and is **not** an unconditional maximum. The engine settles ties without extra matches (wins, head-to-head among the tied teams, game difference, point difference, points for, then a deterministic draw). If the organizer would instead play tiebreaker matches, the worst cases are:

| Situation | Extra matches, worst case | Where |
| --- | --- | --- |
| Two teams tied for the qualifying position of a bracket | 1 per bracket | after that bracket, before its semifinals |
| Three teams tied in a bracket (each 2-1) | up to 3 per bracket (a mini round robin) or 2 (knockout) | after that bracket |
| Tie among best second-placed teams for the wildcard | up to 3 per wildcard division (8 divisions) | after all three brackets of the division |
| Worst case over the whole event | up to 144 matches (40 brackets x 3 + 8 wildcard divisions x 3), very unlikely | - |

Scheduling impact: this schedule has little spare capacity (the final category finishes with 0 minutes of slack at recovery 5), and a wildcard tie delays the semifinal that depends on all three brackets of that division. Reserve contingency time, or decide the tie rule, before the event.

---
Generated 2026-10-27T06:18:24.859Z by bench/acceptance.mjs.
