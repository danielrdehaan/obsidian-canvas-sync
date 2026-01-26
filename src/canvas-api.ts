import { requestUrl, RequestUrlParam } from 'obsidian';
import type {
	CanvasPage,
	CanvasDiscussion,
	CanvasAssignment,
	CanvasAssignmentGroup,
	CanvasModule,
	CanvasModuleItem,
	CanvasCourse,
	CreateAssignmentData,
	UpdateAssignmentData,
	CanvasFile,
	CanvasFolder,
	CanvasFileUploadParams,
	CanvasFileUploadResponse,
	CanvasApiErrorType,
	ApiResilienceSettings,
} from './types';

/**
 * Default resilience settings
 */
export const DEFAULT_RESILIENCE_SETTINGS: ApiResilienceSettings = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	timeoutMs: 30000,
};

/**
 * Custom error class for Canvas API errors with retry metadata
 */
export class CanvasApiError extends Error {
	readonly type: CanvasApiErrorType;
	readonly statusCode?: number;
	readonly retryable: boolean;
	readonly retryAfter?: number;

	constructor(
		message: string,
		type: CanvasApiErrorType,
		statusCode?: number,
		retryAfter?: number
	) {
		super(message);
		this.name = 'CanvasApiError';
		this.type = type;
		this.statusCode = statusCode;
		this.retryAfter = retryAfter;

		// Determine if this error is retryable
		this.retryable = type === 'network' || type === 'rate_limited' || type === 'server_error' || type === 'timeout';
	}

	/**
	 * Create a CanvasApiError from an HTTP response status
	 */
	static fromResponse(status: number, message: string, retryAfterHeader?: string): CanvasApiError {
		let type: CanvasApiErrorType;
		let retryAfter: number | undefined;

		if (status === 401) {
			type = 'auth';
		} else if (status === 403) {
			type = 'forbidden';
		} else if (status === 404) {
			type = 'not_found';
		} else if (status === 429) {
			type = 'rate_limited';
			// Parse Retry-After header if present (in seconds)
			if (retryAfterHeader) {
				const parsed = parseInt(retryAfterHeader, 10);
				if (!isNaN(parsed)) {
					retryAfter = parsed * 1000; // Convert to milliseconds
				}
			}
		} else if (status >= 400 && status < 500) {
			type = 'client_error';
		} else if (status >= 500) {
			type = 'server_error';
		} else {
			type = 'unknown';
		}

		return new CanvasApiError(message, type, status, retryAfter);
	}

	/**
	 * Create a CanvasApiError from a network/fetch error
	 */
	static fromNetworkError(error: unknown): CanvasApiError {
		const message = error instanceof Error ? error.message : String(error);

		// Check if it's a timeout
		if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('aborted')) {
			return new CanvasApiError(`Request timed out: ${message}`, 'timeout');
		}

		// Check if the error message contains an HTTP status code (e.g., "Request failed, status 404")
		// Obsidian's requestUrl throws errors with status codes in the message for non-2xx responses
		const statusMatch = message.match(/status[:\s]+(\d{3})/i);
		if (statusMatch) {
			const status = parseInt(statusMatch[1], 10);
			return CanvasApiError.fromResponse(status, message);
		}

		return new CanvasApiError(`Network error: ${message}`, 'network');
	}
}

/**
 * Canvas LMS API client
 */
export class CanvasApi {
	private apiUrl: string;
	private apiToken: string;
	private debugMode: boolean;
	private resilienceSettings: ApiResilienceSettings;

	constructor(apiUrl: string, apiToken: string, debugMode = false) {
		this.apiUrl = apiUrl.replace(/\/$/, '');
		this.apiToken = apiToken;
		this.debugMode = debugMode;
		this.resilienceSettings = { ...DEFAULT_RESILIENCE_SETTINGS };
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
	 * Update resilience settings
	 */
	setResilienceSettings(settings: Partial<ApiResilienceSettings>): void {
		this.resilienceSettings = { ...this.resilienceSettings, ...settings };
	}

	/**
	 * Get current resilience settings
	 */
	getResilienceSettings(): ApiResilienceSettings {
		return { ...this.resilienceSettings };
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
	 * Make an API request with retry logic and timeout
	 */
	private async request<T>(
		method: string,
		endpoint: string,
		data?: Record<string, unknown>
	): Promise<T> {
		const url = `${this.apiUrl}/api/v1${endpoint}`;
		const { maxRetries, baseDelayMs, maxDelayMs, timeoutMs } = this.resilienceSettings;

		let lastError: CanvasApiError | Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

			this.log(`${method} ${endpoint} (attempt ${attempt + 1}/${maxRetries + 1})`, data);

			try {
				// Create timeout promise
				const timeoutPromise = new Promise<never>((_, reject) => {
					setTimeout(() => {
						reject(new CanvasApiError(`Request timed out after ${timeoutMs}ms`, 'timeout'));
					}, timeoutMs);
				});

				// Race between request and timeout
				const response = await Promise.race([
					requestUrl(params),
					timeoutPromise,
				]);

				this.log('Response:', response.status, response.json);

				// Check for error status codes
				if (response.status >= 400) {
					const retryAfterHeader = response.headers?.['retry-after'] || response.headers?.['Retry-After'];
					throw CanvasApiError.fromResponse(
						response.status,
						`HTTP ${response.status}: ${JSON.stringify(response.json)}`,
						retryAfterHeader
					);
				}

				return response.json as T;
			} catch (error) {
				// Convert to CanvasApiError if needed
				if (!(error instanceof CanvasApiError)) {
					lastError = CanvasApiError.fromNetworkError(error);
				} else {
					lastError = error;
				}

				this.log(`Error (attempt ${attempt + 1}):`, lastError.message, `retryable: ${(lastError as CanvasApiError).retryable}`);

				// Check if we should retry
				const canvasError = lastError as CanvasApiError;
				if (!canvasError.retryable || attempt >= maxRetries) {
					throw lastError;
				}

				// Calculate delay with exponential backoff and jitter
				let delay: number;
				if (canvasError.retryAfter) {
					// Use Retry-After header if provided
					delay = canvasError.retryAfter;
				} else {
					// Exponential backoff: baseDelay * 2^attempt + jitter
					const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
					const jitter = Math.random() * baseDelayMs * 0.5;
					delay = Math.min(exponentialDelay + jitter, maxDelayMs);
				}

				this.log(`Retrying in ${Math.round(delay)}ms...`);
				await this.sleep(delay);
			}
		}

		// Should not reach here, but just in case
		throw lastError || new CanvasApiError('Request failed', 'unknown');
	}

	/**
	 * Sleep for a specified duration
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
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
	 * Returns null for 404 (page not found), throws for other errors
	 */
	async getPage(courseId: number, urlSlug: string): Promise<CanvasPage | null> {
		try {
			return await this.request<CanvasPage>('GET', `/courses/${courseId}/pages/${urlSlug}`);
		} catch (error) {
			// Only return null for 404 (not found) - all other errors should propagate
			if (error instanceof CanvasApiError && error.type === 'not_found') {
				return null;
			}
			throw error;
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
		published?: boolean,
		title?: string
	): Promise<CanvasPage> {
		const data: Record<string, unknown> = { body };
		if (published !== undefined) {
			data.published = published;
		}
		if (title !== undefined) {
			data.title = title;
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
		published = true,
		existingSlug?: string
	): Promise<{ page: CanvasPage; created: boolean }> {
		// Use existing slug if provided (for title renames), otherwise derive from title
		const lookupSlug = existingSlug || this.titleToSlug(title);
		const existing = await this.getPage(courseId, lookupSlug);

		if (existing) {
			// Update existing page, including the new title if it changed
			const page = await this.updatePage(courseId, lookupSlug, body, published, title);
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

	// --- Graded Discussions ---
	// A graded discussion is created via the discussion_topics endpoint with an assignment object

	/**
	 * Create a graded discussion (discussion topic with grading enabled)
	 */
	async createGradedDiscussion(
		courseId: number,
		title: string,
		message: string,
		options: {
			points?: number;
			dueAt?: string | null;
			lockAt?: string | null;
			unlockAt?: string | null;
			published?: boolean;
			discussionType?: 'side_comment' | 'threaded';
			assignmentGroupId?: number;
		} = {}
	): Promise<CanvasDiscussion> {
		// Create a discussion topic with an embedded assignment to make it graded
		const assignmentData: Record<string, unknown> = {
			name: title,
			points_possible: options.points ?? 0,
			due_at: options.dueAt ?? null,
			lock_at: options.lockAt ?? null,
			unlock_at: options.unlockAt ?? null,
			published: options.published ?? true,
			grading_type: 'points',
		};
		if (options.assignmentGroupId !== undefined) {
			assignmentData.assignment_group_id = options.assignmentGroupId;
		}
		return this.request<CanvasDiscussion>('POST', `/courses/${courseId}/discussion_topics`, {
			title,
			message,
			published: options.published ?? true,
			discussion_type: options.discussionType ?? 'threaded',
			// Including assignment object makes the discussion graded
			assignment: assignmentData,
		});
	}

	/**
	 * Update a graded discussion
	 * Updates both the discussion content and the assignment settings
	 */
	async updateGradedDiscussion(
		courseId: number,
		discussionId: number,
		message: string,
		options: {
			points?: number;
			dueAt?: string | null;
			lockAt?: string | null;
			unlockAt?: string | null;
			published?: boolean;
			assignmentGroupId?: number;
		} = {}
	): Promise<CanvasDiscussion> {
		const data: Record<string, unknown> = { message };
		if (options.published !== undefined) {
			data.published = options.published;
		}

		// Update the discussion content
		const discussion = await this.request<CanvasDiscussion>(
			'PUT',
			`/courses/${courseId}/discussion_topics/${discussionId}`,
			data
		);

		// If the discussion has an assignment, update the assignment settings too
		if (discussion.assignment?.id) {
			const assignmentData: Record<string, unknown> = {};
			if (options.points !== undefined) assignmentData.points_possible = options.points;
			if (options.dueAt !== undefined) assignmentData.due_at = options.dueAt;
			if (options.lockAt !== undefined) assignmentData.lock_at = options.lockAt;
			if (options.unlockAt !== undefined) assignmentData.unlock_at = options.unlockAt;
			if (options.published !== undefined) assignmentData.published = options.published;
			if (options.assignmentGroupId !== undefined) assignmentData.assignment_group_id = options.assignmentGroupId;

			if (Object.keys(assignmentData).length > 0) {
				await this.request<CanvasAssignment>(
					'PUT',
					`/courses/${courseId}/assignments/${discussion.assignment.id}`,
					{ assignment: assignmentData }
				);
			}
		}

		return discussion;
	}

	/**
	 * Find a graded discussion by title
	 * Graded discussions have an assignment property
	 */
	async getGradedDiscussionByTitle(courseId: number, title: string): Promise<CanvasDiscussion | null> {
		const discussions = await this.getDiscussions(courseId);
		return discussions.find(
			(d) => (d.title === title || d.title.includes(title)) && d.assignment
		) ?? null;
	}

	/**
	 * Create or update a graded discussion
	 */
	async upsertGradedDiscussion(
		courseId: number,
		title: string,
		message: string,
		options: {
			points?: number;
			dueAt?: string | null;
			lockAt?: string | null;
			unlockAt?: string | null;
			published?: boolean;
			discussionType?: 'side_comment' | 'threaded';
			assignmentGroupId?: number;
		} = {}
	): Promise<{ discussion: CanvasDiscussion; created: boolean }> {
		const existing = await this.getGradedDiscussionByTitle(courseId, title);

		if (existing) {
			const discussion = await this.updateGradedDiscussion(courseId, existing.id, message, options);
			return { discussion, created: false };
		} else {
			const discussion = await this.createGradedDiscussion(courseId, title, message, options);
			return { discussion, created: true };
		}
	}

	// --- Assignments ---

	/**
	 * Get all assignments in a course
	 */
	async getAssignments(courseId: number): Promise<CanvasAssignment[]> {
		return this.request<CanvasAssignment[]>(
			'GET',
			`/courses/${courseId}/assignments?per_page=100`
		);
	}

	/**
	 * Get an assignment by name
	 */
	async getAssignmentByName(courseId: number, name: string): Promise<CanvasAssignment | null> {
		const assignments = await this.getAssignments(courseId);
		return assignments.find((a) => a.name === name) ?? null;
	}

	/**
	 * Create a new assignment
	 */
	async createAssignment(
		courseId: number,
		data: CreateAssignmentData
	): Promise<CanvasAssignment> {
		const assignmentData: Record<string, unknown> = {
			name: data.name,
			description: data.description ?? '',
			points_possible: data.points_possible ?? 0,
			due_at: data.due_at ?? null,
			lock_at: data.lock_at ?? null,
			unlock_at: data.unlock_at ?? null,
			submission_types: data.submission_types ?? ['online_upload', 'online_text_entry'],
			allowed_extensions: data.allowed_extensions,
			grading_type: data.grading_type ?? 'points',
			published: data.published ?? true,
		};
		if (data.assignment_group_id !== undefined) {
			assignmentData.assignment_group_id = data.assignment_group_id;
		}
		return this.request<CanvasAssignment>('POST', `/courses/${courseId}/assignments`, {
			assignment: assignmentData,
		});
	}

	/**
	 * Update an existing assignment
	 */
	async updateAssignment(
		courseId: number,
		assignmentId: number,
		data: UpdateAssignmentData
	): Promise<CanvasAssignment> {
		const updateData: Record<string, unknown> = {};

		if (data.name !== undefined) updateData.name = data.name;
		if (data.description !== undefined) updateData.description = data.description;
		if (data.points_possible !== undefined) updateData.points_possible = data.points_possible;
		if (data.due_at !== undefined) updateData.due_at = data.due_at;
		if (data.lock_at !== undefined) updateData.lock_at = data.lock_at;
		if (data.unlock_at !== undefined) updateData.unlock_at = data.unlock_at;
		if (data.submission_types !== undefined) updateData.submission_types = data.submission_types;
		if (data.allowed_extensions !== undefined) updateData.allowed_extensions = data.allowed_extensions;
		if (data.grading_type !== undefined) updateData.grading_type = data.grading_type;
		if (data.published !== undefined) updateData.published = data.published;
		if (data.assignment_group_id !== undefined) updateData.assignment_group_id = data.assignment_group_id;

		return this.request<CanvasAssignment>(
			'PUT',
			`/courses/${courseId}/assignments/${assignmentId}`,
			{ assignment: updateData }
		);
	}

	/**
	 * Create or update an assignment
	 */
	async upsertAssignment(
		courseId: number,
		data: CreateAssignmentData
	): Promise<{ assignment: CanvasAssignment; created: boolean }> {
		const existing = await this.getAssignmentByName(courseId, data.name);

		if (existing) {
			const assignment = await this.updateAssignment(courseId, existing.id, data);
			return { assignment, created: false };
		} else {
			const assignment = await this.createAssignment(courseId, data);
			return { assignment, created: true };
		}
	}

	// --- Assignment Groups ---

	/**
	 * Get all assignment groups in a course
	 */
	async getAssignmentGroups(courseId: number): Promise<CanvasAssignmentGroup[]> {
		return this.request<CanvasAssignmentGroup[]>(
			'GET',
			`/courses/${courseId}/assignment_groups?per_page=100`
		);
	}

	/**
	 * Get an assignment group by name
	 */
	async getAssignmentGroupByName(courseId: number, name: string): Promise<CanvasAssignmentGroup | null> {
		const groups = await this.getAssignmentGroups(courseId);
		return groups.find((g) => g.name === name) ?? null;
	}

	/**
	 * Create a new assignment group
	 */
	async createAssignmentGroup(
		courseId: number,
		name: string,
		position?: number
	): Promise<CanvasAssignmentGroup> {
		const data: Record<string, unknown> = { name };
		if (position !== undefined) {
			data.position = position;
		}
		return this.request<CanvasAssignmentGroup>(
			'POST',
			`/courses/${courseId}/assignment_groups`,
			data
		);
	}

	/**
	 * Get or create an assignment group by name
	 */
	async upsertAssignmentGroup(
		courseId: number,
		name: string
	): Promise<{ group: CanvasAssignmentGroup; created: boolean }> {
		const existing = await this.getAssignmentGroupByName(courseId, name);

		if (existing) {
			return { group: existing, created: false };
		} else {
			const group = await this.createAssignmentGroup(courseId, name);
			return { group, created: true };
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
			// Create the module first
			let module = await this.createModule(courseId, name, position, published);
			// Canvas ignores 'published' on POST, so we need a follow-up PUT to actually publish
			if (published && !module.published) {
				module = await this.updateModule(courseId, module.id, { published: true });
			}
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

	/**
	 * Add an assignment to a module
	 */
	async addAssignmentToModule(
		courseId: number,
		moduleId: number,
		assignmentId: number,
		position?: number
	): Promise<CanvasModuleItem> {
		const data: Record<string, unknown> = {
			type: 'Assignment',
			content_id: assignmentId,
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
	 * Add an external URL to a module
	 */
	async addExternalUrlToModule(
		courseId: number,
		moduleId: number,
		title: string,
		externalUrl: string,
		position?: number,
		newTab = true
	): Promise<CanvasModuleItem> {
		const data: Record<string, unknown> = {
			type: 'ExternalUrl',
			title,
			external_url: externalUrl,
			new_tab: newTab,
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

	// --- Syllabus ---

	/**
	 * Update the course syllabus body
	 * The syllabus is a special course-level field, not a separate content type
	 */
	async updateSyllabus(courseId: number, body: string): Promise<void> {
		await this.request<CanvasCourse>('PUT', `/courses/${courseId}`, {
			course: {
				syllabus_body: body,
			},
		});
	}

	// --- Files ---

	/**
	 * Get all folders in a course
	 */
	async getFolders(courseId: number): Promise<CanvasFolder[]> {
		return this.request<CanvasFolder[]>(
			'GET',
			`/courses/${courseId}/folders?per_page=100`
		);
	}

	/**
	 * Get a folder by path
	 * Returns null for 404 (folder not found), throws for other errors
	 */
	async getFolderByPath(courseId: number, folderPath: string): Promise<CanvasFolder | null> {
		try {
			// Canvas API expects URL-encoded path
			const encodedPath = encodeURIComponent(folderPath);
			return await this.request<CanvasFolder>(
				'GET',
				`/courses/${courseId}/folders/by_path/${encodedPath}`
			);
		} catch (error) {
			// Only return null for 404 (not found) - all other errors should propagate
			if (error instanceof CanvasApiError && error.type === 'not_found') {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Create a folder in a course
	 */
	async createFolder(
		courseId: number,
		name: string,
		parentFolderId?: number
	): Promise<CanvasFolder> {
		const data: Record<string, unknown> = {
			name,
			locked: false,
		};
		if (parentFolderId !== undefined) {
			data.parent_folder_id = parentFolderId;
		}
		return this.request<CanvasFolder>(
			'POST',
			`/courses/${courseId}/folders`,
			data
		);
	}

	/**
	 * Get or create a folder hierarchy in a course
	 * @param courseId - Canvas course ID
	 * @param folderPath - Full folder path (e.g., "canvas-sync/images")
	 * @returns The deepest folder in the hierarchy
	 */
	async getOrCreateFolder(courseId: number, folderPath: string): Promise<CanvasFolder> {
		// First, try to get the folder directly
		const existing = await this.getFolderByPath(courseId, folderPath);
		if (existing) {
			this.log(`Folder exists: ${folderPath}`);
			return existing;
		}

		// Get all existing folders to find parent folders
		const allFolders = await this.getFolders(courseId);
		const foldersByPath = new Map<string, CanvasFolder>();
		for (const folder of allFolders) {
			foldersByPath.set(folder.full_name, folder);
		}

		// Split path and create folders as needed
		const parts = folderPath.split('/').filter((p) => p);
		let currentPath = '';
		let parentFolderId: number | undefined = undefined;

		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const fullPath = `course files/${currentPath}`;

			if (foldersByPath.has(fullPath)) {
				const folder = foldersByPath.get(fullPath)!;
				parentFolderId = folder.id;
				this.log(`Folder exists: ${fullPath} (id: ${folder.id})`);
			} else {
				// Create this folder
				this.log(`Creating folder: ${part} (parent: ${parentFolderId})`);
				const newFolder = await this.createFolder(courseId, part, parentFolderId);
				foldersByPath.set(`course files/${currentPath}`, newFolder);
				parentFolderId = newFolder.id;
			}
		}

		// Return the final folder
		const finalPath = `course files/${folderPath}`;
		return foldersByPath.get(finalPath)!;
	}

	/**
	 * Initiate a file upload (Step 1 of Canvas file upload process)
	 */
	async initiateFileUpload(
		courseId: number,
		params: CanvasFileUploadParams
	): Promise<CanvasFileUploadResponse> {
		const data: Record<string, unknown> = {
			name: params.name,
			size: params.size,
			content_type: params.content_type,
			on_duplicate: params.on_duplicate || 'overwrite',
		};

		if (params.parent_folder_id !== undefined) {
			data.parent_folder_id = params.parent_folder_id;
		} else if (params.parent_folder_path !== undefined) {
			data.parent_folder_path = params.parent_folder_path;
		}

		return this.request<CanvasFileUploadResponse>(
			'POST',
			`/courses/${courseId}/files`,
			data
		);
	}

	/**
	 * Upload file data (Step 2 of Canvas file upload process)
	 * Uses multipart/form-data format
	 * @returns The Location header URL for confirmation
	 */
	async uploadFileData(
		uploadUrl: string,
		uploadParams: Record<string, string>,
		fileData: ArrayBuffer,
		filename: string,
		contentType: string
	): Promise<string> {
		// Build multipart form data manually
		const boundary = `----CanvasSyncBoundary${Date.now()}`;
		const body = this.buildMultipartBody(boundary, uploadParams, fileData, filename, contentType);

		this.log(`Uploading to ${uploadUrl}, body size: ${body.byteLength}`);

		const response = await requestUrl({
			url: uploadUrl,
			method: 'POST',
			headers: {
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body: body,
			throw: false,
		});

		this.log(`Upload response: status=${response.status}`);

		// Canvas returns a 3xx redirect with Location header
		// OR a 201 with the file object directly
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers['location'] || response.headers['Location'];
			if (location) {
				return location;
			}
		}

		// If we got a successful response with JSON, the file is already confirmed
		if (response.status >= 200 && response.status < 300) {
			if (response.json?.id) {
				// Return a special marker indicating no confirmation needed
				return `__ALREADY_CONFIRMED__:${response.json.id}`;
			}
		}

		throw new Error(`Upload failed with status ${response.status}: ${response.text}`);
	}

	/**
	 * Confirm file upload (Step 3 of Canvas file upload process)
	 */
	async confirmFileUpload(locationUrl: string): Promise<CanvasFile> {
		// Check if already confirmed (from uploadFileData)
		if (locationUrl.startsWith('__ALREADY_CONFIRMED__:')) {
			const fileId = parseInt(locationUrl.split(':')[1], 10);
			// Fetch the file details
			const file = await this.request<CanvasFile>('GET', `/files/${fileId}`);
			return file;
		}

		this.log(`Confirming upload at: ${locationUrl}`);

		const response = await requestUrl({
			url: locationUrl,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiToken}`,
			},
		});

		this.log(`Confirm response: status=${response.status}`);
		return response.json as CanvasFile;
	}

	/**
	 * Upload a file to a Canvas course (combines all 3 steps)
	 * @param courseId - Canvas course ID
	 * @param filename - Name for the file in Canvas
	 * @param fileData - Binary file data
	 * @param contentType - MIME type (e.g., "image/png")
	 * @param folderId - Optional folder ID to upload to
	 * @param folderPath - Optional folder path (if folderId not provided)
	 */
	async uploadFile(
		courseId: number,
		filename: string,
		fileData: ArrayBuffer,
		contentType: string,
		folderId?: number,
		folderPath?: string
	): Promise<CanvasFile> {
		// Step 1: Initiate upload
		const params: CanvasFileUploadParams = {
			name: filename,
			size: fileData.byteLength,
			content_type: contentType,
			on_duplicate: 'overwrite',
		};

		if (folderId !== undefined) {
			params.parent_folder_id = folderId;
		} else if (folderPath !== undefined) {
			params.parent_folder_path = folderPath;
		}

		this.log(`Step 1: Initiating upload for ${filename} (${fileData.byteLength} bytes)`);
		const initResponse = await this.initiateFileUpload(courseId, params);

		// Step 2: Upload file data
		this.log(`Step 2: Uploading data to ${initResponse.upload_url}`);
		const locationUrl = await this.uploadFileData(
			initResponse.upload_url,
			initResponse.upload_params,
			fileData,
			filename,
			contentType
		);

		// Step 3: Confirm upload
		this.log(`Step 3: Confirming upload`);
		const file = await this.confirmFileUpload(locationUrl);

		this.log(`Upload complete: ${file.display_name} (id: ${file.id})`);
		return file;
	}

	/**
	 * Build multipart/form-data body as ArrayBuffer
	 */
	private buildMultipartBody(
		boundary: string,
		params: Record<string, string>,
		fileData: ArrayBuffer,
		filename: string,
		contentType: string
	): ArrayBuffer {
		const encoder = new TextEncoder();
		const parts: Uint8Array[] = [];

		// Add each form field
		for (const [key, value] of Object.entries(params)) {
			const fieldPart = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
			parts.push(encoder.encode(fieldPart));
		}

		// Add file field
		const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
		parts.push(encoder.encode(fileHeader));
		parts.push(new Uint8Array(fileData));
		parts.push(encoder.encode('\r\n'));

		// Add closing boundary
		const closing = `--${boundary}--\r\n`;
		parts.push(encoder.encode(closing));

		// Calculate total length
		let totalLength = 0;
		for (const part of parts) {
			totalLength += part.length;
		}

		// Combine all parts
		const combined = new Uint8Array(totalLength);
		let offset = 0;
		for (const part of parts) {
			combined.set(part, offset);
			offset += part.length;
		}

		return combined.buffer;
	}

	/**
	 * Get a file by ID
	 */
	async getFile(fileId: number): Promise<CanvasFile> {
		return this.request<CanvasFile>('GET', `/files/${fileId}`);
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
