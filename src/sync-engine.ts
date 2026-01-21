import type { App, TFile, TFolder, Notice } from 'obsidian';
import { CanvasApi } from './canvas-api';
import { MarkdownConverter, ConvertOptions } from './converter';
import { FrontmatterParser } from './frontmatter';
import { LinkParser } from './link-parser';
import type {
	CourseConfig,
	ModuleStructure,
	ModuleItem,
	SyncResult,
	CourseSyncResult,
	CanvasContentType,
	ParsedFile,
} from './types';

/**
 * Sync engine - coordinates syncing files to Canvas
 */
export class SyncEngine {
	private app: App;
	private api: CanvasApi;
	private converter: MarkdownConverter;
	private frontmatter: FrontmatterParser;
	private linkParser: LinkParser;
	private debugMode: boolean;

	constructor(
		app: App,
		api: CanvasApi,
		sharedContentPath: string,
		debugMode = false
	) {
		this.app = app;
		this.api = api;
		this.converter = new MarkdownConverter();
		this.frontmatter = new FrontmatterParser(app);
		this.linkParser = new LinkParser(app, sharedContentPath);
		this.debugMode = debugMode;
	}

	/**
	 * Set debug mode
	 */
	setDebugMode(debug: boolean): void {
		this.debugMode = debug;
		this.api.setDebugMode(debug);
	}

	/**
	 * Set shared content path
	 */
	setSharedContentPath(path: string): void {
		this.linkParser.setSharedContentPath(path);
	}

	/**
	 * Log debug messages
	 */
	private log(...args: unknown[]): void {
		if (this.debugMode) {
			console.log('[Sync Engine]', ...args);
		}
	}

	/**
	 * Folders to exclude from module discovery
	 */
	private excludedFolders = new Set([
		'canvas-import',
		'.claude',
		'.obsidian',
		'node_modules',
		'Attachments',
		'attachments',
	]);

	/**
	 * Check if a folder should be treated as a module
	 */
	private isModuleFolder(folderName: string): boolean {
		// Skip hidden folders (starting with .)
		if (folderName.startsWith('.')) {
			return false;
		}

		// Skip explicitly excluded folders
		if (this.excludedFolders.has(folderName)) {
			return false;
		}

		// Accept folders with numbered prefix (00-Course-Info, 01-Week-01, etc.)
		if (/^\d+-/.test(folderName)) {
			return true;
		}

		// Accept other common module patterns
		if (/^(Week|Module|Unit|Chapter|Section)/i.test(folderName)) {
			return true;
		}

		return false;
	}

	/**
	 * Discover module structure from folder hierarchy
	 */
	async discoverModules(coursePath: string): Promise<ModuleStructure[]> {
		const modules: ModuleStructure[] = [];
		const folder = this.app.vault.getAbstractFileByPath(coursePath);

		if (!folder) {
			this.log('Course folder not found:', coursePath);
			return modules;
		}

		// Get all direct subfolders
		const subfolders = this.app.vault
			.getAllLoadedFiles()
			.filter(
				(f) =>
					f.parent?.path === coursePath &&
					'children' in f // It's a folder
			) as TFolder[];

		for (const subfolder of subfolders) {
			// Skip folders that shouldn't be modules
			const isModule = this.isModuleFolder(subfolder.name);
			console.log(`[Sync Engine] Folder "${subfolder.name}": isModule=${isModule}, inExcluded=${this.excludedFolders.has(subfolder.name)}`);
			if (!isModule) {
				console.log(`[Sync Engine] Skipping non-module folder: ${subfolder.name}`);
				continue;
			}

			const moduleStructure = await this.parseModuleFolder(subfolder);
			if (moduleStructure) {
				modules.push(moduleStructure);
			}
		}

		// Sort by position
		modules.sort((a, b) => a.position - b.position);

		return modules;
	}

	/**
	 * Parse a folder as a module
	 */
	private async parseModuleFolder(folder: TFolder): Promise<ModuleStructure | null> {
		// Extract position from folder name (e.g., "01-Course-Info" -> 1)
		const positionMatch = folder.name.match(/^(\d+)-/);
		const position = positionMatch ? parseInt(positionMatch[1], 10) : 0;

		// Look for a module note (_module.md or folder-named note)
		const moduleNote =
			this.findFile(folder, '_module.md') ||
			this.findFile(folder, `${folder.name}.md`);

		let moduleName = this.folderNameToTitle(folder.name);
		let publish = true;

		if (moduleNote) {
			const parsed = await this.frontmatter.parseFile(moduleNote);
			const moduleFm = this.frontmatter.extractModuleFrontmatter(parsed.frontmatter);

			if (moduleFm.module_name) {
				moduleName = moduleFm.module_name;
			}
			if (moduleFm.publish !== undefined) {
				publish = moduleFm.publish;
			}
		}

		// Get all markdown files in the folder
		const files = this.getFilesInFolder(folder);
		const items: ModuleItem[] = [];

		for (const file of files) {
			// Skip module notes
			if (file.basename === '_module' || file.basename === folder.name) {
				continue;
			}

			const parsed = await this.frontmatter.parseFile(file);

			// Check if file should be synced
			if (!this.frontmatter.shouldSync(parsed)) {
				continue;
			}

			items.push({
				type: this.frontmatter.getEffectiveContentType(parsed),
				title: this.frontmatter.getEffectiveTitle(parsed),
				filePath: file.path,
				position: this.frontmatter.extractPosition(parsed),
			});
		}

		// Sort items by position
		items.sort((a, b) => a.position - b.position);

		return {
			name: moduleName,
			position,
			folderPath: folder.path,
			items,
			publish,
		};
	}

	/**
	 * Find a specific file in a folder
	 */
	private findFile(folder: TFolder, filename: string): TFile | null {
		for (const child of folder.children) {
			if (child instanceof this.app.vault.adapter.constructor) {
				continue;
			}
			if ('extension' in child && child.name === filename) {
				return child as TFile;
			}
		}
		return null;
	}

	/**
	 * Get all markdown files in a folder (non-recursive)
	 */
	private getFilesInFolder(folder: TFolder): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.parent?.path === folder.path);
	}

	/**
	 * Convert folder name to title
	 */
	private folderNameToTitle(name: string): string {
		// Remove numbered prefix
		let title = name.replace(/^\d+-/, '');
		// Replace hyphens with spaces
		title = title.replace(/-/g, ' ');
		// Title case
		return title
			.split(' ')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}

	/**
	 * Sync a single file to a Canvas course
	 */
	async syncFile(
		file: TFile,
		courseId: number,
		pageSlugMap: Map<string, string>,
		discussionTitleMap: Map<string, number>
	): Promise<SyncResult> {
		const parsed = await this.frontmatter.parseFile(file);

		if (!this.frontmatter.shouldSync(parsed)) {
			return {
				success: true,
				filePath: file.path,
				canvasType: 'page',
				title: parsed.filename,
				action: 'skipped',
				courseId,
			};
		}

		const type = this.frontmatter.getEffectiveContentType(parsed);
		const title = this.frontmatter.getEffectiveTitle(parsed);
		const publish = parsed.canvas.publish !== false;

		// Build converter options
		const convertOptions: ConvertOptions = {
			courseId,
			pageSlugMap,
			discussionTitleMap,
		};

		// Convert markdown to HTML
		const html = this.converter.convert(parsed.content, convertOptions);

		try {
			if (type === 'page') {
				const { page, created } = await this.api.upsertPage(courseId, title, html, publish);
				return {
					success: true,
					filePath: file.path,
					canvasType: type,
					title,
					action: created ? 'created' : 'updated',
					courseId,
					pageUrl: page.url,
				};
			} else if (type === 'discussion') {
				// Standard (ungraded) discussion
				const { discussion, created } = await this.api.upsertDiscussion(courseId, title, html, {
					published: publish,
					discussionType: 'threaded',
				});
				return {
					success: true,
					filePath: file.path,
					canvasType: type,
					title,
					action: created ? 'created' : 'updated',
					courseId,
					discussionId: discussion.id,
				};
			} else if (type === 'graded_discussion') {
				// Graded discussion (discussion topic with grading enabled)
				const { discussion, created } = await this.api.upsertGradedDiscussion(
					courseId,
					title,
					html,
					{
						points: parsed.canvas.points ?? 0,
						dueAt: parsed.canvas.due_date ?? null,
						lockAt: parsed.canvas.lock_at ?? null,
						unlockAt: parsed.canvas.unlock_at ?? null,
						published: publish,
						discussionType: 'threaded',
					}
				);
				return {
					success: true,
					filePath: file.path,
					canvasType: type,
					title,
					action: created ? 'created' : 'updated',
					courseId,
					discussionId: discussion.id,
					assignmentId: discussion.assignment?.id,
				};
			} else if (type === 'assignment') {
				const { assignment, created } = await this.api.upsertAssignment(courseId, {
					name: title,
					description: html,
					points_possible: parsed.canvas.points ?? 0,
					due_at: parsed.canvas.due_date ?? null,
					lock_at: parsed.canvas.lock_at ?? null,
					unlock_at: parsed.canvas.unlock_at ?? null,
					submission_types: parsed.canvas.submission_types ?? ['online_upload', 'online_text_entry'],
					allowed_extensions: parsed.canvas.allowed_extensions,
					grading_type: parsed.canvas.grading_type ?? 'points',
					published: publish,
				});
				return {
					success: true,
					filePath: file.path,
					canvasType: type,
					title,
					action: created ? 'created' : 'updated',
					courseId,
					assignmentId: assignment.id,
				};
			} else if (type === 'external_url') {
				// External URLs don't create standalone content - they're module items only
				// Return a "ready" status so the module sync can add it
				if (!parsed.canvas.url) {
					return {
						success: false,
						filePath: file.path,
						canvasType: type,
						title,
						action: 'failed',
						error: 'External URL type requires canvas_url in frontmatter',
						courseId,
					};
				}
				return {
					success: true,
					filePath: file.path,
					canvasType: type,
					title,
					action: 'ready',
					courseId,
					externalUrl: parsed.canvas.url,
					newTab: parsed.canvas.new_tab ?? true,
				};
			}

			return {
				success: false,
				filePath: file.path,
				canvasType: type,
				title,
				action: 'failed',
				error: `Unsupported content type: ${type}`,
				courseId,
			};
		} catch (error) {
			return {
				success: false,
				filePath: file.path,
				canvasType: type,
				title,
				action: 'failed',
				error: String(error),
				courseId,
			};
		}
	}

	/**
	 * Sync an entire course to Canvas
	 */
	async syncCourse(
		course: CourseConfig,
		progressCallback?: (message: string) => void
	): Promise<CourseSyncResult[]> {
		const results: CourseSyncResult[] = [];

		// Get all files in the course folder
		const courseFiles = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(course.path));

		// Build maps for link resolution
		const pageSlugMap = await this.frontmatter.buildPageSlugMap(courseFiles);
		const discussionTitleMap = await this.frontmatter.buildDiscussionTitleMap(courseFiles);

		// Get shared content files (will be synced first to get actual Canvas URLs)
		const sharedContentFiles = await this.linkParser.getSharedContentToSync(course.path);

		// Sync to each Canvas course ID
		for (const courseId of course.courseIds) {
			const courseResult: CourseSyncResult = {
				courseId,
				courseName: '',
				results: [],
				success: 0,
				failed: 0,
				skipped: 0,
			};

			try {
				// Get course name
				const canvasCourse = await this.api.getCourse(courseId);
				courseResult.courseName = canvasCourse.name;

				progressCallback?.(`Syncing to ${canvasCourse.name} (ID: ${courseId})...`);

				// Sync shared content FIRST to get actual Canvas URLs for wiki-link resolution
				if (sharedContentFiles.length > 0) {
					progressCallback?.(`  Shared Content (${sharedContentFiles.length} files)...`);

					for (const file of sharedContentFiles) {
						const parsed = await this.frontmatter.parseFile(file);
						const result = await this.syncFile(
							file,
							courseId,
							pageSlugMap,
							discussionTitleMap
						);

						courseResult.results.push(result);

						if (result.action === 'skipped') {
							courseResult.skipped++;
						} else if (result.success) {
							courseResult.success++;
							// Update pageSlugMap with the actual Canvas URL (not our calculated slug)
							if (result.pageUrl) {
								pageSlugMap.set(parsed.filename, result.pageUrl);
								console.log(`[Sync Engine] Updated pageSlugMap: "${parsed.filename}" -> "${result.pageUrl}"`);
							}
						} else {
							courseResult.failed++;
						}

						progressCallback?.(`    ${result.action}: ${result.title}`);
					}
				}

				// Discover and sync modules
				const modules = await this.discoverModules(course.path);

				for (const module of modules) {
					progressCallback?.(`  Module: ${module.name}`);

					// Create/update the module in Canvas
					const { module: canvasModule } = await this.api.upsertModule(
						courseId,
						module.name,
						module.position,
						module.publish
					);

					// Get existing module items to avoid duplicates
					console.log(`[Sync Engine] Getting existing items for module ${canvasModule.id}`);
					const existingItems = await this.api.getModuleItems(courseId, canvasModule.id);
					console.log(`[Sync Engine] Found ${existingItems.length} existing items in module`);
					const existingPageUrls = new Set(existingItems.filter(i => i.type === 'Page').map(i => i.page_url));
					const existingDiscussionIds = new Set(existingItems.filter(i => i.type === 'Discussion').map(i => i.content_id));
					const existingAssignmentIds = new Set(existingItems.filter(i => i.type === 'Assignment').map(i => i.content_id));
					const existingExternalUrls = new Set(existingItems.filter(i => i.type === 'ExternalUrl').map(i => i.title));

					// Sync each item in the module
					let itemPosition = 1;
					for (const item of module.items) {
						const file = this.app.vault.getAbstractFileByPath(item.filePath) as TFile;
						if (!file) continue;

						const parsed = await this.frontmatter.parseFile(file);

						const result = await this.syncFile(
							file,
							courseId,
							pageSlugMap,
							discussionTitleMap
						);

						courseResult.results.push(result);

						if (result.action === 'skipped') {
							courseResult.skipped++;
						} else if (result.success) {
							courseResult.success++;

							// Update maps with actual Canvas IDs/URLs for future file conversions
							if (result.canvasType === 'page' && result.pageUrl) {
								pageSlugMap.set(parsed.filename, result.pageUrl);
								console.log(`[Sync Engine] Updated pageSlugMap: "${parsed.filename}" -> "${result.pageUrl}"`);
							} else if ((result.canvasType === 'discussion' || result.canvasType === 'graded_discussion') && result.discussionId) {
								discussionTitleMap.set(parsed.filename, result.discussionId);
								console.log(`[Sync Engine] Updated discussionTitleMap: "${parsed.filename}" -> ${result.discussionId}`);
							}

							// Add item to module if not already present
							console.log(`[Sync Engine] Attempting to add ${result.canvasType} "${result.title}" to module. pageUrl=${result.pageUrl}, discussionId=${result.discussionId}, assignmentId=${result.assignmentId}, externalUrl=${result.externalUrl}`);
							try {
								if (result.canvasType === 'page' && result.pageUrl) {
									const alreadyExists = existingPageUrls.has(result.pageUrl);
									console.log(`[Sync Engine] Page ${result.pageUrl} already in module: ${alreadyExists}`);
									if (!alreadyExists) {
										await this.api.addPageToModule(
											courseId,
											canvasModule.id,
											result.pageUrl,
											itemPosition
										);
										console.log(`[Sync Engine] Added page to module: ${result.title}`);
									}
								} else if (result.canvasType === 'discussion' && result.discussionId) {
									// Standard (ungraded) discussion - add as Discussion
									const alreadyExists = existingDiscussionIds.has(result.discussionId);
									console.log(`[Sync Engine] Discussion ${result.discussionId} already in module: ${alreadyExists}`);
									if (!alreadyExists) {
										await this.api.addDiscussionToModule(
											courseId,
											canvasModule.id,
											result.discussionId,
											itemPosition
										);
										console.log(`[Sync Engine] Added discussion to module: ${result.title}`);
									}
								} else if (result.canvasType === 'graded_discussion' && result.assignmentId) {
									// Graded discussion - add as Assignment (since it's an assignment with discussion_topic type)
									const alreadyExists = existingAssignmentIds.has(result.assignmentId);
									console.log(`[Sync Engine] Graded discussion (assignment) ${result.assignmentId} already in module: ${alreadyExists}`);
									if (!alreadyExists) {
										await this.api.addAssignmentToModule(
											courseId,
											canvasModule.id,
											result.assignmentId,
											itemPosition
										);
										console.log(`[Sync Engine] Added graded discussion to module: ${result.title}`);
									}
								} else if (result.canvasType === 'assignment' && result.assignmentId) {
									const alreadyExists = existingAssignmentIds.has(result.assignmentId);
									console.log(`[Sync Engine] Assignment ${result.assignmentId} already in module: ${alreadyExists}`);
									if (!alreadyExists) {
										await this.api.addAssignmentToModule(
											courseId,
											canvasModule.id,
											result.assignmentId,
											itemPosition
										);
										console.log(`[Sync Engine] Added assignment to module: ${result.title}`);
									}
								} else if (result.canvasType === 'external_url' && result.externalUrl) {
									const alreadyExists = existingExternalUrls.has(result.title);
									console.log(`[Sync Engine] External URL "${result.title}" already in module: ${alreadyExists}`);
									if (!alreadyExists) {
										await this.api.addExternalUrlToModule(
											courseId,
											canvasModule.id,
											result.title,
											result.externalUrl,
											itemPosition,
											result.newTab ?? true
										);
										console.log(`[Sync Engine] Added external URL to module: ${result.title}`);
									}
								}
							} catch (moduleItemError) {
								console.log(`[Sync Engine] Error adding item to module: ${moduleItemError}`);
							}
						} else {
							courseResult.failed++;
						}

						itemPosition++;
						progressCallback?.(`    ${result.action}: ${result.title}`);
					}
				}

			} catch (error) {
				this.log('Error syncing course:', error);
				courseResult.failed++;
			}

			results.push(courseResult);
		}

		return results;
	}

	/**
	 * Sync a single file to all configured courses
	 */
	async syncSingleFile(
		file: TFile,
		courses: CourseConfig[]
	): Promise<SyncResult[]> {
		const results: SyncResult[] = [];

		// Find which course this file belongs to
		const matchingCourse = courses.find((c) => file.path.startsWith(c.path));

		if (!matchingCourse) {
			// Check if it's shared content
			if (this.linkParser.isSharedContent(file.path)) {
				// Sync to all courses that link to this file
				const coursePaths = courses.map((c) => c.path);
				const { affectedCourses } = await this.linkParser.shouldTriggerSharedSync(
					file.path,
					coursePaths
				);

				for (const coursePath of affectedCourses) {
					const course = courses.find((c) => c.path === coursePath);
					if (course) {
						const courseFiles = this.app.vault
							.getMarkdownFiles()
							.filter((f) => f.path.startsWith(course.path));

						const pageSlugMap = await this.frontmatter.buildPageSlugMap(courseFiles);
						const discussionTitleMap =
							await this.frontmatter.buildDiscussionTitleMap(courseFiles);

						for (const courseId of course.courseIds) {
							const result = await this.syncFile(
								file,
								courseId,
								pageSlugMap,
								discussionTitleMap
							);
							results.push(result);
						}
					}
				}
			}
			return results;
		}

		// Get course files for link resolution
		const courseFiles = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith(matchingCourse.path));

		const pageSlugMap = await this.frontmatter.buildPageSlugMap(courseFiles);
		const discussionTitleMap = await this.frontmatter.buildDiscussionTitleMap(courseFiles);

		// Sync to each course ID
		for (const courseId of matchingCourse.courseIds) {
			const result = await this.syncFile(file, courseId, pageSlugMap, discussionTitleMap);
			results.push(result);
		}

		return results;
	}

	/**
	 * Set up course structure in Canvas (create modules and initial content)
	 */
	async setupCourse(
		course: CourseConfig,
		progressCallback?: (message: string) => void
	): Promise<void> {
		const modules = await this.discoverModules(course.path);

		for (const courseId of course.courseIds) {
			progressCallback?.(`Setting up course ID: ${courseId}`);

			for (const module of modules) {
				progressCallback?.(`  Creating module: ${module.name}`);
				const { module: canvasModule } = await this.api.upsertModule(
					courseId,
					module.name,
					module.position,
					module.publish
				);

				// Note: We don't add items to modules here since Canvas
				// will automatically organize pages/discussions created later
				// This just sets up the module structure
			}
		}
	}
}
