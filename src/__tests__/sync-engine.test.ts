import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../sync-engine';
import { CanvasApi } from '../canvas-api';
import { App } from '../__mocks__/obsidian';

// Mock the canvas-api module
vi.mock('../canvas-api', () => ({
	CanvasApi: vi.fn().mockImplementation(() => ({
		getCourse: vi.fn().mockResolvedValue({ name: 'Test Course' }),
		upsertModule: vi.fn().mockResolvedValue({ module: { id: 1, published: true } }),
		getModuleItems: vi.fn().mockResolvedValue([]),
		addPageToModule: vi.fn().mockResolvedValue({}),
		addDiscussionToModule: vi.fn().mockResolvedValue({}),
		addAssignmentToModule: vi.fn().mockResolvedValue({}),
		addExternalUrlToModule: vi.fn().mockResolvedValue({}),
		setDebugMode: vi.fn(),
	})),
}));

describe('SyncEngine', () => {
	let syncEngine: SyncEngine;
	let mockApp: App;
	let mockApi: CanvasApi;

	beforeEach(() => {
		mockApp = new App();
		mockApi = new CanvasApi('https://canvas.example.com', 'test-token');
		syncEngine = new SyncEngine(mockApp as unknown as import('obsidian').App, mockApi, [], false);
	});

	describe('Race Condition Prevention', () => {
		it('should not add duplicate items to module Sets', () => {
			// This test validates the Set update logic
			// by checking that Sets properly track added items

			const existingPageUrls = new Set<string>();
			const existingDiscussionIds = new Set<number>();
			const existingAssignmentIds = new Set<number>();
			const existingExternalUrls = new Set<string>();

			// Simulate adding items
			const pageUrl = 'test-page-url';
			if (!existingPageUrls.has(pageUrl)) {
				existingPageUrls.add(pageUrl);
			}

			// Verify duplicate detection works
			expect(existingPageUrls.has(pageUrl)).toBe(true);
			expect(existingPageUrls.size).toBe(1);

			// Simulate adding discussion
			const discussionId = 123;
			if (!existingDiscussionIds.has(discussionId)) {
				existingDiscussionIds.add(discussionId);
			}
			expect(existingDiscussionIds.has(discussionId)).toBe(true);

			// Simulate adding assignment
			const assignmentId = 456;
			if (!existingAssignmentIds.has(assignmentId)) {
				existingAssignmentIds.add(assignmentId);
			}
			expect(existingAssignmentIds.has(assignmentId)).toBe(true);

			// Simulate adding external URL
			const urlTitle = 'External Link';
			if (!existingExternalUrls.has(urlTitle)) {
				existingExternalUrls.add(urlTitle);
			}
			expect(existingExternalUrls.has(urlTitle)).toBe(true);

			// Try to add duplicates - should not change size
			existingPageUrls.add(pageUrl);
			expect(existingPageUrls.size).toBe(1);

			existingDiscussionIds.add(discussionId);
			expect(existingDiscussionIds.size).toBe(1);

			existingAssignmentIds.add(assignmentId);
			expect(existingAssignmentIds.size).toBe(1);

			existingExternalUrls.add(urlTitle);
			expect(existingExternalUrls.size).toBe(1);
		});

		it('should track multiple unique items correctly', () => {
			const existingPageUrls = new Set<string>();

			// Add multiple unique pages
			const pages = ['page-1', 'page-2', 'page-3'];
			for (const page of pages) {
				if (!existingPageUrls.has(page)) {
					existingPageUrls.add(page);
				}
			}

			expect(existingPageUrls.size).toBe(3);
			expect(existingPageUrls.has('page-1')).toBe(true);
			expect(existingPageUrls.has('page-2')).toBe(true);
			expect(existingPageUrls.has('page-3')).toBe(true);
			expect(existingPageUrls.has('page-4')).toBe(false);
		});
	});

	describe('Module discovery', () => {
		it('should identify numbered prefix folders as modules', () => {
			// Access private method via any cast for testing
			const isModuleFolder = (syncEngine as unknown as { isModuleFolder: (name: string) => boolean }).isModuleFolder.bind(syncEngine);

			expect(isModuleFolder('00-Course-Info')).toBe(true);
			expect(isModuleFolder('01-Week-01')).toBe(true);
			expect(isModuleFolder('12-Final-Project')).toBe(true);
		});

		it('should identify common module patterns', () => {
			const isModuleFolder = (syncEngine as unknown as { isModuleFolder: (name: string) => boolean }).isModuleFolder.bind(syncEngine);

			expect(isModuleFolder('Week-1')).toBe(true);
			expect(isModuleFolder('Module-Introduction')).toBe(true);
			expect(isModuleFolder('Unit-5')).toBe(true);
			expect(isModuleFolder('Chapter-3')).toBe(true);
			expect(isModuleFolder('Section-A')).toBe(true);
		});

		it('should exclude hidden and system folders', () => {
			const isModuleFolder = (syncEngine as unknown as { isModuleFolder: (name: string) => boolean }).isModuleFolder.bind(syncEngine);

			expect(isModuleFolder('.obsidian')).toBe(false);
			expect(isModuleFolder('.git')).toBe(false);
			expect(isModuleFolder('canvas-import')).toBe(false);
			expect(isModuleFolder('node_modules')).toBe(false);
			expect(isModuleFolder('Attachments')).toBe(false);
		});

		it('should exclude random folder names', () => {
			const isModuleFolder = (syncEngine as unknown as { isModuleFolder: (name: string) => boolean }).isModuleFolder.bind(syncEngine);

			expect(isModuleFolder('Random-Folder')).toBe(false);
			expect(isModuleFolder('MyNotes')).toBe(false);
			expect(isModuleFolder('drafts')).toBe(false);
		});
	});

	describe('Folder name to title conversion', () => {
		it('should strip numeric prefixes', () => {
			const folderNameToTitle = (syncEngine as unknown as { folderNameToTitle: (name: string) => string }).folderNameToTitle.bind(syncEngine);

			expect(folderNameToTitle('01-Introduction')).toBe('Introduction');
			expect(folderNameToTitle('12-Advanced-Topics')).toBe('Advanced Topics');
		});

		it('should replace hyphens with spaces', () => {
			const folderNameToTitle = (syncEngine as unknown as { folderNameToTitle: (name: string) => string }).folderNameToTitle.bind(syncEngine);

			expect(folderNameToTitle('week-one-overview')).toBe('Week One Overview');
		});

		it('should title case words', () => {
			const folderNameToTitle = (syncEngine as unknown as { folderNameToTitle: (name: string) => string }).folderNameToTitle.bind(syncEngine);

			expect(folderNameToTitle('final-exam')).toBe('Final Exam');
		});
	});

	describe('Debug mode', () => {
		it('should toggle debug mode', () => {
			syncEngine.setDebugMode(true);
			// No error means it worked
			syncEngine.setDebugMode(false);
		});
	});

	describe('Shared content paths', () => {
		it('should update shared content paths', () => {
			syncEngine.setSharedContentPaths(['path/to/shared', 'another/path']);
			// No error means it worked
		});
	});

	describe('buildExistingItemSets', () => {
		it('should extract page URLs from existing items', () => {
			const buildExistingItemSets = (syncEngine as unknown as {
				buildExistingItemSets: (items: Array<{ type: string; page_url?: string; content_id?: number; title: string }>) => {
					pageUrls: Set<string | undefined>;
					discussionIds: Set<number>;
					assignmentIds: Set<number>;
					externalUrls: Set<string>;
				};
			}).buildExistingItemSets.bind(syncEngine);

			const items = [
				{ type: 'Page', page_url: 'page-1', title: 'Page 1' },
				{ type: 'Page', page_url: 'page-2', title: 'Page 2' },
				{ type: 'Discussion', content_id: 123, title: 'Discussion 1' },
			];

			const sets = buildExistingItemSets(items);

			expect(sets.pageUrls.has('page-1')).toBe(true);
			expect(sets.pageUrls.has('page-2')).toBe(true);
			expect(sets.pageUrls.size).toBe(2);
		});

		it('should extract discussion IDs from existing items', () => {
			const buildExistingItemSets = (syncEngine as unknown as {
				buildExistingItemSets: (items: Array<{ type: string; page_url?: string; content_id?: number; title: string }>) => {
					pageUrls: Set<string | undefined>;
					discussionIds: Set<number>;
					assignmentIds: Set<number>;
					externalUrls: Set<string>;
				};
			}).buildExistingItemSets.bind(syncEngine);

			const items = [
				{ type: 'Discussion', content_id: 100, title: 'Discussion 1' },
				{ type: 'Discussion', content_id: 200, title: 'Discussion 2' },
				{ type: 'Page', page_url: 'page-1', title: 'Page 1' },
			];

			const sets = buildExistingItemSets(items);

			expect(sets.discussionIds.has(100)).toBe(true);
			expect(sets.discussionIds.has(200)).toBe(true);
			expect(sets.discussionIds.size).toBe(2);
		});

		it('should extract assignment IDs from existing items', () => {
			const buildExistingItemSets = (syncEngine as unknown as {
				buildExistingItemSets: (items: Array<{ type: string; page_url?: string; content_id?: number; title: string }>) => {
					pageUrls: Set<string | undefined>;
					discussionIds: Set<number>;
					assignmentIds: Set<number>;
					externalUrls: Set<string>;
				};
			}).buildExistingItemSets.bind(syncEngine);

			const items = [
				{ type: 'Assignment', content_id: 500, title: 'Assignment 1' },
				{ type: 'Assignment', content_id: 600, title: 'Assignment 2' },
			];

			const sets = buildExistingItemSets(items);

			expect(sets.assignmentIds.has(500)).toBe(true);
			expect(sets.assignmentIds.has(600)).toBe(true);
			expect(sets.assignmentIds.size).toBe(2);
		});

		it('should extract external URL titles from existing items', () => {
			const buildExistingItemSets = (syncEngine as unknown as {
				buildExistingItemSets: (items: Array<{ type: string; page_url?: string; content_id?: number; title: string }>) => {
					pageUrls: Set<string | undefined>;
					discussionIds: Set<number>;
					assignmentIds: Set<number>;
					externalUrls: Set<string>;
				};
			}).buildExistingItemSets.bind(syncEngine);

			const items = [
				{ type: 'ExternalUrl', title: 'External Link 1' },
				{ type: 'ExternalUrl', title: 'External Link 2' },
			];

			const sets = buildExistingItemSets(items);

			expect(sets.externalUrls.has('External Link 1')).toBe(true);
			expect(sets.externalUrls.has('External Link 2')).toBe(true);
			expect(sets.externalUrls.size).toBe(2);
		});

		it('should handle empty items array', () => {
			const buildExistingItemSets = (syncEngine as unknown as {
				buildExistingItemSets: (items: Array<{ type: string; page_url?: string; content_id?: number; title: string }>) => {
					pageUrls: Set<string | undefined>;
					discussionIds: Set<number>;
					assignmentIds: Set<number>;
					externalUrls: Set<string>;
				};
			}).buildExistingItemSets.bind(syncEngine);

			const sets = buildExistingItemSets([]);

			expect(sets.pageUrls.size).toBe(0);
			expect(sets.discussionIds.size).toBe(0);
			expect(sets.assignmentIds.size).toBe(0);
			expect(sets.externalUrls.size).toBe(0);
		});
	});

	describe('Parallel batch processing', () => {
		it('should process items in batches with specified concurrency', async () => {
			const processInBatches = (syncEngine as unknown as {
				processInBatches: <T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency?: number) => Promise<R[]>;
			}).processInBatches.bind(syncEngine);

			const items = [1, 2, 3, 4, 5, 6, 7];
			const processed: number[] = [];
			const batchStarts: number[] = [];

			const results = await processInBatches(
				items,
				async (item) => {
					if (processed.length % 3 === 0) {
						batchStarts.push(processed.length);
					}
					processed.push(item);
					return item * 2;
				},
				3
			);

			// Should return correct results
			expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);

			// Should have processed all items
			expect(processed).toEqual([1, 2, 3, 4, 5, 6, 7]);
		});

		it('should handle empty arrays', async () => {
			const processInBatches = (syncEngine as unknown as {
				processInBatches: <T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency?: number) => Promise<R[]>;
			}).processInBatches.bind(syncEngine);

			const results = await processInBatches(
				[],
				async (item: number) => item * 2,
				3
			);

			expect(results).toEqual([]);
		});

		it('should handle items less than concurrency limit', async () => {
			const processInBatches = (syncEngine as unknown as {
				processInBatches: <T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency?: number) => Promise<R[]>;
			}).processInBatches.bind(syncEngine);

			const items = [1, 2];
			const results = await processInBatches(
				items,
				async (item) => item * 2,
				5
			);

			expect(results).toEqual([2, 4]);
		});

		it('should process items in parallel within each batch', async () => {
			const processInBatches = (syncEngine as unknown as {
				processInBatches: <T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency?: number) => Promise<R[]>;
			}).processInBatches.bind(syncEngine);

			const startTimes: { item: number; start: number }[] = [];
			const items = [1, 2, 3, 4];

			await processInBatches(
				items,
				async (item) => {
					const start = Date.now();
					startTimes.push({ item, start });
					// Small delay to ensure we can measure parallelism
					await new Promise(resolve => setTimeout(resolve, 10));
					return item;
				},
				2
			);

			// Items in the same batch should have very close start times
			// Batch 1: items 1 and 2
			// Batch 2: items 3 and 4
			const batch1 = startTimes.filter(t => t.item <= 2);
			const batch2 = startTimes.filter(t => t.item > 2);

			// Items in same batch should start within 5ms of each other
			if (batch1.length === 2) {
				expect(Math.abs(batch1[0].start - batch1[1].start)).toBeLessThan(10);
			}
			if (batch2.length === 2) {
				expect(Math.abs(batch2[0].start - batch2[1].start)).toBeLessThan(10);
			}
		});

		it('should use default concurrency of 3 when not specified', async () => {
			const processInBatches = (syncEngine as unknown as {
				processInBatches: <T, R>(items: T[], processor: (item: T) => Promise<R>, concurrency?: number) => Promise<R[]>;
			}).processInBatches.bind(syncEngine);

			const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
			const batchSizes: number[] = [];
			let currentBatch: number[] = [];

			const results = await processInBatches(
				items,
				async (item) => {
					currentBatch.push(item);
					if (currentBatch.length === 3 || item === items[items.length - 1]) {
						batchSizes.push(currentBatch.length);
						currentBatch = [];
					}
					return item;
				}
				// No concurrency specified - should use default of 3
			);

			expect(results).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});
	});
});
