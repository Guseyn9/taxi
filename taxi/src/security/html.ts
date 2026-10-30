import DOMPurify from 'dompurify';
const inlineTags = ['a', 'b', 'strong', 'em', 'i', 'u', 's', 'span', 'br', 'code', 'small', 'sub', 'sup'];
const blockTags = [...inlineTags, 'p', 'div', 'ul', 'ol', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'img'];
/** The sanitizer is the final boundary, immediately before insertion into the DOM. */
export function sanitizeHtml(input: unknown, inline = false): string {
    if (typeof input !== 'string')
        return '';
    if (!DOMPurify.isSupported) {
        // Unsupported engines must show text rather than return unfiltered HTML.
        return input.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    }
    return DOMPurify.sanitize(input, {
        ALLOWED_TAGS: inline ? inlineTags : blockTags,
        ALLOWED_ATTR: ['href', 'rel', 'title', 'class', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan', 'dir', 'lang', 'aria-label'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: true,
        SANITIZE_NAMED_PROPS: true,
        // No inline CSS, handlers, forms, active embeds, custom elements or target=_blank.
        FORBID_ATTR: ['style', 'id', 'name', 'target', 'srcset'],
        RETURN_TRUSTED_TYPE: false,
    });
}
