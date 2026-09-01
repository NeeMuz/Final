import re

import bleach

ALLOWED_TAGS = [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h2', 'h3', 'ul', 'ol', 'li', 'blockquote',
    'a', 'img', 'code', 'pre', 'span', 'div',
]

ALLOWED_ATTRIBUTES = {
    '*': ['class'],
    'a': ['href', 'title', 'rel', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'div': ['class'],
    'p': ['class', 'data-placeholder'],
}

ALLOWED_PROTOCOLS = ['http', 'https', 'mailto']

# Classes the editor is allowed to emit. Anything else (including colours
# pasted from other sites as inline styles) is dropped, which keeps article
# colours resolving against the active theme instead of a hardcoded hex.
ALLOWED_CLASS_RE = re.compile(
    r'^(ql-color-|ql-bg-|ql-size-|ql-indent-|wiki-thumb)[a-z0-9-]*$'
)

TAG_WITH_CLASS_RE = re.compile(r'\sclass="([^"]*)"')


def _filter_classes(html):
    def replace(match):
        kept = [
            name for name in match.group(1).split()
            if ALLOWED_CLASS_RE.match(name)
        ]
        return f' class="{" ".join(kept)}"' if kept else ''

    return TAG_WITH_CLASS_RE.sub(replace, html)


# Empty figure labels/captions are dropped; non-empty ones stay inside the frame.
_THUMB_EMPTY_TEXT_RE = re.compile(
    r'<p class="[^"]*wiki-thumb-(?:label|caption)[^"]*"[^>]*>\s*(?:<br\s*/?>)?\s*</p>\s*',
    re.IGNORECASE,
)


def _clean_empty_thumb_text(html):
    previous = None
    while previous != html:
        previous = html
        html = _THUMB_EMPTY_TEXT_RE.sub('', html)
    return html


def sanitize_article_html(html):
    if not html:
        return ''
    cleaned = bleach.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
    )
    cleaned = _filter_classes(cleaned)
    cleaned = _clean_empty_thumb_text(cleaned)
    return bleach.linkify(
        cleaned,
        callbacks=[bleach.callbacks.nofollow],
        parse_email=True,
    )
