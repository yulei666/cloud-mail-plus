import createDOMPurify from 'dompurify';

// Create an isolated DOMPurify instance bound to current window
const factory = typeof createDOMPurify === 'function' ? createDOMPurify : createDOMPurify?.default;
const emailPurify = typeof window !== 'undefined' && typeof factory === 'function' ? factory(window) : null;

if (emailPurify) {
  // Ensure all <a> tags open in new tab and have secure rel attributes
  emailPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

const DEFAULT_PURIFY_CONFIG = {
  FORCE_BODY: true,
  FORBIDDEN_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'meta', 'link'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  ADD_ATTR: ['target', 'rel'],
  WHOLE_DOCUMENT: false
};

export function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeEmailHtml(html, customConfig = {}) {
  if (!html || typeof html !== 'string') return '';
  if (!emailPurify || typeof emailPurify.sanitize !== 'function') {
    console.error('DOMPurify is not available, refusing to output unsanitized HTML');
    return '';
  }
  return emailPurify.sanitize(html, {
    ...DEFAULT_PURIFY_CONFIG,
    ...customConfig
  });
}

export default emailPurify;
