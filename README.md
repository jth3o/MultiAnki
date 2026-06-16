# MultiAnki

A minimal active-recall app for mastering multiplication facts (1×1 through 12×12).

## What it is

MultiAnki presents multiplication problems one at a time. You type your answer (or admit you don't know), and it shows immediate feedback. Facts you struggle with appear more often; facts you know well appear less often. Nothing else.

The goal is to validate a single hypothesis: does repeated active recall of multiplication facts improve accuracy?

## How to run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

Progress is stored in `localStorage` — it persists across page reloads automatically.

## What's included

- All 144 multiplication facts (1–12 × 1–12)
- Immediate correct/incorrect feedback
- Weighted random selection: wrong answers come back more often
- Session accuracy counter (correct / total)
- Keyboard-friendly: Enter to submit or advance

## What's intentionally excluded

- Authentication or accounts
- Teacher or parent dashboards
- Backend or database
- Spaced repetition scheduling (SM-2, Leitner, etc.)
- Mastery levels, streaks, badges, or points
- Multi-page routing
- Deployment configuration

These may be added later once the core learning loop is validated.
