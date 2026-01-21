import { Marked } from 'marked';

/**
 * Options for converting markdown to HTML
 */
export interface ConvertOptions {
	courseId: number;
	pageSlugMap: Map<string, string>;
	discussionTitleMap: Map<string, number>;
}

/**
 * Convert Obsidian markdown to Canvas-ready HTML
 */
export class MarkdownConverter {
	private marked: Marked;

	constructor() {
		this.marked = new Marked({
			gfm: true,
			breaks: true,
		});
	}

	/**
	 * Convert markdown content to HTML with Canvas styling
	 */
	convert(markdown: string, options: ConvertOptions): string {
		// Strip frontmatter
		let content = this.stripFrontmatter(markdown);

		// Convert Obsidian callouts to styled divs
		content = this.convertCallouts(content);

		// Convert YouTube embeds before markdown processing
		content = this.convertYouTubeEmbeds(content);

		// Convert wiki-links to Canvas links
		content = this.convertWikiLinks(content, options);

		// Convert to HTML
		let html = this.marked.parse(content) as string;

		// Apply inline styles for Canvas
		html = this.applyCanvasStyles(html);

		// Wrap in container
		return this.wrapInContainer(html);
	}

	/**
	 * Strip YAML frontmatter from markdown
	 */
	private stripFrontmatter(content: string): string {
		if (content.startsWith('---')) {
			const end = content.indexOf('---', 3);
			if (end !== -1) {
				return content.slice(end + 3).trim();
			}
		}
		return content;
	}

	/**
	 * Convert YouTube embed syntax to iframes
	 * Handles: ![alt](youtube-url) and ![alt](youtu.be-url)
	 */
	private convertYouTubeEmbeds(content: string): string {
		// Match markdown image syntax with YouTube URLs
		// ![optional alt text](https://youtube.com/watch?v=VIDEO_ID)
		// ![optional alt text](https://www.youtube.com/watch?v=VIDEO_ID)
		// ![optional alt text](https://youtu.be/VIDEO_ID)
		const youtubePattern = /!\[([^\]]*)\]\((https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)[^\)]*)\)/g;

		return content.replace(youtubePattern, (match, altText, fullUrl, videoId) => {
			console.log(`[Converter] Converting YouTube embed: ${videoId}`);

			const title = altText || 'YouTube video';

			return `<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin: 20px 0;">
<iframe
	src="https://www.youtube.com/embed/${videoId}"
	title="${title}"
	style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; border-radius: 8px;"
	allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
	allowfullscreen>
</iframe>
</div>`;
		});
	}

	/**
	 * Convert Obsidian callout syntax to styled HTML divs
	 */
	private convertCallouts(content: string): string {
		const calloutPattern =
			/> \[!(note|tip|warning|important|info|example|quote)\]([^\n]*)\n((?:>[^\n]*\n?)*)/gi;

		return content.replace(calloutPattern, (match, type, title, body) => {
			const calloutType = type.toLowerCase();
			const calloutTitle = title.trim() || this.capitalizeFirst(calloutType);
			let calloutBody = body
				.split('\n')
				.map((line: string) => line.replace(/^>\s?/, ''))
				.join('\n')
				.trim();

			const colors = this.getCalloutColors(calloutType);

			return `<div style="background: ${colors.bg}; border-left: 4px solid ${colors.border}; padding: 16px 20px; margin: 20px 0; border-radius: 4px;">
<p style="margin: 0 0 8px 0; font-weight: 600; color: ${colors.text};">${calloutTitle}</p>
<div style="margin: 0; color: #333;">${calloutBody}</div>
</div>

`;
		});
	}

	/**
	 * Get colors for a callout type
	 */
	private getCalloutColors(type: string): { bg: string; border: string; text: string } {
		const colorMap: Record<string, { bg: string; border: string; text: string }> = {
			note: { bg: '#e3f2fd', border: '#1976d2', text: '#1565c0' },
			tip: { bg: '#e8f5e9', border: '#388e3c', text: '#2e7d32' },
			warning: { bg: '#fff3e0', border: '#f57c00', text: '#e65100' },
			important: { bg: '#fce4ec', border: '#c2185b', text: '#ad1457' },
			info: { bg: '#e0f7fa', border: '#0097a7', text: '#00838f' },
			example: { bg: '#f3e5f5', border: '#7b1fa2', text: '#6a1b9a' },
			quote: { bg: '#eceff1', border: '#546e7a', text: '#455a64' },
		};
		return colorMap[type] || colorMap['note'];
	}

	/**
	 * Convert wiki-links to Canvas internal links
	 */
	private convertWikiLinks(content: string, options: ConvertOptions): string {
		// Match wiki-links: [[target]] or [[target|display]] or [[target\|display]] (escaped pipe in tables)
		const wikiLinkPattern = /\[\[([^\]|]+)(?:\\?\|([^\]]+))?\]\]/g;

		return content.replace(wikiLinkPattern, (match, target, display) => {
			// Strip trailing backslash from target (used for escaped pipes in markdown tables)
			const cleanTarget = target.replace(/\\$/, '');
			// Extract just the filename (ignore path)
			const filename = cleanTarget.split('/').pop() || cleanTarget;
			const displayText = display || filename.replace(/-/g, ' ');

			console.log(`[Converter] Processing wiki-link: target="${target}" -> cleanTarget="${cleanTarget}", filename="${filename}"`);
			console.log(`[Converter] pageSlugMap has "${filename}": ${options.pageSlugMap.has(filename)}`);
			console.log(`[Converter] discussionTitleMap has "${filename}": ${options.discussionTitleMap.has(filename)}`);

			// Check if it's a page we know about
			const slug = options.pageSlugMap.get(filename);
			if (slug) {
				console.log(`[Converter] Found page slug: "${slug}"`);
				return `<a href="/courses/${options.courseId}/pages/${slug}">${displayText}</a>`;
			}

			// Check if it's a discussion - create an actual link
			const discussionId = options.discussionTitleMap.get(filename);
			if (discussionId) {
				console.log(`[Converter] Found discussion ID: ${discussionId}`);
				return `<a href="/courses/${options.courseId}/discussion_topics/${discussionId}">${displayText}</a>`;
			}

			// Unknown link - return as styled text with visual indicator
			console.log(`[Converter] Unknown link, returning plain text`);
			return `<em>${displayText}</em>`;
		});
	}

	/**
	 * Apply Canvas-friendly inline styles to HTML elements
	 */
	private applyCanvasStyles(html: string): string {
		// Tables
		html = html.replace(
			/<table>/g,
			'<table style="border-collapse: collapse; width: 100%; margin: 24px 0; font-size: 15px;">'
		);
		html = html.replace(
			/<thead>/g,
			'<thead style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">'
		);
		html = html.replace(
			/<th>/g,
			'<th style="border: 1px solid #e2e8f0; padding: 12px 16px; text-align: left; color: white; font-weight: 600;">'
		);
		html = html.replace(/<td>/g, '<td style="border: 1px solid #e2e8f0; padding: 12px 16px;">');
		html = html.replace(
			/<tr>(\s*<td)/g,
			'<tr style="background-color: #fff;">$1'
		);

		// Headings
		html = html.replace(
			/<h1>([^<]+)<\/h1>/g,
			'<h1 style="color: #1a202c; font-size: 2em; font-weight: 700; margin: 32px 0 16px 0; padding-bottom: 12px; border-bottom: 3px solid #667eea;">$1</h1>'
		);
		html = html.replace(
			/<h2>([^<]+)<\/h2>/g,
			'<h2 style="color: #2d3748; font-size: 1.5em; font-weight: 600; margin: 28px 0 12px 0; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">$1</h2>'
		);
		html = html.replace(
			/<h3>([^<]+)<\/h3>/g,
			'<h3 style="color: #4a5568; font-size: 1.25em; font-weight: 600; margin: 24px 0 8px 0;">$1</h3>'
		);
		html = html.replace(
			/<h4>([^<]+)<\/h4>/g,
			'<h4 style="color: #718096; font-size: 1.1em; font-weight: 600; margin: 20px 0 8px 0;">$1</h4>'
		);

		// Code blocks
		html = html.replace(
			/<pre><code>/g,
			'<pre style="background: #1e1e1e; color: #d4d4d4; padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-family: \'SF Mono\', Consolas, monospace; font-size: 14px; line-height: 1.5; margin: 16px 0;"><code>'
		);
		html = html.replace(
			/<code>/g,
			'<code style="background: #f1f5f9; color: #e53e3e; padding: 2px 6px; border-radius: 4px; font-family: \'SF Mono\', Consolas, monospace; font-size: 0.9em;">'
		);

		// Blockquotes
		html = html.replace(
			/<blockquote>/g,
			'<blockquote style="border-left: 4px solid #667eea; margin: 20px 0; padding: 12px 20px; background: #f7fafc; color: #4a5568; font-style: italic;">'
		);

		// Lists
		html = html.replace(/<ul>/g, '<ul style="margin: 16px 0; padding-left: 24px;">');
		html = html.replace(/<ol>/g, '<ol style="margin: 16px 0; padding-left: 24px;">');
		html = html.replace(/<li>/g, '<li style="margin: 8px 0; line-height: 1.6;">');

		// Links
		html = html.replace(
			/<a href="([^"]+)">/g,
			'<a href="$1" style="color: #667eea; text-decoration: none; border-bottom: 1px solid #667eea;">'
		);

		// Horizontal rules
		html = html.replace(
			/<hr\s*\/?>/g,
			'<hr style="border: none; border-top: 2px solid #e2e8f0; margin: 32px 0;">'
		);

		// Strong/bold
		html = html.replace(
			/<strong>([^<]+)<\/strong>/g,
			'<strong style="font-weight: 600; color: #1a202c;">$1</strong>'
		);

		return html;
	}

	/**
	 * Wrap HTML in a container with base styles
	 */
	private wrapInContainer(html: string): string {
		return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.7; color: #2d3748; max-width: 900px;">
${html}
</div>`;
	}

	/**
	 * Capitalize first letter
	 */
	private capitalizeFirst(str: string): string {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
}
