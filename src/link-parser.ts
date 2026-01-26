import type { App, TFile, TFolder } from 'obsidian';
import type { SharedContentDiscovery } from './types';

/**
 * Parse wiki-links to discover shared content dependencies
 */
export class LinkParser {
	private app: App;
	private sharedContentPaths: string[];

	constructor(app: App, sharedContentPaths: string[] = []) {
		this.app = app;
		this.sharedContentPaths = sharedContentPaths;
	}

	/**
	 * Update the shared content paths
	 */
	setSharedContentPaths(paths: string[]): void {
		this.sharedContentPaths = paths;
	}

	/**
	 * Check if a file is in one of the shared content folders
	 */
	isSharedContent(filePath: string): boolean {
		if (!this.sharedContentPaths || this.sharedContentPaths.length === 0) {
			return false;
		}
		return this.sharedContentPaths.some(
			(path) => path && filePath.startsWith(path)
		);
	}

	/**
	 * Get all markdown files in a folder recursively
	 */
	getMarkdownFiles(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !(folder instanceof this.app.vault.adapter.constructor)) {
			// Use vault.getFiles() and filter
			return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folderPath));
		}
		return [];
	}

	/**
	 * Extract all wiki-links from a file's content
	 */
	extractWikiLinksFromContent(content: string): string[] {
		const links: string[] = [];
		const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
		let match;

		while ((match = wikiLinkPattern.exec(content)) !== null) {
			links.push(match[1]);
		}

		return links;
	}

	/**
	 * Resolve a wiki-link target to a file
	 */
	resolveWikiLink(linkTarget: string, sourcePath: string): TFile | null {
		// Use Obsidian's built-in link resolution
		return this.app.metadataCache.getFirstLinkpathDest(linkTarget, sourcePath);
	}

	/**
	 * Discover all shared content files linked from a course folder
	 */
	async discoverSharedContent(coursePath: string): Promise<SharedContentDiscovery[]> {
		const discoveries: Map<string, SharedContentDiscovery> = new Map();
		const courseFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(coursePath));

		for (const file of courseFiles) {
			const content = await this.app.vault.read(file);
			const links = this.extractWikiLinksFromContent(content);

			for (const linkTarget of links) {
				const resolvedFile = this.resolveWikiLink(linkTarget, file.path);
				const isShared = resolvedFile ? this.isSharedContent(resolvedFile.path) : false;

				if (resolvedFile && isShared) {
					let discovery = discoveries.get(resolvedFile.path);

					if (!discovery) {
						discovery = {
							filePath: resolvedFile.path,
							linkedByCourses: [],
							linkedByFiles: [],
						};
						discoveries.set(resolvedFile.path, discovery);
					}

					// Track which course file links to this shared content
					if (!discovery.linkedByFiles.some((f) => f.filePath === file.path)) {
						discovery.linkedByFiles.push({
							coursePath,
							filePath: file.path,
						});
					}
				}
			}
		}

		return Array.from(discoveries.values());
	}

	/**
	 * Find all courses that link to a specific shared content file
	 */
	async findCoursesLinkingTo(sharedFilePath: string, coursePaths: string[]): Promise<string[]> {
		const linkingCourses: string[] = [];

		for (const coursePath of coursePaths) {
			const discoveries = await this.discoverSharedContent(coursePath);
			if (discoveries.some((d) => d.filePath === sharedFilePath)) {
				linkingCourses.push(coursePath);
			}
		}

		return linkingCourses;
	}

	/**
	 * Get all shared content files
	 */
	getAllSharedContentFiles(): TFile[] {
		if (!this.sharedContentPaths || this.sharedContentPaths.length === 0) {
			return [];
		}

		return this.app.vault.getMarkdownFiles().filter((f) => this.isSharedContent(f.path));
	}

	/**
	 * Build a dependency graph for a course
	 * Returns a map of shared content file paths to their referencing course files
	 */
	async buildDependencyGraph(
		coursePath: string
	): Promise<Map<string, string[]>> {
		const graph = new Map<string, string[]>();
		const discoveries = await this.discoverSharedContent(coursePath);

		for (const discovery of discoveries) {
			const referencingFiles = discovery.linkedByFiles
				.filter((f) => f.coursePath === coursePath)
				.map((f) => f.filePath);

			graph.set(discovery.filePath, referencingFiles);
		}

		return graph;
	}

	/**
	 * Check if a file change should trigger a shared content sync
	 */
	async shouldTriggerSharedSync(
		changedFilePath: string,
		coursePaths: string[]
	): Promise<{ shouldSync: boolean; affectedCourses: string[] }> {
		if (!this.isSharedContent(changedFilePath)) {
			return { shouldSync: false, affectedCourses: [] };
		}

		const affectedCourses = await this.findCoursesLinkingTo(changedFilePath, coursePaths);

		return {
			shouldSync: affectedCourses.length > 0,
			affectedCourses,
		};
	}

	/**
	 * Get the shared content files that need to be synced for a course
	 */
	async getSharedContentToSync(coursePath: string): Promise<TFile[]> {
		const discoveries = await this.discoverSharedContent(coursePath);
		const files: TFile[] = [];

		for (const discovery of discoveries) {
			const tfile = this.app.vault.getMarkdownFiles().find((f) => f.path === discovery.filePath);
			if (tfile) {
				files.push(tfile);
			}
		}

		return files;
	}
}
