import {
	App,
	Plugin,
	Notice,
	TFile,
	TFolder,
	TAbstractFile,
	PluginManifest,
	Menu,
	debounce,
	setIcon,
} from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import {
	CanvasSyncSettings,
	DEFAULT_SETTINGS,
	CanvasSyncSettingTab,
} from './settings';
import { CanvasApi } from './canvas-api';
import { SyncEngine } from './sync-engine';
import type { CourseConfig, SyncResult } from './types';

export default class CanvasSyncPlugin extends Plugin {
	settings: CanvasSyncSettings;
	canvasApi: CanvasApi;
	syncEngine: SyncEngine;

	private statusBarItem: HTMLElement | null = null;
	private watchModeEnabled = false;
	private fileModifyHandler: ((file: TAbstractFile) => void) | null = null;
	private ribbonIconEl: HTMLElement | null = null;
	private lastSyncTime: Date | null = null;
	private isSyncing = false;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.settings = DEFAULT_SETTINGS;
		this.canvasApi = new CanvasApi('', '', false);
		this.syncEngine = new SyncEngine(app, this.canvasApi, [], false);
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize API with settings
		this.canvasApi.setCredentials(
			this.settings.canvasApiUrl,
			this.settings.canvasApiToken
		);
		this.canvasApi.setDebugMode(this.settings.debugMode);

		// Initialize sync engine
		this.syncEngine.setSharedContentPaths(this.settings.sharedContentPaths);
		this.syncEngine.setDebugMode(this.settings.debugMode);
		this.syncEngine.setStyleSettings(this.settings.style);

		// Load and set CSS snippets
		await this.ensureSnippetsFolder();
		const customCss = await this.loadEnabledSnippets();
		this.syncEngine.setCustomCss(customCss);

		// Add settings tab
		this.addSettingTab(new CanvasSyncSettingTab(this.app, this));

		// Add ribbon icon
		this.ribbonIconEl = this.addRibbonIcon('upload-cloud', 'Canvas Sync', (evt) => {
			this.showSyncMenu(evt);
		});

		// Register commands
		this.registerCommands();

		// Set up status bar
		if (this.settings.showStatusBar) {
			this.setupStatusBar();
		}

		// Enable watch mode if configured
		if (this.settings.syncOnSave) {
			this.enableWatchMode();
		}

		// Register file menu items
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.addFileMenuItems(menu, file);
				} else if (file instanceof TFolder) {
					this.addFolderMenuItems(menu, file);
				}
			})
		);

		console.log('Canvas Sync plugin loaded');
	}

	onunload(): void {
		this.disableWatchMode();
		console.log('Canvas Sync plugin unloaded');
	}

	async loadSettings(): Promise<void> {
		const savedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);

		// Deep merge style settings to preserve defaults for missing properties
		this.settings.style = Object.assign(
			{},
			DEFAULT_SETTINGS.style,
			savedData?.style
		);

		// Migration: Convert old sharedContentPath to sharedContentPaths
		const data = this.settings as CanvasSyncSettings & { sharedContentPath?: string };
		if (data.sharedContentPath && (!this.settings.sharedContentPaths || this.settings.sharedContentPaths.length === 0)) {
			this.settings.sharedContentPaths = [data.sharedContentPath];
			delete data.sharedContentPath;
			await this.saveData(this.settings);
		}

		// Ensure sharedContentPaths is always an array
		if (!Array.isArray(this.settings.sharedContentPaths)) {
			this.settings.sharedContentPaths = [];
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Update components with new settings
		this.canvasApi.setCredentials(
			this.settings.canvasApiUrl,
			this.settings.canvasApiToken
		);
		this.canvasApi.setDebugMode(this.settings.debugMode);
		this.syncEngine.setSharedContentPaths(this.settings.sharedContentPaths);
		this.syncEngine.setDebugMode(this.settings.debugMode);
		this.syncEngine.setStyleSettings(this.settings.style);

		// Reload CSS snippets
		const customCss = await this.loadEnabledSnippets();
		this.syncEngine.setCustomCss(customCss);
	}

	/**
	 * Register plugin commands
	 */
	private registerCommands(): void {
		// Sync current file
		this.addCommand({
			id: 'sync-current-file',
			name: 'Sync current file to Canvas',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === 'md') {
					if (!checking) {
						this.syncCurrentFile();
					}
					return true;
				}
				return false;
			},
		});

		// Sync all courses
		this.addCommand({
			id: 'sync-all-courses',
			name: 'Sync all courses to Canvas',
			callback: () => {
				this.syncAllCourses();
			},
		});

		// Sync specific course (will show a modal to pick)
		this.addCommand({
			id: 'sync-course',
			name: 'Sync a course to Canvas...',
			callback: () => {
				this.showCoursePicker();
			},
		});

		// Setup course structure
		this.addCommand({
			id: 'setup-course',
			name: 'Setup course structure in Canvas...',
			callback: () => {
				this.showCoursePickerForSetup();
			},
		});

		// Open in Canvas
		this.addCommand({
			id: 'open-in-canvas',
			name: 'Open current file in Canvas',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file && file.extension === 'md') {
					if (!checking) {
						this.openInCanvas(file);
					}
					return true;
				}
				return false;
			},
		});

		// Toggle watch mode
		this.addCommand({
			id: 'toggle-watch-mode',
			name: 'Toggle auto-sync on save',
			callback: () => {
				this.settings.syncOnSave = !this.settings.syncOnSave;
				this.saveSettings();

				if (this.settings.syncOnSave) {
					this.enableWatchMode();
					new Notice('Canvas auto-sync enabled');
				} else {
					this.disableWatchMode();
					new Notice('Canvas auto-sync disabled');
				}
			},
		});
	}

	/**
	 * Show sync menu on ribbon click
	 */
	private showSyncMenu(evt: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Sync current file')
				.setIcon('file-up')
				.onClick(() => this.syncCurrentFile())
		);

		menu.addSeparator();

		for (const course of this.settings.courses.filter((c) => c.enabled)) {
			menu.addItem((item) =>
				item
					.setTitle(`Sync ${course.name}`)
					.setIcon('folder-up')
					.onClick(() => this.syncCourse(course))
			);
		}

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle('Sync all courses')
				.setIcon('cloud-upload')
				.onClick(() => this.syncAllCourses())
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle(this.settings.syncOnSave ? 'Disable auto-sync' : 'Enable auto-sync')
				.setIcon(this.settings.syncOnSave ? 'pause' : 'play')
				.onClick(() => {
					this.settings.syncOnSave = !this.settings.syncOnSave;
					this.saveSettings();
					if (this.settings.syncOnSave) {
						this.enableWatchMode();
						new Notice('Auto-sync enabled');
					} else {
						this.disableWatchMode();
						new Notice('Auto-sync disabled');
					}
				})
		);

		menu.showAtMouseEvent(evt);
	}

	/**
	 * Add items to file context menu
	 */
	private addFileMenuItems(menu: Menu, file: TFile): void {
		menu.addItem((item) =>
			item
				.setTitle('Sync to Canvas')
				.setIcon('upload-cloud')
				.onClick(() => this.syncFile(file))
		);
	}

	/**
	 * Add items to folder context menu
	 */
	private addFolderMenuItems(menu: Menu, folder: TFolder): void {
		// Check if this folder is within a course
		const course = this.settings.courses.find((c) =>
			folder.path.startsWith(c.path)
		);

		if (!course) return;

		menu.addItem((item) =>
			item
				.setTitle('Sync folder to Canvas')
				.setIcon('folder-up')
				.onClick(() => this.syncFolder(folder, course))
		);
	}

	/**
	 * Sync all markdown files in a folder
	 */
	async syncFolder(folder: TFolder, course: CourseConfig): Promise<void> {
		if (!this.validateSettings()) return;

		const files = this.app.vault.getMarkdownFiles().filter((f) =>
			f.path.startsWith(folder.path)
		);

		if (files.length === 0) {
			new Notice('No markdown files found in this folder');
			return;
		}

		this.startSync();
		new Notice(`Syncing ${files.length} files from ${folder.name}...`);

		let success = 0;
		let failed = 0;

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			this.updateStatusBar(`Syncing ${i + 1}/${files.length}...`);

			try {
				const results = await this.syncEngine.syncSingleFile(file, [course]);
				if (results.some((r) => r.success)) {
					success++;
				} else {
					failed++;
				}
			} catch (error) {
				failed++;
				console.error(`Error syncing ${file.path}:`, error);
			}
		}

		this.endSync();
		new Notice(`Folder sync complete: ${success} succeeded, ${failed} failed`);
	}

	/**
	 * Sync the currently active file
	 */
	async syncCurrentFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No file is currently open');
			return;
		}

		await this.syncFile(file);
	}

	/**
	 * Sync a specific file
	 */
	async syncFile(file: TFile): Promise<void> {
		if (!this.validateSettings()) return;

		this.startSync();
		this.updateStatusBar('Syncing...');

		try {
			const enabledCourses = this.settings.courses.filter((c) => c.enabled);
			const results = await this.syncEngine.syncSingleFile(file, enabledCourses);

			if (results.length === 0) {
				new Notice(`File ${file.name} is not in a configured course`);
				return;
			}

			const successful = results.filter((r) => r.success).length;
			const failed = results.filter((r) => !r.success).length;

			if (failed > 0) {
				new Notice(
					`Sync completed: ${successful} succeeded, ${failed} failed`,
					5000
				);
			} else {
				new Notice(`Synced ${file.name} to ${results.length} course(s)`);
			}
		} catch (error) {
			new Notice(`Sync failed: ${error}`);
			console.error('Sync error:', error);
		} finally {
			this.endSync();
		}
	}

	/**
	 * Sync a specific course
	 */
	async syncCourse(course: CourseConfig): Promise<void> {
		if (!this.validateSettings()) return;

		this.startSync();
		this.updateStatusBar(`Syncing ${course.name}...`);
		new Notice(`Starting sync for ${course.name}...`);

		try {
			const results = await this.syncEngine.syncCourse(course, (message) => {
				if (this.settings.debugMode) {
					console.log(message);
				}
			});

			let totalSuccess = 0;
			let totalFailed = 0;

			for (const result of results) {
				totalSuccess += result.success;
				totalFailed += result.failed;
			}

			new Notice(
				`${course.name} sync complete: ${totalSuccess} succeeded, ${totalFailed} failed`,
				5000
			);
		} catch (error) {
			new Notice(`Sync failed: ${error}`);
			console.error('Sync error:', error);
		} finally {
			this.endSync();
		}
	}

	/**
	 * Sync all enabled courses
	 */
	async syncAllCourses(): Promise<void> {
		if (!this.validateSettings()) return;

		const enabledCourses = this.settings.courses.filter((c) => c.enabled);

		if (enabledCourses.length === 0) {
			new Notice('No courses configured. Go to settings to add courses.');
			return;
		}

		this.startSync();
		this.updateStatusBar('Syncing all...');
		new Notice(`Starting sync for ${enabledCourses.length} course(s)...`);

		let totalSuccess = 0;
		let totalFailed = 0;

		for (let i = 0; i < enabledCourses.length; i++) {
			const course = enabledCourses[i];
			this.updateStatusBar(`Syncing ${course.name} (${i + 1}/${enabledCourses.length})...`);

			try {
				const results = await this.syncEngine.syncCourse(course);

				for (const result of results) {
					totalSuccess += result.success;
					totalFailed += result.failed;
				}
			} catch (error) {
				totalFailed++;
				console.error(`Error syncing ${course.name}:`, error);
			}
		}

		new Notice(
			`All courses synced: ${totalSuccess} succeeded, ${totalFailed} failed`,
			5000
		);

		this.endSync();
	}

	/**
	 * Sync all courses after a snippet change
	 * Shows progress and completion notices
	 */
	async syncAllCoursesForSnippetChange(): Promise<void> {
		const enabledCourses = this.settings.courses.filter((c) => c.enabled);

		if (enabledCourses.length === 0) {
			new Notice('No courses configured to sync');
			return;
		}

		// Count total files for progress
		let totalFiles = 0;
		for (const course of enabledCourses) {
			const files = this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.startsWith(course.path));
			totalFiles += files.length;
		}

		new Notice(`Syncing ${totalFiles} files across ${enabledCourses.length} course(s)...`);

		this.startSync();

		let success = 0;
		let failed = 0;

		for (const course of enabledCourses) {
			try {
				const results = await this.syncEngine.syncCourse(course);
				for (const result of results) {
					success += result.success;
					failed += result.failed;
				}
			} catch (error) {
				console.error(`Error syncing ${course.name}:`, error);
				failed++;
			}
		}

		this.endSync();
		new Notice(`Snippet sync complete: ${success} updated, ${failed} failed`);
	}

	/**
	 * Show course picker modal
	 */
	private showCoursePicker(): void {
		const enabledCourses = this.settings.courses.filter((c) => c.enabled);

		if (enabledCourses.length === 0) {
			new Notice('No courses configured. Go to settings to add courses.');
			return;
		}

		if (enabledCourses.length === 1) {
			this.syncCourse(enabledCourses[0]);
			return;
		}

		// Create a simple picker using the suggest modal
		const items = enabledCourses.map((c) => ({
			text: c.name,
			course: c,
		}));

		// For simplicity, just sync the first course or show a menu
		const menu = new Menu();
		for (const item of items) {
			menu.addItem((menuItem) =>
				menuItem.setTitle(item.text).onClick(() => this.syncCourse(item.course))
			);
		}
		menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
	}

	/**
	 * Show course picker for setup
	 */
	private showCoursePickerForSetup(): void {
		const enabledCourses = this.settings.courses.filter((c) => c.enabled);

		if (enabledCourses.length === 0) {
			new Notice('No courses configured. Go to settings to add courses.');
			return;
		}

		const menu = new Menu();
		for (const course of enabledCourses) {
			menu.addItem((item) =>
				item.setTitle(course.name).onClick(async () => {
					new Notice(`Setting up ${course.name}...`);
					try {
						await this.syncEngine.setupCourse(course, (msg) => {
							if (this.settings.debugMode) console.log(msg);
						});
						new Notice(`${course.name} setup complete!`);
					} catch (error) {
						new Notice(`Setup failed: ${error}`);
					}
				})
			);
		}
		menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
	}

	/**
	 * Open the current file's corresponding Canvas page
	 */
	private async openInCanvas(file: TFile): Promise<void> {
		const course = this.settings.courses.find((c) =>
			file.path.startsWith(c.path)
		);

		if (!course) {
			new Notice('This file is not in a configured course');
			return;
		}

		// Generate the page slug
		const title = file.basename
			.replace(/^\d+-/, '')
			.replace(/-/g, ' ')
			.split(' ')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');

		const slug = title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');

		const url = `${this.settings.canvasApiUrl}/courses/${course.courseIds[0]}/pages/${slug}`;

		window.open(url, '_blank');
	}

	/**
	 * Enable watch mode for auto-sync on file save
	 */
	enableWatchMode(): void {
		if (this.watchModeEnabled) return;

		// Debounced sync handler
		const debouncedSync = debounce(
			async (file: TFile) => {
				if (file.extension !== 'md') return;

				// Check if file is in a course folder or shared content
				const isInCourse = this.settings.courses.some((c) =>
					file.path.startsWith(c.path)
				);
				const isShared = this.settings.sharedContentPaths.some(
					(path) => path && file.path.startsWith(path)
				);

				if (isInCourse || (isShared && this.settings.syncSharedContent)) {
					await this.syncFile(file);
				}
			},
			2000,
			true
		);

		this.fileModifyHandler = (file: TAbstractFile) => {
			if (file instanceof TFile) {
				debouncedSync(file);
			}
		};

		this.registerEvent(this.app.vault.on('modify', this.fileModifyHandler));

		this.watchModeEnabled = true;
		this.updateStatusBar('Watching');

		if (this.settings.debugMode) {
			console.log('Canvas Sync: Watch mode enabled');
		}
	}

	/**
	 * Disable watch mode
	 */
	disableWatchMode(): void {
		this.watchModeEnabled = false;
		this.updateStatusBar('Idle');

		if (this.settings.debugMode) {
			console.log('Canvas Sync: Watch mode disabled');
		}
	}

	/**
	 * Set up the status bar
	 */
	private setupStatusBar(): void {
		if (!this.statusBarItem) {
			this.statusBarItem = this.addStatusBarItem();
		}
		this.updateStatusBar(this.watchModeEnabled ? 'Watching' : 'Idle');
	}

	/**
	 * Update the status bar
	 */
	updateStatusBar(status?: string): void {
		if (!this.settings.showStatusBar) {
			if (this.statusBarItem) {
				this.statusBarItem.remove();
				this.statusBarItem = null;
			}
			return;
		}

		if (!this.statusBarItem) {
			this.setupStatusBar();
		}

		if (this.statusBarItem && status) {
			let displayText = `Canvas: ${status}`;

			// Add last sync time if not currently syncing
			if (!this.isSyncing && this.lastSyncTime) {
				const ago = this.getTimeAgo(this.lastSyncTime);
				displayText += ` (${ago})`;
			}

			this.statusBarItem.setText(displayText);
		}
	}

	/**
	 * Get human-readable time ago string
	 */
	private getTimeAgo(date: Date): string {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

		if (seconds < 60) return 'just now';
		if (seconds < 120) return '1m ago';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 7200) return '1h ago';
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		return 'over a day ago';
	}

	/**
	 * Start sync - update UI state
	 */
	private startSync(): void {
		this.isSyncing = true;

		// Add syncing class to ribbon icon for animation
		if (this.ribbonIconEl) {
			this.ribbonIconEl.addClass('canvas-sync-syncing');
			setIcon(this.ribbonIconEl, 'loader');
		}
	}

	/**
	 * End sync - update UI state
	 */
	private endSync(): void {
		this.isSyncing = false;
		this.lastSyncTime = new Date();

		// Remove syncing class and restore icon
		if (this.ribbonIconEl) {
			this.ribbonIconEl.removeClass('canvas-sync-syncing');
			setIcon(this.ribbonIconEl, 'upload-cloud');
		}

		this.updateStatusBar(this.watchModeEnabled ? 'Watching' : 'Idle');
	}

	/**
	 * Validate that required settings are configured
	 */
	private validateSettings(): boolean {
		if (!this.settings.canvasApiUrl) {
			new Notice('Canvas API URL not configured. Go to settings.');
			return false;
		}

		if (!this.settings.canvasApiToken) {
			new Notice('Canvas API token not configured. Go to settings.');
			return false;
		}

		if (this.settings.courses.length === 0) {
			new Notice('No courses configured. Go to settings to add courses.');
			return false;
		}

		return true;
	}

	/**
	 * Get the path to the CSS snippets folder (relative to vault)
	 */
	getSnippetsVaultPath(): string {
		return `${this.app.vault.configDir}/plugins/canvas-sync/snippets`;
	}

	/**
	 * Get the absolute path to the CSS snippets folder
	 */
	getSnippetsPath(): string {
		// Use the adapter to get the full path
		const adapter = this.app.vault.adapter as any;
		if (adapter.basePath) {
			return `${adapter.basePath}/${this.getSnippetsVaultPath()}`;
		}
		// Fallback for different adapter types
		return this.getSnippetsVaultPath();
	}

	/**
	 * Ensure the snippets folder exists
	 */
	async ensureSnippetsFolder(): Promise<void> {
		const snippetsPath = this.getSnippetsPath();

		try {
			if (!fs.existsSync(snippetsPath)) {
				fs.mkdirSync(snippetsPath, { recursive: true });
				if (this.settings.debugMode) {
					console.log('Canvas Sync: Created snippets folder at', snippetsPath);
				}
			}
		} catch (error) {
			if (this.settings.debugMode) {
				console.log('Canvas Sync: Snippets folder creation:', error);
			}
		}
	}

	/**
	 * Discover CSS files in the snippets folder
	 */
	async discoverSnippets(): Promise<string[]> {
		const snippetsPath = this.getSnippetsPath();

		// Ensure folder exists
		await this.ensureSnippetsFolder();

		try {
			if (!fs.existsSync(snippetsPath)) {
				return [];
			}

			const files = fs.readdirSync(snippetsPath);
			const cssFiles = files
				.filter((f) => f.endsWith('.css'))
				.sort();

			if (this.settings.debugMode) {
				console.log('Canvas Sync: Discovered snippets:', cssFiles);
			}

			return cssFiles;
		} catch (error) {
			console.error('Canvas Sync: Error reading snippets folder:', error);
			return [];
		}
	}

	/**
	 * Load all enabled CSS snippets and concatenate them
	 */
	async loadEnabledSnippets(): Promise<string> {
		const snippetsPath = this.getSnippetsPath();
		const enabledSnippets = this.settings.style.enabledSnippets;

		console.log('Canvas Sync: Loading snippets from:', snippetsPath);
		console.log('Canvas Sync: Enabled snippets:', enabledSnippets);

		if (enabledSnippets.length === 0) {
			return '';
		}

		const cssContents: string[] = [];

		for (const snippet of enabledSnippets) {
			const filePath = path.join(snippetsPath, snippet);
			console.log('Canvas Sync: Attempting to load:', filePath);

			try {
				if (fs.existsSync(filePath)) {
					const content = fs.readFileSync(filePath, 'utf-8');
					console.log(`Canvas Sync: Loaded ${snippet} (${content.length} chars)`);
					cssContents.push(`/* === ${snippet} === */\n${content}`);
				} else {
					console.warn(`Canvas Sync: Snippet file not found: ${filePath}`);
				}
			} catch (error) {
				console.error(`Canvas Sync: Error loading snippet ${snippet}:`, error);
			}
		}

		const result = cssContents.join('\n\n');
		console.log('Canvas Sync: Total custom CSS length:', result.length);
		return result;
	}
}
