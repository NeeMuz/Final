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


# Captions used to live inside the photo frame (contenteditable=false), which
# trapped the caret. Keep them as a normal paragraph immediately after the
# thumbnail so authors can type under a photo.
_THUMB_CAPTION_RE = re.compile(
    r'(<div class="[^"]*wiki-thumb[^"]*">)(.*?)'
    r'<p class="[^"]*wiki-thumb-caption[^"]*"[^>]*>(.*?)</p>\s*'
    r'(</div>)',
    re.IGNORECASE | re.DOTALL,
)


def _hoist_thumb_captions(html):
    def replace(match):
        caption = match.group(3).strip()
        block = match.group(1) + match.group(2) + match.group(4)
        if caption:
            return f'{block}<p>{caption}</p>'
        return f'{block}<p><br></p>'

    previous = None
    while previous != html:
        previous = html
        html = _THUMB_CAPTION_RE.sub(replace, html)
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
    cleaned = _hoist_thumb_captions(cleaned)
    return bleach.linkify(
        cleaned,
        callbacks=[bleach.callbacks.nofollow],
        parse_email=True,
    )
