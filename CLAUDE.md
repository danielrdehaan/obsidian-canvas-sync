# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Canvas Sync is an Obsidian plugin that synchronizes markdown files to Canvas LMS. It enables educators to manage course content in Obsidian and automatically sync pages, assignments, discussions, and external URLs to Canvas courses.

**Tech Stack:** TypeScript, Obsidian Plugin API, esbuild, Marked.js

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Development build with watch mode (inline source maps)
npm run build        # Production build (runs tsc type check first)
```

The build outputs `main.js` to the root directory.

**Important:** After building, always copy the plugin to the test vault:

```bash
cp main.js /Users/danielrdehaan/Documents/DRD_Vault/.obsidian/plugins/canvas-sync/
```

Then reload Obsidian (`Cmd+R`) to pick up the changes.

## Architecture

The plugin follows a layered architecture with clear separation of concerns:

```
main.ts (Plugin Entry)
    ├── UI orchestration (ribbon, menus, status bar, commands)
    ├── Settings persistence
    └── Watch mode (auto-sync on save)
           │
           ▼
sync-engine.ts (Orchestration)
    ├── Discovers module structure from folders
    ├── Resolves wiki-links and shared content
    └── Coordinates sync workflow
           │
           ▼
    ┌──────┴──────┬──────────────┬─────────────┐
    ▼             ▼              ▼             ▼
frontmatter.ts  link-parser.ts  converter.ts  canvas-api.ts
(YAML parsing)  (Wiki-links)    (MD→HTML)     (REST client)
```

### Key Modules

- **main.ts** - Plugin lifecycle, UI (ribbon icon, context menus, settings tab), command registration
- **sync-engine.ts** - Core sync logic: discovers folder structure, routes files to appropriate Canvas API calls
- **canvas-api.ts** - Canvas REST API client for pages, discussions, assignments, modules
- **converter.ts** - Transforms Obsidian markdown to styled HTML (callouts, YouTube embeds, wiki-links, theming)
- **frontmatter.ts** - Parses `canvas_*` frontmatter fields from markdown files
- **link-parser.ts** - Extracts and resolves `[[wiki-links]]`
- **settings.ts** - Settings UI tab and course/snippet management modals
- **types.ts** - TypeScript interfaces for content types, configs, and API responses

### Data Flow

1. User triggers sync → SyncEngine discovers module structure from folder hierarchy
2. For each markdown file: parse frontmatter → resolve wiki-links → convert to HTML
3. Route to Canvas API based on `canvas_type` (page, assignment, discussion, etc.)
4. Update status bar with results

### Content Types

The `canvas_type` frontmatter field determines how files are synced:
- `page` (default) - Wiki page
- `discussion` - Ungraded discussion
- `graded_discussion` - Discussion with gradebook entry (creates assignment + linked topic)
- `assignment` - File/text submission assignment
- `external_url` - Module item linking to external URL
- `syllabus` - Course syllabus page

### CSS Class Convention

Generated HTML uses `cs-` prefixed classes (e.g., `.cs-h1`, `.cs-table`, `.cs-callout-warning`) to avoid conflicts with Canvas's styles.

## Module Naming Convention

Folder names map to Canvas modules with numeric prefixes stripped:
- `00-Course-Info/` → "Course Info" module
- `01-Week-01/` → "Week 01" module

Files starting with `_` are excluded from sync (for local notes).
