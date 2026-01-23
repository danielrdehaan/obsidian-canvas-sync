import type { App, TFile } from 'obsidian';
import type { CanvasApi } from './canvas-api';
import type { MediaParser } from './media-parser';
import type {
	MediaEmbed,
	MediaType,
	MediaCacheEntry,
	MediaUploadCache,
	MediaSettings,
	CanvasFile,
	CanvasFolder,
} from './types';

/**
 * Default media settings
 */
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
	enabled: true,
	uploadImages: true,
	uploadAudio: true,
	uploadVideo: true,
	uploadPdf: true,
	uploadOther: true,
	enforceMaxFileSize: true,
	maxFileSize: 100 * 1024 * 1024, // 100MB
	canvasFolderName: 'canvas-sync',
	uploadDestination: 'canvas',
	dropboxSharedFolder: '/Canvas Media/Shared Resources',
};

/**
 * Media replacement entry - maps original embed to Canvas HTML
 */
export interface MediaReplacement {
	original: string;
	replacement: string;
}

/**
 * Media uploader - orchestrates media file uploads to Canvas
 */
export class MediaUploader {
	private app: App;
	private api: CanvasApi;
	private parser: MediaParser;
	private settings: MediaSettings;
	private cache: MediaUploadCache;
	private debugMode: boolean;

	// Cache folder IDs per course to avoid repeated lookups
	private folderCache: Map<string, CanvasFolder> = new Map();

	constructor(
		app: App,
		api: CanvasApi,
		parser: MediaParser,
		settings: MediaSettings = DEFAULT_MEDIA_SETTINGS,
		cache: MediaUploadCache = {},
		debugMode = false
	) {
		this.app = app;
		this.api = api;
		this.parser = parser;
		this.settings = settings;
		this.cache = cache;
		this.debugMode = debugMode;
	}

	/**
	 * Set debug mode
	 */
	setDebugMode(debug: boolean): void {
		this.debugMode = debug;
		this.parser.setDebugMode(debug);
	}

	/**
	 * Update settings
	 */
	setSettings(settings: MediaSettings): void {
		this.settings = settings;
	}

	/**
	 * Get the current cache (for persistence)
	 */
	getCache(): MediaUploadCache {
		return this.cache;
	}

	/**
	 * Set the cache (for loading persisted cache)
	 */
	setCache(cache: MediaUploadCache): void {
		this.cache = cache;
	}

	/**
	 * Get the default upload destination setting
	 */
	getUploadDestination(): 'canvas' | 'dropbox' {
		return this.settings.uploadDestination;
	}

	/**
	 * Check if media uploads are enabled
	 */
	isEnabled(): boolean {
		return this.settings.enabled;
	}

	/**
	 * Log debug messages
	 */
	private log(...args: unknown[]): void {
		if (this.debugMode) {
			console.log('[Media Uploader]', ...args);
		}
	}

	/**
	 * Check if a media type should be uploaded based on settings
	 */
	private shouldUploadType(mediaType: MediaType): boolean {
		switch (mediaType) {
			case 'image':
				return this.settings.uploadImages;
			case 'audio':
				return this.settings.uploadAudio;
			case 'video':
				return this.settings.uploadVideo;
			case 'pdf':
				return this.settings.uploadPdf;
			case 'other':
				return this.settings.uploadOther;
			default:
				return false;
		}
	}

	/**
	 * Get cache key for a file in a course
	 */
	private getCacheKey(courseId: number, vaultPath: string): string {
		return `${courseId}:${vaultPath}`;
	}

	/**
	 * Get subfolder name for a media type
	 */
	private getSubfolderName(mediaType: MediaType): string {
		switch (mediaType) {
			case 'image':
				return 'images';
			case 'audio':
				return 'audio';
			case 'video':
				return 'videos';
			case 'pdf':
				return 'documents';
			case 'other':
				return 'files';
			default:
				return 'files';
		}
	}

	/**
	 * Get or create the upload folder for a media type
	 */
	private async getUploadFolder(courseId: number, mediaType: MediaType): Promise<CanvasFolder> {
		const subfolderName = this.getSubfolderName(mediaType);
		const folderPath = `${this.settings.canvasFolderName}/${subfolderName}`;
		const cacheKey = `${courseId}:${folderPath}`;

		// Check folder cache first
		if (this.folderCache.has(cacheKey)) {
			return this.folderCache.get(cacheKey)!;
		}

		// Get or create the folder
		const folder = await this.api.getOrCreateFolder(courseId, folderPath);
		this.folderCache.set(cacheKey, folder);

		return folder;
	}

	/**
	 * Process all media embeds in markdown content
	 * Returns a map of original embed text to Canvas HTML replacements
	 */
	async processMediaEmbeds(
		content: string,
		sourcePath: string,
		courseId: number,
		progressCallback?: (message: string) => void
	): Promise<MediaReplacement[]> {
		if (!this.settings.enabled) {
			this.log('Media uploads disabled');
			return [];
		}

		const replacements: MediaReplacement[] = [];
		const embeds = this.parser.extractMediaEmbeds(content);

		if (embeds.length === 0) {
			this.log('No media embeds found');
			return [];
		}

		this.log(`Found ${embeds.length} media embeds`);

		for (const embed of embeds) {
			try {
				const replacement = await this.processEmbed(
					embed,
					sourcePath,
					courseId,
					progressCallback
				);

				if (replacement) {
					replacements.push(replacement);
				}
			} catch (error) {
				this.log(`Error processing embed ${embed.filename}:`, error);
				// Continue processing other embeds
			}
		}

		return replacements;
	}

	/**
	 * Process a single media embed
	 */
	private async processEmbed(
		embed: MediaEmbed,
		sourcePath: string,
		courseId: number,
		progressCallback?: (message: string) => void
	): Promise<MediaReplacement | null> {
		const mediaType = embed.mediaType || this.parser.getMediaType(embed.filename);

		// Check if this media type should be uploaded
		if (!this.shouldUploadType(mediaType)) {
			this.log(`Skipping ${embed.filename} - type ${mediaType} not enabled`);
			return null;
		}

		// Handle external files (ext:// embeds)
		if (embed.isExternal && embed.externalPath) {
			return this.processExternalEmbed(embed, courseId, mediaType, progressCallback);
		}

		// Resolve the file in the vault
		const file = this.parser.resolveMediaFile(embed, sourcePath);
		if (!file) {
			this.log(`Could not resolve file: ${embed.filename}`);
			return null;
		}

		// Check file size (if limit is enforced)
		if (this.settings.enforceMaxFileSize && !this.parser.isWithinSizeLimit(file.stat.size, this.settings.maxFileSize)) {
			this.log(`File too large: ${embed.filename} (${file.stat.size} bytes)`);
			return null;
		}

		// Read file data
		const fileData = await this.parser.readMediaFile(file);
		const contentHash = await this.parser.computeFileHash(fileData);

		// Check cache
		const cacheKey = this.getCacheKey(courseId, file.path);
		const cached = this.cache[cacheKey];

		if (cached && cached.contentHash === contentHash) {
			// Cache hit - file hasn't changed
			this.log(`Cache hit for ${embed.filename}`);
			const html = this.generateCanvasHtml(
				cached.canvasFileId,
				cached.canvasUrl,
				mediaType,
				embed.altText || embed.filename,
				courseId
			);
			return { original: embed.raw, replacement: html };
		}

		// Upload the file
		progressCallback?.(`Uploading ${file.name}...`);
		this.log(`Uploading ${file.name} to Canvas`);

		const canvasFile = await this.uploadWithRetry(
			file.name,
			fileData,
			mediaType,
			courseId
		);

		// Update cache
		this.cache[cacheKey] = {
			canvasFileId: canvasFile.id,
			canvasUrl: canvasFile.url,
			contentHash,
			uploadedAt: Date.now(),
			vaultPath: file.path,
		};

		// Generate HTML replacement
		const html = this.generateCanvasHtml(
			canvasFile.id,
			canvasFile.url,
			mediaType,
			embed.altText || embed.filename,
			courseId
		);

		return { original: embed.raw, replacement: html };
	}

	/**
	 * Process an external file embed (ext:// syntax)
	 */
	private async processExternalEmbed(
		embed: MediaEmbed,
		courseId: number,
		mediaType: MediaType,
		progressCallback?: (message: string) => void
	): Promise<MediaReplacement | null> {
		const externalPath = embed.externalPath!;

		// Normalize path (handle Windows backslashes)
		const normalizedPath = externalPath.replace(/\\/g, '/');

		// Check if file exists
		const exists = await this.parser.externalFileExists(normalizedPath);
		if (!exists) {
			this.log(`External file not found: ${normalizedPath}`);
			// Return a fallback link instead of null so the embed isn't lost
			const fallbackHtml = `<a href="file://${normalizedPath}" class="cs-link cs-file-missing" style="color: #a0aec0; text-decoration: line-through;">${this.escapeHtml(embed.filename)} (file not found)</a>`;
			return { original: embed.raw, replacement: fallbackHtml };
		}

		// Get file stats for size check
		const stats = await this.parser.getExternalFileStats(normalizedPath);
		if (!stats) {
			this.log(`Could not get stats for external file: ${normalizedPath}`);
			return null;
		}

		// Check file size (if limit is enforced)
		if (this.settings.enforceMaxFileSize && !this.parser.isWithinSizeLimit(stats.size, this.settings.maxFileSize)) {
			this.log(`External file too large: ${embed.filename} (${stats.size} bytes)`);
			return null;
		}

		// Read file data
		const fileData = await this.parser.readExternalFile(normalizedPath);
		const contentHash = await this.parser.computeFileHash(fileData);

		// Check cache (use ext: prefix to avoid collisions with vault paths)
		const cacheKey = this.getCacheKey(courseId, `ext:${normalizedPath}`);
		const cached = this.cache[cacheKey];

		if (cached && cached.contentHash === contentHash) {
			// Cache hit - file hasn't changed
			this.log(`Cache hit for external file ${embed.filename}`);
			const html = this.generateCanvasHtml(
				cached.canvasFileId,
				cached.canvasUrl,
				mediaType,
				embed.altText || embed.filename,
				courseId
			);
			return { original: embed.raw, replacement: html };
		}

		// Upload the file
		progressCallback?.(`Uploading external file ${embed.filename}...`);
		this.log(`Uploading external file ${embed.filename} to Canvas`);

		const canvasFile = await this.uploadWithRetry(
			embed.filename,
			fileData,
			mediaType,
			courseId
		);

		// Update cache
		this.cache[cacheKey] = {
			canvasFileId: canvasFile.id,
			canvasUrl: canvasFile.url,
			contentHash,
			uploadedAt: Date.now(),
			vaultPath: `ext:${normalizedPath}`,
		};

		// Generate HTML replacement
		const html = this.generateCanvasHtml(
			canvasFile.id,
			canvasFile.url,
			mediaType,
			embed.altText || embed.filename,
			courseId
		);

		return { original: embed.raw, replacement: html };
	}

	/**
	 * Upload a file with retry logic for rate limiting
	 */
	private async uploadWithRetry(
		filename: string,
		fileData: ArrayBuffer,
		mediaType: MediaType,
		courseId: number,
		maxRetries = 3
	): Promise<CanvasFile> {
		const folder = await this.getUploadFolder(courseId, mediaType);
		const mimeType = this.parser.getMimeType(filename);

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				return await this.api.uploadFile(
					courseId,
					filename,
					fileData,
					mimeType,
					folder.id
				);
			} catch (error) {
				const errorStr = String(error);

				// Check for rate limiting (429)
				if (errorStr.includes('429') && attempt < maxRetries) {
					const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
					this.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
					await this.sleep(delay);
					continue;
				}

				throw error;
			}
		}

		throw new Error(`Failed to upload ${filename} after ${maxRetries} attempts`);
	}

	/**
	 * Generate Canvas HTML for an uploaded media file
	 */
	private generateCanvasHtml(
		fileId: number,
		fileUrl: string,
		mediaType: MediaType,
		altText: string,
		courseId: number
	): string {
		// Canvas file URLs for embedding
		const previewUrl = `/courses/${courseId}/files/${fileId}/preview`;
		const downloadUrl = `/courses/${courseId}/files/${fileId}/download`;

		switch (mediaType) {
			case 'image':
				return this.generateImageHtml(previewUrl, altText);
			case 'audio':
				return this.generateAudioHtml(previewUrl, downloadUrl, altText);
			case 'video':
				return this.generateVideoHtml(previewUrl, downloadUrl, altText);
			case 'pdf':
				return this.generatePdfHtml(previewUrl, downloadUrl, altText);
			default:
				// Generic file link
				return `<a href="${downloadUrl}" class="cs-link">${altText}</a>`;
		}
	}

	/**
	 * Generate HTML for an image
	 */
	private generateImageHtml(previewUrl: string, altText: string): string {
		return `<p style="margin: 16px 0;"><img src="${previewUrl}" alt="${this.escapeHtml(altText)}" class="cs-media-image" style="max-width: 100%; height: auto; display: block;"></p>`;
	}

	/**
	 * Generate HTML for an audio file
	 */
	private generateAudioHtml(previewUrl: string, downloadUrl: string, altText: string): string {
		return `<div class="cs-audio-container" style="margin: 16px 0;">
<audio controls preload="metadata" style="width: 100%; max-width: 500px;">
<source src="${previewUrl}" type="audio/mpeg">
Your browser does not support the audio element.
</audio>
</div>`;
	}

	/**
	 * Generate HTML for a video file
	 */
	private generateVideoHtml(previewUrl: string, downloadUrl: string, altText: string): string {
		return `<div class="cs-video-container" style="margin: 16px 0;">
<video controls preload="metadata" style="width: 100%; max-width: 800px;">
<source src="${previewUrl}">
Your browser does not support the video element.
</video>
</div>`;
	}

	/**
	 * Generate HTML for a PDF file
	 */
	private generatePdfHtml(previewUrl: string, downloadUrl: string, altText: string): string {
		return `<div class="cs-pdf-container" style="margin: 16px 0;">
<iframe src="${previewUrl}" style="width: 100%; height: 600px; border: 1px solid #e2e8f0; border-radius: 4px;" title="${this.escapeHtml(altText)}"></iframe>
<div style="margin-top: 8px;">
<a href="${downloadUrl}" class="cs-link" style="font-size: 0.9em;">Download PDF: ${this.escapeHtml(altText)}</a>
</div>
</div>`;
	}

	/**
	 * Escape HTML special characters
	 */
	private escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/**
	 * Sleep for a specified duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Clear cache for a specific course
	 */
	clearCacheForCourse(courseId: number): void {
		const prefix = `${courseId}:`;
		for (const key of Object.keys(this.cache)) {
			if (key.startsWith(prefix)) {
				delete this.cache[key];
			}
		}
		this.log(`Cleared cache for course ${courseId}`);
	}

	/**
	 * Clear all cache
	 */
	clearAllCache(): void {
		this.cache = {};
		this.folderCache.clear();
		this.log('Cleared all cache');
	}
}
