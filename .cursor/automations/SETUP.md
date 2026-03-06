# Cursor Automation Setup — AI Auto-Fix

One-time setup. Takes about 2 minutes.

## Step 1 — Open Cursor Automations

Go to **cursor.com** in your browser → sign in → left sidebar → **Automations** → **+ New**

## Step 2 — Name it

```
TorchLit AI Auto-Fix
```

## Step 3 — Set the trigger

Choose: **Slack message received**
- Connect your Slack workspace if not already connected
- Channel: whichever channel receives the TorchLit AI Review webhook (the one in SLACK_WEBHOOK secret)
- Filter: `:red_circle:` (so it only fires on CRITICAL runs, not clean passes)

## Step 4 — Paste the agent prompt

Open `.cursor/automations/ai-fix-prompt.txt` and paste the full contents into the prompt field.

## Step 5 — Set the repository

Make sure the automation is scoped to: `mootoo4499/torchlit-games-website`

## Step 6 — Save and enable

Click **Create**. It's live.

---

## How the full pipeline works end-to-end

```
You push to main
  → GitHub Actions runs Claude review
    → CRITICAL found
      → GitHub Issue created (label: bug, ai-review)
      → Slack message fires: ":red_circle: TorchLit AI Review — N CRITICAL issues found"
        → Cursor Automation triggers
          → Agent reads the Issue, finds the file, applies the fix
          → Opens a PR: [AI-FIX] fix: description (closes #N)
            → You review the PR and merge (or close if wrong)
```

## What you review

Just the PRs that land in your repo labeled `[AI-FIX]`. Each one is one CRITICAL finding, one surgical fix, ready to merge or discard.
