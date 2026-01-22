# Canvas Sync Plugin for Obsidian

Sync your Obsidian markdown files to Canvas LMS. Supports multiple courses, automatic wiki-link resolution, and shared content discovery.

## Features

- **Multi-Course Support** — Sync to multiple Canvas courses/sections simultaneously
- **Folder-Based Modules** — Folder structure automatically maps to Canvas modules
- **Minimal Configuration** — Most files need no special frontmatter
- **Wiki-Link Resolution** — Obsidian `[[wiki-links]]` convert to Canvas internal links
- **Shared Content Discovery** — Files linked from courses are auto-synced
- **Auto-Sync on Save** — Optional watch mode syncs files when saved
- **Media Uploads** — Auto-upload images, audio, video, and PDFs to Canvas or Dropbox
- **YouTube Embeds** — Embed YouTube videos with standard markdown image syntax
- **Obsidian Callouts** — Callouts converted to styled Canvas divs
- **Context Menus** — Right-click files or folders to sync
- **Light/Dark Mode Support** — Automatic theme switching based on OS preference
- **Mobile Responsive** — Tables scroll horizontally, fonts scale on small screens
- **Customizable Styling** — Accent colors and custom CSS for institutional branding

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

Items within modules are ordered by:
1. `canvas_position` frontmatter (if specified)
2. Filename alphanumerically (as fallback)

Examples:
- `01.01-Lecture.md`, `01.02-Studio-Session.md`, `01.03-Assignment.md` → sorted alphabetically
- Files with `canvas_position: 1` will appear before `canvas_position: 2`

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

## Media Uploads

The plugin can automatically upload media files (images, audio, video, PDFs) embedded in your notes. You can choose to upload to either **Canvas Files** or **Dropbox**.

### Upload Destinations

| Destination | Pros | Cons |
|-------------|------|------|
| **Canvas** | No external dependencies, files stay in LMS | File size limits, slower uploads |
| **Dropbox** | Large file support, fast CDN, streaming URLs | Requires Dropbox account and app setup |

### Supported File Types

| Type | Extensions | Setting |
|------|------------|---------|
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg` | Upload Images |
| Audio | `.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac` | Upload Audio |
| Video | `.mp4`, `.webm`, `.mov` | Upload Video |
| Documents | `.pdf` | Upload PDFs |

### Embedding Media in Notes

Use standard Obsidian wiki-link syntax:

```markdown
![[my-audio-file.mp3]]
![[diagram.png]]
![[lecture-recording.mp4]]
```

When you sync, these embeds are replaced with HTML that plays/displays the media from your chosen upload destination.

### Setting Up Dropbox Integration

To use Dropbox for media uploads, you need to create a Dropbox App:

#### Step 1: Create a Dropbox App

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Click **Create app**
3. Choose **Scoped access**
4. Choose **Full Dropbox** (or App folder if you prefer limited access)
5. Name your app (e.g., "Obsidian Canvas Sync")
6. Click **Create app**

#### Step 2: Configure Permissions

**This step is critical — the app won't work without proper permissions.**

1. In your app settings, click the **Permissions** tab
2. Enable the following scopes:
   - `files.content.write` — Required for creating folders and uploading files
   - `files.content.read` — Required for reading file metadata
   - `sharing.write` — Required for creating shared links
3. **Click the "Submit" button at the bottom of the page**

> ⚠️ **Important:** You must click **Submit** after checking the permission boxes. The permissions are not saved until you submit them. This is a common gotcha!

#### Step 3: Configure the Redirect URI

1. In the **Settings** tab of your app, scroll to **OAuth 2**
2. Under **Redirect URIs**, add: `obsidian://canvas-sync-dropbox-auth`
3. Click **Add**

#### Step 4: Copy Your App Key

1. In the **Settings** tab, find **App key**
2. Copy this value — you'll need it in Obsidian

#### Step 5: Connect in Obsidian

1. Open Obsidian Settings → **Canvas Sync**
2. Scroll to **Media Uploads**
3. Set **Default Destination** to **Dropbox**
4. Paste your **Dropbox App Key**
5. Click **Authorize with Dropbox**
6. A browser window opens — sign in and authorize the app
7. You'll be redirected back to Obsidian with a success message

#### Step 6: Configure Upload Folder (Optional)

By default, files are uploaded to `/Canvas Media/{course-name}/`. You can configure a custom folder path per course in the course settings.

### Troubleshooting Dropbox

#### "App not permitted" or "Missing scope" Error

```
Your app is not permitted to access this endpoint because it does not have the required scope 'files.content.write'
```

**Solution:**
1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Select your app
3. Click the **Permissions** tab
4. Enable the required scopes (`files.content.write`, `files.content.read`, `sharing.write`)
5. **Click Submit** to save the permissions
6. In Obsidian, **disconnect and reconnect** to Dropbox (tokens must be refreshed after permission changes)

#### Authorization Callback Not Working

If clicking "Authorize" opens a browser but Obsidian doesn't receive the callback:

1. Make sure the redirect URI is exactly: `obsidian://canvas-sync-dropbox-auth`
2. Ensure Obsidian is registered as a URL handler on your system
3. Try closing and reopening Obsidian

#### Files Upload But Don't Play in Canvas

Dropbox shared links may take a moment to propagate. If audio/video doesn't play immediately:
1. Wait 30 seconds and refresh the Canvas page
2. Check that the shared link was created (visible in plugin debug logs)
3. Some Canvas instances block external content — check with your LMS admin

---

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
- Gradient header row (uses your accent color)
- Clean borders
- Alternating row colors
- Horizontal scrolling on mobile devices

## Content Styling

The plugin generates styled HTML with full support for light mode, dark mode, and mobile devices. All styling is configurable through the plugin settings.

### Theme Modes

| Mode | Behavior |
|------|----------|
| **Auto** (default) | Follows the user's OS/browser dark mode preference using `prefers-color-scheme` |
| **Light** | Always uses light theme colors |
| **Dark** | Always uses dark theme colors |

When set to Auto, content automatically adapts:
- Students using Canvas in a dark browser/OS see dark-themed content
- Students using light mode see light-themed content
- No action required from students — it just works

### Accent Color

The accent color is used for:
- **H1 heading underlines** — Colored border below main headings
- **Table header gradients** — Gradient from accent to a darker shade
- **Links** — Link text and underline color
- **Blockquote borders** — Left border accent
- **Callout borders** — Left border on callout boxes

Default: `#667eea` (purple-blue)

**Examples of accent colors:**
- `#667eea` — Purple-blue (default)
- `#2563eb` — Blue
- `#059669` — Green
- `#dc2626` — Red
- `#7c3aed` — Purple
- Match your institution's brand color!

### CSS Snippets

For advanced customization, use CSS snippets — modular CSS files that can be individually toggled on/off, similar to Obsidian's CSS snippets feature.

**Location:** `.obsidian/plugins/canvas-sync/snippets/`

**How to use:**
1. Click **Open Snippets Folder** in settings to open the folder
2. Create `.css` files in this folder
3. Click **Refresh** to see new snippets
4. Toggle snippets on/off with the checkboxes

**Benefits of snippets:**
- **Modular** — Separate concerns (branding, accessibility, mobile tweaks)
- **Shareable** — Share individual snippets with colleagues
- **Safe experimentation** — Test new styles without breaking working configs
- **Toggle on/off** — Quickly enable/disable customizations

**Example snippets:**

`institution-branding.css`:
```css
/* Custom table header with school colors */
.cs-thead {
  background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
}

/* Add institution logo */
.cs-container::before {
  content: '';
  display: block;
  height: 60px;
  background: url('https://yourschool.edu/logo.png') no-repeat;
  background-size: contain;
  margin-bottom: 20px;
}
```

`larger-headings.css`:
```css
/* Increase heading sizes for presentation mode */
.cs-h1 { font-size: 2.5em; }
.cs-h2 { font-size: 1.8em; }
.cs-h3 { font-size: 1.4em; }
```

`high-contrast.css`:
```css
/* High contrast mode for accessibility */
.cs-container { color: #000; }
.cs-link { color: #0000ee; text-decoration: underline; }
.cs-callout-body { color: #000; }
```

`custom-callouts.css`:
```css
/* Custom callout colors */
.cs-callout-important {
  background: #fef2f2;
  border-color: #dc2626;
}
.cs-callout-important .cs-callout-title {
  color: #b91c1c;
}
```

**Load order:** Snippets are loaded alphabetically by filename. Use numeric prefixes (e.g., `01-base.css`, `02-overrides.css`) to control order.

### CSS Class Reference

All elements use `cs-` prefixed classes for styling:

| Class | Element |
|-------|---------|
| `.cs-container` | Main content wrapper |
| `.cs-h1`, `.cs-h2`, `.cs-h3`, `.cs-h4` | Headings |
| `.cs-table-wrap` | Scrollable table container |
| `.cs-table` | Table element |
| `.cs-thead` | Table header |
| `.cs-th` | Table header cell |
| `.cs-td` | Table data cell |
| `.cs-tr` | Table row (body rows only) |
| `.cs-pre` | Code block container |
| `.cs-code` | Inline code |
| `.cs-code-block` | Code inside pre block |
| `.cs-blockquote` | Blockquote |
| `.cs-ul`, `.cs-ol` | Lists |
| `.cs-li` | List item |
| `.cs-link` | Links |
| `.cs-hr` | Horizontal rule |
| `.cs-strong` | Bold text |
| `.cs-callout` | Callout container |
| `.cs-callout-{type}` | Callout by type (note, tip, warning, etc.) |
| `.cs-callout-title` | Callout title |
| `.cs-callout-body` | Callout content |
| `.cs-video-container` | YouTube embed wrapper |
| `.cs-video-iframe` | YouTube iframe |

### Mobile Responsiveness

Content automatically adapts to smaller screens:

- **Tables** — Wrapped in a scrollable container, smaller padding and font
- **Headings** — Use `clamp()` for fluid font sizing (scales between min/max)
- **Callouts** — Reduced padding on mobile
- **Blockquotes** — Reduced padding and margins
- **Code blocks** — Smaller font, horizontal scrolling

The breakpoint is 600px. On screens narrower than this:
- Base font size reduces to 14px
- Table font reduces to 13px
- Spacing is tightened throughout

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

### Media Uploads

| Setting | Description |
|---------|-------------|
| **Enable Media Uploads** | Master toggle for media upload functionality |
| **Default Destination** | Where to upload media: Canvas or Dropbox |
| **Canvas Folder Name** | Folder name in Canvas Files for uploads (default: `canvas-sync`) |
| **Dropbox App Key** | Your Dropbox app's App Key (from App Console) |
| **Authorize/Disconnect** | Connect or disconnect your Dropbox account |
| **Upload Images** | Upload image files (png, jpg, gif, etc.) |
| **Upload Audio** | Upload audio files (mp3, wav, etc.) |
| **Upload Video** | Upload video files (mp4, webm, etc.) |
| **Upload PDFs** | Upload PDF documents |
| **Enforce Max File Size** | Enable/disable file size limit |
| **Max File Size** | Maximum file size for uploads in MB (default: 100) |

See [Media Uploads](#media-uploads) for setup instructions.

### Content Styling

| Setting | Description |
|---------|-------------|
| **Theme** | Color scheme: Auto (follows OS), Light, or Dark |
| **Accent Color** | Primary color for links, headings, tables (hex format) |
| **CSS Snippets** | Toggle individual CSS snippet files on/off |
| **Open Snippets Folder** | Opens the snippets folder in your file manager |
| **Refresh** | Rescans the snippets folder for new/removed files |

See [Content Styling](#content-styling) for detailed documentation.

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

### Dark Mode Not Working

**Symptom:** Content stays light even when browser/OS is in dark mode.

**Causes:**
1. Theme is set to "Light" instead of "Auto" — check Content Styling settings
2. Browser doesn't support `prefers-color-scheme` — try a modern browser
3. Canvas may override some styles — try custom CSS to force colors

**Solutions:**
1. Set Theme to "Auto" in plugin settings
2. Re-sync the affected pages
3. If Canvas strips the `<style>` block, check with your Canvas admin

### CSS Snippets Not Applying

**Symptom:** CSS snippets aren't affecting Canvas content.

**Solutions:**
1. Verify the snippet is toggled **on** in settings
2. Click **Refresh** in settings to detect new snippet files
3. Check the CSS file has valid syntax (no errors)
4. Re-sync affected pages after enabling/changing snippets
5. Inspect the page source in Canvas to verify CSS is included
6. Your CSS selectors may need higher specificity — try adding `!important`

**Snippet not appearing in list:**
1. Ensure the file has a `.css` extension
2. Ensure it's in the correct folder: `.obsidian/plugins/canvas-sync/snippets/`
3. Click **Refresh** in settings

### Accent Color Not Changing

**Symptom:** Changed accent color but content still uses old color.

**Solutions:**
1. Ensure you entered a valid hex color (e.g., `#667eea`)
2. Re-sync affected pages after changing the color
3. Hard refresh the Canvas page

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
