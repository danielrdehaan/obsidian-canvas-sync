import { requestUrl, RequestUrlParam } from 'obsidian';
import type {
	CanvasPage,
	CanvasDiscussion,
	CanvasModule,
	CanvasModuleItem,
	CanvasCourse,
} from './types';

/**
 * Canvas LMS API client
 */
export class CanvasApi {
	private apiUrl: string;
	private apiToken: string;
	private debugMode: boolean;

	constructor(apiUrl: string, apiToken: string, debugMode = false) {
		this.apiUrl = apiUrl.replace(/\/$/, '');
		this.apiToken = apiToken;
		this.debugMode = debugMode;
	}

	/**
	 * Update API credentials
	 */
	setCredentials(apiUrl: string, apiToken: string): void {
		this.apiUrl = apiUrl.replace(/\/$/, '');
		this.apiToken = apiToken;
	}

	/**
	 * Set debug mode
	 */
	setDebugMode(debug: boolean): void {
		this.debugMode = debug;
	}

	/**
	 * Log debug messages
	 */
	private log(...args: unknown[]): void {
		if (this.debugMode) {
			console.log('[Canvas API]', ...args);
		}
	}

	/**
	 * Make an API request
	 */
	private async request<T>(
		method: string,
		endpoint: string,
		data?: Record<string, unknown>
	): Promise<T> {
		const url = `${this.apiUrl}/api/v1${endpoint}`;

		const params: RequestUrlParam = {
			url,
			method,
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
				'Content-Type': 'application/json',
			},
		};

		if (data && (method === 'POST' || method === 'PUT')) {
			params.body = JSON.stringify(data);
		}

		this.log(`${method} ${endpoint}`, data);

		try {
			const response = await requestUrl(params);
			this.log('Response:', response.status, response.json);
			return response.json as T;
		} catch (error) {
			this.log('Error:', error);
			throw error;
		}
	}

	/**
	 * Test the API connection
	 */
	async testConnection(): Promise<{ success: boolean; userName?: string; error?: string }> {
		try {
			const user = await this.request<{ name: string }>('GET', '/users/self');
			return { success: true, userName: user.name };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Get course information
	 */
	async getCourse(courseId: number): Promise<CanvasCourse> {
		return this.request<CanvasCourse>('GET', `/courses/${courseId}`);
	}

	// --- Pages ---

	/**
	 * Get all pages in a course
	 */
	async getPages(courseId: number): Promise<CanvasPage[]> {
		return this.request<CanvasPage[]>('GET', `/courses/${courseId}/pages?per_page=100`);
	}

	/**
	 * Get a specific page by URL slug
	 */
	async getPage(courseId: number, urlSlug: string): Promise<CanvasPage | null> {
		try {
			return await this.request<CanvasPage>('GET', `/courses/${courseId}/pages/${urlSlug}`);
		} catch {
			return null;
		}
	}

	/**
	 * Create a new page
	 */
	async createPage(
		courseId: number,
		title: string,
		body: string,
		published = true
	): Promise<CanvasPage> {
		return this.request<CanvasPage>('POST', `/courses/${courseId}/pages`, {
			wiki_page: {
				title,
				body,
				published,
			},
		});
	}

	/**
	 * Update an existing page
	 */
	async updatePage(
		courseId: number,
		urlSlug: string,
		body: string,
		published?: boolean
	): Promise<CanvasPage> {
		const data: Record<string, unknown> = { body };
		if (published !== undefined) {
			data.published = published;
		}
		return this.request<CanvasPage>('PUT', `/courses/${courseId}/pages/${urlSlug}`, {
			wiki_page: data,
		});
	}

	/**
	 * Create or update a page
	 */
	async upsertPage(
		courseId: number,
		title: string,
		body: string,
		published = true
	): Promise<{ page: CanvasPage; created: boolean }> {
		const slug = this.titleToSlug(title);
		const existing = await this.getPage(courseId, slug);

		if (existing) {
			const page = await this.updatePage(courseId, slug, body, published);
			return { page, created: false };
		} else {
			const page = await this.createPage(courseId, title, body, published);
			return { page, created: true };
		}
	}

	// --- Discussions ---

	/**
	 * Get all discussion topics in a course
	 */
	async getDiscussions(courseId: number): Promise<CanvasDiscussion[]> {
		return this.request<CanvasDiscussion[]>(
			'GET',
			`/courses/${courseId}/discussion_topics?per_page=100`
		);
	}

	/**
	 * Get a discussion by title
	 */
	async getDiscussionByTitle(courseId: number, title: string): Promise<CanvasDiscussion | null> {
		const discussions = await this.getDiscussions(courseId);
		return discussions.find((d) => d.title === title || d.title.includes(title)) ?? null;
	}

	/**
	 * Create a new discussion topic
	 */
	async createDiscussion(
		courseId: number,
		title: string,
		message: string,
		options: {
			published?: boolean;
			discussionType?: 'side_comment' | 'threaded';
			allowRating?: boolean;
		} = {}
	): Promise<CanvasDiscussion> {
		return this.request<CanvasDiscussion>('POST', `/courses/${courseId}/discussion_topics`, {
			title,
			message,
			published: options.published ?? true,
			discussion_type: options.discussionType ?? 'threaded',
			allow_rating: options.allowRating ?? false,
		});
	}

	/**
	 * Update an existing discussion topic
	 */
	async updateDiscussion(
		courseId: number,
		discussionId: number,
		message: string,
		published?: boolean
	): Promise<CanvasDiscussion> {
		const data: Record<string, unknown> = { message };
		if (published !== undefined) {
			data.published = published;
		}
		return this.request<CanvasDiscussion>(
			'PUT',
			`/courses/${courseId}/discussion_topics/${discussionId}`,
			data
		);
	}

	/**
	 * Create or update a discussion
	 */
	async upsertDiscussion(
		courseId: number,
		title: string,
		message: string,
		options: {
			published?: boolean;
			discussionType?: 'side_comment' | 'threaded';
		} = {}
	): Promise<{ discussion: CanvasDiscussion; created: boolean }> {
		const existing = await this.getDiscussionByTitle(courseId, title);

		if (existing) {
			const discussion = await this.updateDiscussion(
				courseId,
				existing.id,
				message,
				options.published
			);
			return { discussion, created: false };
		} else {
			const discussion = await this.createDiscussion(courseId, title, message, options);
			return { discussion, created: true };
		}
	}

	// --- Modules ---

	/**
	 * Get all modules in a course
	 */
	async getModules(courseId: number): Promise<CanvasModule[]> {
		return this.request<CanvasModule[]>('GET', `/courses/${courseId}/modules?per_page=100`);
	}

	/**
	 * Get a module by name
	 */
	async getModuleByName(courseId: number, name: string): Promise<CanvasModule | null> {
		const modules = await this.getModules(courseId);
		return modules.find((m) => m.name === name) ?? null;
	}

	/**
	 * Create a new module
	 */
	async createModule(
		courseId: number,
		name: string,
		position: number,
		published = true
	): Promise<CanvasModule> {
		return this.request<CanvasModule>('POST', `/courses/${courseId}/modules`, {
			module: {
				name,
				position,
				published,
			},
		});
	}

	/**
	 * Update a module
	 */
	async updateModule(
		courseId: number,
		moduleId: number,
		data: { name?: string; position?: number; published?: boolean }
	): Promise<CanvasModule> {
		return this.request<CanvasModule>('PUT', `/courses/${courseId}/modules/${moduleId}`, {
			module: data,
		});
	}

	/**
	 * Create or update a module
	 */
	async upsertModule(
		courseId: number,
		name: string,
		position: number,
		published = true
	): Promise<{ module: CanvasModule; created: boolean }> {
		const existing = await this.getModuleByName(courseId, name);

		if (existing) {
			const module = await this.updateModule(courseId, existing.id, { position, published });
			return { module, created: false };
		} else {
			const module = await this.createModule(courseId, name, position, published);
			return { module, created: true };
		}
	}

	/**
	 * Get items in a module
	 */
	async getModuleItems(courseId: number, moduleId: number): Promise<CanvasModuleItem[]> {
		return this.request<CanvasModuleItem[]>(
			'GET',
			`/courses/${courseId}/modules/${moduleId}/items?per_page=100`
		);
	}

	/**
	 * Add a page to a module
	 */
	async addPageToModule(
		courseId: number,
		moduleId: number,
		pageUrl: string,
		position?: number
	): Promise<CanvasModuleItem> {
		const data: Record<string, unknown> = {
			type: 'Page',
			page_url: pageUrl,
		};
		if (position !== undefined) {
			data.position = position;
		}
		return this.request<CanvasModuleItem>(
			'POST',
			`/courses/${courseId}/modules/${moduleId}/items`,
			{ module_item: data }
		);
	}

	/**
	 * Add a discussion to a module
	 */
	async addDiscussionToModule(
		courseId: number,
		moduleId: number,
		discussionId: number,
		position?: number
	): Promise<CanvasModuleItem> {
		const data: Record<string, unknown> = {
			type: 'Discussion',
			content_id: discussionId,
		};
		if (position !== undefined) {
			data.position = position;
		}
		return this.request<CanvasModuleItem>(
			'POST',
			`/courses/${courseId}/modules/${moduleId}/items`,
			{ module_item: data }
		);
	}

	// --- Utilities ---

	/**
	 * Convert a title to a URL slug
	 */
	titleToSlug(title: string): string {
		return title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}
}
