# ARC AGI-2 Viewer

**[Try it live →](https://arc-agi2-viewer.netlify.app/)**

A local viewer for [ARC-AGI-2](https://arcprize.org/) puzzles. Load challenges, solutions, and model submissions to visually inspect grids, compare attempts side-by-side, and see accuracy scores broken down by complexity level.

![ARC AGI-2 Viewer]

## What it does

- **Browse tasks** — view all evaluation puzzles in a scrollable sidebar
- **See the grids** — training examples, test inputs, expected outputs, and model attempts displayed as colored grids
- **Compare submissions** — load up to two submission files and see which tasks each one got right or wrong
- **Similarity metrics** — pixel-level comparison between attempts and the expected output
- **Score breakdown** — accuracy tables by complexity level, number of training examples, and test pairs
- **Filter tasks** — by submission, complexity level, solved/unsolved, or similarity threshold
- **Export** — download a ZIP of all visualizations, stats, and task ID lists ready for Kaggle scripts

## Files it accepts

| File | What it is |
|------|-----------|
| `arc-agi_evaluation_challenges.json` | The puzzle inputs and training examples |
| `arc-agi_evaluation_solutions.json` | The correct answers |
| Submission JSON | A model's attempts (`attempt_1`, `attempt_2` per test pair) |
| Complexity analysis JSON | Optional — enables per-level filtering and breakdown |

The three default files are already included in this repo and load automatically on startup.

## How to run

You need [Node.js](https://nodejs.org/) installed (LTS version recommended). Do this once:

```
npm install
```

Then to launch the viewer:

```
npm run dev
```

Open **http://localhost:5173** in your browser.

**Windows shortcut:** the repo includes `ARC Viewer.bat` — double-click it to start the server and open the browser automatically.

## Tips

- Press **Spacebar** to toggle an overlay of the expected solution on top of any attempt
- The **Stats** button at the top right opens a score summary panel
- Upload your own submission JSON files using the sidebar buttons
- The complexity level filter only appears after loading a complexity analysis file
