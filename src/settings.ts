import { App, PluginSettingTab, Setting, TextComponent, Notice, TFolder, Modal } from 'obsidian';
import type CanvasSyncPlugin from './main';
import type { CourseConfig, StyleSettings, MediaSettings } from './types';
import { DEFAULT_MEDIA_SETTINGS } from './media-uploader';

/**
 * Plugin settings interface
 */
export interface CanvasSyncSettings {
	canvasApiUrl: string;
	canvasApiToken: string;
	courses: CourseConfig[];
	sharedContentPaths: string[];
	autoSync: boolean;
	syncOnSave: boolean;
	syncSharedContent: boolean;
	showStatusBar: boolean;
	debugMode: boolean;
	/** Content styling settings */
	style: StyleSettings;
	/** Media upload settings */
	media: MediaSettings;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: CanvasSyncSettings = {
	canvasApiUrl: 'https://canvas.colum.edu',
	canvasApiToken: '',
	courses: [],
	sharedContentPaths: [],
	autoSync: false,
	syncOnSave: true,
	syncSharedContent: true,
	showStatusBar: true,
	debugMode: false,
	style: {
		theme: 'auto',
		accentColor: '#667eea',
		enabledSnippets: [],
		mobileCompatible: false,
	},
	media: DEFAULT_MEDIA_SETTINGS,
};

/**
 * Settings tab for the Canvas Sync plugin
 */
export class CanvasSyncSettingTab extends PluginSettingTab {
	plugin: CanvasSyncPlugin;

	constructor(app: App, plugin: CanvasSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Canvas API Settings
		containerEl.createEl('h2', { text: 'Canvas API Settings' });

		new Setting(containerEl)
			.setName('Canvas API URL')
			.setDesc('Your Canvas instance URL (e.g., https://canvas.yourschool.edu)')
			.addText((text) =>
				text
					.setPlaceholder('https://canvas.yourschool.edu')
					.setValue(this.plugin.settings.canvasApiUrl)
					.onChange(async (value) => {
						this.plugin.settings.canvasApiUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Canvas API Token')
			.setDesc('Your Canvas API access token (Settings > Account > New Access Token)')
			.addText((text) => {
				text
					.setPlaceholder('Enter your API token')
					.setValue(this.plugin.settings.canvasApiToken)
					.onChange(async (value) => {
						this.plugin.settings.canvasApiToken = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('Test Connection')
			.setDesc('Verify your Canvas API credentials')
			.addButton((button) =>
				button.setButtonText('Test').onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Testing...');
					try {
						const result = await this.plugin.canvasApi.testConnection();
						if (result.success) {
							new Notice(`Connected to Canvas as ${result.userName}`);
						} else {
							new Notice(`Connection failed: ${result.error}`);
						}
					} catch (error) {
						new Notice(`Connection failed: ${error}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Test');
					}
				})
			);

		// Course Management
		containerEl.createEl('h2', { text: 'Course Management' });

		const coursesContainer = containerEl.createDiv('canvas-sync-courses');
		this.renderCourses(coursesContainer);

		new Setting(containerEl)
			.setName('Add Course')
			.setDesc('Add a new course to sync')
			.addButton((button) =>
				button.setButtonText('Add Course').onClick(() => {
					this.showAddCourseModal();
				})
			);

		// Shared Content Settings
		containerEl.createEl('h2', { text: 'Shared Content' });

		const sharedPathsContainer = containerEl.createDiv('canvas-sync-shared-paths');
		this.renderSharedPaths(sharedPathsContainer);

		new Setting(containerEl)
			.setName('Add Shared Path')
			.setDesc('Add another shared content folder')
			.addButton((button) =>
				button.setButtonText('Add Path').onClick(async () => {
					this.plugin.settings.sharedContentPaths.push('');
					await this.plugin.saveSettings();
					this.renderSharedPaths(sharedPathsContainer);
				})
			);

		new Setting(containerEl)
			.setName('Sync Shared Content')
			.setDesc('Automatically sync shared content files that are wiki-linked from course files')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncSharedContent)
					.onChange(async (value) => {
						this.plugin.settings.syncSharedContent = value;
						await this.plugin.saveSettings();
					})
			);

		// Sync Behavior
		containerEl.createEl('h2', { text: 'Sync Behavior' });

		new Setting(containerEl)
			.setName('Sync on File Save')
			.setDesc('Automatically sync files to Canvas when saved')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
					this.plugin.settings.syncOnSave = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.enableWatchMode();
					} else {
						this.plugin.disableWatchMode();
					}
				})
			);

		new Setting(containerEl)
			.setName('Show Status Bar')
			.setDesc('Show sync status in the status bar')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
					this.plugin.settings.showStatusBar = value;
					await this.plugin.saveSettings();
					this.plugin.updateStatusBar();
				})
			);

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('Enable detailed logging for troubleshooting')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				})
			);

		// Content Styling
		containerEl.createEl('h2', { text: 'Content Styling' });

		new Setting(containerEl)
			.setName('Theme')
			.setDesc('Color scheme for synced content. Auto follows OS/browser dark mode preference.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('auto', 'Auto (follows system)')
					.addOption('light', 'Light')
					.addOption('dark', 'Dark')
					.setValue(this.plugin.settings.style.theme)
					.onChange(async (value) => {
						this.plugin.settings.style.theme = value as 'auto' | 'light' | 'dark';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Mobile Compatible')
			.setDesc('Use transparent backgrounds for better Canvas mobile app dark mode support. Recommended if students use the Canvas app.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.style.mobileCompatible)
					.onChange(async (value) => {
						this.plugin.settings.style.mobileCompatible = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Accent Color')
			.setDesc('Primary color for links, headings, and table headers (hex format)')
			.addText((text) => {
				text
					.setPlaceholder('#667eea')
					.setValue(this.plugin.settings.style.accentColor)
					.onChange(async (value) => {
						// Validate hex color
						const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
						if (hexRegex.test(value) || value === '') {
							this.plugin.settings.style.accentColor = value || '#667eea';
							await this.plugin.saveSettings();
						}
					});
				// Style the input to show the color
				text.inputEl.style.width = '100px';
				text.inputEl.setAttribute('type', 'text');
			})
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.style.accentColor)
					.onChange(async (value) => {
						this.plugin.settings.style.accentColor = value;
						await this.plugin.saveSettings();
						// Update the text input to match
						this.display();
					})
			);

		// CSS Snippets subsection
		containerEl.createEl('h3', { text: 'CSS Snippets' });
		containerEl.createEl('p', {
			text: 'Add CSS files to the snippets folder to customize Canvas content styling. Toggle snippets on/off below.',
			cls: 'setting-item-description',
		});

		const snippetsContainer = containerEl.createDiv('canvas-sync-snippets');
		this.renderSnippets(snippetsContainer);

		new Setting(containerEl)
			.addButton((button) =>
				button
					.setButtonText('Open Snippets Folder')
					.onClick(async () => {
						const snippetsPath = this.plugin.getSnippetsPath();
						// Ensure folder exists
						await this.plugin.ensureSnippetsFolder();
						// Open in system file manager
						const { shell } = require('electron');
						shell.openPath(snippetsPath);
					})
			)
			.addButton((button) =>
				button
					.setButtonText('Refresh')
					.onClick(async () => {
						this.renderSnippets(snippetsContainer);
						new Notice('Snippets list refreshed');
					})
			);

		// Media Uploads
		containerEl.createEl('h2', { text: 'Media Uploads' });
		containerEl.createEl('p', {
			text: 'Upload and embed media files (images, audio, video, PDFs) to Canvas. Media embeds like ![[file.mp3]] will be uploaded and converted to HTML players.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Enable Media Uploads')
			.setDesc('Automatically upload and embed media files referenced in your notes')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.media.enabled)
					.onChange(async (value) => {
						this.plugin.settings.media.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Upload Images')
			.setDesc('Upload image files (PNG, JPG, GIF, WebP, SVG)')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.media.uploadImages)
					.onChange(async (value) => {
						this.plugin.settings.media.uploadImages = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Upload Audio')
			.setDesc('Upload audio files (MP3, WAV, OGG, M4A) with embedded players')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.media.uploadAudio)
					.onChange(async (value) => {
						this.plugin.settings.media.uploadAudio = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Upload Video')
			.setDesc('Upload video files (MP4, WebM, MOV) with embedded players')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.media.uploadVideo)
					.onChange(async (value) => {
						this.plugin.settings.media.uploadVideo = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Upload PDFs')
			.setDesc('Upload PDF files with embedded viewers')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.media.uploadPdf)
					.onChange(async (value) => {
						this.plugin.settings.media.uploadPdf = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max File Size (MB)')
			.setDesc('Maximum file size for uploads (default: 100 MB)')
			.addText((text) =>
				text
					.setPlaceholder('100')
					.setValue(String(this.plugin.settings.media.maxFileSize / (1024 * 1024)))
					.onChange(async (value) => {
						const mb = parseFloat(value);
						if (!isNaN(mb) && mb > 0) {
							this.plugin.settings.media.maxFileSize = mb * 1024 * 1024;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Canvas Folder Name')
			.setDesc('Folder name in Canvas for uploaded media files')
			.addText((text) =>
				text
					.setPlaceholder('canvas-sync')
					.setValue(this.plugin.settings.media.canvasFolderName)
					.onChange(async (value) => {
						this.plugin.settings.media.canvasFolderName = value.trim() || 'canvas-sync';
						await this.plugin.saveSettings();
					})
			);

		// Support Section
		containerEl.createEl('h2', { text: 'Support' });

		new Setting(containerEl)
			.setName('GitHub Repository')
			.setDesc('Report issues, request features, or contribute to the project')
			.addButton((button) =>
				button
					.setButtonText('Open GitHub')
					.onClick(() => {
						window.open('https://github.com/danielrdehaan/obsidian-canvas-sync', '_blank');
					})
			);

		new Setting(containerEl)
			.setName('Support Development')
			.setDesc('If you find this plugin useful, consider buying me a coffee!')
			.addButton((button) =>
				button
					.setButtonText('Buy Me a Coffee')
					.setCta()
					.onClick(() => {
						window.open('https://buymeacoffee.com/danielrdehaan', '_blank');
					})
			);
	}

	/**
	 * Render the list of configured courses
	 */
	private renderCourses(container: HTMLElement): void {
		container.empty();

		if (this.plugin.settings.courses.length === 0) {
			container.createEl('p', {
				text: 'No courses configured. Add a course to get started.',
				cls: 'canvas-sync-no-courses',
			});
			return;
		}

		for (const course of this.plugin.settings.courses) {
			const courseEl = container.createDiv('canvas-sync-course-item');

			new Setting(courseEl)
				.setName(course.name)
				.setDesc(`Path: ${course.path} | Course IDs: ${course.courseIds.join(', ')}`)
				.addToggle((toggle) =>
					toggle
						.setValue(course.enabled)
						.setTooltip('Enable/disable syncing for this course')
						.onChange(async (value) => {
							course.enabled = value;
							await this.plugin.saveSettings();
						})
				)
				.addButton((button) =>
					button
						.setIcon('pencil')
						.setTooltip('Edit course')
						.onClick(() => {
							this.showEditCourseModal(course);
						})
				)
				.addButton((button) =>
					button
						.setIcon('trash')
						.setTooltip('Remove course')
						.onClick(async () => {
							if (confirm(`Remove course "${course.name}"?`)) {
								this.plugin.settings.courses = this.plugin.settings.courses.filter(
									(c) => c.id !== course.id
								);
								await this.plugin.saveSettings();
								this.renderCourses(container);
							}
						})
				);
		}
	}

	/**
	 * Render the list of shared content paths
	 */
	private renderSharedPaths(container: HTMLElement): void {
		container.empty();

		if (this.plugin.settings.sharedContentPaths.length === 0) {
			container.createEl('p', {
				text: 'No shared content paths configured. Add a path to enable shared content syncing.',
				cls: 'canvas-sync-no-paths',
			});
			return;
		}

		for (let i = 0; i < this.plugin.settings.sharedContentPaths.length; i++) {
			const path = this.plugin.settings.sharedContentPaths[i];
			const pathEl = container.createDiv('canvas-sync-path-item');

			let pathInput: TextComponent;

			new Setting(pathEl)
				.setName(path || `Path ${i + 1}`)
				.setDesc(path ? `Folder: ${path}` : 'Click Browse to select a folder')
				.addText((text) => {
					pathInput = text;
					text
						.setPlaceholder('Path to shared content folder')
						.setValue(path)
						.onChange(async (value) => {
							this.plugin.settings.sharedContentPaths[i] = value.trim();
							await this.plugin.saveSettings();
						});
				})
				.addButton((button) =>
					button
						.setIcon('folder')
						.setTooltip('Browse for folder')
						.onClick(() => {
							const modal = new FolderPickerModal(
								this.app,
								path,
								async (selectedPath) => {
									pathInput.setValue(selectedPath);
									this.plugin.settings.sharedContentPaths[i] = selectedPath;
									await this.plugin.saveSettings();
									this.renderSharedPaths(container);
								}
							);
							modal.open();
						})
				)
				.addButton((button) =>
					button
						.setIcon('trash')
						.setTooltip('Remove path')
						.onClick(async () => {
							this.plugin.settings.sharedContentPaths.splice(i, 1);
							await this.plugin.saveSettings();
							this.renderSharedPaths(container);
						})
				);
		}
	}

	/**
	 * Show modal to add a new course
	 */
	private showAddCourseModal(): void {
		const modal = new CourseModal(this.app, this.plugin, null, async (course) => {
			this.plugin.settings.courses.push(course);
			await this.plugin.saveSettings();
			this.display();
		});
		modal.open();
	}

	/**
	 * Show modal to edit an existing course
	 */
	private showEditCourseModal(course: CourseConfig): void {
		const modal = new CourseModal(this.app, this.plugin, course, async (updated) => {
			const index = this.plugin.settings.courses.findIndex((c) => c.id === course.id);
			if (index !== -1) {
				this.plugin.settings.courses[index] = updated;
				await this.plugin.saveSettings();
				this.display();
			}
		});
		modal.open();
	}

	/**
	 * Render the list of CSS snippets
	 */
	private async renderSnippets(container: HTMLElement): Promise<void> {
		container.empty();

		const snippets = await this.plugin.discoverSnippets();

		if (snippets.length === 0) {
			container.createEl('p', {
				text: 'No CSS snippets found. Click "Open Snippets Folder" to add CSS files.',
				cls: 'canvas-sync-no-snippets',
			});
			return;
		}

		for (const snippet of snippets) {
			const isEnabled = this.plugin.settings.style.enabledSnippets.includes(snippet);

			new Setting(container)
				.setName(snippet)
				.addToggle((toggle) =>
					toggle
						.setValue(isEnabled)
						.setTooltip(isEnabled ? 'Disable snippet' : 'Enable snippet')
						.onChange(async (value) => {
							if (value) {
								// Add to enabled list
								if (!this.plugin.settings.style.enabledSnippets.includes(snippet)) {
									this.plugin.settings.style.enabledSnippets.push(snippet);
								}
							} else {
								// Remove from enabled list
								this.plugin.settings.style.enabledSnippets =
									this.plugin.settings.style.enabledSnippets.filter((s) => s !== snippet);
							}
							await this.plugin.saveSettings();

							// Trigger sync of all courses to apply styling changes
							await this.plugin.syncAllCoursesForSnippetChange();
						})
				);
		}
	}
}

/**
 * Modal for adding/editing a course
 */
class CourseModal extends Modal {
	plugin: CanvasSyncPlugin;
	course: CourseConfig | null;
	onSave: (course: CourseConfig) => Promise<void>;

	private nameInput: TextComponent | null = null;
	private pathInput: TextComponent | null = null;
	private idsInput: TextComponent | null = null;

	constructor(
		app: App,
		plugin: CanvasSyncPlugin,
		course: CourseConfig | null,
		onSave: (course: CourseConfig) => Promise<void>
	) {
		super(app);
		this.plugin = plugin;
		this.course = course;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.course ? 'Edit Course' : 'Add Course' });

		new Setting(contentEl)
			.setName('Course Name')
			.setDesc('A display name for this course (e.g., "SP26-MUSC-175")')
			.addText((text) => {
				this.nameInput = text;
				text.setPlaceholder('SP26-MUSC-175').setValue(this.course?.name ?? '');
			});

		new Setting(contentEl)
			.setName('Course Path')
			.setDesc('Path to course folder relative to vault root')
			.addText((text) => {
				this.pathInput = text;
				text
					.setPlaceholder('Website/Digital Garden/Courses/SP26-MUSC-175')
					.setValue(this.course?.path ?? '');
			});

		new Setting(contentEl)
			.setName('Canvas Course IDs')
			.setDesc('Comma-separated Canvas course IDs (for multiple sections)')
			.addText((text) => {
				this.idsInput = text;
				text.setPlaceholder('44972, 44970').setValue(this.course?.courseIds.join(', ') ?? '');
			});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Save')
				.setCta()
				.onClick(async () => {
					await this.save();
				})
		);
	}

	private async save(): Promise<void> {
		const name = this.nameInput?.getValue().trim();
		const path = this.pathInput?.getValue().trim();
		const idsStr = this.idsInput?.getValue().trim();

		if (!name || !path || !idsStr) {
			new Notice('Please fill in all fields');
			return;
		}

		const courseIds = idsStr
			.split(',')
			.map((id) => parseInt(id.trim(), 10))
			.filter((id) => !isNaN(id));

		if (courseIds.length === 0) {
			new Notice('Please enter valid Canvas course IDs');
			return;
		}

		const course: CourseConfig = {
			id: this.course?.id ?? `course-${Date.now()}`,
			name,
			path,
			courseIds,
			enabled: this.course?.enabled ?? true,
		};

		await this.onSave(course);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Modal for browsing and selecting a folder from the vault
 */
class FolderPickerModal extends Modal {
	private currentPath: string;
	private onSelect: (path: string) => void;
	private selectedPath: string;

	constructor(app: App, initialPath: string, onSelect: (path: string) => void) {
		super(app);
		this.currentPath = initialPath;
		this.selectedPath = initialPath;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('folder-picker-modal');

		contentEl.createEl('h2', { text: 'Select Folder' });

		// Selected path display
		const pathDisplay = contentEl.createDiv('folder-picker-path');
		pathDisplay.createEl('strong', { text: 'Selected: ' });
		const pathSpan = pathDisplay.createEl('span', { text: this.selectedPath || '(vault root)' });

		// Folder tree container
		const treeContainer = contentEl.createDiv('folder-picker-tree');
		this.renderFolderTree(treeContainer, pathSpan);

		// Buttons
		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('Select')
					.setCta()
					.onClick(() => {
						this.onSelect(this.selectedPath);
						this.close();
					})
			)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close())
			);
	}

	private renderFolderTree(container: HTMLElement, pathSpan: HTMLElement): void {
		const root = this.app.vault.getRoot();
		this.renderFolder(container, root, 0, pathSpan);
	}

	private renderFolder(container: HTMLElement, folder: TFolder, depth: number, pathSpan: HTMLElement): void {
		const children = folder.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.filter((f) => !f.name.startsWith('.'))
			.sort((a, b) => a.name.localeCompare(b.name));

		for (const child of children) {
			const folderEl = container.createDiv('folder-picker-item');
			folderEl.style.paddingLeft = `${depth * 20}px`;

			const isSelected = child.path === this.selectedPath;
			if (isSelected) {
				folderEl.addClass('is-selected');
			}

			// Expand/collapse icon
			const hasChildren = child.children.some(
				(c) => c instanceof TFolder && !c.name.startsWith('.')
			);
			const iconSpan = folderEl.createSpan('folder-picker-icon');
			iconSpan.setText(hasChildren ? '▶' : '  ');

			// Folder name
			const nameSpan = folderEl.createSpan('folder-picker-name');
			nameSpan.setText(child.name);

			// Click to select
			folderEl.addEventListener('click', (e) => {
				e.stopPropagation();
				// Remove previous selection
				container.querySelectorAll('.is-selected').forEach((el) =>
					el.removeClass('is-selected')
				);
				folderEl.addClass('is-selected');
				this.selectedPath = child.path;
				pathSpan.setText(child.path);
			});

			// Double-click to select and close
			folderEl.addEventListener('dblclick', () => {
				this.onSelect(child.path);
				this.close();
			});

			// Children container (initially hidden)
			const childContainer = container.createDiv('folder-picker-children');
			childContainer.style.display = 'none';

			if (hasChildren) {
				let expanded = false;
				iconSpan.addEventListener('click', (e) => {
					e.stopPropagation();
					expanded = !expanded;
					iconSpan.setText(expanded ? '▼' : '▶');
					childContainer.style.display = expanded ? 'block' : 'none';
					if (expanded && childContainer.childElementCount === 0) {
						this.renderFolder(childContainer, child, depth + 1, pathSpan);
					}
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
