# Operator walkthrough: Qourts Smart Scheduler

A guided run you can do yourself, start to finish, with no help from Claude. It uses the built-in demo event, "Guided demo: club championship" (6 courts, 6 divisions, 2 days, 102 matches, a few players entered in more than one division). Allow about 20 minutes.

## Start the app

From the repository folder, in any terminal (including the Terminal panel in Claude Code Desktop):

```bash
npm install
```

```bash
npm run app
```

Open **http://localhost:5173** in your browser. Stop the app with `Ctrl+C`. Needs Node 20 or newer. The first command is only needed once.

Your work is saved in **this browser only**, under that address. Always use the same URL, or you will not see your saved projects. Nothing is synced or backed up; use the JSON export (step 7) to keep a copy.

## 1. Set up

1. On the home screen, choose **Open example** on *Guided demo: club championship*.
2. Look through the four parts: *Event & timing*, *Courts*, *Divisions & teams*, *Review*. Switch **Simple / Advanced** at the top right to see more options (court names and tags, per-division windows, recovery overrides).
3. In *Divisions & teams*, notice that Ben Lim, Carla Diaz and Omar Tan appear in two divisions each. The scheduler treats them as one person, so their matches can never overlap and they get proper rest.
4. In *Review* you should see **102 matches** and "No blocking problem found". Try changing recovery to 5 and watch the warning; set it back to 20.

## 2. Special rules

1. Go to **Special rules**. Under the text box click each of the six suggested requests, then **Interpret**.
2. Read the review cards:
   - "Court 3 is unavailable..." and "Women's Doubles cannot start before 1 PM..." are clear hard rules.
   - "Prefer to keep pool play on one day" can only be a preference.
   - "Reserve Court 6..." and "At least 30 minutes..." do not say hard or preferred. The **Confirm** button stays disabled until you choose. Choose **Mandatory** for both.
3. Confirm all six. You should now see six confirmed rules.
4. Optional: press **Build a rule by hand** to see the manual editor, which always works without any AI.

## 3. Generate and compare

1. Go to **Generate & compare** and press **Generate three schedules** (a few seconds).
2. Read the recommendation and the three cards, then switch to **Detailed** for the full table. Green marks the best value where options differ.
3. Press **Use this schedule** under *Balanced Operations*.

Optional honest-failure test: change the first rule to "Advanced Men's Doubles must finish by 12:00 on day 1" and generate again. The app says no schedule was found and that this is not a proof of impossibility.

## 4. Edit on the court matrix

1. On **Schedule**, switch days and zoom. Court 6 should only hold medal matches (marked ★). Court 3 should be empty from 12:00 to 13:30 on day 1.
2. Click a match. In the side panel, set Court 3, day 1, start 12:30 and watch it say **Not allowed**, with the reason. Nothing changes.
3. Drag a match to another court or time. Green ghost = allowed, red = not allowed. Drop on another match to swap.
4. Use the panel instead of dragging (court, day, time, nudge buttons, *Or swap with*). Read the impact table, then **Apply change**.
5. Use **Undo** and **Redo**.

## 5. Locks

1. Select three matches and press **Lock this match in place** for each. Try to move one: it refuses.
2. Go to **Generate & compare** and press **Generate again**. The note says it kept your locked matches exactly where they were. Use a new option and check on the matrix that the locked matches did not move.
3. Conflict test: on **Special rules**, add "Court 1 is unavailable 08:00-18:00 on day 1" as a mandatory rule, and lock a match that sits on Court 1 on day 1. Generate again. You get an explanation naming the conflicting lock and three choices: revise the locks, release the conflicting lock, or keep everything as is. Nothing is released unless you choose it.

## 6. Approve, and see approval protected

1. Go to **Approve & export**. If risks are listed, read them and tick the box, then **Approve this schedule**. The status becomes *approved*.
2. Go back to **Schedule** and move any match. A message says approval was withdrawn and the status returns to *draft*. Approving again is a deliberate step. The same happens after undo, regeneration, locking, or changing the setup or rules.

## 7. Save, reload, export

1. Press `F5`. The app shows your saved project on the home screen; open it and check its status and schedule.
2. On **Approve & export**, download the match list (CSV), the court grid (CSV) and the whole project (JSON), and try **Print or save as PDF**.
3. On the home screen, **Import a saved file** with the JSON. An import only keeps its approval if the file is consistent and the engine still passes the schedule.

## Also try

- Open *Echelon-style one day* and find the experimental warning on every screen. Its recovery value is an assumption, not an official rule, and the schedule is not suitable for live operations.
- Open *Club weekend open* (192 matches) to see a bigger event.

## If something looks wrong

Note the step, what you expected and what you saw, and a screenshot if you can. Browser storage can be cleared by the browser; if a project vanishes, that is why. The JSON export is your backup.
