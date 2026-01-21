# Canvas Sync Plugin for Obsidian

Sync your Obsidian markdown files to Canvas LMS. Supports multiple courses, automatic wiki-link resolution, and shared content discovery.

## Features

- **Multi-Course Support**: Sync to multiple Canvas courses/sections simultaneously
- **Folder-Based Modules**: Folder structure automatically maps to Canvas modules
- **Minimal Configuration**: Most files need no special frontmatter
- **Wiki-Link Resolution**: Obsidian wiki-links convert to Canvas internal links
- **Shared Content Discovery**: Files linked from courses are auto-synced
- **Auto-Sync on Save**: Optional watch mode syncs files when saved

## Installation

1. Copy the plugin folder to `.obsidian/plugins/canvas-sync/`
2. Enable in Settings > Community Plugins
3. Configure Canvas API credentials

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
│   └── 03-Assignment.md      → Discussion (needs canvas_type)
├── 02-Week-02/               → Module: "Week 02"
│   └── ...
```

**Module names** are derived from folder names:
- `00-Course-Info` → "Course Info"
- `01-Week-01` → "Week 01"

**Item order** is derived from filename prefixes:
- `01-Lecture.md` → position 1
- `02-Studio-Session.md` → position 2
- `03-Assignment.md` → position 3

## Frontmatter

Most files need no special frontmatter. The plugin uses smart defaults:

| Source | Canvas Title | Canvas Type |
|--------|--------------|-------------|
| `title` in frontmatter | Used if present | — |
| Filename | Converted (01-Lecture → "Lecture") | Inferred |

### When to Add Canvas Frontmatter

Only add `canvas_*` fields when you need to override defaults:

```yaml
---
title: My Lecture
canvas_type: discussion    # Override type (page is default)
canvas_sync: false         # Exclude from sync
---
```

### Available Fields

| Field | Purpose | Default |
|-------|---------|---------|
| `canvas_type` | `page`, `discussion`, `graded_discussion` | Inferred from filename |
| `canvas_title` | Override the title sent to Canvas | Uses `title` or filename |
| `canvas_position` | Override order in module | Uses filename prefix |
| `canvas_sync` | Set `false` to skip this file | `true` |
| `canvas_publish` | Publish state in Canvas | `true` |

### Example: Assignment File

Assignments should be discussions in Canvas:

```yaml
---
title: Assignment - Week 01
due_date: 2026-02-01
canvas_type: discussion
---
```

### Example: Exclude a File

```yaml
---
title: Draft Notes
canvas_sync: false
---
```

## Commands

| Command | Description |
|---------|-------------|
| `Canvas: Sync current file` | Sync the active file |
| `Canvas: Sync all courses` | Sync all enabled courses |
| `Canvas: Sync a course...` | Pick a course to sync |
| `Canvas: Open in Canvas` | Open current file in Canvas |
| `Canvas: Toggle auto-sync` | Enable/disable watch mode |

## Settings

### Canvas API
- **API URL**: Your Canvas instance (e.g., `https://canvas.yourschool.edu`)
- **API Token**: Generate at Canvas > Account > Settings > New Access Token

### Courses
Add courses with:
- **Name**: Display name (e.g., "SP26-MUSC-175")
- **Path**: Vault path to course folder
- **Course IDs**: Comma-separated Canvas course IDs

### Shared Content
- **Path**: Folder containing shared resources
- Files wiki-linked from courses are auto-synced to those courses

## How It Works

1. **Module Discovery**: Scans course folder for subfolders
2. **File Parsing**: Reads frontmatter and content
3. **Type Inference**: Determines page vs discussion
4. **HTML Conversion**: Converts markdown with Canvas styling
5. **API Sync**: Creates/updates pages and discussions

## Development

```bash
npm install
npm run build    # Production build
npm run dev      # Watch mode
```

## License

MIT
