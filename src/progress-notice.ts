import { Notice } from 'obsidian';
import type { SyncWarning } from './types';

/**
 * Progress state for sync operations
 */
export interface ProgressState {
	/** Current item number */
	current: number;
	/** Total items to sync */
	total: number;
	/** Current phase (e.g., "Shared Content", "Module: Week 01") */
	phase: string;
	/** Current item name being synced */
	currentItem?: string;
}

/**
 * Progress notice with visual progress bar
 * Wraps Obsidian's Notice API with custom HTML for progress display
 */
export class ProgressNotice {
	private notice: Notice | null = null;
	private containerEl: HTMLElement | null = null;
	private progressBar: HTMLElement | null = null;
	private progressText: HTMLElement | null = null;
	private phaseText: HTMLElement | null = null;
	private itemText: HTMLElement | null = null;
	private debugMode: boolean;

	constructor(debugMode = false) {
		this.debugMode = debugMode;
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
			console.log('[ProgressNotice]', ...args);
		}
	}

	/**
	 * Show the progress notice with initial state
	 */
	show(initialState: ProgressState): void {
		// Create persistent notice (duration=0 means it stays until hidden)
		this.notice = new Notice('', 0);

		// Build custom HTML structure
		this.containerEl = this.notice.noticeEl;
		this.containerEl.addClass('canvas-sync-progress-notice');
		this.containerEl.empty();

		// Phase text (e.g., "Syncing to Course Name...")
		this.phaseText = this.containerEl.createDiv({ cls: 'cs-progress-phase' });

		// Progress text (e.g., "5/23 files")
		this.progressText = this.containerEl.createDiv({ cls: 'cs-progress-text' });

		// Progress bar container
		const barContainer = this.containerEl.createDiv({ cls: 'cs-progress-bar-container' });
		this.progressBar = barContainer.createDiv({ cls: 'cs-progress-bar' });
		this.progressBar.style.width = '0%';

		// Current item text (e.g., "Creating: Week 01 Overview")
		this.itemText = this.containerEl.createDiv({ cls: 'cs-progress-item' });

		this.update(initialState);

		this.log('Shown with', initialState);
	}

	/**
	 * Update the progress display
	 */
	update(state: ProgressState): void {
		if (!this.notice) return;

		const percent = state.total > 0 ? (state.current / state.total) * 100 : 0;
		this.log('Update:', state.current, '/', state.total, `(${percent.toFixed(1)}%)`);

		if (this.phaseText) {
			this.phaseText.setText(state.phase);
		}

		if (this.progressText) {
			this.progressText.setText(`${state.current}/${state.total} files`);
		}

		if (this.progressBar) {
			this.progressBar.style.width = `${percent}%`;
		}

		if (this.itemText && state.currentItem) {
			this.itemText.setText(state.currentItem);
			this.itemText.show();
		} else if (this.itemText) {
			this.itemText.hide();
		}
	}

	/**
	 * Show completion state and auto-dismiss
	 */
	complete(successCount: number, failedCount: number): void {
		if (!this.notice || !this.containerEl) return;

		this.containerEl.empty();
		this.containerEl.removeClass('canvas-sync-progress-notice');
		this.containerEl.addClass('canvas-sync-progress-complete');

		const icon = failedCount > 0 ? '⚠️' : '✓';
		const message = failedCount > 0
			? `Sync complete: ${successCount} succeeded, ${failedCount} failed`
			: `Sync complete: ${successCount} files synced`;

		this.containerEl.createDiv({ cls: 'cs-progress-complete', text: `${icon} ${message}` });

		// Auto-dismiss after 5 seconds
		setTimeout(() => this.hide(), 5000);
	}

	/**
	 * Show completion state with warnings and auto-dismiss
	 */
	completeWithWarnings(successCount: number, failedCount: number, warnings: SyncWarning[]): void {
		if (!this.notice || !this.containerEl) return;

		this.containerEl.empty();
		this.containerEl.removeClass('canvas-sync-progress-notice');
		this.containerEl.addClass('canvas-sync-progress-complete');

		const warningCount = warnings.length;

		// Determine icon and main message
		let icon: string;
		let message: string;

		if (failedCount > 0) {
			icon = '⚠️';
			message = `Sync complete: ${successCount} succeeded, ${failedCount} failed`;
		} else if (warningCount > 0) {
			icon = '⚠️';
			message = `Sync complete: ${successCount} files (${warningCount} warning${warningCount > 1 ? 's' : ''})`;
		} else {
			icon = '✓';
			message = `Sync complete: ${successCount} files synced`;
		}

		// Create summary line
		this.containerEl.createDiv({ cls: 'cs-progress-complete', text: `${icon} ${message}` });

		// If there are warnings, show expandable details
		if (warningCount > 0) {
			const warningsContainer = this.containerEl.createDiv({ cls: 'cs-warnings-container' });

			// Group warnings by type
			const warningsByType = new Map<string, SyncWarning[]>();
			for (const warning of warnings) {
				const existing = warningsByType.get(warning.type) || [];
				existing.push(warning);
				warningsByType.set(warning.type, existing);
			}

			// Display summary of warnings by type
			for (const [type, typeWarnings] of warningsByType) {
				const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
				warningsContainer.createDiv({
					cls: 'cs-warning-summary',
					text: `${typeLabel}: ${typeWarnings.length} warning${typeWarnings.length > 1 ? 's' : ''}`,
				});
			}
		}

		// Auto-dismiss after 8 seconds (longer to allow reading warnings)
		setTimeout(() => this.hide(), warningCount > 0 ? 8000 : 5000);
	}

	/**
	 * Show error state and auto-dismiss
	 */
	error(message: string): void {
		if (!this.notice || !this.containerEl) return;

		this.containerEl.empty();
		this.containerEl.removeClass('canvas-sync-progress-notice');
		this.containerEl.addClass('canvas-sync-progress-error');

		this.containerEl.createDiv({ cls: 'cs-progress-error', text: `✗ ${message}` });

		// Auto-dismiss after 5 seconds
		setTimeout(() => this.hide(), 5000);
	}

	/**
	 * Hide and clean up the notice
	 */
	hide(): void {
		if (this.notice) {
			this.notice.hide();
			this.notice = null;
		}
		this.containerEl = null;
		this.progressBar = null;
		this.progressText = null;
		this.phaseText = null;
		this.itemText = null;
	}
}
