# Canvas Sync Plugin for Obsidian

Sync your Obsidian markdown files to Canvas LMS. Supports multiple courses, automatic wiki-link resolution, and shared content discovery.

## Features

- **Multi-Course Support** — Sync to multiple Canvas courses/sections simultaneously
- **Folder-Based Modules** — Folder structure automatically maps to Canvas modules
- **Minimal Configuration** — Most files need no special frontmatter
- **Wiki-Link Resolution** — Obsidian `[[wiki-links]]` convert to Canvas internal links
- **Shared Content Discovery** — Files linked from courses are auto-synced
- **Auto-Sync on Save** — Optional watch mode syncs files when saved
- **YouTube Embeds** — Embed YouTube videos with standard markdown image syntax
- **Obsidian Callouts** — Callouts converted to styled Canvas divs
- **Context Menus** — Right-click files or folders to sync

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract to `.obsidian/plugins/canvas-sync/`
3. Enable the plugin in Settings → Community Plugins
4. Configure your Canvas API credentials

## Quick Start

### 1. Get Your Canvas API Token

1. Log into your Canvas instance
2. Click your profile icon → **Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Enter a purpose (e.g., "Obsidian Sync") and expiration date
6. Click **Generate Token**
7. **Copy the token immediately** — you won't be able to see it again

### 2. Find Your Course ID(s)

The course ID is in your Canvas URL:

```
https://canvas.yourschool.edu/courses/12345
                                     ^^^^^
                                     This is your course ID
```

If you teach multiple sections of the same course, you'll have multiple IDs.

### 3. Configure the Plugin

1. Open Obsidian Settings → **Canvas Sync**
2. Enter your **Canvas API URL** (e.g., `https://canvas.yourschool.edu`)
3. Paste your **API Token**
4. Click **Test Connection** to verify
5. Click **Add Course** and enter:
   - **Name**: Display name (e.g., "SP26-MUSC-175")
   - **Path**: Path to your course folder in the vault
   - **Course IDs**: Your Canvas course ID(s), comma-separated

### 4. Sync!

- Use the ribbon icon (cloud upload) to open the sync menu
- Or use Command Palette: `Canvas: Sync all courses`

## Folder Structure

The plugin uses folder structure to create Canvas modules:

```
Course-Folder/
├── 00-Course-Info/           → Module: "Course Info"
│   ├── Syllabus.md           → Page (uses title from frontmatter)
│   └── Course-Hub.md         → Page
├── 01-Week-01/               → Module: "Week 01"
│   ├── 01-Lecture.md         → Page: "Lecture"
│   ├── 02-Studio-Session.md  → Page: "Studio Session"
│   └── 03-Assignment.md      → Graded Discussion (with canvas_type: graded_discussion)
├── 02-Week-02/               → Module: "Week 02"
│   └── ...
```

### Module Names

Module names are derived from folder names by removing the numeric prefix:
- `00-Course-Info` → "Course Info"
- `01-Week-01` → "Week 01"
- `15-Finals-Week` → "Finals Week"

### Item Order

Items within modules are ordered by filename prefix:
- `01-Lecture.md` → position 1
- `02-Studio-Session.md` → position 2
- `03-Assignment.md` → position 3

## Frontmatter Reference

Most files need no special frontmatter. The plugin uses smart defaults based on filename and folder structure.

### When to Add Frontmatter

Add `canvas_*` fields when you need non-default behavior:

```yaml
---
title: My Custom Page Title
canvas_type: discussion    # Required for non-page content (default: page)
canvas_sync: false         # Exclude from sync
---
```

**Important:** Content type is determined **only** by `canvas_type` frontmatter. There is no filename inference — a file named `Assignment.md` becomes a **page** unless you add `canvas_type: assignment`.

### Available Fields

#### Common Fields (all types)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `canvas_type` | string | `page` | Content type (see below) |
| `canvas_title` | string | Uses `title` | Override the title sent to Canvas |
| `canvas_position` | number | From filename | Override order within module |
| `canvas_sync` | boolean | `true` | Set `false` to skip this file |
| `canvas_publish` | boolean | `true` | Publish state in Canvas |

#### Content Types

| `canvas_type` | Canvas Result |
|---------------|---------------|
| `page` | Wiki page (default) |
| `discussion` | Ungraded discussion topic |
| `graded_discussion` | Graded discussion (appears in gradebook) |
| `assignment` | Assignment with file/text submissions |
| `external_url` | Module item linking to URL |

**Discussion vs Graded Discussion:**
- `discussion` — Creates a standard discussion topic. Students can post and reply, but there's no grade attached.
- `graded_discussion` — Creates a discussion that appears in the Canvas gradebook. Supports points, due dates, and grading. Technically implemented as an assignment with a linked discussion topic.

#### Graded Discussion Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `canvas_points` | number | `0` | Points possible |
| `canvas_due_date` | string | — | Due date (YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD) |
| `canvas_lock_at` | string | — | Lock date (no more posts accepted) |
| `canvas_unlock_at` | string | — | Unlock date (discussion opens) |
| `canvas_assignment_group` | string | — | Assignment group name (auto-created if needed) |

#### Assignment-Specific Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `canvas_points` | number | `0` | Points possible |
| `canvas_due_date` | string | — | Due date (YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD) |
| `canvas_lock_at` | string | — | Lock date (submissions closed) |
| `canvas_unlock_at` | string | — | Unlock date (available from) |
| `canvas_submission_types` | array | `['online_upload', 'online_text_entry']` | Allowed submission types |
| `canvas_allowed_extensions` | array | — | File extensions for uploads (e.g., `['zip', 'wav', 'mp3']`) |
| `canvas_grading_type` | string | `points` | Grading scheme |
| `canvas_assignment_group` | string | — | Assignment group name (auto-created if needed) |

**Submission Types:**
- `online_upload` — File upload
- `online_text_entry` — Rich text box
- `online_url` — URL submission
- `media_recording` — Audio/video recording
- `none` — No submission (attendance, in-class work)

**Grading Types:**
- `points` — Numeric points (default)
- `pass_fail` — Pass/Fail
- `percent` — Percentage
- `letter_grade` — A-F letter grades
- `not_graded` — Ungraded

#### External URL Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `canvas_url` | string | **Required** | The external URL to link to |
| `canvas_new_tab` | boolean | `true` | Open link in new tab |

### Example: Assignment with File Upload

```yaml
---
title: Week 03 Sound Design Project
canvas_type: assignment
canvas_points: 100
canvas_due_date: 2026-02-15T23:59:00
canvas_submission_types:
  - online_upload
canvas_allowed_extensions:
  - zip
  - wav
  - mp3
---

## Assignment Instructions

Create a 30-second sound design piece...
```

### Example: Simple Assignment

For common cases, minimal frontmatter works:

```yaml
---
title: Assignment 1
canvas_type: assignment
canvas_points: 10
canvas_due_date: 2026-02-15
---
```

Defaults to `['online_upload', 'online_text_entry']` submission types.

### Example: Ungraded Discussion

```yaml
---
title: Week 03 Discussion
canvas_type: discussion
---

## Discussion Prompt

Share your thoughts on...
```

### Example: Graded Discussion

For weekly check-ins, habit updates, or any discussion that needs grading:

```yaml
---
title: Assignment - Week 03
canvas_type: graded_discussion
canvas_points: 4
canvas_due_date: 2026-02-15T23:59:00
canvas_assignment_group: Weekly Discussions
---

## Weekly Habit Check-In

Share your progress this week...
```

This creates a discussion that:
- Appears in the Canvas gradebook
- Has a due date visible to students
- Can be graded out of the specified points
- Is organized in the "Weekly Discussions" assignment group (created if it doesn't exist)

### Example: External URL

Link to external resources without creating a page:

```yaml
---
title: Spotify Playlist - Week 03
canvas_type: external_url
canvas_url: "https://open.spotify.com/playlist/xyz"
---

Listening materials for this week's lecture.
```

Note: The markdown body is for your Obsidian reference only — Canvas just shows the link.

### Example: Exclude a File

```yaml
---
title: Draft Notes (Work in Progress)
canvas_sync: false
---
```

## Media Embeds

### YouTube Videos

Embed YouTube videos using standard markdown image syntax:

```markdown
![Video Title](https://www.youtube.com/watch?v=VIDEO_ID)
```

Also supports shortened URLs:

```markdown
![](https://youtu.be/VIDEO_ID)
```

The plugin converts these to responsive iframes in Canvas.

### Images

Standard markdown images work normally:

```markdown
![Alt text](path/to/image.png)
```

## Obsidian Features Support

### Callouts

Obsidian callouts are converted to styled Canvas divs with appropriate colors:

```markdown
> [!note] Important Information
> This will render as a blue info box in Canvas.

> [!warning] Deadline Approaching
> This will render as an orange warning box.
```

**Supported callout types:** `note`, `tip`, `warning`, `important`, `info`, `example`, `quote`

### Wiki-Links

Wiki-links are converted to Canvas internal links:

```markdown
See the [[Syllabus]] for details.
```

Becomes a clickable link to the Syllabus page in Canvas.

**In markdown tables**, use `\|` for the pipe character in wiki-link display text:

```markdown
| Resource | Link |
|----------|------|
| Overview | [[Course-Hub\|Course Hub]] |
```

### Tables

Tables are styled with:
- Gradient header row (purple)
- Clean borders
- Alternating row colors (on some themes)

## Commands

Access via Command Palette (Cmd/Ctrl + P):

| Command | Description |
|---------|-------------|
| `Canvas: Sync current file` | Sync the active file to all configured courses |
| `Canvas: Sync all courses` | Sync all enabled courses |
| `Canvas: Sync a course...` | Pick a specific course to sync |
| `Canvas: Setup course structure` | Create Canvas modules from folder structure |
| `Canvas: Open in Canvas` | Open the current file's Canvas page in browser |
| `Canvas: Toggle auto-sync` | Enable/disable watch mode |

## UI Elements

### Ribbon Icon

- Click the **cloud upload icon** in the left ribbon to open the sync menu
- The icon animates (changes to a loader) during sync operations
- Menu options:
  - Sync current file
  - Sync individual courses
  - Sync all courses
  - Toggle auto-sync

### Status Bar

Shows current sync state at the bottom of Obsidian:
- `Canvas: Watching` — Auto-sync is enabled
- `Canvas: Idle` — Auto-sync is disabled
- `Canvas: Syncing...` — Sync in progress
- `Canvas: Watching (2m ago)` — Last sync time

### Context Menus

**File context menu** (right-click a markdown file):
- "Sync to Canvas" — Sync this file

**Folder context menu** (right-click a folder inside a course):
- "Sync folder to Canvas" — Sync all markdown files in this folder

## Settings Reference

### Canvas API

| Setting | Description |
|---------|-------------|
| **API URL** | Your Canvas instance URL (e.g., `https://canvas.yourschool.edu`) |
| **API Token** | Your Canvas API access token |
| **Test Connection** | Verify credentials are working |

### Courses

Add courses with:
- **Name** — Display name for the course
- **Path** — Vault path to course folder
- **Course IDs** — Canvas course IDs (comma-separated for multiple sections)
- **Enable/Disable** — Toggle syncing for individual courses

### Shared Content

| Setting | Description |
|---------|-------------|
| **Shared Content Path** | Folder containing shared resources |
| **Sync Shared Content** | Auto-sync files wiki-linked from courses |

When enabled, any file in the Shared Content folder that is wiki-linked from a course will automatically sync to that course.

### Sync Behavior

| Setting | Description |
|---------|-------------|
| **Sync on File Save** | Automatically sync when files are saved (2-second debounce) |
| **Show Status Bar** | Display sync status in the status bar |
| **Debug Mode** | Enable detailed logging (check Developer Console) |

## Shared Content

The plugin supports sharing content across multiple courses:

1. Create a "Shared Knowledge" folder (or similar) in your vault
2. Set it as the **Shared Content Path** in settings
3. Wiki-link to shared files from your course content

When you sync a course, any wiki-linked shared files are automatically synced to that course. Each course gets its own copy with correct internal links.

**Example:**
```
Shared Knowledge/
├── Habits-Framework.md
└── Giving-Feedback.md

Course-A/01-Week-01/Lecture.md contains:
  "Review the [[Habits-Framework]] before class..."

→ Habits-Framework.md is auto-synced to Course-A
```

## Troubleshooting

### Wiki-links Not Resolving

**Symptom:** Links appear as italicized text instead of clickable links.

**Causes:**
1. Target file hasn't been synced yet — sync the entire course first
2. Filename mismatch — wiki-link target must match the filename exactly
3. File is in a different module — verify the linked file is in the course

### API Connection Issues

**Symptom:** "Connection failed" or timeout errors.

**Solutions:**
1. Verify your API URL doesn't have a trailing slash
2. Check that your token hasn't expired
3. Try generating a new token
4. Ensure your institution allows API access

### Files Not Syncing

**Symptom:** Files are skipped during sync.

**Check:**
1. `canvas_sync: false` in frontmatter excludes the file
2. Files starting with `_` are skipped (used for module notes)
3. File must be in a configured course folder

### Auto-sync Not Working

**Symptom:** Files don't sync when saved.

**Solutions:**
1. Verify "Sync on File Save" is enabled in settings
2. Check that the file is in a course folder or shared content path
3. There's a 2-second debounce — wait a moment after saving

### Canvas Shows Old Content

**Symptom:** Canvas page doesn't reflect latest changes.

**Solutions:**
1. Hard refresh the Canvas page (Cmd/Ctrl + Shift + R)
2. Check "Last sync" time in status bar
3. Try manual sync via Command Palette

## Development

```bash
# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build
```

## Support

- **Issues & Features:** [GitHub Issues](https://github.com/danielrdehaan/obsidian-canvas-sync/issues)
- **Support Development:** [Buy Me a Coffee](https://buymeacoffee.com/danielrdehaan)

## License

MIT
