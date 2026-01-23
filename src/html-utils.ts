/**
 * Escape HTML special characters to prevent XSS attacks.
 */
export function escapeHtml(text: string): string {
	if (typeof text !== 'string') {
		return '';
	}
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}
