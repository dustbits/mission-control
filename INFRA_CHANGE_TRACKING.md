# Infrastructure Change Tracking — Procedure

> **Owner:** Sanji (Ops/Deploy Agent)  
> **Location:** `/home/zoro/bin/infra-tracking/`  
> **Storage:** Google Drive (folder via secret `google-drive-folder-id`) + local `/tmp/infra-snapshots/`  
> **Schedule:** Daily via cron — runs as part of the overnight audit pipeline

---

## Overview

Every day, the infra-tracking pipeline captures a full infrastructure snapshot and diffs it against the previous day's snapshot. Two files are produced:

| File | Purpose |
|------|---------|
| `infra-snapshot-YYYY-MM-DD.json` | Full point-in-time state of all infrastructure |
| `infra-changes-YYYY-MM-DD.md` | Human-readable diff — what changed since yesterday |

Both are uploaded to a designated Google Drive folder automatically.

---

## What Gets Tracked

The snapshot covers **10 sections**:

### 1. MC Deploy History
Recent deploys from `deployHistory.json` (last 10 entries) — commit SHA, message, branch, agent, changed files, duration.

### 2. MC Live Status
Active agents, board columns, total task count from `mission-control-live.json`.

### 3. Git State
Current branch, HEAD SHA + message, last 5 commits, dirty/untracked/staged files, remotes — from `/mnt/spike-storage/mission-control-staging/.git`.

### 4. GCP Resources
All Google Cloud resources via `gcloud` CLI:
- Compute Engine instances
- Cloud Run services
- Secrets (list)
- GCS buckets
- Cloud SQL instances
- Container images

### 5. GCP Secrets Detail
Top 10 secrets + their 3 most recent versions (from `gcloud secrets versions list`). Catches secret rotations and new secrets added.

### 6. Docker Containers
All containers (running + stopped) — ID, name, image, status, state.

### 7. Cron Job History
All cron job names, and which ones have recorded errors (e=1 samples) — from `cron-error-history.json`.

### 8. System State
Disk usage (`df -h`), memory (`free -h`), uptime, load average.

### 9. OpenClaw State
OpenClaw container status, checked memory paths.

### 10. Agent Dispatch Log
Last 30 lines of `shared-log.txt` / `shared-log.md` — captures recent agent dispatches.

---

## Scripts

### `infra-snapshot.py` — Capture
```bash
python3 /home/zoro/bin/infra-tracking/infra-snapshot.py [OUTPUT_DIR]
# Output: infra-snapshot-YYYY-MM-DD.json
```

### `infra-diff.py` — Diff
```bash
python3 /home/zoro/bin/infra-tracking/infra-diff.py [INPUT_DIR] [OUTPUT_DIR]
# Output: infra-changes-YYYY-MM-DD.md
# Compares two most recent snapshots in INPUT_DIR
```

### `drive-uploader.py` — Google Drive (OAuth2 via GCP secrets)
```bash
# One-time OAuth setup (run interactively on a machine with a browser):
python3 /home/zoro/bin/infra-tracking/drive-uploader.py init

# List files in target folder:
python3 /home/zoro/bin/infra-tracking/drive-uploader.py list-folder

# Upload a file:
python3 /home/zoro/bin/infra-tracking/drive-uploader.py upload <file> [--name <display_name>]
```

> **Alternative: `gog` CLI (OpenClaw)** — `gog` is pre-authenticated as `ops@ironthread.ai` and supports all Drive operations without needing OAuth secrets:
> ```bash
> gog drive ls [folder-id]           # List files
> gog drive upload <file> --folder <folder-id> [--name <name>]  # Upload
> ```
> No secret management needed. Preferred for OpenClaw-integrated workflows.

### `infra-daily.sh` — Orchestrator
```bash
# Full daily run:
bash /home/zoro/bin/infra-tracking/infra-daily.sh
```
Steps: capture → diff → upload to Drive → write to shared-log.

---

## Google Drive Setup (One-Time)

1. Run the OAuth flow on a machine with browser access:
   ```bash
   python3 /home/zoro/bin/infra-tracking/drive-uploader.py init
   ```
   This opens a browser for Google account authorization.

2. After authorization, copy the printed refresh token.

3. Store it as a GCP secret:
   ```bash
   echo -n "<refresh_token>" | gcloud secrets create google-drive-refresh-token \
     --data-file=- --project=gen-lang-client-0412397372
   ```

4. Create a Google Drive folder, copy its ID (from the folder URL), and store it:
   ```bash
   echo -n "<folder_id>" | gcloud secrets create google-drive-folder-id \
     --data-file=- --project=gen-lang-client-0412397372
   ```

5. Verify with:
   ```bash
   python3 /home/zoro/bin/infra-tracking/drive-uploader.py list-folder
   ```

---

## Cron Integration

Add to crontab (`crontab -e`) to run daily at ~06:00 UTC:
```cron
0 6 * * * bash /home/zoro/bin/infra-tracking/infra-daily.sh >> /home/zoro/logs/infra-daily.log 2>&1
```

Or wire into the existing overnight-audit pipeline:
```bash
# In your overnight-audit.sh or equivalent:
bash /home/zoro/bin/infra-tracking/infra-daily.sh
```

---

## File Retention

- **Local (`/tmp/infra-snapshots/`):** Keep last 30 days rolling. Old snapshots are pruned automatically if disk is tight; Drive holds the master record.
- **Google Drive:** All snapshots and diffs accumulate. Use Drive search/filter to find specific dates.

---

## Sample Diff Output

```markdown
# Infrastructure Change Report
**Date:** 2026-04-09
**Previous Snapshot:** 2026-04-08
**Generated:** 2026-04-09T06:00:12Z

## MC Deploy History
  **mc_deploy_history.count:** `14` → `15`

## Git State
  **+ git commit:** `a1d1575` chore: sync deployHistory + live JSON post
  **git_state.branch:** `master` → `master`

## Docker Containers
  **+ Added containers:** `['openclaw-new-001']`
```

---

## Drive File Naming Convention

```
infra-snapshot-2026-04-09.json   (full snapshot, overwrite-safe per day)
infra-changes-2026-04-09.md      (diff report, overwrite-safe per day)
```

Both land in the same Google Drive folder. Filenames include the date so you can find any day's state at a glance.

---

## Secrets Required

| Secret Name | Project | Purpose |
|-------------|---------|---------|
| `google-drive-refresh-token` | gen-lang-client-0412397372 | OAuth2 token for Drive API |
| `google-drive-folder-id` | gen-lang-client-0412397372 | Target Drive folder ID |
