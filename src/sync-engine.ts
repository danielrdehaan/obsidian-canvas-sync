import type { App, TFile, TFolder, Notice } from 'obsidian';
import { CanvasApi } from './canvas-api';
import { MarkdownConverter, ConvertOptions } from './converter';
import { FrontmatterParser } from './frontmatter';
import { LinkParser } from './link-parser';
import type { MediaUploader, MediaReplacement } from './media-uploader';
import type { DropboxUploader } from './dropbox-uploader';
import type {
	CourseConfig,
	ModuleStructure,
	ModuleItem,
	SyncResult,
	CourseSyncResult,
	CanvasContentType,
	ParsedFile,
	StyleSettings,
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
	private mediaUploader?: MediaUploader;
	private dropboxUploader?: DropboxUploader | null;
	private debugMode: boolean;
	private styleSettings?: StyleSettings;
	private customCss: string = '';

	constructor(
		app: App,
		api: CanvasApi,
		sharedContentPaths: string[] = [],
		debugMode = false
	) {
		this.app = app;
		this.api = api;
		this.converter = new MarkdownConverter();
		this.frontmatter = new FrontmatterParser(app);
		this.linkParser = new LinkParser(app, sharedContentPaths);
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
	 * Set shared content paths
	 */
	setSharedContentPaths(paths: string[]): void {
		this.linkParser.setSharedContentPaths(paths);
	}

	/**
	 * Set style settings for content conversion
	 */
	setStyleSettings(style: StyleSettings): void {
		this.styleSettings = style;
	}

	/**
	 * Set custom CSS content (concatenated snippets)
	 */
	setCustomCss(css: string): void {
		this.customCss = css;
		if (this.debugMode) {
			console.log('[Sync Engine] setCustomCss called, length:', css.length);
		}
	}

	/**
	 * Set media uploader instance
	 */
	setMediaUploader(uploader: MediaUploader): void {
		this.mediaUploader = uploader;
	}

	/**
	 * Set Dropbox uploader instance (for Dropbox-based media storage)
	 */
	setDropboxUploader(uploader: DropboxUploader | null): void {
		this.dropboxUploader = uploader;
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
	 * Update the canvas_page_url frontmatter field after sync
	 * This stores the page URL so that title renames work correctly
	 */
	private async updatePageUrlFrontmatter(file: TFile, pageUrl: string): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				frontmatter.canvas_page_url = pageUrl;
			});
			this.log(`Updated canvas_page_url for ${file.path}: ${pageUrl}`);
		} catch (error) {
			this.log(`Warning: Failed to update canvas_page_url for ${file.path}:`, error);
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

		if (moduleNote) {
			const parsed = await this.frontmatter.parseFile(moduleNote);
			const moduleFm = this.frontmatter.extractModuleFrontmatter(parsed.frontmatter);

			if (moduleFm.module_name) {
				moduleName = moduleFm.module_name;
			}
		}

		// Modules always default to published - individual items control their own publish state
		const publish = true;
		this.log(`Module "${moduleName}" will be published: ${publish}`);

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

		// Sort items by position, then by filename alphanumerically as tiebreaker
		items.sort((a, b) => {
			if (a.position !== b.position) {
				return a.position - b.position;
			}
			// Fall back to alphanumeric filename comparison
			return a.filePath.localeCompare(b.filePath);
		});

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
		discussionTitleMap: Map<string, number>,
		progressCallback?: (message: string) => void,
		courseConfig?: CourseConfig
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

		// Process media embeds - route to Dropbox or Canvas based on settings
		// Priority: 1) Course-specific dropbox setting, 2) Global uploadDestination setting
		let mediaReplacements: MediaReplacement[] = [];

		// Determine if we should use Dropbox
		const courseDropboxEnabled = courseConfig?.dropbox?.enabled;
		const globalDestination = this.mediaUploader?.getUploadDestination();
		const useDropbox = this.dropboxUploader && (
			courseDropboxEnabled ||
			(courseDropboxEnabled !== false && globalDestination === 'dropbox')
		);

		this.log('Media upload routing:', {
			hasDropboxUploader: !!this.dropboxUploader,
			hasMediaUploader: !!this.mediaUploader,
			courseDropboxEnabled,
			globalDestination,
			useDropbox,
			courseName: courseConfig?.name,
		});

		if (useDropbox && this.dropboxUploader) {
			// Use Dropbox for media storage
			const dropboxFolder = courseConfig?.dropbox?.folderPath || `/Canvas Media/${courseConfig?.name || 'Uploads'}`;
			const sharedFolder = this.dropboxUploader.getDropboxSharedFolder();

			this.log(`Using Dropbox for media uploads, folder: ${dropboxFolder}`);
			try {
				mediaReplacements = await this.dropboxUploader.processMediaEmbeds(
					parsed.content,
					file.path,
					dropboxFolder,
					progressCallback,
					sharedFolder,
					(path: string) => this.linkParser.isSharedContent(path)
				);
				this.log(`Dropbox processMediaEmbeds returned ${mediaReplacements.length} replacements`);
				if (mediaReplacements.length > 0) {
					this.log(`Processed ${mediaReplacements.length} media embeds via Dropbox`);
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				this.log('Error processing media embeds via Dropbox:', errorMsg);
				console.error('[Sync Engine] Dropbox media error details:', error);
				// Continue without media - don't fail the sync
			}

			// Also process ext:// standard markdown links (files already in Dropbox)
			try {
				const extLinkReplacements = await this.dropboxUploader.processExtLinks(
					parsed.content,
					progressCallback
				);
				if (extLinkReplacements.length > 0) {
					this.log(`Processed ${extLinkReplacements.length} ext:// links via Dropbox`);
					mediaReplacements = [...mediaReplacements, ...extLinkReplacements];
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				this.log('Error processing ext:// links via Dropbox:', errorMsg);
				// Continue without ext:// links - don't fail the sync
			}
		} else if (this.mediaUploader) {
			// Use Canvas for media storage
			try {
				mediaReplacements = await this.mediaUploader.processMediaEmbeds(
					parsed.content,
					file.path,
					courseId,
					progressCallback
				);
				if (mediaReplacements.length > 0) {
					this.log(`Processed ${mediaReplacements.length} media embeds via Canvas`);
				}
			} catch (error) {
				this.log('Error processing media embeds:', error);
				// Continue without media - don't fail the sync
			}
		}

		// Build converter options
		const convertOptions: ConvertOptions = {
			courseId,
			pageSlugMap,
			discussionTitleMap,
			style: this.styleSettings,
			customCss: this.customCss || undefined,
			mediaReplacements,
		};

		this.log('Converting file:', file.path);
		this.log('Custom CSS length:', this.customCss?.length || 0);

		// Convert markdown to HTML
		const html = this.converter.convert(parsed.content, convertOptions);

		try {
			if (type === 'page') {
				// Use existing page URL for lookups if available (handles title renames)
				const existingSlug = parsed.canvas.page_url;
				const { page, created } = await this.api.upsertPage(courseId, title, html, publish, existingSlug);

				// Write page URL back to frontmatter if this is first sync or URL changed
				if (created || !existingSlug || existingSlug !== page.url) {
					await this.updatePageUrlFrontmatter(file, page.url);
				}

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
				// Look up assignment group if specified
				let assignmentGroupId: number | undefined;
				if (parsed.canvas.assignment_group) {
					const { group } = await this.api.upsertAssignmentGroup(courseId, parsed.canvas.assignment_group);
					assignmentGroupId = group.id;
					this.log(`Using assignment group: ${parsed.canvas.assignment_group} (ID: ${group.id})`);
				}

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
						assignmentGroupId,
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
				// Look up assignment group if specified
				let assignmentGroupId: number | undefined;
				if (parsed.canvas.assignment_group) {
					const { group } = await this.api.upsertAssignmentGroup(courseId, parsed.canvas.assignment_group);
					assignmentGroupId = group.id;
					this.log(`Using assignment group: ${parsed.canvas.assignment_group} (ID: ${group.id})`);
				}

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
					assignment_group_id: assignmentGroupId,
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
			} else if (type === 'syllabus') {
				// Syllabus updates BOTH the course's built-in syllabus body
				// AND creates a page so it can be added to modules
				await this.api.updateSyllabus(courseId, html);

				// Also create/update a page with the same content
				// Use existing page URL for lookups if available (handles title renames)
				const existingSlug = parsed.canvas.page_url;
				const { page, created } = await this.api.upsertPage(courseId, title, html, publish, existingSlug);

				// Write page URL back to frontmatter if this is first sync or URL changed
				if (created || !existingSlug || existingSlug !== page.url) {
					await this.updatePageUrlFrontmatter(file, page.url);
				}

				return {
					success: true,
					filePath: file.path,
					canvasType: type,
					title,
					action: created ? 'created' : 'updated',
					courseId,
					pageUrl: page.url, // Include pageUrl so it can be added to modules
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
	 * Structured progress callback for progress notice updates
	 */
	public onItemProgress?: (info: {
		current: number;
		total: number;
		phase: string;
		itemTitle?: string;
		action?: string;
	}) => void;

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

		// Get all shared content files (for inclusion in slug maps)
		const allSharedContentFiles = this.linkParser.getAllSharedContentFiles();

		// Build maps for link resolution - include both course and shared content files
		// This ensures wiki-links to shared content resolve even before shared content is synced
		const allFilesForMaps = [...courseFiles, ...allSharedContentFiles];
		const pageSlugMap = await this.frontmatter.buildPageSlugMap(allFilesForMaps);
		const discussionTitleMap = await this.frontmatter.buildDiscussionTitleMap(allFilesForMaps);

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

			// Track which files have been synced to prevent duplicates
			// (e.g., shared content that also appears in module items)
			const syncedFilePaths = new Set<string>();

			try {
				// Get course name
				const canvasCourse = await this.api.getCourse(courseId);
				courseResult.courseName = canvasCourse.name;

				progressCallback?.(`Syncing to ${canvasCourse.name} (ID: ${courseId})...`);

				// Calculate total for progress tracking
				const totals = await this.calculateSyncTotals(course);
				let currentProgress = 0;

				// Sync shared content FIRST to get actual Canvas URLs for wiki-link resolution
				if (sharedContentFiles.length > 0) {
					progressCallback?.(`  Shared Content (${sharedContentFiles.length} files)...`);

					for (const file of sharedContentFiles) {
						// Skip if already synced (shouldn't happen in shared content, but defensive)
						if (syncedFilePaths.has(file.path)) {
							this.log(`Skipping "${file.path}" - already synced`);
							continue;
						}

						const parsed = await this.frontmatter.parseFile(file);
						const result = await this.syncFile(
							file,
							courseId,
							pageSlugMap,
							discussionTitleMap,
							progressCallback,
							course
						);

						courseResult.results.push(result);

						// Track synced file (even if skipped, to avoid re-processing)
						syncedFilePaths.add(file.path);

						if (result.action === 'skipped') {
							courseResult.skipped++;
						} else if (result.success) {
							courseResult.success++;
							// Update pageSlugMap with the actual Canvas URL (not our calculated slug)
							if (result.pageUrl) {
								pageSlugMap.set(parsed.filename, result.pageUrl);
								console.log(`[Sync Engine] Updated pageSlugMap: "${parsed.filename}" -> "${result.pageUrl}"`);
							}
							// Also update discussionTitleMap for discussions
							if (result.discussionId) {
								discussionTitleMap.set(parsed.filename, result.discussionId);
								console.log(`[Sync Engine] Updated discussionTitleMap: "${parsed.filename}" -> ${result.discussionId}`);
							}
						} else {
							courseResult.failed++;
						}

						progressCallback?.(`    ${result.action}: ${result.title}`);

						// Emit structured progress
						currentProgress++;
						this.onItemProgress?.({
							current: currentProgress,
							total: totals.totalCount,
							phase: 'Shared Content',
							itemTitle: result.title,
							action: result.action,
						});
					}
				}

				// Discover and sync modules
				const modules = await this.discoverModules(course.path);

				for (const module of modules) {
					progressCallback?.(`  Module: ${module.name}`);

					// Create/update the module in Canvas
					this.log(`Creating/updating module "${module.name}" with publish=${module.publish}`);
					const { module: canvasModule } = await this.api.upsertModule(
						courseId,
						module.name,
						module.position,
						module.publish
					);
					this.log(`Module "${module.name}" result: id=${canvasModule.id}, published=${canvasModule.published}`);

					// Get existing module items to avoid duplicates
					console.log(`[Sync Engine] Getting existing items for module ${canvasModule.id}`);
					const existingItems = await this.api.getModuleItems(courseId, canvasModule.id);
					console.log(`[Sync Engine] Found ${existingItems.length} existing items in module`);
					// Debug: log all items with their types and IDs
					for (const item of existingItems) {
						console.log(`[Sync Engine]   Item: type="${item.type}", content_id=${item.content_id} (${typeof item.content_id}), title="${item.title}"`);
					}
					const existingPageUrls = new Set(existingItems.filter(i => i.type === 'Page').map(i => i.page_url));
					const existingDiscussionIds = new Set<number>(
						existingItems
							.filter(i => i.type === 'Discussion' && i.content_id !== undefined)
							.map(i => Number(i.content_id))
					);
					const existingAssignmentIds = new Set<number>(
						existingItems
							.filter(i => i.type === 'Assignment' && i.content_id !== undefined)
							.map(i => Number(i.content_id))
					);
					const existingExternalUrls = new Set(existingItems.filter(i => i.type === 'ExternalUrl').map(i => i.title));
					console.log(`[Sync Engine] existingAssignmentIds:`, Array.from(existingAssignmentIds));

					// Sync each item in the module
					let itemPosition = 1;
					for (const item of module.items) {
						const file = this.app.vault.getAbstractFileByPath(item.filePath) as TFile;
						if (!file) continue;

						// Skip files already synced as shared content, but still add to module
						if (syncedFilePaths.has(item.filePath)) {
							this.log(`Skipping sync for "${item.title}" - already synced as shared content`);

							// Still need to add to module - get Canvas URL from pageSlugMap
							const parsed = await this.frontmatter.parseFile(file);
							const pageUrl = pageSlugMap.get(parsed.filename);
							const discussionId = discussionTitleMap.get(parsed.filename);

							if (pageUrl && !existingPageUrls.has(pageUrl)) {
								try {
									await this.api.addPageToModule(
										courseId,
										canvasModule.id,
										pageUrl,
										itemPosition
									);
									console.log(`[Sync Engine] Added shared content page to module: ${item.title}`);
								} catch (moduleItemError) {
									console.log(`[Sync Engine] Error adding shared content to module: ${moduleItemError}`);
								}
							} else if (discussionId && !existingDiscussionIds.has(discussionId)) {
								try {
									await this.api.addDiscussionToModule(
										courseId,
										canvasModule.id,
										discussionId,
										itemPosition
									);
									console.log(`[Sync Engine] Added shared content discussion to module: ${item.title}`);
								} catch (moduleItemError) {
									console.log(`[Sync Engine] Error adding shared content to module: ${moduleItemError}`);
								}
							}

							itemPosition++;
							progressCallback?.(`    skipped (shared): ${item.title}`);
							continue;
						}

						const parsed = await this.frontmatter.parseFile(file);

						const result = await this.syncFile(
							file,
							courseId,
							pageSlugMap,
							discussionTitleMap,
							progressCallback,
							course
						);

						courseResult.results.push(result);

						// Track synced file to prevent duplicate syncs in other modules
						syncedFilePaths.add(item.filePath);

						if (result.action === 'skipped') {
							courseResult.skipped++;
						} else if (result.success) {
							courseResult.success++;

							// Update maps with actual Canvas IDs/URLs for future file conversions
							if ((result.canvasType === 'page' || result.canvasType === 'syllabus') && result.pageUrl) {
								pageSlugMap.set(parsed.filename, result.pageUrl);
								console.log(`[Sync Engine] Updated pageSlugMap: "${parsed.filename}" -> "${result.pageUrl}"`);
							} else if ((result.canvasType === 'discussion' || result.canvasType === 'graded_discussion') && result.discussionId) {
								discussionTitleMap.set(parsed.filename, result.discussionId);
								console.log(`[Sync Engine] Updated discussionTitleMap: "${parsed.filename}" -> ${result.discussionId}`);
							}

							// Add item to module if not already present
							console.log(`[Sync Engine] Attempting to add ${result.canvasType} "${result.title}" to module. pageUrl=${result.pageUrl}, discussionId=${result.discussionId}, assignmentId=${result.assignmentId}, externalUrl=${result.externalUrl}`);
							try {
								if ((result.canvasType === 'page' || result.canvasType === 'syllabus') && result.pageUrl) {
									// Syllabus creates both a course syllabus AND a page for module inclusion
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
								} else if (result.canvasType === 'graded_discussion' && result.discussionId && result.assignmentId) {
									// Graded discussion - Canvas returns these as type="Discussion" in module items,
									// so we check against existingDiscussionIds using the discussionId
									const alreadyExists = existingDiscussionIds.has(result.discussionId);
									console.log(`[Sync Engine] Graded discussion ${result.discussionId} already in module: ${alreadyExists}`);
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
									console.log(`[Sync Engine] Assignment ${result.assignmentId} (${typeof result.assignmentId}) already in module: ${alreadyExists}, set contains: [${Array.from(existingAssignmentIds).join(', ')}]`);
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

						// Emit structured progress for module items
						currentProgress++;
						this.onItemProgress?.({
							current: currentProgress,
							total: totals.totalCount,
							phase: `Module: ${module.name}`,
							itemTitle: result.title,
							action: result.action,
						});
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

						// Include shared content files for link resolution
						const allSharedContentFiles = this.linkParser.getAllSharedContentFiles();
						const allFilesForMaps = [...courseFiles, ...allSharedContentFiles];
						const pageSlugMap = await this.frontmatter.buildPageSlugMap(allFilesForMaps);
						const discussionTitleMap =
							await this.frontmatter.buildDiscussionTitleMap(allFilesForMaps);

						for (const courseId of course.courseIds) {
							const result = await this.syncFile(
								file,
								courseId,
								pageSlugMap,
								discussionTitleMap,
								undefined,
								course
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

		// Include shared content files for link resolution
		const allSharedContentFiles = this.linkParser.getAllSharedContentFiles();
		const allFilesForMaps = [...courseFiles, ...allSharedContentFiles];
		const pageSlugMap = await this.frontmatter.buildPageSlugMap(allFilesForMaps);
		const discussionTitleMap = await this.frontmatter.buildDiscussionTitleMap(allFilesForMaps);

		// Sync to each course ID
		for (const courseId of matchingCourse.courseIds) {
			const result = await this.syncFile(file, courseId, pageSlugMap, discussionTitleMap, undefined, matchingCourse);
			results.push(result);
		}

		return results;
	}

	/**
	 * Calculate total items to sync for progress tracking
	 * Pre-calculates counts before sync starts for accurate progress display
	 */
	async calculateSyncTotals(course: CourseConfig): Promise<{
		sharedContentCount: number;
		moduleItemCount: number;
		totalCount: number;
	}> {
		// Get shared content files that will be synced
		const sharedContentFiles = await this.linkParser.getSharedContentToSync(course.path);
		const sharedContentCount = sharedContentFiles.length;

		// Discover modules and count their items
		const modules = await this.discoverModules(course.path);
		let moduleItemCount = 0;

		// Track shared content paths to avoid double-counting
		const sharedPaths = new Set(sharedContentFiles.map(f => f.path));

		for (const module of modules) {
			for (const item of module.items) {
				// Don't count items that are also shared content (they're counted once in sharedContentCount)
				if (!sharedPaths.has(item.filePath)) {
					moduleItemCount++;
				}
			}
		}

		const totals = {
			sharedContentCount,
			moduleItemCount,
			totalCount: sharedContentCount + moduleItemCount,
		};
		console.log('[Sync Engine] calculateSyncTotals:', totals);
		return totals;
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
