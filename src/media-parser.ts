import type { App, TFile } from 'obsidian';
import type { MediaEmbed, MediaType } from './types';

/**
 * Extension mappings for media types
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const PDF_EXTENSIONS = new Set(['pdf']);

/**
 * MIME type mappings for common media files
 */
const MIME_TYPES: Record<string, string> = {
	// Images
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	// Audio
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	m4a: 'audio/mp4',
	flac: 'audio/flac',
	aac: 'audio/aac',
	// Video
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	avi: 'video/x-msvideo',
	mkv: 'video/x-matroska',
	// Documents
	pdf: 'application/pdf',
};

/**
 * Media parser - detects and extracts media embeds from markdown content
 */
export class MediaParser {
	private app: App;
	private debugMode: boolean;
	private allowedExternalPaths: string[] = [];

	constructor(app: App, debugMode = false) {
		this.app = app;
		this.debugMode = debugMode;
	}

	/**
	 * Set debug mode
	 */
	setDebugMode(debug: boolean): void {
		this.debugMode = debug;
	}

	/**
	 * Set allowed external paths for file access validation
	 */
	setAllowedExternalPaths(paths: string[]): void {
		this.allowedExternalPaths = paths;
	}

	/**
	 * Get the vault base path
	 */
	private getVaultBasePath(): string {
		return (this.app.vault.adapter as unknown as { basePath: string }).basePath || '';
	}

	/**
	 * Validate that an external path is safe to access
	 * Prevents path traversal attacks and restricts access to allowed paths
	 */
	private validateExternalPath(absolutePath: string): void {
		const path = require('path');

		// Prevent path traversal with relative components - check BEFORE normalization
		if (absolutePath.includes('..')) {
			throw new Error(`Invalid path contains traversal: ${absolutePath}`);
		}

		const normalizedPath = path.normalize(absolutePath);

		// Check if path is under the vault
		const vaultBase = this.getVaultBasePath();
		if (vaultBase && normalizedPath.startsWith(path.normalize(vaultBase))) {
			// Path is under vault - allowed
			return;
		}

		// Check if path is under any allowed external paths
		const isAllowed = this.allowedExternalPaths.some(allowed => {
			const normalizedAllowed = path.normalize(allowed);
			// Ensure we match complete path segments, not partial prefixes
			return normalizedPath.startsWith(normalizedAllowed + path.sep) ||
				normalizedPath === normalizedAllowed;
		});

		if (!isAllowed) {
			throw new Error(`Access denied: ${absolutePath} is outside allowed paths`);
		}
	}

	/**
	 * Log debug messages
	 */
	private log(...args: unknown[]): void {
		if (this.debugMode) {
			console.log('[Media Parser]', ...args);
		}
	}

	/**
	 * Extract all media embeds from markdown content
	 * Detects both Obsidian wiki-link embeds (![[file.ext]]) and standard markdown (![alt](path))
	 */
	extractMediaEmbeds(content: string): MediaEmbed[] {
		const embeds: MediaEmbed[] = [];

		// Pattern 1: Obsidian wiki-link embeds - ![[filename.ext]] or ![[filename.ext|alttext]]
		const wikiEmbedPattern = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
		let match;

		while ((match = wikiEmbedPattern.exec(content)) !== null) {
			const filename = match[1].trim();
			const altText = match[2]?.trim();
			const extension = this.getExtension(filename);
			const mediaType = this.getMediaType(filename);

			// Include all file types (filtering happens in uploader based on settings)
			// Skip files with no extension (likely wiki-links to notes)
			if (extension) {
				embeds.push({
					raw: match[0],
					filename,
					altText,
					mediaType,
				});
				this.log(`Found wiki embed: ${filename} (${mediaType})`);
			}
		}

		// Pattern 2: External file embeds - ![ext:///path/to/file] or ![ext:///path/to/file|width]
		const externalEmbedPattern = /!\[ext:\/\/([^\]|]+)(?:\|(\d+))?\]/g;

		while ((match = externalEmbedPattern.exec(content)) !== null) {
			const externalPath = match[1].trim();
			const filename = externalPath.split('/').pop() || externalPath;
			const extension = this.getExtension(filename);
			const mediaType = this.getMediaType(filename);

			if (extension) {
				embeds.push({
					raw: match[0],
					filename,
					externalPath,
					isExternal: true,
					mediaType,
				});
				this.log(`Found external embed: ${externalPath} (${mediaType})`);
			}
		}

		// Pattern 3: Standard markdown image syntax - ![alt](path)
		// But skip YouTube URLs which are handled by the YouTube embed converter
		const markdownEmbedPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;

		while ((match = markdownEmbedPattern.exec(content)) !== null) {
			const altText = match[1].trim();
			const path = match[2].trim();

			// Skip URLs (these are external resources or YouTube embeds)
			if (path.startsWith('http://') || path.startsWith('https://')) {
				continue;
			}

			const filename = path.split('/').pop() || path;
			const mediaType = this.getMediaType(filename);
			const extension = this.getExtension(filename);

			// Include all file types (filtering happens in uploader based on settings)
			// Skip files with no extension
			if (extension) {
				embeds.push({
					raw: match[0],
					filename,
					altText: altText || undefined,
					vaultPath: path, // For markdown syntax, the path is already provided
					mediaType,
				});
				this.log(`Found markdown embed: ${filename} (${mediaType})`);
			}
		}

		// Pattern 4: Standard markdown links to local files - [text](path)
		// These are NOT embeds (no ! prefix) but should still trigger upload
		// The uploaded file will render as a download link instead of an embedded player
		// Note: We match all [text](path) patterns and check for preceding ! manually
		// to ensure compatibility with all Electron versions
		const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

		while ((match = markdownLinkPattern.exec(content)) !== null) {
			// Skip if preceded by ! (already handled as embed by Pattern 3)
			const matchStart = match.index;
			if (matchStart > 0 && content[matchStart - 1] === '!') {
				continue;
			}

			const displayText = match[1].trim();
			const path = match[2].trim();

			// Skip URLs, protocols, anchors, emails
			if (
				path.startsWith('http://') ||
				path.startsWith('https://') ||
				path.startsWith('#') ||
				path.startsWith('mailto:') ||
				path.startsWith('tel:') ||
				path.includes('://')
			) {
				continue;
			}

			const filename = path.split('/').pop() || path;
			const extension = this.getExtension(filename);
			const mediaType = this.getMediaType(filename);

			// Include all file types with extensions (filtering happens in uploader)
			if (extension) {
				embeds.push({
					raw: match[0],
					filename,
					altText: displayText,
					vaultPath: path,
					mediaType,
					isLink: true, // Flag to generate link HTML instead of embed
				});
				this.log(`Found markdown link: ${filename} (${mediaType})`);
			}
		}

		// Pattern 5: Wiki-links to files (without ! prefix) - [[filename.ext]] or [[filename.ext|display]]
		// These are links (not embeds) and should render as download links
		const wikiLinkPattern = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

		while ((match = wikiLinkPattern.exec(content)) !== null) {
			// Skip if preceded by ! (already handled as embed by Pattern 1)
			const matchStart = match.index;
			if (matchStart > 0 && content[matchStart - 1] === '!') {
				continue;
			}

			const filename = match[1].trim();
			const altText = match[2]?.trim();
			const extension = this.getExtension(filename);
			const mediaType = this.getMediaType(filename);

			// Only include files with extensions (skip wiki-links to notes)
			if (extension) {
				embeds.push({
					raw: match[0],
					filename,
					altText: altText || filename,
					mediaType,
					isLink: true, // Flag to generate link HTML instead of embed
				});
				this.log(`Found wiki link: ${filename} (${mediaType})`);
			}
		}

		return embeds;
	}

	/**
	 * Resolve a media file's path within the vault
	 * Uses Obsidian's link resolution to find the file
	 */
	resolveMediaFile(embed: MediaEmbed, sourcePath: string): TFile | null {
		// If vaultPath is already set (from markdown syntax), try direct resolution first
		if (embed.vaultPath) {
			const file = this.app.vault.getAbstractFileByPath(embed.vaultPath);
			if (file instanceof this.app.vault.adapter.constructor) {
				return null;
			}
			if (file && 'extension' in file) {
				return file as TFile;
			}
			// Try relative to source file
			const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
			const relativePath = `${sourceDir}/${embed.vaultPath}`;
			const relativeFile = this.app.vault.getAbstractFileByPath(relativePath);
			if (relativeFile && 'extension' in relativeFile) {
				return relativeFile as TFile;
			}
			// Fall through to search by filename (Obsidian resolves links flexibly)
		}

		// Use Obsidian's metadataCache for link resolution (handles spaces, case, etc.)
		const cache = this.app.metadataCache;
		const linkPath = embed.vaultPath || embed.filename;
		const linkedFile = cache.getFirstLinkpathDest(linkPath, sourcePath);
		if (linkedFile) {
			this.log(`Resolved via cache: ${linkPath} to ${linkedFile.path}`);
			return linkedFile;
		}

		// Fallback: search all files by filename
		const files = this.app.vault.getFiles();

		// Try exact match first
		for (const file of files) {
			if (file.name === embed.filename) {
				this.log(`Resolved ${embed.filename} to ${file.path}`);
				return file;
			}
		}

		// Try case-insensitive match
		const lowerFilename = embed.filename.toLowerCase();
		for (const file of files) {
			if (file.name.toLowerCase() === lowerFilename) {
				this.log(`Resolved (case-insensitive) ${embed.filename} to ${file.path}`);
				return file;
			}
		}

		// Try normalizing underscores/spaces (common mismatch)
		const normalizedTarget = embed.filename.toLowerCase().replace(/[_\s]+/g, ' ');
		for (const file of files) {
			const normalizedFile = file.name.toLowerCase().replace(/[_\s]+/g, ' ');
			if (normalizedFile === normalizedTarget) {
				this.log(`Resolved (normalized) ${embed.filename} to ${file.path}`);
				return file;
			}
		}

		this.log(`Could not resolve: ${embed.filename}`);
		return null;
	}

	/**
	 * Determine the media type from a filename
	 */
	getMediaType(filename: string): MediaType {
		const ext = this.getExtension(filename);

		if (IMAGE_EXTENSIONS.has(ext)) return 'image';
		if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
		if (VIDEO_EXTENSIONS.has(ext)) return 'video';
		if (PDF_EXTENSIONS.has(ext)) return 'pdf';

		return 'other';
	}

	/**
	 * Get MIME type for a filename
	 */
	getMimeType(filename: string): string {
		const ext = this.getExtension(filename);
		return MIME_TYPES[ext] || 'application/octet-stream';
	}

	/**
	 * Get file extension (lowercase, without dot)
	 */
	getExtension(filename: string): string {
		const lastDot = filename.lastIndexOf('.');
		if (lastDot === -1) return '';
		return filename.substring(lastDot + 1).toLowerCase();
	}

	/**
	 * Compute SHA-256 hash of file data for cache validation
	 */
	async computeFileHash(data: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Read a media file's binary data
	 */
	async readMediaFile(file: TFile): Promise<ArrayBuffer> {
		return await this.app.vault.readBinary(file);
	}

	/**
	 * Read an external file's binary data from the filesystem
	 * Validates path is within allowed directories before reading
	 */
	async readExternalFile(absolutePath: string): Promise<ArrayBuffer> {
		this.validateExternalPath(absolutePath);
		const fs = require('fs').promises;
		const buffer = await fs.readFile(absolutePath);
		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	}

	/**
	 * Check if an external file exists at the given absolute path
	 * Validates path is within allowed directories before checking
	 */
	async externalFileExists(absolutePath: string): Promise<boolean> {
		try {
			this.validateExternalPath(absolutePath);
		} catch {
			return false;
		}
		const fs = require('fs').promises;
		try {
			await fs.access(absolutePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get file stats for an external file
	 * Validates path is within allowed directories before checking
	 */
	async getExternalFileStats(absolutePath: string): Promise<{ size: number } | null> {
		try {
			this.validateExternalPath(absolutePath);
		} catch {
			return null;
		}
		const fs = require('fs').promises;
		try {
			const stats = await fs.stat(absolutePath);
			return { size: stats.size };
		} catch {
			return null;
		}
	}

	/**
	 * Check if a file is a supported media type
	 */
	isSupportedMediaFile(filename: string): boolean {
		return this.getMediaType(filename) !== 'other';
	}

	/**
	 * Check if file size is within limits
	 */
	isWithinSizeLimit(size: number, maxSize: number): boolean {
		return size <= maxSize;
	}
}
