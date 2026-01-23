/**
 * Canvas content types
 */
export type CanvasContentType = 'page' | 'discussion' | 'graded_discussion' | 'assignment' | 'external_url' | 'syllabus';

/**
 * Content theme options for Canvas styling
 */
export type ContentTheme = 'auto' | 'light' | 'dark';

/**
 * Style settings for Canvas content
 */
export interface StyleSettings {
	/** Theme mode: auto (follows OS preference), light, or dark */
	theme: ContentTheme;
	/** Primary accent color (hex) used for links, headings, table headers */
	accentColor: string;
	/** List of enabled CSS snippet filenames */
	enabledSnippets: string[];
	/** Mobile compatible mode: uses transparent backgrounds for Canvas mobile dark mode support */
	mobileCompatible: boolean;
}

/**
 * Canvas assignment submission types
 */
export type SubmissionType =
	| 'online_upload'
	| 'online_text_entry'
	| 'online_url'
	| 'media_recording'
	| 'discussion_topic'
	| 'none';

/**
 * Canvas assignment grading types
 */
export type GradingType =
	| 'pass_fail'
	| 'percent'
	| 'letter_grade'
	| 'gpa_scale'
	| 'points'
	| 'not_graded';

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
	// Assignment-specific fields
	submission_types?: SubmissionType[];
	allowed_extensions?: string[];
	grading_type?: GradingType;
	lock_at?: string;
	unlock_at?: string;
	assignment_group?: string;
	// External URL fields
	url?: string;
	new_tab?: boolean;
	// Page identity field (stores the Canvas page URL slug after first sync)
	page_url?: string;
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
	/** Optional Dropbox settings for this course */
	dropbox?: CourseDropboxSettings;
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
	action: 'created' | 'updated' | 'skipped' | 'failed' | 'ready';
	error?: string;
	courseId: number;
	/** Page URL slug (for pages) */
	pageUrl?: string;
	/** Discussion ID (for discussions) */
	discussionId?: number;
	/** Assignment ID (for assignments) */
	assignmentId?: number;
	/** External URL (for external_url type) */
	externalUrl?: string;
	/** Open in new tab (for external_url type) */
	newTab?: boolean;
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
 * Canvas API assignment group response
 */
export interface CanvasAssignmentGroup {
	id: number;
	name: string;
	position: number;
	group_weight: number;
}

/**
 * Canvas API assignment response
 */
export interface CanvasAssignment {
	id: number;
	name: string;
	description: string;
	html_url: string;
	due_at: string | null;
	lock_at: string | null;
	unlock_at: string | null;
	points_possible: number;
	submission_types: SubmissionType[];
	allowed_extensions?: string[];
	grading_type: GradingType;
	published: boolean;
}

/**
 * Data for creating a Canvas assignment
 */
export interface CreateAssignmentData {
	name: string;
	description?: string;
	points_possible?: number;
	due_at?: string | null;
	lock_at?: string | null;
	unlock_at?: string | null;
	submission_types?: SubmissionType[];
	allowed_extensions?: string[];
	grading_type?: GradingType;
	published?: boolean;
	assignment_group_id?: number;
}

/**
 * Data for updating a Canvas assignment
 */
export interface UpdateAssignmentData {
	name?: string;
	description?: string;
	points_possible?: number;
	due_at?: string | null;
	lock_at?: string | null;
	unlock_at?: string | null;
	submission_types?: SubmissionType[];
	allowed_extensions?: string[];
	grading_type?: GradingType;
	published?: boolean;
	assignment_group_id?: number;
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

// ============================================
// Media Upload Types
// ============================================

/**
 * Supported media types for Canvas uploads
 */
export type MediaType = 'image' | 'audio' | 'video' | 'pdf' | 'other';

/**
 * Parsed media embed from markdown content
 */
export interface MediaEmbed {
	/** The raw embed text (e.g., "![[file.png]]" or "![alt](path)") */
	raw: string;
	/** The filename (e.g., "file.png") */
	filename: string;
	/** Optional alt text */
	altText?: string;
	/** Full path within vault (resolved) */
	vaultPath?: string;
	/** Media type determined from extension */
	mediaType?: MediaType;
	/** Absolute filesystem path for external files */
	externalPath?: string;
	/** True if this is an ext:// external file embed */
	isExternal?: boolean;
}

/**
 * Cache entry for an uploaded media file
 */
export interface MediaCacheEntry {
	/** Canvas file ID */
	canvasFileId: number;
	/** Canvas file URL */
	canvasUrl: string;
	/** Content hash (SHA-256) for change detection */
	contentHash: string;
	/** Upload timestamp */
	uploadedAt: number;
	/** Original vault path */
	vaultPath: string;
}

/**
 * Media upload cache - maps courseId:vaultPath to cache entry
 */
export type MediaUploadCache = Record<string, MediaCacheEntry>;

/**
 * Settings for media upload behavior
 */
export interface MediaSettings {
	/** Enable media uploads */
	enabled: boolean;
	/** Upload images (png, jpg, gif, webp, svg) */
	uploadImages: boolean;
	/** Upload audio files (mp3, wav, ogg, m4a) */
	uploadAudio: boolean;
	/** Upload video files (mp4, webm, mov) */
	uploadVideo: boolean;
	/** Upload PDF files */
	uploadPdf: boolean;
	/** Upload other files (zip, etc.) as download links */
	uploadOther: boolean;
	/** Enforce maximum file size limit */
	enforceMaxFileSize: boolean;
	/** Maximum file size in bytes (default 100MB) */
	maxFileSize: number;
	/** Canvas folder name for uploads */
	canvasFolderName: string;
	/** Default upload destination (canvas or dropbox) */
	uploadDestination: MediaUploadDestination;
	/** Local filesystem path to Dropbox folder (for ext:// link conversion) */
	dropboxLocalPath?: string;
	/** Dropbox folder path for shared content media uploads */
	dropboxSharedFolder?: string;
}

/**
 * Canvas file response from Files API
 */
export interface CanvasFile {
	id: number;
	uuid: string;
	folder_id: number;
	display_name: string;
	filename: string;
	url: string;
	size: number;
	created_at: string;
	updated_at: string;
	content_type: string;
	'content-type'?: string;
}

/**
 * Canvas folder response from Folders API
 */
export interface CanvasFolder {
	id: number;
	name: string;
	full_name: string;
	parent_folder_id: number | null;
	created_at: string;
	updated_at: string;
	files_count: number;
	folders_count: number;
}

/**
 * Parameters for initiating a Canvas file upload (Step 1)
 */
export interface CanvasFileUploadParams {
	name: string;
	size: number;
	content_type: string;
	parent_folder_id?: number;
	parent_folder_path?: string;
	on_duplicate?: 'overwrite' | 'rename';
}

/**
 * Response from Canvas file upload initiation (Step 1)
 */
export interface CanvasFileUploadResponse {
	upload_url: string;
	upload_params: Record<string, string>;
}

/**
 * Response from Canvas file upload data (Step 2)
 * Returns a Location header for confirmation
 */
export interface CanvasFileUploadDataResponse {
	location: string;
}

// ============================================
// Dropbox Integration Types
// ============================================

/**
 * Dropbox authentication tokens
 */
export interface DropboxAuth {
	/** OAuth2 access token */
	accessToken: string;
	/** OAuth2 refresh token */
	refreshToken: string;
	/** Token expiration timestamp (Unix ms) */
	expiresAt: number;
	/** Dropbox account ID */
	accountId?: string;
	/** Display name for UI */
	displayName?: string;
}

/**
 * Upload destination options
 */
export type MediaUploadDestination = 'canvas' | 'dropbox';

/**
 * Per-course Dropbox settings
 */
export interface CourseDropboxSettings {
	/** Enable Dropbox uploads for this course */
	enabled: boolean;
	/** Folder path in Dropbox (e.g., "/Canvas Media/MUSC-175") */
	folderPath: string;
}

/**
 * Cache entry for an uploaded Dropbox file
 */
export interface DropboxCacheEntry {
	/** Dropbox file ID */
	dropboxFileId: string;
	/** Shared URL (www.dropbox.com) */
	sharedUrl: string;
	/** Direct URL (dl.dropboxusercontent.com) for streaming */
	directUrl: string;
	/** Content hash (SHA-256) for change detection */
	contentHash: string;
	/** Upload timestamp */
	uploadedAt: number;
	/** Original vault path */
	vaultPath: string;
}

/**
 * Dropbox upload cache - maps dropboxFolderPath:vaultPath to cache entry
 */
export type DropboxUploadCache = Record<string, DropboxCacheEntry>;

/**
 * Dropbox file metadata from API response
 */
export interface DropboxFileMetadata {
	'.tag': 'file';
	id: string;
	name: string;
	path_lower: string;
	path_display: string;
	size: number;
	content_hash: string;
}

/**
 * Dropbox folder metadata from API response
 */
export interface DropboxFolderMetadata {
	'.tag': 'folder';
	id: string;
	name: string;
	path_lower: string;
	path_display: string;
}

/**
 * Dropbox entry (file or folder)
 */
export type DropboxEntry = DropboxFileMetadata | DropboxFolderMetadata;

/**
 * Dropbox shared link metadata
 */
export interface DropboxSharedLinkMetadata {
	'.tag': 'file' | 'folder';
	url: string;
	name: string;
	path_lower: string;
}

