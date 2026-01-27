/**
 * Mock implementations of Obsidian API for testing
 */

// Mock TFile
export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	stat: { size: number; mtime: number; ctime: number };
	parent: TFolder | null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.extension = this.name.split('.').pop() || '';
		this.basename = this.name.replace(`.${this.extension}`, '');
		this.stat = { size: 1000, mtime: Date.now(), ctime: Date.now() };
		this.parent = null;
	}
}

// Mock TFolder
export class TFolder {
	path: string;
	name: string;
	parent: TFolder | null;
	children: (TFile | TFolder)[];

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.parent = null;
		this.children = [];
	}
}

// Mock TAbstractFile
export class TAbstractFile {
	path: string;
	name: string;
	parent: TFolder | null;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() || '';
		this.parent = null;
	}
}

// Mock CachedMetadata
export interface CachedMetadata {
	frontmatter?: Record<string, unknown>;
	links?: Array<{
		original: string;
		link: string;
		displayText?: string;
	}>;
}

// Mock Notice
export class Notice {
	noticeEl: HTMLElement;

	constructor(message: string, timeout?: number) {
		this.noticeEl = {
			addClass: () => {},
			removeClass: () => {},
			empty: () => {},
			createDiv: () => ({
				setText: () => {},
				show: () => {},
				hide: () => {},
			}),
			setText: () => {},
		} as unknown as HTMLElement;
	}

	hide(): void {}
}

// Mock requestUrl
export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	json: unknown;
	text: string;
}

export async function requestUrl(params: RequestUrlParam): Promise<RequestUrlResponse> {
	// Default mock implementation - can be overridden in tests
	return {
		status: 200,
		headers: {},
		json: {},
		text: '',
	};
}

// Mock Vault
export class Vault {
	adapter = {
		constructor: class {},
		basePath: '/mock/vault',
	};

	async read(file: TFile): Promise<string> {
		return '';
	}

	async readBinary(file: TFile): Promise<ArrayBuffer> {
		return new ArrayBuffer(0);
	}

	getFiles(): TFile[] {
		return [];
	}

	getMarkdownFiles(): TFile[] {
		return [];
	}

	getAllLoadedFiles(): (TFile | TFolder)[] {
		return [];
	}

	getAbstractFileByPath(path: string): TFile | TFolder | null {
		return null;
	}
}

// Mock MetadataCache
export class MetadataCache {
	getFileCache(file: TFile): CachedMetadata | null {
		return null;
	}

	getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
		return null;
	}
}

// Mock FileManager
export class FileManager {
	async processFrontMatter(
		file: TFile,
		fn: (frontmatter: Record<string, unknown>) => void
	): Promise<void> {
		// Mock implementation
	}
}

// Mock App
export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	fileManager: FileManager;

	constructor() {
		this.vault = new Vault();
		this.metadataCache = new MetadataCache();
		this.fileManager = new FileManager();
	}
}

// Mock Plugin
export class Plugin {
	app: App;
	manifest: { id: string; name: string; version: string };

	constructor(app: App, manifest: { id: string; name: string; version: string }) {
		this.app = app;
		this.manifest = manifest;
	}

	async loadData(): Promise<unknown> {
		return {};
	}

	async saveData(data: unknown): Promise<void> {}

	addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement {
		return {} as HTMLElement;
	}

	addSettingTab(tab: unknown): void {}

	addCommand(command: unknown): void {}

	registerEvent(event: unknown): void {}
}

// Mock PluginManifest
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	author: string;
	description: string;
}

// Mock Menu
export class Menu {
	addItem(callback: (item: MenuItem) => void): this {
		callback(new MenuItem());
		return this;
	}

	showAtMouseEvent(event: MouseEvent): void {}
}

// Mock MenuItem
export class MenuItem {
	setTitle(title: string): this {
		return this;
	}

	setIcon(icon: string): this {
		return this;
	}

	onClick(callback: () => void): this {
		return this;
	}

	setSection(section: string): this {
		return this;
	}
}

// Mock debounce
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	delay: number
): T {
	return fn;
}

// Mock setIcon
export function setIcon(element: HTMLElement, icon: string): void {}

// Export all types
export type { App as AppType };
