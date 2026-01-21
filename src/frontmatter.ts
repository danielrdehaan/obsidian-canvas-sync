import type { App, TFile, CachedMetadata } from 'obsidian';
import type {
	CanvasFrontmatter,
	ModuleFrontmatter,
	ParsedFile,
	WikiLink,
	CanvasContentType,
	SubmissionType,
	GradingType,
} from './types';

/**
 * Parse frontmatter and extract canvas configuration from files
 */
export class FrontmatterParser {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Parse a file and extract all relevant metadata
	 */
	async parseFile(file: TFile): Promise<ParsedFile> {
		const content = await this.app.vault.read(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter ?? {};

		// Debug: log frontmatter for troubleshooting
		console.log(`[Frontmatter] Parsing ${file.basename}: cache exists=${!!cache}, frontmatter keys=${Object.keys(frontmatter).join(', ')}`);

		return {
			path: file.path,
			filename: file.basename,
			content,
			frontmatter,
			canvas: this.extractCanvasFrontmatter(frontmatter),
			wikiLinks: this.extractWikiLinks(content, cache),
		};
	}

	/**
	 * Extract canvas-specific frontmatter (flattened format: canvas_type, canvas_title, etc.)
	 */
	extractCanvasFrontmatter(frontmatter: Record<string, unknown>): CanvasFrontmatter {
		return {
			type: this.parseContentType(frontmatter.canvas_type),
			title: typeof frontmatter.canvas_title === 'string' ? frontmatter.canvas_title : undefined,
			publish: typeof frontmatter.canvas_publish === 'boolean' ? frontmatter.canvas_publish : true,
			sync: typeof frontmatter.canvas_sync === 'boolean' ? frontmatter.canvas_sync : true,
			points: typeof frontmatter.canvas_points === 'number' ? frontmatter.canvas_points : undefined,
			due_date: typeof frontmatter.canvas_due_date === 'string' ? frontmatter.canvas_due_date : undefined,
			position: typeof frontmatter.canvas_position === 'number' ? frontmatter.canvas_position : undefined,
			// Assignment-specific fields
			submission_types: this.parseSubmissionTypes(frontmatter.canvas_submission_types),
			allowed_extensions: this.parseStringArray(frontmatter.canvas_allowed_extensions),
			grading_type: this.parseGradingType(frontmatter.canvas_grading_type),
			lock_at: typeof frontmatter.canvas_lock_at === 'string' ? frontmatter.canvas_lock_at : undefined,
			unlock_at: typeof frontmatter.canvas_unlock_at === 'string' ? frontmatter.canvas_unlock_at : undefined,
			assignment_group: typeof frontmatter.canvas_assignment_group === 'string' ? frontmatter.canvas_assignment_group : undefined,
			// External URL fields
			url: typeof frontmatter.canvas_url === 'string' ? frontmatter.canvas_url : undefined,
			new_tab: typeof frontmatter.canvas_new_tab === 'boolean' ? frontmatter.canvas_new_tab : true,
			// Page identity field (stores the Canvas page URL slug after first sync)
			page_url: typeof frontmatter.canvas_page_url === 'string' ? frontmatter.canvas_page_url : undefined,
		};
	}

	/**
	 * Extract module frontmatter from a folder note (flattened format)
	 */
	extractModuleFrontmatter(frontmatter: Record<string, unknown>): ModuleFrontmatter {
		return {
			module_name: typeof frontmatter.canvas_module === 'string' ? frontmatter.canvas_module : undefined,
			position: typeof frontmatter.canvas_position === 'number' ? frontmatter.canvas_position : undefined,
			publish: typeof frontmatter.canvas_publish === 'boolean' ? frontmatter.canvas_publish : true,
			require_sequential:
				typeof frontmatter.canvas_sequential === 'boolean' ? frontmatter.canvas_sequential : false,
		};
	}

	/**
	 * Parse content type from frontmatter
	 */
	private parseContentType(type: unknown): CanvasContentType | undefined {
		const validTypes: CanvasContentType[] = [
			'page',
			'discussion',
			'graded_discussion',
			'assignment',
			'external_url',
			'syllabus',
		];

		if (typeof type === 'string' && validTypes.includes(type as CanvasContentType)) {
			return type as CanvasContentType;
		}

		return undefined;
	}

	/**
	 * Parse submission types array from frontmatter
	 */
	private parseSubmissionTypes(value: unknown): SubmissionType[] | undefined {
		const validTypes: SubmissionType[] = [
			'online_upload',
			'online_text_entry',
			'online_url',
			'media_recording',
			'none',
		];

		if (!Array.isArray(value)) {
			return undefined;
		}

		const parsed = value.filter(
			(v): v is SubmissionType => typeof v === 'string' && validTypes.includes(v as SubmissionType)
		);

		return parsed.length > 0 ? parsed : undefined;
	}

	/**
	 * Parse grading type from frontmatter
	 */
	private parseGradingType(value: unknown): GradingType | undefined {
		const validTypes: GradingType[] = [
			'pass_fail',
			'percent',
			'letter_grade',
			'gpa_scale',
			'points',
			'not_graded',
		];

		if (typeof value === 'string' && validTypes.includes(value as GradingType)) {
			return value as GradingType;
		}

		return undefined;
	}

	/**
	 * Parse a string array from frontmatter
	 */
	private parseStringArray(value: unknown): string[] | undefined {
		if (!Array.isArray(value)) {
			return undefined;
		}

		const parsed = value.filter((v): v is string => typeof v === 'string');
		return parsed.length > 0 ? parsed : undefined;
	}

	/**
	 * Extract wiki-links from content
	 */
	extractWikiLinks(content: string, cache: CachedMetadata | null): WikiLink[] {
		const links: WikiLink[] = [];

		// Use Obsidian's cached links if available
		if (cache?.links) {
			for (const link of cache.links) {
				links.push({
					raw: link.original,
					target: link.link,
					display: link.displayText || link.link.replace(/-/g, ' '),
					resolvedPath: this.resolveLink(link.link),
				});
			}
		} else {
			// Fallback to regex parsing
			const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
			let match;

			while ((match = wikiLinkPattern.exec(content)) !== null) {
				const target = match[1];
				const display = match[2] || target.split('/').pop()?.replace(/-/g, ' ') || target;

				links.push({
					raw: match[0],
					target,
					display,
					resolvedPath: this.resolveLink(target),
				});
			}
		}

		return links;
	}

	/**
	 * Resolve a wiki-link to a file path
	 */
	private resolveLink(linkTarget: string): string | undefined {
		// Try to find the file using Obsidian's link resolution
		const file = this.app.metadataCache.getFirstLinkpathDest(linkTarget, '');
		return file?.path;
	}

	/**
	 * Get default content type when not specified in frontmatter
	 * Note: Filename inference has been removed - use explicit canvas_type in frontmatter
	 */
	getDefaultContentType(): CanvasContentType {
		return 'page';
	}

	/**
	 * Generate a Canvas title from a filename
	 */
	generateTitle(filename: string): string {
		// Remove common prefixes like "01-", "Week-01-", etc.
		let title = filename;

		// Remove numbered prefix (01-, 02-, etc.)
		title = title.replace(/^\d+-/, '');

		// Replace hyphens and underscores with spaces
		title = title.replace(/[-_]/g, ' ');

		// Title case
		title = title
			.split(' ')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');

		return title;
	}

	/**
	 * Get the effective content type (from frontmatter or default to page)
	 */
	getEffectiveContentType(parsed: ParsedFile): CanvasContentType {
		return parsed.canvas.type || this.getDefaultContentType();
	}

	/**
	 * Get the effective title (canvas_title > title > generated from filename)
	 */
	getEffectiveTitle(parsed: ParsedFile): string {
		// Priority: canvas_title > title > generated
		if (parsed.canvas.title) {
			console.log(`[Frontmatter] Using canvas_title: ${parsed.canvas.title}`);
			return parsed.canvas.title;
		}
		if (typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim()) {
			console.log(`[Frontmatter] Using frontmatter title: ${parsed.frontmatter.title}`);
			return parsed.frontmatter.title;
		}
		const generated = this.generateTitle(parsed.filename);
		console.log(`[Frontmatter] Generated title from filename "${parsed.filename}": ${generated}`);
		console.log(`[Frontmatter] frontmatter.title was: ${JSON.stringify(parsed.frontmatter.title)}`);
		return generated;
	}

	/**
	 * Check if a file should be synced based on frontmatter
	 */
	shouldSync(parsed: ParsedFile): boolean {
		// Check explicit sync: false
		if (parsed.canvas.sync === false) {
			return false;
		}

		// Skip files that start with underscore (convention for module notes)
		if (parsed.filename.startsWith('_')) {
			return false;
		}

		return true;
	}

	/**
	 * Extract position from frontmatter
	 * Returns canvas_position if set, otherwise 0 (sorting will use filename as tiebreaker)
	 */
	extractPosition(parsed: ParsedFile): number {
		// Use frontmatter position if specified
		if (parsed.canvas.position !== undefined) {
			return parsed.canvas.position;
		}

		// Default to 0 - sorting will use filename alphanumerically as tiebreaker
		return 0;
	}

	/**
	 * Build a page slug map for a course
	 */
	async buildPageSlugMap(files: TFile[]): Promise<Map<string, string>> {
		const map = new Map<string, string>();

		console.log(`[Frontmatter] Building pageSlugMap for ${files.length} files`);

		for (const file of files) {
			const parsed = await this.parseFile(file);
			const type = this.getEffectiveContentType(parsed);

			if (type === 'page') {
				const title = this.getEffectiveTitle(parsed);
				const slug = title
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '');
				map.set(parsed.filename, slug);
				console.log(`[Frontmatter] Added to pageSlugMap: "${parsed.filename}" -> "${slug}"`);
			} else {
				console.log(`[Frontmatter] Skipped "${parsed.filename}" (type=${type})`);
			}
		}

		console.log(`[Frontmatter] pageSlugMap has ${map.size} entries`);
		return map;
	}

	/**
	 * Build a discussion title map for a course
	 */
	async buildDiscussionTitleMap(files: TFile[]): Promise<Map<string, number>> {
		const map = new Map<string, number>();
		let id = 1;

		console.log(`[Frontmatter] Building discussionTitleMap for ${files.length} files`);

		for (const file of files) {
			const parsed = await this.parseFile(file);
			const type = this.getEffectiveContentType(parsed);

			if (type === 'discussion' || type === 'graded_discussion') {
				map.set(parsed.filename, id++);
				console.log(`[Frontmatter] Added to discussionTitleMap: "${parsed.filename}" -> ${id - 1}`);
			}
		}

		console.log(`[Frontmatter] discussionTitleMap has ${map.size} entries`);
		return map;
	}
}
