import type { App, TFile } from 'obsidian';
import type { DropboxApi } from './dropbox-api';
import type { MediaParser } from './media-parser';
import type { MediaReplacement } from './media-uploader';
import type {
	MediaEmbed,
	MediaType,
	MediaSettings,
	DropboxCacheEntry,
	DropboxUploadCache,
} from './types';

/**
 * Dropbox uploader - orchestrates media file uploads to Dropbox
 * Generates embed HTML using Dropbox direct URLs
 */
export class DropboxUploader {
	private app: App;
	private api: DropboxApi;
	private parser: MediaParser;
	private settings: MediaSettings;
	private cache: DropboxUploadCache;
	private debugMode: boolean;

	// Track created folders to avoid repeated API calls
	private createdFolders: Set<string> = new Set();

	constructor(
		app: App,
		api: DropboxApi,
		parser: MediaParser,
		settings: MediaSettings,
		cache: DropboxUploadCache = {},
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
	getCache(): DropboxUploadCache {
		return this.cache;
	}

	/**
	 * Set the cache (for loading persisted cache)
	 */
	setCache(cache: DropboxUploadCache): void {
		this.cache = cache;
	}

	/**
	 * Log debug messages
	 */
	private log(...args: unknown[]): void {
		if (this.debugMode) {
			console.log('[Dropbox Uploader]', ...args);
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
			default:
				return false;
		}
	}

	/**
	 * Get cache key for a file in a Dropbox folder
	 */
	private getCacheKey(dropboxFolderPath: string, vaultPath: string): string {
		return `${dropboxFolderPath}:${vaultPath}`;
	}

	/**
	 * Get subfolder name for a media type
	 */
	private getSubfolderForType(mediaType: MediaType): string {
		switch (mediaType) {
			case 'image':
				return 'images';
			case 'audio':
				return 'audio';
			case 'video':
				return 'video';
			case 'pdf':
				return 'pdf';
			default:
				return 'other';
		}
	}

	/**
	 * Ensure a folder exists in Dropbox
	 */
	private async ensureFolder(folderPath: string): Promise<void> {
		if (this.createdFolders.has(folderPath)) {
			this.log(`Folder already in cache: ${folderPath}`);
			return;
		}

		this.log(`Ensuring folder exists: ${folderPath}`);

		try {
			await this.api.createFolder(folderPath);
			this.createdFolders.add(folderPath);
			this.log(`Folder created/verified: ${folderPath}`);
		} catch (error) {
			// Folder might already exist, that's fine
			const errorStr = String(error);
			this.log(`ensureFolder error: ${errorStr}`);

			// Check for conflict indicators (409 status or 'conflict' in message)
			if (errorStr.includes('conflict') || errorStr.includes('409')) {
				this.log(`Folder conflict (already exists): ${folderPath}`);
				this.createdFolders.add(folderPath);
				return;
			}
			throw error;
		}
	}

	/**
	 * Process all media embeds in markdown content
	 * Uploads files to Dropbox and returns HTML replacements
	 */
	async processMediaEmbeds(
		content: string,
		sourcePath: string,
		baseFolderPath: string,
		progressCallback?: (message: string) => void
	): Promise<MediaReplacement[]> {
		this.log('processMediaEmbeds called', {
			sourcePath,
			baseFolderPath,
			settingsEnabled: this.settings.enabled,
			uploadAudio: this.settings.uploadAudio,
			uploadImages: this.settings.uploadImages,
			isAuthenticated: this.api.isAuthenticated(),
		});

		if (!this.settings.enabled) {
			this.log('Media uploads disabled');
			return [];
		}

		if (!this.api.isAuthenticated()) {
			this.log('Dropbox not authenticated');
			return [];
		}

		const replacements: MediaReplacement[] = [];
		const embeds = this.parser.extractMediaEmbeds(content);

		this.log(`extractMediaEmbeds found ${embeds.length} embeds:`, embeds.map(e => e.filename));

		if (embeds.length === 0) {
			this.log('No media embeds found');
			return [];
		}

		this.log(`Found ${embeds.length} media embeds`);

		// Ensure base folder exists
		try {
			this.log(`About to ensure base folder: ${baseFolderPath}`);
			await this.ensureFolder(baseFolderPath);
			this.log(`Base folder ensured successfully: ${baseFolderPath}`);
		} catch (folderError) {
			const errorMsg = folderError instanceof Error ? folderError.message : String(folderError);
			this.log(`Failed to ensure base folder: ${errorMsg}`);
			console.error('[Dropbox Uploader] Base folder creation failed:', folderError);
			throw folderError;
		}

		for (const embed of embeds) {
			try {
				const replacement = await this.processEmbed(
					embed,
					sourcePath,
					baseFolderPath,
					progressCallback
				);

				if (replacement) {
					replacements.push(replacement);
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				this.log(`Error processing embed ${embed.filename}: ${errorMsg}`);
				console.error(`[Dropbox Uploader] Embed error for ${embed.filename}:`, error);
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
		baseFolderPath: string,
		progressCallback?: (message: string) => void
	): Promise<MediaReplacement | null> {
		this.log(`Processing embed: ${embed.filename}`);
		const mediaType = embed.mediaType || this.parser.getMediaType(embed.filename);
		this.log(`Media type for ${embed.filename}: ${mediaType}`);

		// Check if this media type should be uploaded
		if (!this.shouldUploadType(mediaType)) {
			this.log(`Skipping ${embed.filename} - type ${mediaType} not enabled (uploadAudio=${this.settings.uploadAudio})`);
			return null;
		}

		// Resolve the file in the vault
		const file = this.parser.resolveMediaFile(embed, sourcePath);
		if (!file) {
			this.log(`Could not resolve file: ${embed.filename} (sourcePath: ${sourcePath})`);
			return null;
		}
		this.log(`Resolved file: ${embed.filename} -> ${file.path}`);

		// Check file size (if limit is enforced)
		if (this.settings.enforceMaxFileSize && !this.parser.isWithinSizeLimit(file.stat.size, this.settings.maxFileSize)) {
			this.log(`File too large: ${embed.filename} (${file.stat.size} bytes)`);
			return null;
		}

		// Read file data
		const fileData = await this.parser.readMediaFile(file);
		const contentHash = await this.parser.computeFileHash(fileData);

		// Check cache
		const cacheKey = this.getCacheKey(baseFolderPath, file.path);
		const cached = this.cache[cacheKey];

		if (cached && cached.contentHash === contentHash) {
			// Cache hit - file hasn't changed, verify link still works
			this.log(`Cache hit for ${embed.filename}`);
			const html = this.generateEmbedHtml(
				cached.directUrl,
				cached.sharedUrl,
				file.name,
				mediaType,
				embed.altText
			);
			return { original: embed.raw, replacement: html };
		}

		// Upload the file
		progressCallback?.(`Uploading ${embed.filename} to Dropbox...`);
		this.log(`Uploading ${embed.filename} to Dropbox`);

		// Determine target path
		const subfolder = this.getSubfolderForType(mediaType);
		const targetPath = `${baseFolderPath}/${subfolder}/${file.name}`;

		// Ensure subfolder exists
		await this.ensureFolder(`${baseFolderPath}/${subfolder}`);

		// Upload file
		const metadata = await this.api.uploadFile(targetPath, fileData, 'overwrite');

		// Create shared link
		const sharedUrl = await this.api.createSharedLink(metadata.path_display);

		// Transform URLs
		const { DropboxApi } = await import('./dropbox-api');
		const directUrl = DropboxApi.transformToDirectUrl(sharedUrl);
		const downloadUrl = DropboxApi.transformToDownloadUrl(sharedUrl);

		// Update cache
		this.cache[cacheKey] = {
			dropboxFileId: metadata.id,
			sharedUrl,
			directUrl,
			contentHash,
			uploadedAt: Date.now(),
			vaultPath: file.path,
		};

		// Generate HTML replacement
		const html = this.generateEmbedHtml(
			directUrl,
			downloadUrl,
			file.name,
			mediaType,
			embed.altText
		);

		return { original: embed.raw, replacement: html };
	}

	/**
	 * Generate embed HTML for Dropbox-hosted media
	 */
	private generateEmbedHtml(
		directUrl: string,
		downloadUrl: string,
		filename: string,
		mediaType: MediaType,
		altText?: string
	): string {
		const displayName = altText || filename;
		const mimeType = this.parser.getMimeType(filename);

		switch (mediaType) {
			case 'image':
				return this.generateImageHtml(directUrl, displayName);
			case 'audio':
				return this.generateAudioHtml(directUrl, downloadUrl, displayName, mimeType);
			case 'video':
				return this.generateVideoHtml(directUrl, downloadUrl, displayName, mimeType);
			case 'pdf':
				return this.generatePdfHtml(directUrl, downloadUrl, displayName);
			default:
				// Generic file link
				return `<a href="${downloadUrl}" class="cs-link">${this.escapeHtml(displayName)}</a>`;
		}
	}

	/**
	 * Generate HTML for an image
	 */
	private generateImageHtml(directUrl: string, altText: string): string {
		return `<img src="${directUrl}" alt="${this.escapeHtml(altText)}" class="cs-media-image" style="max-width: 100%; height: auto;">`;
	}

	/**
	 * Generate HTML for an audio file
	 */
	private generateAudioHtml(
		directUrl: string,
		downloadUrl: string,
		altText: string,
		mimeType: string
	): string {
		return `<div class="cs-audio-container" style="margin: 16px 0;">
<audio style="width: 100%; max-width: 500px;" controls preload="metadata">
<source src="${directUrl}" type="${mimeType}" />
Your browser does not support the audio element.
</audio>
<div style="margin-top: 8px;">
<a href="${downloadUrl}" class="cs-link" style="font-size: 0.9em;">Download: ${this.escapeHtml(altText)}</a>
</div>
</div>`;
	}

	/**
	 * Generate HTML for a video file
	 */
	private generateVideoHtml(
		directUrl: string,
		downloadUrl: string,
		altText: string,
		mimeType: string
	): string {
		return `<div class="cs-video-container" style="margin: 16px 0;">
<video style="width: 100%; max-width: 800px;" controls preload="metadata">
<source src="${directUrl}" type="${mimeType}" />
Your browser does not support the video element.
</video>
<div style="margin-top: 8px;">
<a href="${downloadUrl}" class="cs-link" style="font-size: 0.9em;">Download: ${this.escapeHtml(altText)}</a>
</div>
</div>`;
	}

	/**
	 * Generate HTML for a PDF file
	 */
	private generatePdfHtml(directUrl: string, downloadUrl: string, altText: string): string {
		return `<div class="cs-pdf-container" style="margin: 16px 0;">
<iframe src="${directUrl}" style="width: 100%; height: 600px; border: 1px solid #e2e8f0; border-radius: 4px;" title="${this.escapeHtml(altText)}"></iframe>
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
	 * Clear cache for a specific folder path
	 */
	clearCacheForFolder(folderPath: string): void {
		const prefix = `${folderPath}:`;
		for (const key of Object.keys(this.cache)) {
			if (key.startsWith(prefix)) {
				delete this.cache[key];
			}
		}
		this.log(`Cleared cache for folder ${folderPath}`);
	}

	/**
	 * Clear all cache
	 */
	clearAllCache(): void {
		this.cache = {};
		this.createdFolders.clear();
		this.log('Cleared all cache');
	}
}
