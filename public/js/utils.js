/**
 * Utility functions for Command Center
 */

export function formatTimeAgo(mins) {
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Smart DOM update using morphdom - only patches what changed
 * @param {HTMLElement} targetEl - Element to update
 * @param {string} newHtml - New HTML content
 */
export function smartUpdate(targetEl, newHtml) {
  if (typeof morphdom === 'undefined') {
    // Fallback if morphdom not loaded
    targetEl.innerHTML = newHtml;
    return;
  }
  // Create a temporary container with the new content
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;
  // If target has single child and temp has single child, morph directly
  if (targetEl.children.length === 1 && temp.children.length === 1) {
    morphdom(targetEl.firstElementChild, temp.firstElementChild);
  } else {
    // Otherwise morph the container itself
    morphdom(targetEl, temp, { childrenOnly: true });
  }
}

export function formatBytes(bytes) {
  if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}
