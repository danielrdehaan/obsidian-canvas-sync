import { Marked } from 'marked';
import type { StyleSettings, ContentTheme } from './types';
import type { MediaReplacement } from './media-uploader';

/**
 * Options for converting markdown to HTML
 */
export interface ConvertOptions {
	courseId: number;
	pageSlugMap: Map<string, string>;
	discussionTitleMap: Map<string, number>;
	/** Style settings for theming */
	style?: StyleSettings;
	/** Custom CSS content loaded from file */
	customCss?: string;
	/** Media embed replacements (from media uploader) */
	mediaReplacements?: MediaReplacement[];
}

/**
 * Color palette for a theme
 */
interface ThemeColors {
	text: string;
	textMuted: string;
	textLight: string;
	background: string;
	backgroundAlt: string;
	border: string;
	borderLight: string;
	codeBackground: string;
	codeText: string;
	inlineCodeBackground: string;
	inlineCodeText: string;
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

		// Apply media replacements before any other processing
		// This replaces ![[media.ext]] embeds with Canvas HTML
		if (options.mediaReplacements && options.mediaReplacements.length > 0) {
			content = this.applyMediaReplacements(content, options.mediaReplacements);
		}

		// Convert Obsidian callouts to styled divs
		content = this.convertCallouts(content, options.style?.accentColor);

		// Convert YouTube embeds before markdown processing
		content = this.convertYouTubeEmbeds(content);

		// Convert wiki-links to Canvas links
		content = this.convertWikiLinks(content, options);

		// Convert to HTML
		let html = this.marked.parse(content) as string;

		// Apply CSS classes for Canvas
		html = this.applyContentClasses(html);

		// Generate style block and wrap in container
		const styleBlock = this.generateStyleBlock(options.style);
		return this.wrapInContainer(html, styleBlock, options.customCss);
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
	 * Apply media replacements to content
	 * Replaces media embed syntax with Canvas HTML
	 */
	private applyMediaReplacements(content: string, replacements: MediaReplacement[]): string {
		for (const { original, replacement } of replacements) {
			// Escape special regex characters in the original string
			const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			content = content.replace(new RegExp(escapedOriginal, 'g'), replacement);
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

			return `<div class="cs-video-container">
<iframe
	src="https://www.youtube.com/embed/${videoId}"
	title="${title}"
	class="cs-video-iframe"
	allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
	allowfullscreen>
</iframe>
</div>`;
		});
	}

	/**
	 * Convert Obsidian callout syntax to styled HTML divs
	 */
	private convertCallouts(content: string, accentColor?: string): string {
		const calloutPattern =
			/> \[!(note|tip|warning|important|info|example|quote)\]([^\n]*)\n((?:>[^\n]*\n?)*)/gi;

		return content.replace(calloutPattern, (match, type, title, body) => {
			const calloutType = type.toLowerCase();
			const calloutTitle = title.trim() || this.capitalizeFirst(calloutType);
			const calloutIcon = this.getCalloutIcon(calloutType);
			let calloutBody = body
				.split('\n')
				.map((line: string) => line.replace(/^>\s?/, ''))
				.join('\n')
				.trim();

			// Convert Unicode bullet characters (•) to markdown list items
			// First, ensure each bullet is on its own line
			calloutBody = calloutBody.replace(/•\s*/g, '\n- ');
			// Clean up any double newlines and leading newline
			calloutBody = calloutBody.replace(/^\n/, '').replace(/\n{3,}/g, '\n\n');

			// Process the body through markdown parser to handle bold, italic, links, lists, etc.
			let processedBody = this.marked.parse(calloutBody) as string;
			// Apply content classes to the parsed HTML
			processedBody = this.applyContentClasses(processedBody);

			return `<div class="cs-callout cs-callout-${calloutType}">
<p class="cs-callout-title"><span class="cs-callout-icon">${calloutIcon}</span><b>${calloutTitle}</b></p>
<div class="cs-callout-body">${processedBody}</div>
</div>

`;
		});
	}

	/**
	 * Get icon for callout type
	 */
	private getCalloutIcon(type: string): string {
		const iconMap: Record<string, string> = {
			note: 'ℹ',
			tip: '💡',
			warning: '⚠',
			important: '🔥',
			info: 'ℹ',
			example: '📝',
			quote: '❝',
		};
		return iconMap[type] || iconMap['note'];
	}

	/**
	 * Get callout colors for CSS generation
	 */
	private getCalloutColors(type: string): { bg: string; bgDark: string; border: string; text: string; textDark: string } {
		const colorMap: Record<string, { bg: string; bgDark: string; border: string; text: string; textDark: string }> = {
			note: { bg: '#e3f2fd', bgDark: '#1e3a5f', border: '#1976d2', text: '#1565c0', textDark: '#64b5f6' },
			tip: { bg: '#e8f5e9', bgDark: '#1b4332', border: '#388e3c', text: '#2e7d32', textDark: '#81c784' },
			warning: { bg: '#fff3e0', bgDark: '#4a3728', border: '#f57c00', text: '#e65100', textDark: '#ffb74d' },
			important: { bg: '#fce4ec', bgDark: '#4a2c3f', border: '#c2185b', text: '#ad1457', textDark: '#f48fb1' },
			info: { bg: '#e0f7fa', bgDark: '#1a3a3f', border: '#0097a7', text: '#00838f', textDark: '#4dd0e1' },
			example: { bg: '#f3e5f5', bgDark: '#3d2a4a', border: '#7b1fa2', text: '#6a1b9a', textDark: '#ce93d8' },
			quote: { bg: '#eceff1', bgDark: '#2d3436', border: '#546e7a', text: '#455a64', textDark: '#90a4ae' },
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
				return `<a href="/courses/${options.courseId}/pages/${slug}" class="cs-link">${displayText}</a>`;
			}

			// Check if it's a discussion - create an actual link
			const discussionId = options.discussionTitleMap.get(filename);
			if (discussionId) {
				console.log(`[Converter] Found discussion ID: ${discussionId}`);
				return `<a href="/courses/${options.courseId}/discussion_topics/${discussionId}" class="cs-link">${displayText}</a>`;
			}

			// Unknown link - return as styled text with visual indicator
			console.log(`[Converter] Unknown link, returning plain text`);
			return `<em>${displayText}</em>`;
		});
	}

	/**
	 * Apply CSS classes to HTML elements (replacing inline styles)
	 */
	private applyContentClasses(html: string): string {
		// Tables
		html = html.replace(/<table>/g, '<div class="cs-table-wrap"><table class="cs-table">');
		html = html.replace(/<\/table>/g, '</table></div>');
		html = html.replace(/<thead>/g, '<thead class="cs-thead">');
		html = html.replace(/<th>/g, '<th class="cs-th">');
		html = html.replace(/<td>/g, '<td class="cs-td">');
		html = html.replace(/<tr>(\s*<td)/g, '<tr class="cs-tr">$1');

		// Headings
		html = html.replace(/<h1>([^<]+)<\/h1>/g, '<h1 class="cs-h1">$1</h1>');
		html = html.replace(/<h2>([^<]+)<\/h2>/g, '<h2 class="cs-h2">$1</h2>');
		html = html.replace(/<h3>([^<]+)<\/h3>/g, '<h3 class="cs-h3">$1</h3>');
		html = html.replace(/<h4>([^<]+)<\/h4>/g, '<h4 class="cs-h4">$1</h4>');

		// Code blocks
		html = html.replace(/<pre><code>/g, '<pre class="cs-pre"><code class="cs-code-block">');
		html = html.replace(/<code>/g, '<code class="cs-code">');

		// Blockquotes
		html = html.replace(/<blockquote>/g, '<blockquote class="cs-blockquote">');

		// Lists
		html = html.replace(/<ul>/g, '<ul class="cs-ul">');
		html = html.replace(/<ol>/g, '<ol class="cs-ol">');
		html = html.replace(/<li>/g, '<li class="cs-li">');

		// Links (that don't already have cs-link class)
		html = html.replace(/<a href="([^"]+)"(?!\s+class="cs-link")>/g, '<a href="$1" class="cs-link">');

		// Horizontal rules
		html = html.replace(/<hr\s*\/?>/g, '<hr class="cs-hr">');

		// Strong/bold
		html = html.replace(/<strong>([^<]+)<\/strong>/g, '<strong class="cs-strong">$1</strong>');

		return html;
	}

	/**
	 * Generate the CSS style block
	 */
	private generateStyleBlock(style?: StyleSettings): string {
		const accent = style?.accentColor || '#667eea';
		const accentDark = this.adjustColor(accent, 30); // Lighten for dark mode
		const accentSecondary = this.adjustColor(accent, -20); // Darken for gradient

		// Light theme colors
		const light: ThemeColors = {
			text: '#2d3748',
			textMuted: '#4a5568',
			textLight: '#718096',
			background: 'transparent',
			backgroundAlt: '#f7fafc',
			border: '#e2e8f0',
			borderLight: '#edf2f7',
			codeBackground: '#1e1e1e',
			codeText: '#d4d4d4',
			inlineCodeBackground: '#f1f5f9',
			inlineCodeText: '#e53e3e',
		};

		// Dark theme colors
		const dark: ThemeColors = {
			text: '#e2e8f0',
			textMuted: '#a0aec0',
			textLight: '#718096',
			background: 'transparent',
			backgroundAlt: '#1a202c',
			border: '#4a5568',
			borderLight: '#2d3748',
			codeBackground: '#0d1117',
			codeText: '#e6edf3',
			inlineCodeBackground: '#2d3748',
			inlineCodeText: '#fc8181',
		};

		// Generate callout CSS for all types
		const calloutTypes = ['note', 'tip', 'warning', 'important', 'info', 'example', 'quote'];
		const calloutLightCss = calloutTypes.map(type => {
			const colors = this.getCalloutColors(type);
			return `.cs-callout-${type} { background: ${colors.bg}; border-color: ${colors.border}; }
.cs-callout-${type} .cs-callout-title { color: ${colors.text}; }`;
		}).join('\n');

		const calloutDarkCss = calloutTypes.map(type => {
			const colors = this.getCalloutColors(type);
			return `.cs-callout-${type} { background: ${colors.bgDark}; }
.cs-callout-${type} .cs-callout-title { color: ${colors.textDark}; }`;
		}).join('\n');

		const theme = style?.theme || 'auto';
		const mobileCompatible = style?.mobileCompatible ?? false;

		// Mobile-compatible styles (transparent/inherit to work with Canvas dark mode)
		const tableCellBg = mobileCompatible ? 'transparent' : '#fff';
		const tableCellBgDark = mobileCompatible ? 'transparent' : dark.backgroundAlt;
		const blockquoteBg = mobileCompatible ? 'rgba(0, 0, 0, 0.03)' : light.backgroundAlt;
		const blockquoteBgDark = mobileCompatible ? 'rgba(255, 255, 255, 0.05)' : dark.backgroundAlt;

		// Mobile-compatible text colors (inherit lets Canvas control colors for dark mode)
		const textColor = mobileCompatible ? 'inherit' : light.text;
		const textColorDark = mobileCompatible ? 'inherit' : dark.text;
		const headingColor = mobileCompatible ? 'inherit' : '#1a202c';
		const headingColorDark = mobileCompatible ? 'inherit' : '#f7fafc';
		const mutedColor = mobileCompatible ? 'inherit' : light.textMuted;
		const mutedColorDark = mobileCompatible ? 'inherit' : dark.textMuted;
		const strongColor = mobileCompatible ? 'inherit' : '#1a202c';
		const strongColorDark = mobileCompatible ? 'inherit' : '#f7fafc';

		// Base styles (always included)
		const baseStyles = `
/* Canvas Sync Content Styles - Generated */
.cs-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.7;
  max-width: 900px;
}

/* Video embeds */
.cs-video-container {
  margin: 16px 0;
}
.cs-video-container video {
  width: 100%;
  max-width: 800px;
  display: block;
}
.cs-video-iframe {
  width: 100%;
  max-width: 800px;
  height: 450px;
  border: none;
  border-radius: 8px;
}

/* Headings */
.cs-h1 {
  font-size: clamp(1.5em, 4vw, 2em);
  font-weight: 700;
  margin: 32px 0 16px 0;
  padding-bottom: 12px;
  border-bottom: 3px solid ${accent};
}
.cs-h2 {
  font-size: clamp(1.25em, 3vw, 1.5em);
  font-weight: 600;
  margin: 28px 0 12px 0;
  padding-bottom: 8px;
}
.cs-h3 {
  font-size: clamp(1.1em, 2.5vw, 1.25em);
  font-weight: 600;
  margin: 24px 0 8px 0;
}
.cs-h4 {
  font-size: 1.1em;
  font-weight: 600;
  margin: 20px 0 8px 0;
}

/* Tables */
.cs-table-wrap {
  overflow-x: auto;
  margin: 24px 0;
  -webkit-overflow-scrolling: touch;
}
.cs-table {
  border-collapse: collapse;
  width: 100%;
  min-width: 400px;
  font-size: 15px;
}
.cs-thead {
  background: linear-gradient(135deg, ${accent} 0%, ${accentSecondary} 100%);
}
.cs-th {
  padding: 12px 16px;
  text-align: left;
  color: white;
  font-weight: 600;
}
.cs-td {
  padding: 12px 16px;
}
.cs-tr:nth-child(even) .cs-td {
  background-color: rgba(0, 0, 0, 0.02);
}

/* Code */
.cs-pre {
  background: ${light.codeBackground};
  color: ${light.codeText};
  padding: 16px 20px;
  border-radius: 8px;
  overflow-x: auto;
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: clamp(12px, 2vw, 14px);
  line-height: 1.5;
  margin: 16px 0;
}
.cs-code-block {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}
.cs-code {
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.9em;
}

/* Blockquotes */
.cs-blockquote {
  border-left: 4px solid ${accent};
  margin: 20px 0;
  padding: 12px 20px;
  font-style: italic;
}

/* Lists */
.cs-ul, .cs-ol {
  margin: 16px 0;
  padding-left: 24px;
}
.cs-li {
  margin: 8px 0;
  line-height: 1.6;
}

/* Links */
.cs-link {
  text-decoration: none;
  border-bottom: 1px solid;
}
.cs-link:hover {
  border-bottom-width: 2px;
}

/* Horizontal rules */
.cs-hr {
  border: none;
  border-top: 2px solid;
  margin: 32px 0;
}

/* Strong */
.cs-strong {
  font-weight: 600;
}

/* Callouts */
.cs-callout {
  border-left: 4px solid;
  padding: 16px 20px;
  margin: 20px 0;
  border-radius: 4px;
}
.cs-callout-title {
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
}
.cs-callout-icon {
  font-size: 1.1em;
}
.cs-callout-body {
  margin: 0;
}
.cs-callout-body .cs-blockquote {
  border-left: none;
  background: transparent;
  padding: 0;
  margin: 0;
  box-shadow: none;
}

/* Mobile adjustments */
@media (max-width: 600px) {
  .cs-container {
    font-size: 14px;
  }
  .cs-table {
    font-size: 13px;
  }
  .cs-th, .cs-td {
    padding: 8px 12px;
  }
  .cs-callout {
    padding: 12px 16px;
  }
  .cs-blockquote {
    padding: 10px 16px;
    margin: 16px 0;
  }
}
`;

		// Light mode specific styles
		const lightModeStyles = `
.cs-container { color: ${textColor}; }
.cs-h1 { color: ${headingColor}; }
.cs-h2 { color: ${textColor}; border-bottom: 2px solid ${light.border}; }
.cs-h3 { color: ${mutedColor}; }
.cs-h4 { color: ${mobileCompatible ? 'inherit' : light.textLight}; }
.cs-td { border: 1px solid ${light.border}; background: ${tableCellBg}; }
.cs-code { background: ${light.inlineCodeBackground}; color: ${light.inlineCodeText}; }
.cs-blockquote { background: ${blockquoteBg}; color: ${mutedColor}; }
.cs-link { color: ${accent}; border-color: ${accent}; }
.cs-hr { border-color: ${light.border}; }
.cs-strong { color: ${strongColor}; }
.cs-callout-body { color: ${mobileCompatible ? 'inherit' : '#333'}; }
${calloutLightCss}
`;

		// Dark mode specific styles
		const darkModeStyles = `
.cs-container { color: ${textColorDark}; }
.cs-h1 { color: ${headingColorDark}; border-color: ${accentDark}; }
.cs-h2 { color: ${textColorDark}; border-bottom: 2px solid ${dark.border}; }
.cs-h3 { color: ${mutedColorDark}; }
.cs-h4 { color: ${mobileCompatible ? 'inherit' : dark.textLight}; }
.cs-td { border: 1px solid ${dark.border}; background: ${tableCellBgDark}; }
.cs-tr:nth-child(even) .cs-td { background-color: rgba(255, 255, 255, 0.03); }
.cs-pre { background: ${dark.codeBackground}; color: ${dark.codeText}; }
.cs-code { background: ${dark.inlineCodeBackground}; color: ${dark.inlineCodeText}; }
.cs-blockquote { background: ${blockquoteBgDark}; color: ${mutedColorDark}; border-color: ${accentDark}; }
.cs-link { color: ${accentDark}; border-color: ${accentDark}; }
.cs-hr { border-color: ${dark.border}; }
.cs-strong { color: ${strongColorDark}; }
.cs-callout-body { color: ${mutedColorDark}; }
${calloutDarkCss}
`;

		// Build the complete CSS based on theme setting
		let css = baseStyles;

		if (theme === 'light') {
			css += lightModeStyles;
		} else if (theme === 'dark') {
			css += darkModeStyles;
		} else {
			// Auto mode: use light as default, dark with prefers-color-scheme
			css += lightModeStyles;
			css += `
@media (prefers-color-scheme: dark) {
${darkModeStyles}
}
`;
		}

		return `<style>\n${css}\n</style>`;
	}

	/**
	 * Adjust a hex color's brightness
	 * @param hex - Hex color string (e.g., "#667eea")
	 * @param amount - Amount to adjust (-100 to 100, negative = darker, positive = lighter)
	 */
	private adjustColor(hex: string, amount: number): string {
		// Remove # if present
		hex = hex.replace(/^#/, '');

		// Parse hex to RGB
		let r = parseInt(hex.substring(0, 2), 16);
		let g = parseInt(hex.substring(2, 4), 16);
		let b = parseInt(hex.substring(4, 6), 16);

		// Adjust brightness
		r = Math.max(0, Math.min(255, r + amount));
		g = Math.max(0, Math.min(255, g + amount));
		b = Math.max(0, Math.min(255, b + amount));

		// Convert back to hex
		return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
	}

	/**
	 * Wrap HTML in a container and apply inline styles
	 * Canvas LMS strips <style> tags, so we must use inline styles
	 */
	private wrapInContainer(html: string, styleBlock: string, customCss?: string): string {
		// Extract CSS from style block
		const cssMatch = styleBlock.match(/<style>\s*([\s\S]*?)\s*<\/style>/);
		let css = cssMatch ? cssMatch[1] : '';

		// Append custom CSS if provided
		if (customCss) {
			css += `\n/* Custom CSS */\n${customCss}`;
		}

		// Wrap content in container first
		let wrappedHtml = `<div class="cs-container">\n${html}\n</div>`;

		// Apply inline styles
		wrappedHtml = this.applyInlineStyles(wrappedHtml, css);

		return wrappedHtml;
	}

	/**
	 * Parse CSS and apply styles inline to matching elements
	 * This is necessary because Canvas LMS strips <style> tags
	 */
	private applyInlineStyles(html: string, css: string): string {
		// Parse CSS rules (simple parser for class selectors)
		const rules = this.parseCssRules(css);
		console.log(`[Converter] Parsed ${rules.length} CSS rules for inline application`);

		// Apply each rule to matching elements
		const initialLength = html.length;
		for (const rule of rules) {
			html = this.applyRuleInline(html, rule.selector, rule.styles);
		}
		console.log(`[Converter] Inline styles applied: HTML grew from ${initialLength} to ${html.length} chars`);

		return html;
	}

	/**
	 * Parse CSS into selector/styles pairs
	 */
	private parseCssRules(css: string): Array<{ selector: string; styles: string }> {
		const rules: Array<{ selector: string; styles: string }> = [];

		// Remove comments
		css = css.replace(/\/\*[\s\S]*?\*\//g, '');

		// Remove @media queries (we'll handle light mode only for Canvas)
		css = css.replace(/@media[^{]+\{[\s\S]*?\}\s*\}/g, '');

		// Match CSS rules: selector { properties }
		const rulePattern = /([^{}]+)\{([^{}]+)\}/g;
		let match;

		while ((match = rulePattern.exec(css)) !== null) {
			const selectorPart = match[1].trim();
			const stylesPart = match[2].trim();

			// Handle comma-separated selectors
			const selectors = selectorPart.split(',').map((s) => s.trim());

			for (const selector of selectors) {
				// Only process .cs- class selectors (skip pseudo-selectors like :hover)
				if (selector.startsWith('.cs-') && !selector.includes(':')) {
					rules.push({
						selector,
						styles: this.normalizeStyles(stylesPart),
					});
				}
			}
		}

		return rules;
	}

	/**
	 * Normalize CSS styles to a single line
	 */
	private normalizeStyles(styles: string): string {
		return styles
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('/*'))
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	/**
	 * Apply a CSS rule inline to matching elements
	 */
	private applyRuleInline(html: string, selector: string, styles: string): string {
		// Extract class name from selector (e.g., ".cs-h1" -> "cs-h1")
		const classMatch = selector.match(/^\.([a-zA-Z0-9_-]+)/);
		if (!classMatch) return html;

		const className = classMatch[1];

		// Handle descendant selectors like ".cs-container img" or ".cs-callout-note .cs-callout-title"
		if (selector.includes(' ')) {
			const parts = selector.split(/\s+/);
			if (parts.length === 2 && parts[0] === '.cs-container') {
				// It's a descendant selector like ".cs-container img"
				const descendant = parts[1];
				// Apply to all matching tags within cs-container
				const tagPattern = new RegExp(`<${descendant}([^>]*)>`, 'gi');
				return html.replace(tagPattern, (match, attrs) => {
					return this.mergeInlineStyle(`<${descendant}${attrs}>`, styles);
				});
			}
			// Handle callout type descendant selectors like ".cs-callout-note .cs-callout-title"
			if (parts.length === 2 && parts[0].startsWith('.cs-callout-') && parts[1].startsWith('.cs-callout-')) {
				const parentClass = parts[0].slice(1); // Remove leading dot
				const childClass = parts[1].slice(1);
				// Find elements with childClass that are inside elements with parentClass
				// Use a regex to find parent elements, then apply styles to matching children inside
				const parentPattern = new RegExp(
					`(<[^>]*class="[^"]*${parentClass}[^"]*"[^>]*>)([\\s\\S]*?)(<\\/div>)`,
					'gi'
				);
				return html.replace(parentPattern, (match, openTag, content, closeTag) => {
					// Apply styles to child elements within this parent
					const childPattern = new RegExp(
						`<([a-zA-Z0-9]+)([^>]*class="[^"]*${childClass}[^"]*"[^>]*)>`,
						'gi'
					);
					const styledContent = content.replace(childPattern, (childMatch: string, tag: string, attrs: string) => {
						return this.mergeInlineStyle(`<${tag}${attrs}>`, styles);
					});
					return openTag + styledContent + closeTag;
				});
			}
			return html;
		}

		// Match elements with this class and add/merge inline styles
		// Pattern: <tag ... class="... className ..." ...>
		// The class name must be a complete class (bounded by " or space on both sides)
		// This prevents "cs-callout" from matching "cs-callout-title"
		const pattern = new RegExp(
			`<([a-zA-Z0-9]+)([^>]*class="([^"]* )?${className}( [^"]*|)"[^>]*)>`,
			'gi'
		);

		return html.replace(pattern, (match, tag, attrs) => {
			return this.mergeInlineStyle(`<${tag}${attrs}>`, styles);
		});
	}

	/**
	 * Merge styles into an element's existing inline style attribute
	 */
	private mergeInlineStyle(openTag: string, newStyles: string): string {
		// Check if element already has a style attribute
		const styleMatch = openTag.match(/style="([^"]*)"/);

		if (styleMatch) {
			// Merge with existing styles
			const existingStyles = styleMatch[1];
			const mergedStyles = existingStyles.endsWith(';')
				? `${existingStyles} ${newStyles}`
				: `${existingStyles}; ${newStyles}`;
			return openTag.replace(/style="[^"]*"/, `style="${mergedStyles}"`);
		} else {
			// Add new style attribute before the closing >
			return openTag.replace(/>$/, ` style="${newStyles}">`);
		}
	}

	/**
	 * Capitalize first letter
	 */
	private capitalizeFirst(str: string): string {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
}
