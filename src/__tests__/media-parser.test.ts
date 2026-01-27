import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaParser } from '../media-parser';
import { App, TFile } from '../__mocks__/obsidian';

describe('MediaParser', () => {
	let parser: MediaParser;
	let mockApp: App;

	beforeEach(() => {
		mockApp = new App();
		parser = new MediaParser(mockApp as unknown as import('obsidian').App, false);
	});

	describe('Path Validation', () => {
		it('should allow paths under the vault', async () => {
			// Set vault base path
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';

			// Path under vault should not throw
			const validatePath = (parser as unknown as { validateExternalPath: (path: string) => void }).validateExternalPath.bind(parser);

			expect(() => validatePath('/Users/test/vault/file.png')).not.toThrow();
			expect(() => validatePath('/Users/test/vault/subdir/file.png')).not.toThrow();
		});

		it('should reject paths with traversal attempts', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';

			const validatePath = (parser as unknown as { validateExternalPath: (path: string) => void }).validateExternalPath.bind(parser);

			expect(() => validatePath('/Users/test/vault/../secret/file.txt')).toThrow('Invalid path contains traversal');
			expect(() => validatePath('/Users/../etc/passwd')).toThrow('Invalid path contains traversal');
		});

		it('should reject paths outside vault when no allowed paths configured', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';

			const validatePath = (parser as unknown as { validateExternalPath: (path: string) => void }).validateExternalPath.bind(parser);

			expect(() => validatePath('/Users/other/file.txt')).toThrow('Access denied');
			expect(() => validatePath('/etc/passwd')).toThrow('Access denied');
		});

		it('should allow paths in configured allowed external paths', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';
			parser.setAllowedExternalPaths(['/Users/test/Dropbox', '/Volumes/External']);

			const validatePath = (parser as unknown as { validateExternalPath: (path: string) => void }).validateExternalPath.bind(parser);

			expect(() => validatePath('/Users/test/Dropbox/file.png')).not.toThrow();
			expect(() => validatePath('/Volumes/External/media/audio.mp3')).not.toThrow();
		});

		it('should reject similar-prefix paths that are not actually under allowed paths', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';
			parser.setAllowedExternalPaths(['/Users/test/Dropbox']);

			const validatePath = (parser as unknown as { validateExternalPath: (path: string) => void }).validateExternalPath.bind(parser);

			// 'DropboxMalicious' should NOT match '/Users/test/Dropbox'
			expect(() => validatePath('/Users/test/DropboxMalicious/file.txt')).toThrow('Access denied');
		});
	});

	describe('External File Methods with Validation', () => {
		it('externalFileExists should return false for paths outside allowed directories', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';
			parser.setAllowedExternalPaths([]);

			const result = await parser.externalFileExists('/etc/passwd');
			expect(result).toBe(false);
		});

		it('getExternalFileStats should return null for paths outside allowed directories', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';
			parser.setAllowedExternalPaths([]);

			const result = await parser.getExternalFileStats('/etc/passwd');
			expect(result).toBeNull();
		});

		it('readExternalFile should throw for paths outside allowed directories', async () => {
			(mockApp.vault.adapter as unknown as { basePath: string }).basePath = '/Users/test/vault';
			parser.setAllowedExternalPaths([]);

			await expect(parser.readExternalFile('/etc/passwd')).rejects.toThrow('Access denied');
		});
	});

	describe('Media Type Detection', () => {
		it('should detect image files', () => {
			expect(parser.getMediaType('photo.png')).toBe('image');
			expect(parser.getMediaType('photo.jpg')).toBe('image');
			expect(parser.getMediaType('photo.jpeg')).toBe('image');
			expect(parser.getMediaType('photo.gif')).toBe('image');
			expect(parser.getMediaType('photo.webp')).toBe('image');
			expect(parser.getMediaType('photo.svg')).toBe('image');
			expect(parser.getMediaType('photo.bmp')).toBe('image');
		});

		it('should detect audio files', () => {
			expect(parser.getMediaType('song.mp3')).toBe('audio');
			expect(parser.getMediaType('song.wav')).toBe('audio');
			expect(parser.getMediaType('song.ogg')).toBe('audio');
			expect(parser.getMediaType('song.m4a')).toBe('audio');
			expect(parser.getMediaType('song.flac')).toBe('audio');
			expect(parser.getMediaType('song.aac')).toBe('audio');
		});

		it('should detect video files', () => {
			expect(parser.getMediaType('video.mp4')).toBe('video');
			expect(parser.getMediaType('video.webm')).toBe('video');
			expect(parser.getMediaType('video.mov')).toBe('video');
			expect(parser.getMediaType('video.avi')).toBe('video');
			expect(parser.getMediaType('video.mkv')).toBe('video');
		});

		it('should detect PDF files', () => {
			expect(parser.getMediaType('document.pdf')).toBe('pdf');
		});

		it('should return other for unknown types', () => {
			expect(parser.getMediaType('file.txt')).toBe('other');
			expect(parser.getMediaType('archive.zip')).toBe('other');
			expect(parser.getMediaType('document.docx')).toBe('other');
		});
	});

	describe('MIME Type Detection', () => {
		it('should return correct MIME types for images', () => {
			expect(parser.getMimeType('photo.png')).toBe('image/png');
			expect(parser.getMimeType('photo.jpg')).toBe('image/jpeg');
			expect(parser.getMimeType('photo.gif')).toBe('image/gif');
		});

		it('should return correct MIME types for audio', () => {
			expect(parser.getMimeType('song.mp3')).toBe('audio/mpeg');
			expect(parser.getMimeType('song.wav')).toBe('audio/wav');
		});

		it('should return correct MIME types for video', () => {
			expect(parser.getMimeType('video.mp4')).toBe('video/mp4');
			expect(parser.getMimeType('video.webm')).toBe('video/webm');
		});

		it('should return octet-stream for unknown types', () => {
			expect(parser.getMimeType('file.xyz')).toBe('application/octet-stream');
		});
	});

	describe('Extension Extraction', () => {
		it('should extract extensions correctly', () => {
			expect(parser.getExtension('file.txt')).toBe('txt');
			expect(parser.getExtension('file.PDF')).toBe('pdf');
			expect(parser.getExtension('file.name.ext')).toBe('ext');
		});

		it('should return empty string for files without extension', () => {
			expect(parser.getExtension('filename')).toBe('');
		});
	});

	describe('Media Embed Extraction', () => {
		it('should extract wiki-link embeds', () => {
			const content = '![[image.png]]';
			const embeds = parser.extractMediaEmbeds(content);
			expect(embeds).toHaveLength(1);
			expect(embeds[0].filename).toBe('image.png');
			expect(embeds[0].raw).toBe('![[image.png]]');
		});

		it('should extract wiki-link embeds with alt text', () => {
			const content = '![[image.png|My Photo]]';
			const embeds = parser.extractMediaEmbeds(content);
			expect(embeds).toHaveLength(1);
			expect(embeds[0].filename).toBe('image.png');
			expect(embeds[0].altText).toBe('My Photo');
		});

		it('should extract standard markdown embeds', () => {
			const content = '![Alt text](path/to/image.png)';
			const embeds = parser.extractMediaEmbeds(content);
			expect(embeds).toHaveLength(1);
			expect(embeds[0].filename).toBe('image.png');
			expect(embeds[0].altText).toBe('Alt text');
		});

		it('should skip external URLs', () => {
			const content = '![Alt](https://example.com/image.png)';
			const embeds = parser.extractMediaEmbeds(content);
			expect(embeds).toHaveLength(0);
		});

		it('should extract external file embeds', () => {
			const content = '![ext:///path/to/file.mp3]';
			const embeds = parser.extractMediaEmbeds(content);
			expect(embeds).toHaveLength(1);
			expect(embeds[0].isExternal).toBe(true);
			expect(embeds[0].externalPath).toBe('/path/to/file.mp3');
		});

		it('should extract multiple embeds', () => {
			const content = '![[a.png]] and ![[b.jpg]] and ![c](c.gif)';
			const embeds = parser.extractMediaEmbeds(content);
			expect(embeds).toHaveLength(3);
		});
	});

	describe('Size Validation', () => {
		it('should validate file size correctly', () => {
			const maxSize = 100 * 1024 * 1024; // 100MB
			expect(parser.isWithinSizeLimit(50 * 1024 * 1024, maxSize)).toBe(true);
			expect(parser.isWithinSizeLimit(100 * 1024 * 1024, maxSize)).toBe(true);
			expect(parser.isWithinSizeLimit(100 * 1024 * 1024 + 1, maxSize)).toBe(false);
		});
	});

	describe('Supported Media Check', () => {
		it('should identify supported media files', () => {
			expect(parser.isSupportedMediaFile('photo.png')).toBe(true);
			expect(parser.isSupportedMediaFile('song.mp3')).toBe(true);
			expect(parser.isSupportedMediaFile('video.mp4')).toBe(true);
			expect(parser.isSupportedMediaFile('doc.pdf')).toBe(true);
		});

		it('should return false for unsupported files', () => {
			expect(parser.isSupportedMediaFile('file.txt')).toBe(false);
			expect(parser.isSupportedMediaFile('archive.zip')).toBe(false);
		});
	});
});
