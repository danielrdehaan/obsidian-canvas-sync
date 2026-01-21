import { App, PluginSettingTab, Setting, TextComponent, Notice } from 'obsidian';
import type CanvasSyncPlugin from './main';
import type { CourseConfig } from './types';

/**
 * Plugin settings interface
 */
export interface CanvasSyncSettings {
	canvasApiUrl: string;
	canvasApiToken: string;
	courses: CourseConfig[];
	sharedContentPath: string;
	autoSync: boolean;
	syncOnSave: boolean;
	syncSharedContent: boolean;
	showStatusBar: boolean;
	debugMode: boolean;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: CanvasSyncSettings = {
	canvasApiUrl: 'https://canvas.colum.edu',
	canvasApiToken: '',
	courses: [],
	sharedContentPath: 'Website/Digital Garden/Shared Knowledge',
	autoSync: false,
	syncOnSave: true,
	syncSharedContent: true,
	showStatusBar: true,
	debugMode: false,
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

		new Setting(containerEl)
			.setName('Shared Content Path')
			.setDesc('Path to shared content folder (relative to vault root). Files linked from courses will be auto-synced.')
			.addText((text) =>
				text
					.setPlaceholder('Shared Knowledge')
					.setValue(this.plugin.settings.sharedContentPath)
					.onChange(async (value) => {
						this.plugin.settings.sharedContentPath = value.trim();
						await this.plugin.saveSettings();
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
}

import { Modal } from 'obsidian';

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
