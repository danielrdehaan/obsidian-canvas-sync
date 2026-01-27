import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrontmatterParser } from '../frontmatter';
import { App, TFile } from '../__mocks__/obsidian';

describe('FrontmatterParser', () => {
	let parser: FrontmatterParser;
	let mockApp: App;

	beforeEach(() => {
		mockApp = new App();
		parser = new FrontmatterParser(mockApp as unknown as import('obsidian').App);
	});

	describe('extractCanvasFrontmatter', () => {
		it('should extract canvas_type', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_type: 'page' });
			expect(result.type).toBe('page');
		});

		it('should extract all valid content types', () => {
			const validTypes = ['page', 'discussion', 'graded_discussion', 'assignment', 'external_url', 'syllabus'];

			for (const type of validTypes) {
				const result = parser.extractCanvasFrontmatter({ canvas_type: type });
				expect(result.type).toBe(type);
			}
		});

		it('should return undefined for invalid content type', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_type: 'invalid' });
			expect(result.type).toBeUndefined();
		});

		it('should extract canvas_title', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_title: 'Custom Title' });
			expect(result.title).toBe('Custom Title');
		});

		it('should extract canvas_publish', () => {
			const resultTrue = parser.extractCanvasFrontmatter({ canvas_publish: true });
			expect(resultTrue.publish).toBe(true);

			const resultFalse = parser.extractCanvasFrontmatter({ canvas_publish: false });
			expect(resultFalse.publish).toBe(false);
		});

		it('should default publish to true when not specified', () => {
			const result = parser.extractCanvasFrontmatter({});
			expect(result.publish).toBe(true);
		});

		it('should extract canvas_sync', () => {
			const resultTrue = parser.extractCanvasFrontmatter({ canvas_sync: true });
			expect(resultTrue.sync).toBe(true);

			const resultFalse = parser.extractCanvasFrontmatter({ canvas_sync: false });
			expect(resultFalse.sync).toBe(false);
		});

		it('should default sync to true when not specified', () => {
			const result = parser.extractCanvasFrontmatter({});
			expect(result.sync).toBe(true);
		});

		it('should extract canvas_points', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_points: 100 });
			expect(result.points).toBe(100);
		});

		it('should ignore non-numeric points', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_points: 'not a number' });
			expect(result.points).toBeUndefined();
		});

		it('should extract canvas_due_date', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_due_date: '2024-12-31' });
			expect(result.due_date).toBe('2024-12-31');
		});

		it('should extract canvas_position', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_position: 5 });
			expect(result.position).toBe(5);
		});

		it('should extract assignment-specific fields', () => {
			const frontmatter = {
				canvas_submission_types: ['online_upload', 'online_text_entry'],
				canvas_allowed_extensions: ['pdf', 'docx'],
				canvas_grading_type: 'points',
				canvas_lock_at: '2024-12-31T23:59:59Z',
				canvas_unlock_at: '2024-01-01T00:00:00Z',
				canvas_assignment_group: 'Homework',
			};

			const result = parser.extractCanvasFrontmatter(frontmatter);
			expect(result.submission_types).toEqual(['online_upload', 'online_text_entry']);
			expect(result.allowed_extensions).toEqual(['pdf', 'docx']);
			expect(result.grading_type).toBe('points');
			expect(result.lock_at).toBe('2024-12-31T23:59:59Z');
			expect(result.unlock_at).toBe('2024-01-01T00:00:00Z');
			expect(result.assignment_group).toBe('Homework');
		});

		it('should filter invalid submission types', () => {
			const result = parser.extractCanvasFrontmatter({
				canvas_submission_types: ['online_upload', 'invalid_type', 'online_text_entry'],
			});
			expect(result.submission_types).toEqual(['online_upload', 'online_text_entry']);
		});

		it('should extract external URL fields', () => {
			const result = parser.extractCanvasFrontmatter({
				canvas_url: 'https://example.com',
				canvas_new_tab: false,
			});
			expect(result.url).toBe('https://example.com');
			expect(result.new_tab).toBe(false);
		});

		it('should default new_tab to true for external URLs', () => {
			const result = parser.extractCanvasFrontmatter({
				canvas_url: 'https://example.com',
			});
			expect(result.new_tab).toBe(true);
		});

		it('should extract canvas_page_url', () => {
			const result = parser.extractCanvasFrontmatter({ canvas_page_url: 'my-page-slug' });
			expect(result.page_url).toBe('my-page-slug');
		});
	});

	describe('extractModuleFrontmatter', () => {
		it('should extract module_name', () => {
			const result = parser.extractModuleFrontmatter({ canvas_module: 'Week 1' });
			expect(result.module_name).toBe('Week 1');
		});

		it('should extract position', () => {
			const result = parser.extractModuleFrontmatter({ canvas_position: 3 });
			expect(result.position).toBe(3);
		});

		it('should extract publish', () => {
			const result = parser.extractModuleFrontmatter({ canvas_publish: false });
			expect(result.publish).toBe(false);
		});

		it('should default publish to true', () => {
			const result = parser.extractModuleFrontmatter({});
			expect(result.publish).toBe(true);
		});

		it('should extract require_sequential', () => {
			const result = parser.extractModuleFrontmatter({ canvas_sequential: true });
			expect(result.require_sequential).toBe(true);
		});

		it('should default require_sequential to false', () => {
			const result = parser.extractModuleFrontmatter({});
			expect(result.require_sequential).toBe(false);
		});
	});

	describe('generateTitle', () => {
		it('should remove numbered prefix', () => {
			expect(parser.generateTitle('01-introduction')).toBe('Introduction');
			expect(parser.generateTitle('12-advanced-topics')).toBe('Advanced Topics');
		});

		it('should replace hyphens with spaces', () => {
			expect(parser.generateTitle('hello-world')).toBe('Hello World');
		});

		it('should replace underscores with spaces', () => {
			expect(parser.generateTitle('hello_world')).toBe('Hello World');
		});

		it('should title case words', () => {
			expect(parser.generateTitle('the-quick-brown-fox')).toBe('The Quick Brown Fox');
		});

		it('should handle mixed formats', () => {
			expect(parser.generateTitle('01-week_one-overview')).toBe('Week One Overview');
		});
	});

	describe('getDefaultContentType', () => {
		it('should return page as default', () => {
			expect(parser.getDefaultContentType()).toBe('page');
		});
	});

	describe('shouldSync', () => {
		it('should return false when canvas_sync is false', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { sync: false, publish: true },
				wikiLinks: [],
			};
			expect(parser.shouldSync(parsed)).toBe(false);
		});

		it('should return false for files starting with underscore', () => {
			const parsed = {
				path: '_notes.md',
				filename: '_notes',
				content: '',
				frontmatter: {},
				canvas: { sync: true, publish: true },
				wikiLinks: [],
			};
			expect(parser.shouldSync(parsed)).toBe(false);
		});

		it('should return true for normal files', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { sync: true, publish: true },
				wikiLinks: [],
			};
			expect(parser.shouldSync(parsed)).toBe(true);
		});

		it('should return true when sync is undefined (defaults to true)', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { publish: true },
				wikiLinks: [],
			};
			expect(parser.shouldSync(parsed)).toBe(true);
		});
	});

	describe('extractPosition', () => {
		it('should return canvas_position when specified', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { position: 5, publish: true },
				wikiLinks: [],
			};
			expect(parser.extractPosition(parsed)).toBe(5);
		});

		it('should return 0 when position not specified', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { publish: true },
				wikiLinks: [],
			};
			expect(parser.extractPosition(parsed)).toBe(0);
		});
	});

	describe('getEffectiveContentType', () => {
		it('should return type from frontmatter when specified', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { type: 'discussion' as const, publish: true },
				wikiLinks: [],
			};
			expect(parser.getEffectiveContentType(parsed)).toBe('discussion');
		});

		it('should return page when type not specified', () => {
			const parsed = {
				path: 'test.md',
				filename: 'test',
				content: '',
				frontmatter: {},
				canvas: { publish: true },
				wikiLinks: [],
			};
			expect(parser.getEffectiveContentType(parsed)).toBe('page');
		});
	});

	describe('getEffectiveTitle', () => {
		it('should prefer canvas_title', () => {
			const parsed = {
				path: 'test.md',
				filename: 'different-name',
				content: '',
				frontmatter: { title: 'Frontmatter Title' },
				canvas: { title: 'Canvas Title', publish: true },
				wikiLinks: [],
			};
			expect(parser.getEffectiveTitle(parsed)).toBe('Canvas Title');
		});

		it('should fall back to frontmatter title', () => {
			const parsed = {
				path: 'test.md',
				filename: 'different-name',
				content: '',
				frontmatter: { title: 'Frontmatter Title' },
				canvas: { publish: true },
				wikiLinks: [],
			};
			expect(parser.getEffectiveTitle(parsed)).toBe('Frontmatter Title');
		});

		it('should generate from filename as last resort', () => {
			const parsed = {
				path: 'test.md',
				filename: '01-my-page',
				content: '',
				frontmatter: {},
				canvas: { publish: true },
				wikiLinks: [],
			};
			expect(parser.getEffectiveTitle(parsed)).toBe('My Page');
		});

		it('should ignore empty frontmatter title', () => {
			const parsed = {
				path: 'test.md',
				filename: '01-my-page',
				content: '',
				frontmatter: { title: '   ' },
				canvas: { publish: true },
				wikiLinks: [],
			};
			expect(parser.getEffectiveTitle(parsed)).toBe('My Page');
		});
	});

	describe('extractWikiLinks', () => {
		it('should extract wiki-links from cache when available', () => {
			const cache = {
				links: [
					{ original: '[[Target Page]]', link: 'Target Page', displayText: 'Target Page' },
					{ original: '[[Other|Custom Text]]', link: 'Other', displayText: 'Custom Text' },
				],
			};

			const result = parser.extractWikiLinks('content', cache);
			expect(result).toHaveLength(2);
			expect(result[0].target).toBe('Target Page');
			expect(result[0].display).toBe('Target Page');
			expect(result[1].target).toBe('Other');
			expect(result[1].display).toBe('Custom Text');
		});

		it('should extract wiki-links with regex fallback', () => {
			const content = '[[Simple Link]] and [[Path/To/Page|Display Text]]';

			const result = parser.extractWikiLinks(content, null);
			expect(result).toHaveLength(2);
			expect(result[0].target).toBe('Simple Link');
			expect(result[0].display).toBe('Simple Link');
			expect(result[1].target).toBe('Path/To/Page');
			expect(result[1].display).toBe('Display Text');
		});

		it('should handle hyphens in display text', () => {
			const content = '[[my-page-name]]';

			const result = parser.extractWikiLinks(content, null);
			expect(result).toHaveLength(1);
			expect(result[0].display).toBe('my page name');
		});
	});
});
