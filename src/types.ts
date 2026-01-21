/**
 * Canvas content types
 */
export type CanvasContentType = 'page' | 'discussion' | 'graded_discussion' | 'assignment';

/**
 * Canvas frontmatter configuration
 */
export interface CanvasFrontmatter {
	type?: CanvasContentType;
	title?: string;
	publish?: boolean;
	sync?: boolean;
	points?: number;
	due_date?: string;
	position?: number;
}

/**
 * Module configuration from folder note
 */
export interface ModuleFrontmatter {
	module_name?: string;
	position?: number;
	publish?: boolean;
	require_sequential?: boolean;
}

/**
 * Parsed file metadata
 */
export interface ParsedFile {
	path: string;
	filename: string;
	content: string;
	frontmatter: Record<string, unknown>;
	canvas: CanvasFrontmatter;
	wikiLinks: WikiLink[];
}

/**
 * Wiki link representation
 */
export interface WikiLink {
	raw: string;
	target: string;
	display: string;
	resolvedPath?: string;
}

/**
 * Course configuration
 */
export interface CourseConfig {
	id: string;
	name: string;
	path: string;
	courseIds: number[];
	enabled: boolean;
}

/**
 * Module structure
 */
export interface ModuleStructure {
	name: string;
	position: number;
	folderPath: string;
	items: ModuleItem[];
	publish: boolean;
}

/**
 * Module item
 */
export interface ModuleItem {
	type: CanvasContentType;
	title: string;
	filePath: string;
	position: number;
	canvasId?: number;
}

/**
 * Sync result for a single file
 */
export interface SyncResult {
	success: boolean;
	filePath: string;
	canvasType: CanvasContentType;
	title: string;
	action: 'created' | 'updated' | 'skipped' | 'failed';
	error?: string;
	courseId: number;
	/** Page URL slug (for pages) */
	pageUrl?: string;
	/** Discussion ID (for discussions) */
	discussionId?: number;
}

/**
 * Course sync result
 */
export interface CourseSyncResult {
	courseId: number;
	courseName: string;
	results: SyncResult[];
	success: number;
	failed: number;
	skipped: number;
}

/**
 * Canvas API page response
 */
export interface CanvasPage {
	page_id: number;
	url: string;
	title: string;
	body: string;
	published: boolean;
	created_at: string;
	updated_at: string;
}

/**
 * Canvas API discussion topic response
 */
export interface CanvasDiscussion {
	id: number;
	title: string;
	message: string;
	discussion_type: string;
	published: boolean;
	assignment?: CanvasAssignment;
}

/**
 * Canvas API assignment response
 */
export interface CanvasAssignment {
	id: number;
	name: string;
	description: string;
	due_at?: string;
	points_possible: number;
	published: boolean;
}

/**
 * Canvas API module response
 */
export interface CanvasModule {
	id: number;
	name: string;
	position: number;
	published: boolean;
	items_count: number;
}

/**
 * Canvas API module item response
 */
export interface CanvasModuleItem {
	id: number;
	title: string;
	position: number;
	type: string;
	content_id?: number;
	page_url?: string;
}

/**
 * Canvas API course response
 */
export interface CanvasCourse {
	id: number;
	name: string;
	course_code: string;
}

/**
 * Shared content discovery result
 */
export interface SharedContentDiscovery {
	/** Path to the shared content file */
	filePath: string;
	/** Courses that link to this file */
	linkedByCourses: string[];
	/** Wiki links that reference this file */
	linkedByFiles: { coursePath: string; filePath: string }[];
}
