import { requestUrl, RequestUrlResponse } from 'obsidian';
import type {
	DropboxAuth,
	DropboxFileMetadata,
	DropboxFolderMetadata,
	DropboxEntry,
	DropboxSharedLinkMetadata,
} from './types';

/**
 * OAuth2 PKCE code verifier and challenge
 */
interface PKCEPair {
	codeVerifier: string;
	codeChallenge: string;
}

/**
 * Dropbox API client with OAuth2 PKCE authentication
 */
export class DropboxApi {
	private auth: DropboxAuth | null;
	private appKey: string;
	private debugMode: boolean;
	private onAuthUpdate?: (auth: DropboxAuth) => void;

	// Dropbox API endpoints
	private static readonly AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
	private static readonly TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
	private static readonly API_URL = 'https://api.dropboxapi.com/2';
	private static readonly CONTENT_URL = 'https://content.dropboxapi.com/2';

	// Redirect URI for Obsidian
	private static readonly REDIRECT_URI = 'obsidian://canvas-sync-dropbox-auth';

	// Max size for single upload (150 MB)
	private static readonly MAX_SINGLE_UPLOAD = 150 * 1024 * 1024;
	// Chunk size for session uploads (100 MB - safe margin under 150 MB limit)
	private static readonly CHUNK_SIZE = 100 * 1024 * 1024;

	constructor(
		appKey: string = '',
		auth: DropboxAuth | null = null,
		debugMode = false,
		onAuthUpdate?: (auth: DropboxAuth) => void
	) {
		this.appKey = appKey;
		this.auth = auth;
		this.debugMode = debugMode;
		this.onAuthUpdate = onAuthUpdate;
	}

	/**
	 * Set debug mode
	 */
	setDebugMode(debug: boolean): void {
		this.debugMode = debug;
	}

	/**
	 * Set app key
	 */
	setAppKey(appKey: string): void {
		this.appKey = appKey;
	}

	/**
	 * Set auth tokens
	 */
	setAuth(auth: DropboxAuth | null): void {
		this.auth = auth;
	}

	/**
	 * Get current auth
	 */
	getAuth(): DropboxAuth | null {
		return this.auth;
	}

	/**
	 * Check if authenticated
	 */
	isAuthenticated(): boolean {
		return this.auth !== null && this.auth.accessToken !== '';
	}

	/**
	 * Log debug messages
	 */
	private log(...args: unknown[]): void {
		if (this.debugMode) {
			console.log('[Dropbox API]', ...args);
		}
	}

	// ============================================
	// OAuth2 PKCE Authentication
	// ============================================

	/**
	 * Generate PKCE code verifier and challenge
	 */
	async generatePKCE(): Promise<PKCEPair> {
		// Generate 32 random bytes for code verifier
		const randomBytes = new Uint8Array(32);
		crypto.getRandomValues(randomBytes);
		const codeVerifier = this.base64UrlEncode(randomBytes);

		// Generate code challenge (SHA-256 hash of verifier)
		const encoder = new TextEncoder();
		const data = encoder.encode(codeVerifier);
		const digest = await crypto.subtle.digest('SHA-256', data);
		const codeChallenge = this.base64UrlEncode(new Uint8Array(digest));

		return { codeVerifier, codeChallenge };
	}

	/**
	 * Base64 URL-safe encoding (no padding)
	 */
	private base64UrlEncode(bytes: Uint8Array): string {
		const base64 = btoa(String.fromCharCode(...bytes));
		return base64
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	}

	/**
	 * Generate authorization URL for OAuth2 flow
	 * Returns the URL and the code verifier (to be stored for token exchange)
	 */
	async getAuthorizationUrl(): Promise<{ url: string; codeVerifier: string }> {
		if (!this.appKey) {
			throw new Error('Dropbox App Key not configured');
		}

		const { codeVerifier, codeChallenge } = await this.generatePKCE();

		const params = new URLSearchParams({
			client_id: this.appKey,
			response_type: 'code',
			redirect_uri: DropboxApi.REDIRECT_URI,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			token_access_type: 'offline', // Get refresh token
		});

		const url = `${DropboxApi.AUTH_URL}?${params.toString()}`;

		this.log('Generated authorization URL');
		return { url, codeVerifier };
	}

	/**
	 * Exchange authorization code for tokens
	 */
	async exchangeCodeForToken(code: string, codeVerifier: string): Promise<DropboxAuth> {
		if (!this.appKey) {
			throw new Error('Dropbox App Key not configured');
		}

		this.log('Exchanging authorization code for tokens');

		const params = new URLSearchParams({
			code,
			grant_type: 'authorization_code',
			redirect_uri: DropboxApi.REDIRECT_URI,
			code_verifier: codeVerifier,
			client_id: this.appKey,
		});

		const response = await requestUrl({
			url: DropboxApi.TOKEN_URL,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params.toString(),
		});

		if (response.status !== 200) {
			throw new Error(`Token exchange failed: ${response.status} ${response.text}`);
		}

		const data = response.json;
		const expiresIn = data.expires_in || 14400; // Default 4 hours

		this.auth = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + (expiresIn * 1000),
			accountId: data.account_id,
		};

		// Get account info for display name
		try {
			const accountInfo = await this.getAccountInfo();
			this.auth.displayName = accountInfo.displayName;
		} catch {
			// Non-critical, continue without display name
		}

		this.onAuthUpdate?.(this.auth);
		this.log('Token exchange successful');

		return this.auth;
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshAccessToken(): Promise<void> {
		if (!this.auth?.refreshToken) {
			throw new Error('No refresh token available');
		}

		if (!this.appKey) {
			throw new Error('Dropbox App Key not configured');
		}

		this.log('Refreshing access token');

		const params = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: this.auth.refreshToken,
			client_id: this.appKey,
		});

		const response = await requestUrl({
			url: DropboxApi.TOKEN_URL,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params.toString(),
		});

		if (response.status !== 200) {
			throw new Error(`Token refresh failed: ${response.status}`);
		}

		const data = response.json;
		const expiresIn = data.expires_in || 14400;

		this.auth = {
			...this.auth,
			accessToken: data.access_token,
			expiresAt: Date.now() + (expiresIn * 1000),
		};

		this.onAuthUpdate?.(this.auth);
		this.log('Token refresh successful');
	}

	/**
	 * Ensure we have a valid access token (refresh if needed)
	 */
	private async ensureValidToken(): Promise<void> {
		if (!this.auth) {
			this.log('ensureValidToken: Not authenticated');
			throw new Error('Not authenticated with Dropbox');
		}

		// Refresh if token expires in less than 5 minutes
		const bufferMs = 5 * 60 * 1000;
		const tokenExpired = Date.now() + bufferMs >= this.auth.expiresAt;
		this.log(`ensureValidToken: tokenExpired=${tokenExpired}, expiresAt=${new Date(this.auth.expiresAt).toISOString()}`);

		if (tokenExpired) {
			this.log('Token expired or expiring soon, refreshing...');
			await this.refreshAccessToken();
		}
	}

	// ============================================
	// API Request Helpers
	// ============================================

	/**
	 * Make an authenticated API request
	 */
	private async apiRequest(
		endpoint: string,
		body?: Record<string, unknown>,
		retryCount = 0
	): Promise<RequestUrlResponse> {
		await this.ensureValidToken();

		try {
			const response = await requestUrl({
				url: `${DropboxApi.API_URL}${endpoint}`,
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.auth!.accessToken}`,
					'Content-Type': 'application/json',
				},
				body: body ? JSON.stringify(body) : undefined,
				throw: false, // Don't throw on 4xx/5xx, let us handle it
			});

			// Handle rate limiting with retry
			if (response.status === 429 && retryCount < 3) {
				const retryAfter = parseInt(response.headers['retry-after'] || '1', 10);
				this.log(`Rate limited, retrying after ${retryAfter}s`);
				await this.sleep(retryAfter * 1000);
				return this.apiRequest(endpoint, body, retryCount + 1);
			}

			if (response.status >= 400) {
				// Include the response body in the error for proper conflict detection
				const errorBody = response.text || '';
				this.log(`API error ${response.status}: ${errorBody}`);
				throw new Error(`Dropbox API error: ${response.status} - ${errorBody}`);
			}

			return response;
		} catch (error) {
			// If requestUrl throws despite throw:false, wrap the error with details
			if (error instanceof Error && error.message.startsWith('Dropbox API error:')) {
				throw error; // Re-throw our own errors
			}
			// Log and re-throw other errors with context
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.log(`Request failed for ${endpoint}:`, errorMsg);
			throw new Error(`Dropbox request failed: ${errorMsg}`);
		}
	}

	/**
	 * Make an authenticated content upload request
	 */
	private async contentUpload(
		endpoint: string,
		data: ArrayBuffer,
		apiArg: Record<string, unknown>,
		retryCount = 0
	): Promise<RequestUrlResponse> {
		await this.ensureValidToken();

		try {
			const response = await requestUrl({
				url: `${DropboxApi.CONTENT_URL}${endpoint}`,
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.auth!.accessToken}`,
					'Content-Type': 'application/octet-stream',
					'Dropbox-API-Arg': JSON.stringify(apiArg),
				},
				body: data,
				throw: false, // Don't throw on 4xx/5xx, let us handle it
			});

			// Handle rate limiting with retry
			if (response.status === 429 && retryCount < 3) {
				const retryAfter = parseInt(response.headers['retry-after'] || '1', 10);
				this.log(`Rate limited, retrying after ${retryAfter}s`);
				await this.sleep(retryAfter * 1000);
				return this.contentUpload(endpoint, data, apiArg, retryCount + 1);
			}

			if (response.status >= 400) {
				const errorBody = response.text || '';
				this.log(`Upload error ${response.status}: ${errorBody}`);
				throw new Error(`Dropbox upload error: ${response.status} - ${errorBody}`);
			}

			return response;
		} catch (error) {
			// If requestUrl throws despite throw:false, wrap the error with details
			if (error instanceof Error && error.message.startsWith('Dropbox upload error:')) {
				throw error; // Re-throw our own errors
			}
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.log(`Upload failed:`, errorMsg);
			throw new Error(`Dropbox upload failed: ${errorMsg}`);
		}
	}

	/**
	 * Sleep helper
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ============================================
	// Account Operations
	// ============================================

	/**
	 * Get account info
	 */
	async getAccountInfo(): Promise<{ displayName: string; email: string }> {
		const response = await this.apiRequest('/users/get_current_account');
		const data = response.json;

		return {
			displayName: data.name?.display_name || data.email || 'Unknown',
			email: data.email || '',
		};
	}

	// ============================================
	// File Operations
	// ============================================

	/**
	 * Upload a file to Dropbox
	 * For files <= 150MB, uses simple upload
	 * For larger files, uses chunked upload sessions
	 */
	async uploadFile(
		path: string,
		data: ArrayBuffer,
		mode: 'add' | 'overwrite' = 'overwrite'
	): Promise<DropboxFileMetadata> {
		// Ensure path starts with /
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;

		this.log(`Uploading file to ${normalizedPath} (${data.byteLength} bytes)`);

		// Use chunked upload for files larger than 150 MB
		if (data.byteLength > DropboxApi.MAX_SINGLE_UPLOAD) {
			this.log(`File exceeds 150 MB, using chunked upload`);
			return this.uploadFileChunked(normalizedPath, data, mode);
		}

		const apiArg = {
			path: normalizedPath,
			mode: mode,
			autorename: mode === 'add',
			mute: true, // Don't trigger notifications
		};

		const response = await this.contentUpload('/files/upload', data, apiArg);
		const metadata = response.json as DropboxFileMetadata;

		this.log(`File uploaded: ${metadata.path_display}`);
		return metadata;
	}

	/**
	 * Upload a large file using chunked upload sessions
	 */
	private async uploadFileChunked(
		path: string,
		data: ArrayBuffer,
		mode: 'add' | 'overwrite'
	): Promise<DropboxFileMetadata> {
		const totalSize = data.byteLength;
		const chunkSize = DropboxApi.CHUNK_SIZE;
		let offset = 0;

		// Start upload session
		const firstChunk = data.slice(0, Math.min(chunkSize, totalSize));
		const sessionId = await this.uploadSessionStart(firstChunk);
		offset = firstChunk.byteLength;

		this.log(`Upload session started: ${sessionId}, uploaded ${offset}/${totalSize} bytes`);

		// Upload remaining chunks
		while (offset < totalSize) {
			const remaining = totalSize - offset;
			const currentChunkSize = Math.min(chunkSize, remaining);
			const chunk = data.slice(offset, offset + currentChunkSize);

			await this.uploadSessionAppend(sessionId, chunk, offset);
			offset += currentChunkSize;

			this.log(`Uploaded chunk: ${offset}/${totalSize} bytes (${Math.round(offset / totalSize * 100)}%)`);
		}

		// Finish upload session
		const metadata = await this.uploadSessionFinish(sessionId, offset, path, mode);
		this.log(`Chunked upload complete: ${metadata.path_display}`);

		return metadata;
	}

	/**
	 * Start an upload session (for large files)
	 */
	private async uploadSessionStart(data: ArrayBuffer): Promise<string> {
		await this.ensureValidToken();

		const response = await requestUrl({
			url: `${DropboxApi.CONTENT_URL}/files/upload_session/start`,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.auth!.accessToken}`,
				'Content-Type': 'application/octet-stream',
				'Dropbox-API-Arg': JSON.stringify({ close: false }),
			},
			body: data,
			throw: false,
		});

		if (response.status >= 400) {
			const errorBody = response.text || '';
			throw new Error(`Upload session start failed: ${response.status} - ${errorBody}`);
		}

		return response.json.session_id;
	}

	/**
	 * Append data to an upload session
	 */
	private async uploadSessionAppend(
		sessionId: string,
		data: ArrayBuffer,
		offset: number
	): Promise<void> {
		await this.ensureValidToken();

		const response = await requestUrl({
			url: `${DropboxApi.CONTENT_URL}/files/upload_session/append_v2`,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.auth!.accessToken}`,
				'Content-Type': 'application/octet-stream',
				'Dropbox-API-Arg': JSON.stringify({
					cursor: {
						session_id: sessionId,
						offset: offset,
					},
					close: false,
				}),
			},
			body: data,
			throw: false,
		});

		if (response.status >= 400) {
			const errorBody = response.text || '';
			throw new Error(`Upload session append failed: ${response.status} - ${errorBody}`);
		}
	}

	/**
	 * Finish an upload session
	 */
	private async uploadSessionFinish(
		sessionId: string,
		offset: number,
		path: string,
		mode: 'add' | 'overwrite'
	): Promise<DropboxFileMetadata> {
		await this.ensureValidToken();

		const response = await requestUrl({
			url: `${DropboxApi.CONTENT_URL}/files/upload_session/finish`,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.auth!.accessToken}`,
				'Content-Type': 'application/octet-stream',
				'Dropbox-API-Arg': JSON.stringify({
					cursor: {
						session_id: sessionId,
						offset: offset,
					},
					commit: {
						path: path,
						mode: mode,
						autorename: mode === 'add',
						mute: true,
					},
				}),
			},
			body: new ArrayBuffer(0), // Empty body for finish
			throw: false,
		});

		if (response.status >= 400) {
			const errorBody = response.text || '';
			throw new Error(`Upload session finish failed: ${response.status} - ${errorBody}`);
		}

		return response.json as DropboxFileMetadata;
	}

	/**
	 * Create a folder in Dropbox
	 * Returns existing folder if it already exists
	 */
	async createFolder(path: string): Promise<DropboxFolderMetadata> {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;

		this.log(`Creating folder: ${normalizedPath}`);

		try {
			const response = await this.apiRequest('/files/create_folder_v2', {
				path: normalizedPath,
				autorename: false,
			});

			return response.json.metadata as DropboxFolderMetadata;
		} catch (error) {
			// Check if folder already exists (Dropbox returns 409 conflict)
			const errorStr = String(error);
			this.log(`createFolder error: ${errorStr}`);

			// Check for various conflict indicators in the error
			if (errorStr.includes('conflict') || errorStr.includes('409')) {
				// Folder exists, get its metadata
				this.log(`Folder already exists, getting metadata`);
				try {
					const metadata = await this.getMetadata(normalizedPath);
					return metadata as DropboxFolderMetadata;
				} catch (metadataError) {
					this.log(`Failed to get folder metadata: ${metadataError}`);
					throw metadataError;
				}
			}
			throw error;
		}
	}

	/**
	 * Get metadata for a file or folder
	 */
	async getMetadata(path: string): Promise<DropboxEntry> {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;

		const response = await this.apiRequest('/files/get_metadata', {
			path: normalizedPath,
		});

		return response.json as DropboxEntry;
	}

	/**
	 * List contents of a folder
	 */
	async listFolder(path: string): Promise<DropboxEntry[]> {
		const normalizedPath = path === '' ? '' : (path.startsWith('/') ? path : `/${path}`);

		this.log(`Listing folder: ${normalizedPath || '(root)'}`);

		const entries: DropboxEntry[] = [];
		let cursor: string | undefined;
		let hasMore = true;

		while (hasMore) {
			let response: RequestUrlResponse;

			if (cursor) {
				response = await this.apiRequest('/files/list_folder/continue', {
					cursor,
				});
			} else {
				response = await this.apiRequest('/files/list_folder', {
					path: normalizedPath,
					recursive: false,
					include_deleted: false,
				});
			}

			const data = response.json;
			entries.push(...(data.entries as DropboxEntry[]));
			cursor = data.cursor;
			hasMore = data.has_more;
		}

		return entries;
	}

	/**
	 * Check if a path exists
	 */
	async pathExists(path: string): Promise<boolean> {
		try {
			await this.getMetadata(path);
			return true;
		} catch {
			return false;
		}
	}

	// ============================================
	// Shared Link Operations
	// ============================================

	/**
	 * Create a shared link for a file
	 * Returns the existing link if one already exists
	 */
	async createSharedLink(path: string): Promise<string> {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;

		this.log(`Creating shared link for: ${normalizedPath}`);

		// First check for existing link
		const existingLink = await this.getExistingSharedLink(normalizedPath);
		if (existingLink) {
			this.log(`Using existing shared link`);
			return existingLink;
		}

		// Create new link
		const response = await this.apiRequest('/sharing/create_shared_link_with_settings', {
			path: normalizedPath,
			settings: {
				requested_visibility: 'public',
				audience: 'public',
				access: 'viewer',
			},
		});

		const data = response.json as DropboxSharedLinkMetadata;
		return data.url;
	}

	/**
	 * Get existing shared link for a file (if any)
	 */
	async getExistingSharedLink(path: string): Promise<string | null> {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;

		try {
			const response = await this.apiRequest('/sharing/list_shared_links', {
				path: normalizedPath,
				direct_only: true,
			});

			const links = response.json.links as DropboxSharedLinkMetadata[];
			if (links.length > 0) {
				return links[0].url;
			}
			return null;
		} catch {
			return null;
		}
	}

	// ============================================
	// URL Transformation
	// ============================================

	/**
	 * Transform a Dropbox sharing URL to a direct streaming URL
	 * Input:  https://www.dropbox.com/scl/fi/xxx/file.mp3?rlkey=yyy&dl=0
	 * Output: https://dl.dropboxusercontent.com/scl/fi/xxx/file.mp3?rlkey=yyy
	 */
	static transformToDirectUrl(sharedUrl: string): string {
		return sharedUrl
			.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
			.replace(/[?&]dl=\d/, '')
			.replace(/&st=[^&]+/, ''); // Remove st parameter if present
	}

	/**
	 * Transform a Dropbox sharing URL to a download URL
	 * Input:  https://www.dropbox.com/scl/fi/xxx/file.mp3?rlkey=yyy&dl=0
	 * Output: https://www.dropbox.com/scl/fi/xxx/file.mp3?rlkey=yyy&dl=1
	 */
	static transformToDownloadUrl(sharedUrl: string): string {
		let url = sharedUrl.replace(/[?&]dl=\d/, '');
		url = url.replace(/&st=[^&]+/, ''); // Remove st parameter if present
		const separator = url.includes('?') ? '&' : '?';
		return `${url}${separator}dl=1`;
	}

	/**
	 * Revoke the current access (for disconnecting)
	 */
	async revokeAccess(): Promise<void> {
		if (this.auth?.accessToken) {
			try {
				await this.apiRequest('/auth/token/revoke');
			} catch {
				// Ignore errors during revoke
			}
		}
		this.auth = null;
	}
}
