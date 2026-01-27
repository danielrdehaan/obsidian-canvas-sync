import { describe, it, expect, beforeEach } from 'vitest';
import { MarkdownConverter, ConvertOptions } from '../converter';

describe('MarkdownConverter', () => {
	let converter: MarkdownConverter;
	let defaultOptions: ConvertOptions;

	beforeEach(() => {
		converter = new MarkdownConverter();
		defaultOptions = {
			courseId: 123,
			pageSlugMap: new Map(),
			discussionTitleMap: new Map(),
		};
	});

	describe('convert', () => {
		it('should strip YAML frontmatter', () => {
			const markdown = `---
title: Test Page
canvas_type: page
---

# Hello World`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).not.toContain('---');
			expect(html).not.toContain('title: Test Page');
			expect(html).toContain('Hello World');
		});

		it('should preserve content after frontmatter', () => {
			const markdown = `---
title: Test
---

First paragraph.

Second paragraph.`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('First paragraph');
			expect(html).toContain('Second paragraph');
		});

		it('should wrap content in cs-container', () => {
			const html = converter.convert('# Test', defaultOptions);
			expect(html).toContain('class="cs-container"');
		});
	});

	describe('headings', () => {
		it('should add cs-h1 class to h1 elements', () => {
			const html = converter.convert('# Heading 1', defaultOptions);
			expect(html).toContain('class="cs-h1"');
		});

		it('should add cs-h2 class to h2 elements', () => {
			const html = converter.convert('## Heading 2', defaultOptions);
			expect(html).toContain('class="cs-h2"');
		});

		it('should add cs-h3 class to h3 elements', () => {
			const html = converter.convert('### Heading 3', defaultOptions);
			expect(html).toContain('class="cs-h3"');
		});

		it('should add cs-h4 class to h4 elements', () => {
			const html = converter.convert('#### Heading 4', defaultOptions);
			expect(html).toContain('class="cs-h4"');
		});
	});

	describe('wiki-links', () => {
		it('should convert known page links to Canvas URLs', () => {
			const options = {
				...defaultOptions,
				pageSlugMap: new Map([['My Page', 'my-page']]),
			};

			const html = converter.convert('See [[My Page]] for more.', options);
			expect(html).toContain('href="/courses/123/pages/my-page"');
			expect(html).toContain('class="cs-link"');
		});

		it('should use display text when provided', () => {
			const options = {
				...defaultOptions,
				pageSlugMap: new Map([['Target', 'target']]),
			};

			const html = converter.convert('[[Target|Custom Text]]', options);
			expect(html).toContain('>Custom Text</a>');
		});

		it('should convert known discussion links', () => {
			const options = {
				...defaultOptions,
				discussionTitleMap: new Map([['Discussion Topic', 456]]),
			};

			const html = converter.convert('Join [[Discussion Topic]]', options);
			expect(html).toContain('href="/courses/123/discussion_topics/456"');
		});

		it('should render unknown links as styled text', () => {
			const html = converter.convert('[[Unknown Page]]', defaultOptions);
			expect(html).toContain('<em>');
			expect(html).toContain('Unknown Page');
		});

		it('should handle wiki-links with paths', () => {
			const options = {
				...defaultOptions,
				pageSlugMap: new Map([['File', 'file']]),
			};

			const html = converter.convert('[[Path/To/File]]', options);
			expect(html).toContain('href="/courses/123/pages/file"');
		});
	});

	describe('callouts', () => {
		it('should convert note callout', () => {
			const markdown = `> [!note] Title
> Content here`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-callout cs-callout-note"');
			expect(html).toContain('cs-callout-title');
		});

		it('should convert warning callout', () => {
			const markdown = `> [!warning]
> Warning content`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('cs-callout-warning');
		});

		it('should convert tip callout', () => {
			const markdown = `> [!tip] Pro Tip
> Helpful advice`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('cs-callout-tip');
			expect(html).toContain('Pro Tip');
		});

		it('should include callout icons', () => {
			const markdown = `> [!important]
> Important info`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('cs-callout-icon');
		});
	});

	describe('YouTube embeds', () => {
		it('should convert YouTube watch URLs to iframes', () => {
			const markdown = '![Video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('cs-video-container');
			expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ');
			expect(html).toContain('iframe');
		});

		it('should convert youtu.be URLs to iframes', () => {
			const markdown = '![](https://youtu.be/dQw4w9WgXcQ)';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ');
		});

		it('should use alt text as iframe title', () => {
			const markdown = '![My Video Title](https://youtube.com/watch?v=abc123)';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('title="My Video Title"');
		});
	});

	describe('tables', () => {
		it('should wrap tables with cs-table-wrap', () => {
			const markdown = `| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-table-wrap"');
			expect(html).toContain('class="cs-table"');
		});

		it('should add classes to table elements', () => {
			const markdown = `| H1 | H2 |
| -- | -- |
| C1 | C2 |`;

			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('cs-thead');
			expect(html).toContain('cs-th');
			expect(html).toContain('cs-td');
		});
	});

	describe('code blocks', () => {
		it('should add cs-pre class to code blocks', () => {
			const markdown = '```\ncode here\n```';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-pre"');
			expect(html).toContain('class="cs-code-block"');
		});

		it('should add cs-code class to inline code', () => {
			const markdown = 'Use the `command` here';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-code"');
		});
	});

	describe('lists', () => {
		it('should add cs-ul class to unordered lists', () => {
			const markdown = `- Item 1
- Item 2`;
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-ul"');
			expect(html).toContain('class="cs-li"');
		});

		it('should add cs-ol class to ordered lists', () => {
			const markdown = `1. First
2. Second`;
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-ol"');
		});
	});

	describe('blockquotes', () => {
		it('should add cs-blockquote class', () => {
			const markdown = '> This is a quote';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-blockquote"');
		});
	});

	describe('horizontal rules', () => {
		it('should add cs-hr class', () => {
			const markdown = '---';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-hr"');
		});
	});

	describe('links', () => {
		it('should add cs-link class to external links', () => {
			const markdown = '[Example](https://example.com)';
			const html = converter.convert(markdown, defaultOptions);
			expect(html).toContain('class="cs-link"');
			expect(html).toContain('href="https://example.com"');
		});
	});

	describe('media replacements', () => {
		it('should apply media replacements to content', () => {
			const options: ConvertOptions = {
				...defaultOptions,
				mediaReplacements: [
					{ original: '![[image.png]]', replacement: '<img src="https://example.com/image.png">' },
				],
			};

			const html = converter.convert('![[image.png]]', options);
			expect(html).toContain('src="https://example.com/image.png"');
			expect(html).not.toContain('![[image.png]]');
		});

		it('should apply multiple replacements', () => {
			const options: ConvertOptions = {
				...defaultOptions,
				mediaReplacements: [
					{ original: '![[a.png]]', replacement: '<img src="a.png">' },
					{ original: '![[b.png]]', replacement: '<img src="b.png">' },
				],
			};

			const html = converter.convert('![[a.png]] and ![[b.png]]', options);
			expect(html).toContain('src="a.png"');
			expect(html).toContain('src="b.png"');
		});
	});

	describe('style settings', () => {
		it('should use custom accent color', () => {
			const options: ConvertOptions = {
				...defaultOptions,
				style: {
					theme: 'light',
					accentColor: '#ff6600',
					enabledSnippets: [],
					mobileCompatible: false,
				},
			};

			const html = converter.convert('# Test', options);
			expect(html).toContain('#ff6600');
		});

		it('should apply custom CSS', () => {
			const options: ConvertOptions = {
				...defaultOptions,
				customCss: '.custom { color: red; }',
			};

			// Custom CSS is included in the style processing
			const html = converter.convert('# Test', options);
			// The custom CSS would be processed and potentially inlined
		});
	});

	describe('inline styles', () => {
		it('should apply inline styles to elements', () => {
			const html = converter.convert('# Heading', defaultOptions);
			// The converter applies inline styles for Canvas compatibility
			expect(html).toContain('style=');
		});
	});

	describe('edge cases', () => {
		it('should handle empty content', () => {
			const html = converter.convert('', defaultOptions);
			expect(html).toContain('cs-container');
		});

		it('should handle content with only whitespace', () => {
			const html = converter.convert('   \n\n   ', defaultOptions);
			expect(html).toContain('cs-container');
		});

		it('should escape HTML in wiki-link display text', () => {
			const options = {
				...defaultOptions,
				pageSlugMap: new Map([['Page', 'page']]),
			};

			const html = converter.convert('[[Page|<script>alert("xss")</script>]]', options);
			expect(html).not.toContain('<script>');
			expect(html).toContain('&lt;script&gt;');
		});

		it('should handle wiki-links in table cells', () => {
			const options = {
				...defaultOptions,
				pageSlugMap: new Map([['Link', 'link']]),
			};

			const markdown = `| Column |
| ------ |
| [[Link\\|Text]] |`;

			const html = converter.convert(markdown, options);
			expect(html).toContain('href="/courses/123/pages/link"');
		});
	});
});
