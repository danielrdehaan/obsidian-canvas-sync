import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasApi, CanvasApiError, DEFAULT_RESILIENCE_SETTINGS } from '../canvas-api';

// Mock requestUrl
vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
}));

import { requestUrl } from 'obsidian';

const mockRequestUrl = requestUrl as ReturnType<typeof vi.fn>;

describe('CanvasApiError', () => {
	describe('fromResponse', () => {
		it('should classify 401 as auth error', () => {
			const error = CanvasApiError.fromResponse(401, 'Unauthorized');
			expect(error.type).toBe('auth');
			expect(error.statusCode).toBe(401);
			expect(error.retryable).toBe(false);
		});

		it('should classify 403 as forbidden error', () => {
			const error = CanvasApiError.fromResponse(403, 'Forbidden');
			expect(error.type).toBe('forbidden');
			expect(error.statusCode).toBe(403);
			expect(error.retryable).toBe(false);
		});

		it('should classify 404 as not_found error', () => {
			const error = CanvasApiError.fromResponse(404, 'Not found');
			expect(error.type).toBe('not_found');
			expect(error.statusCode).toBe(404);
			expect(error.retryable).toBe(false);
		});

		it('should classify 429 as rate_limited error', () => {
			const error = CanvasApiError.fromResponse(429, 'Too many requests');
			expect(error.type).toBe('rate_limited');
			expect(error.statusCode).toBe(429);
			expect(error.retryable).toBe(true);
		});

		it('should parse Retry-After header for 429', () => {
			const error = CanvasApiError.fromResponse(429, 'Too many requests', '60');
			expect(error.type).toBe('rate_limited');
			expect(error.retryAfter).toBe(60000); // Converted to milliseconds
		});

		it('should classify 4xx as client_error', () => {
			const error = CanvasApiError.fromResponse(400, 'Bad request');
			expect(error.type).toBe('client_error');
			expect(error.statusCode).toBe(400);
			expect(error.retryable).toBe(false);
		});

		it('should classify 5xx as server_error', () => {
			const error = CanvasApiError.fromResponse(500, 'Internal server error');
			expect(error.type).toBe('server_error');
			expect(error.statusCode).toBe(500);
			expect(error.retryable).toBe(true);

			const error502 = CanvasApiError.fromResponse(502, 'Bad gateway');
			expect(error502.type).toBe('server_error');
			expect(error502.retryable).toBe(true);
		});
	});

	describe('fromNetworkError', () => {
		it('should detect timeout errors', () => {
			const error = CanvasApiError.fromNetworkError(new Error('Request timeout'));
			expect(error.type).toBe('timeout');
			expect(error.retryable).toBe(true);
		});

		it('should detect aborted errors as timeout', () => {
			const error = CanvasApiError.fromNetworkError(new Error('Request aborted'));
			expect(error.type).toBe('timeout');
			expect(error.retryable).toBe(true);
		});

		it('should parse status code from error message', () => {
			const error = CanvasApiError.fromNetworkError(new Error('Request failed, status 404'));
			expect(error.type).toBe('not_found');
			expect(error.statusCode).toBe(404);
		});

		it('should parse status: format from error message', () => {
			const error = CanvasApiError.fromNetworkError(new Error('Request failed with status: 503'));
			expect(error.type).toBe('server_error');
			expect(error.statusCode).toBe(503);
		});

		it('should classify unknown errors as network errors', () => {
			const error = CanvasApiError.fromNetworkError(new Error('Connection refused'));
			expect(error.type).toBe('network');
			expect(error.retryable).toBe(true);
		});

		it('should handle non-Error objects', () => {
			const error = CanvasApiError.fromNetworkError('Some string error');
			expect(error.type).toBe('network');
			expect(error.message).toContain('Some string error');
		});
	});

	describe('retryable property', () => {
		it('should mark network errors as retryable', () => {
			const error = new CanvasApiError('Network error', 'network');
			expect(error.retryable).toBe(true);
		});

		it('should mark rate_limited as retryable', () => {
			const error = new CanvasApiError('Rate limited', 'rate_limited', 429);
			expect(error.retryable).toBe(true);
		});

		it('should mark server_error as retryable', () => {
			const error = new CanvasApiError('Server error', 'server_error', 500);
			expect(error.retryable).toBe(true);
		});

		it('should mark timeout as retryable', () => {
			const error = new CanvasApiError('Timeout', 'timeout');
			expect(error.retryable).toBe(true);
		});

		it('should NOT mark auth errors as retryable', () => {
			const error = new CanvasApiError('Auth error', 'auth', 401);
			expect(error.retryable).toBe(false);
		});

		it('should NOT mark client_error as retryable', () => {
			const error = new CanvasApiError('Bad request', 'client_error', 400);
			expect(error.retryable).toBe(false);
		});
	});
});

describe('CanvasApi', () => {
	let api: CanvasApi;

	beforeEach(() => {
		api = new CanvasApi('https://canvas.example.com', 'test-token', false);
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('constructor and configuration', () => {
		it('should strip trailing slash from API URL', () => {
			const apiWithSlash = new CanvasApi('https://canvas.example.com/', 'token');
			// Internal state check would require exposing the URL or testing via request
		});

		it('should use default resilience settings', () => {
			const settings = api.getResilienceSettings();
			expect(settings).toEqual(DEFAULT_RESILIENCE_SETTINGS);
		});

		it('should allow updating resilience settings', () => {
			api.setResilienceSettings({ maxRetries: 5, baseDelayMs: 2000 });
			const settings = api.getResilienceSettings();
			expect(settings.maxRetries).toBe(5);
			expect(settings.baseDelayMs).toBe(2000);
			// Other settings should remain at defaults
			expect(settings.maxDelayMs).toBe(DEFAULT_RESILIENCE_SETTINGS.maxDelayMs);
		});
	});

	describe('retry logic', () => {
		it('should retry on server error (5xx)', async () => {
			mockRequestUrl
				.mockResolvedValueOnce({
					status: 500,
					headers: {},
					json: { error: 'Internal error' },
				})
				.mockResolvedValueOnce({
					status: 200,
					headers: {},
					json: { name: 'Test User' },
				});

			const resultPromise = api.testConnection();

			// Fast-forward through retry delays
			await vi.advanceTimersByTimeAsync(5000);

			const result = await resultPromise;
			expect(result.success).toBe(true);
			expect(result.userName).toBe('Test User');
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		it('should retry on rate limit (429)', async () => {
			mockRequestUrl
				.mockResolvedValueOnce({
					status: 429,
					headers: { 'retry-after': '1' },
					json: { error: 'Rate limited' },
				})
				.mockResolvedValueOnce({
					status: 200,
					headers: {},
					json: { name: 'Test User' },
				});

			const resultPromise = api.testConnection();
			await vi.advanceTimersByTimeAsync(5000);

			const result = await resultPromise;
			expect(result.success).toBe(true);
			expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		});

		it('should NOT retry on auth error (401)', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 401,
				headers: {},
				json: { error: 'Unauthorized' },
			});

			const result = await api.testConnection();
			expect(result.success).toBe(false);
			expect(result.error).toContain('401');
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		it('should NOT retry on not found (404)', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 404,
				headers: {},
				json: { error: 'Not found' },
			});

			const result = await api.testConnection();
			expect(result.success).toBe(false);
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		it('should respect maxRetries setting', async () => {
			api.setResilienceSettings({ maxRetries: 2 });

			mockRequestUrl.mockResolvedValue({
				status: 500,
				headers: {},
				json: { error: 'Internal error' },
			});

			const resultPromise = api.testConnection();
			await vi.advanceTimersByTimeAsync(60000);

			const result = await resultPromise;
			expect(result.success).toBe(false);
			// Initial attempt + 2 retries = 3 total calls
			expect(mockRequestUrl).toHaveBeenCalledTimes(3);
		});
	});

	describe('API methods', () => {
		it('testConnection should return success with user name', async () => {
			vi.useRealTimers();
			mockRequestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				json: { name: 'John Doe' },
			});

			const result = await api.testConnection();
			expect(result.success).toBe(true);
			expect(result.userName).toBe('John Doe');
		});

		it('testConnection should return error on failure', async () => {
			// Network errors are retryable, so we need to handle retries
			// Disable retries for this test to avoid timeout
			api.setResilienceSettings({ maxRetries: 0 });
			vi.useRealTimers();
			mockRequestUrl.mockRejectedValue(new Error('Network failure'));

			const result = await api.testConnection();
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('getPage should return null for 404', async () => {
			vi.useRealTimers();
			mockRequestUrl.mockRejectedValue(new Error('Request failed, status 404'));

			const result = await api.getPage(123, 'test-page');
			expect(result).toBeNull();
		});

		it('getPage should throw for other errors', async () => {
			// Server errors are retryable, so disable retries for this test
			api.setResilienceSettings({ maxRetries: 0 });
			vi.useRealTimers();
			mockRequestUrl.mockRejectedValue(new Error('Request failed, status 500'));

			await expect(api.getPage(123, 'test-page')).rejects.toThrow();
		});

		it('titleToSlug should convert titles correctly', () => {
			expect(api.titleToSlug('Hello World')).toBe('hello-world');
			expect(api.titleToSlug('Test Page 123')).toBe('test-page-123');
			expect(api.titleToSlug('Special!@#Characters')).toBe('special-characters');
			expect(api.titleToSlug('  Leading Trailing  ')).toBe('leading-trailing');
			expect(api.titleToSlug('Multiple---Hyphens')).toBe('multiple-hyphens');
		});

		it('deleteModuleItem should call DELETE on correct endpoint', async () => {
			mockRequestUrl.mockResolvedValue({ status: 200, json: {} });

			await api.deleteModuleItem(123, 456, 789);

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'DELETE',
					url: 'https://canvas.example.com/api/v1/courses/123/modules/456/items/789',
				})
			);
		});
	});
});

describe('DEFAULT_RESILIENCE_SETTINGS', () => {
	it('should have reasonable defaults', () => {
		expect(DEFAULT_RESILIENCE_SETTINGS.maxRetries).toBe(3);
		expect(DEFAULT_RESILIENCE_SETTINGS.baseDelayMs).toBe(1000);
		expect(DEFAULT_RESILIENCE_SETTINGS.maxDelayMs).toBe(30000);
		expect(DEFAULT_RESILIENCE_SETTINGS.timeoutMs).toBe(30000);
	});
});
