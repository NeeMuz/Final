(function () {
    'use strict';

    var mount = document.getElementById('wysiwyg-editor');
    var source = document.querySelector('[data-wysiwyg-source]');
    var form = document.querySelector('.article-form');
    if (!mount || !source || !window.Quill) {
        return;
    }

    var uploadUrl = mount.getAttribute('data-upload-url');
    var tabId = window.BIKIBEDIA_TAB_ID || '';
    var MIN_IMAGE_SIZE = 64;
    var THUMB_ALIGNS = ['left', 'center', 'right', 'wide', 'none'];

    // Colours are stored as semantic names, not hex, so they resolve against
    // the active theme via CSS variables. `false` is the "remove colour" swatch.
    var COLOR_NAMES = [
        'ink', 'muted', 'accent', 'info', 'success',
        'warning', 'danger', 'grape', 'rose', 'sand',
    ];
    var COLOR_LABELS = {
        ink: 'Default text',
        muted: 'Muted grey',
        accent: 'Accent blue',
        info: 'Cyan',
        success: 'Green',
        warning: 'Amber',
        danger: 'Red',
        grape: 'Purple',
        rose: 'Pink',
        sand: 'Sand',
    };
    var COLOR_PALETTE = [false].concat(COLOR_NAMES);

    // Inline sizes. Heading is a block format and always applies to the whole
    // paragraph, so this is what makes a selection inside a line bigger.
    var TEXT_SIZES = ['small', 'large', 'huge'];
    var SIZE_PALETTE = ['small', false, 'large', 'huge'];
    var editorContainer = null;
    var editorShell = null;
    var editorRoot = null;
    var quill = null;
    var savedRange = null;
    var ensuringSpace = false;

    var BlockEmbed = Quill.import('blots/block/embed');
    var Delta = Quill.import('delta');
    var Parchment = Quill.import('parchment');
    var THUMB_BLOT_NAME = 'wikithumb';

    function escapeAttr(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function readCaptionText(node) {
        if (!node) {
            return '';
        }
        if (node.tagName === 'TEXTAREA') {
            return node.value;
        }
        return (node.textContent || '').trim();
    }

    function serializeEditorHtml() {
        var clone = editorRoot.cloneNode(true);
        clone.querySelectorAll('.wiki-thumb .wiki-thumb-caption').forEach(function (node) {
            node.remove();
        });
        var html = clone.innerHTML.trim();
        if (html === '<p><br></p>') {
            html = '';
        }
        return html;
    }

    var paletteCache = {};

    function readPaletteColor(name, isBackground) {
        var key = (isBackground ? 'bg:' : 'fg:') + name;
        if (!(key in paletteCache)) {
            var prop = isBackground ? '--article-bg-' + name : '--article-' + name;
            paletteCache[key] = getComputedStyle(document.documentElement)
                .getPropertyValue(prop)
                .trim();
        }
        return paletteCache[key];
    }

    // Quill previews the active colour by writing an inline stroke/fill on the
    // toolbar icon. Semantic names are not CSS colours, so resolve them here.
    function syncColorLabels() {
        var formats = quill.getFormat();
        [
            { selector: '.ql-color.ql-picker', format: 'color', background: false },
            { selector: '.ql-background.ql-picker', format: 'background', background: true },
        ].forEach(function (spec) {
            var picker = editorShell.querySelector(spec.selector);
            var label = picker && picker.querySelector('.ql-color-label');
            if (!label) {
                return;
            }

            var value = formats[spec.format];
            var color = typeof value === 'string' ? readPaletteColor(value, spec.background) : '';
            if (label.tagName === 'line') {
                label.style.stroke = color;
            } else {
                label.style.fill = color;
            }
        });
    }

    function setupColorPickers() {
        editorShell.querySelectorAll('.ql-color-picker').forEach(function (picker) {
            var isBackground = picker.classList.contains('ql-background');
            picker.querySelectorAll('.ql-picker-item').forEach(function (item) {
                var value = item.getAttribute('data-value');
                if (!value) {
                    item.setAttribute('title', isBackground ? 'No highlight' : 'Default colour');
                    return;
                }
                item.setAttribute('title', COLOR_LABELS[value] || value);
            });
        });

        function refreshPalette() {
            paletteCache = {};
            syncColorLabels();
        }

        syncColorLabels();
        quill.on('editor-change', syncColorLabels);
        document.addEventListener('bikibedia:theme-change', refreshPalette);
        new MutationObserver(refreshPalette).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
    }

    function buildThumbHtml(value) {
        var align = (value && value.align) || 'center';
        var src = escapeAttr(value && value.src);
        var width = value && value.width ? ' width="' + escapeAttr(value.width) + '"' : '';
        var height = value && value.height ? ' height="' + escapeAttr(value.height) + '"' : '';
        return (
            '<div class="wiki-thumb wiki-thumb--' + align + '">' +
                '<img src="' + src + '" draggable="false"' + width + height + '>' +
            '</div>'
        );
    }

    function parseThumbAlign(node) {
        var match = node.className.match(/wiki-thumb--(left|center|right|wide|none)/);
        return match ? match[1] : 'none';
    }

    function applyThumbAlign(node, align) {
        THUMB_ALIGNS.forEach(function (name) {
            node.classList.remove('wiki-thumb--' + name);
        });
        node.classList.add('wiki-thumb--' + (align || 'none'));
    }

    function thumbValueFromNode(node) {
        var img = node.querySelector('img');
        var caption = node.querySelector('.wiki-thumb-caption');
        return {
            src: img ? img.getAttribute('src') : '',
            width: img ? img.getAttribute('width') : '',
            height: img ? img.getAttribute('height') : '',
            align: parseThumbAlign(node),
            caption: readCaptionText(caption),
            alt: img ? img.getAttribute('alt') : '',
        };
    }

    function WikiThumbBlot(domNode) {
        BlockEmbed.call(this, domNode);
    }

    WikiThumbBlot.prototype = Object.create(BlockEmbed.prototype);
    WikiThumbBlot.prototype.constructor = WikiThumbBlot;

    WikiThumbBlot.create = function (value) {
        var node = BlockEmbed.create.call(WikiThumbBlot);
        node.setAttribute('contenteditable', 'false');
        node.classList.add('wiki-thumb');
        applyThumbAlign(node, (value && value.align) || 'center');

        var img = document.createElement('img');
        img.setAttribute('src', (value && value.src) || '');
        img.setAttribute('draggable', 'false');
        if (value && value.width) {
            img.setAttribute('width', value.width);
        }
        if (value && value.height) {
            img.setAttribute('height', value.height);
        }
        if (value && value.alt) {
            img.setAttribute('alt', value.alt);
        }
        node.appendChild(img);

        return node;
    };

    WikiThumbBlot.value = function (node) {
        return thumbValueFromNode(node);
    };

    WikiThumbBlot.formats = function () {
        return {};
    };

    WikiThumbBlot.blotName = THUMB_BLOT_NAME;
    WikiThumbBlot.tagName = 'DIV';
    WikiThumbBlot.scope = Parchment.Scope.BLOCK_BLOT;

    Quill.register(WikiThumbBlot, true);

    // Class attributors instead of Quill's default inline-style ones, so the
    // saved HTML carries no hardcoded colours or font sizes. The whitelists
    // also drop arbitrary values pasted from other sites.
    Quill.register({
        'formats/color': new Parchment.Attributor.Class('color', 'ql-color', {
            scope: Parchment.Scope.INLINE,
            whitelist: COLOR_NAMES,
        }),
        'formats/background': new Parchment.Attributor.Class('background', 'ql-bg', {
            scope: Parchment.Scope.INLINE,
            whitelist: COLOR_NAMES,
        }),
        'formats/size': new Parchment.Attributor.Class('size', 'ql-size', {
            scope: Parchment.Scope.INLINE,
            whitelist: TEXT_SIZES,
        }),
    }, true);

    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : '';
    }

    function uploadImage(file) {
        var body = new FormData();
        body.append('image', file);
        body.append('csrfmiddlewaretoken', getCookie('csrftoken'));
        if (tabId) {
            body.append('_tab', tabId);
        }

        var url = uploadUrl;
        if (tabId) {
            url += (url.indexOf('?') === -1 ? '?' : '&') + '__tab=' + encodeURIComponent(tabId);
        }

        return fetch(url, {
            method: 'POST',
            body: body,
            credentials: 'same-origin',
        }).then(function (response) {
            return response.json().catch(function () {
                return { error: 'Upload failed.' };
            }).then(function (data) {
                if (!response.ok) {
                    throw new Error(data.error || 'Upload failed.');
                }
                return data.url;
            });
        });
    }

    function thumbInsertDelta(value) {
        var payload = {};
        payload[THUMB_BLOT_NAME] = value;
        return new Delta().insert(payload);
    }

    function wrapImageNodeAsThumb(img, align) {
        if (!img || img.closest('.wiki-thumb')) {
            return null;
        }

        var thumb = document.createElement('div');
        thumb.className = 'wiki-thumb wiki-thumb--' + (align || 'center');
        thumb.setAttribute('contenteditable', 'false');

        var parent = img.parentNode;
        if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
            parent.replaceWith(thumb);
        } else if (parent) {
            parent.insertBefore(thumb, img);
            img.remove();
        }

        thumb.appendChild(img);
        return thumb;
    }

    function insertThumbFallback(index, payload) {
        quill.clipboard.dangerouslyPasteHTML(index, buildThumbHtml(payload), 'user');
        prepareEditorImages();
    }

    function insertThumbAt(index, url) {
        var payload = {
            src: url,
            align: 'center',
            caption: '',
        };
        var insertAt = typeof index === 'number' ? index : Math.max(0, quill.getLength() - 1);

        try {
            quill.insertEmbed(insertAt, THUMB_BLOT_NAME, payload, 'user');
        } catch (error) {
            insertThumbFallback(insertAt, payload);
        }

        prepareEditorImages();
        ensureEditableSpace();
        focusAfterThumb(findThumbBySrc(url));
        syncBodyToSource();
    }

    function findThumbBySrc(url) {
        var found = null;
        editorRoot.querySelectorAll('.wiki-thumb img').forEach(function (img) {
            if (img.getAttribute('src') === url) {
                found = img.closest('.wiki-thumb');
            }
        });
        return found;
    }

    var activeBasicsField = null;
    var scrollLock = null;

    function lockPageScroll() {
        if (scrollLock) {
            return;
        }
        scrollLock = { y: window.scrollY };
        document.body.style.position = 'fixed';
        document.body.style.top = '-' + scrollLock.y + 'px';
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
    }

    function unlockPageScroll() {
        if (!scrollLock) {
            return;
        }
        var y = scrollLock.y;
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, y);
        scrollLock = null;
    }

    function preservePageScroll(action) {
        var scrollX = window.scrollX;
        var scrollY = window.scrollY;
        action();
        function restore() {
            if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
                window.scrollTo(scrollX, scrollY);
            }
        }
        window.requestAnimationFrame(function () {
            restore();
            window.requestAnimationFrame(restore);
        });
    }

    /* Quill keeps a hidden focus target; pointer-events alone does not stop keyboard
       focus or scroll-into-view. Blur the DOM nodes directly and drop the selection. */
    function blurQuillEditor() {
        if (!quill || !editorRoot) {
            return;
        }
        var keepBasicsFocus = activeBasicsField &&
            form &&
            form.classList.contains('article-form--basics-focus');
        if (document.activeElement === editorRoot) {
            editorRoot.blur();
        }
        if (editorContainer) {
            editorContainer.querySelectorAll('[contenteditable], input, textarea').forEach(function (node) {
                if (node !== editorRoot && document.activeElement === node && typeof node.blur === 'function') {
                    node.blur();
                }
            });
        }
        if (document.activeElement === editorRoot || editorShell.contains(document.activeElement)) {
            try {
                quill.setSelection(null, 'silent');
            } catch (error) {
                /* ignore */
            }
        }
        if (keepBasicsFocus && document.activeElement !== activeBasicsField) {
            activeBasicsField.focus({ preventScroll: true });
        }
    }

    /* While Title / Introduction are active, block pointer events to Quill and keep
       keyboard focus on the native fields above the editor. */
    function setBasicsFocus(active) {
        if (!form) {
            return;
        }
        form.classList.toggle('article-form--basics-focus', !!active);
        if (active) {
            if (editorRoot) {
                editorRoot.setAttribute('tabindex', '-1');
            }
            lockPageScroll();
            blurQuillEditor();
            if (imageTools) {
                imageTools.clear();
            }
            return;
        }
        activeBasicsField = null;
        unlockPageScroll();
        if (editorRoot) {
            editorRoot.removeAttribute('tabindex');
        }
    }

    function isBasicsField(node) {
        if (!node) {
            return false;
        }
        return node.id === 'id_title' || node.id === 'id_introduction';
    }

    function releaseFormFocus() {
        preservePageScroll(function () {
            blurQuillEditor();
            var active = document.activeElement;
            if (active && form.contains(active) && typeof active.blur === 'function') {
                active.blur();
            }
            setBasicsFocus(false);
        });
    }

    function focusAfterThumb(thumb) {
        if (form && form.classList.contains('article-form--basics-focus')) {
            return;
        }
        var blot = thumb && Quill.find(thumb);
        if (!blot) {
            quill.setSelection(Math.max(0, quill.getLength() - 1), 0, 'silent');
            return;
        }
        var index = quill.getIndex(blot) + 1;
        if (index >= quill.getLength()) {
            quill.insertText(quill.getLength(), '\n', 'silent');
            index = Math.max(0, quill.getLength() - 1);
        }
        quill.setSelection(index, 0, 'silent');
    }

    function applyLinkFromPrompt() {
        if (form && form.classList.contains('article-form--basics-focus')) {
            return;
        }
        var range = quill.getSelection() || savedRange;
        if (!range) {
            range = { index: Math.max(0, quill.getLength() - 1), length: 0 };
        }
        var current = '';
        try {
            var fmt = quill.getFormat(range);
            current = typeof fmt.link === 'string' ? fmt.link : '';
        } catch (error) {
            current = '';
        }
        var raw = window.prompt('Link URL', current || 'https://');
        if (raw === null) {
            quill.setSelection(range.index, range.length, 'silent');
            return;
        }
        raw = String(raw).trim();
        quill.setSelection(range.index, range.length, 'silent');
        if (!raw) {
            quill.format('link', false, 'user');
            return;
        }
        if (!/^(https?:\/\/|mailto:|\/|#)/i.test(raw)) {
            raw = 'https://' + raw;
        }
        if (range.length === 0) {
            var label = raw.replace(/^https?:\/\//i, '');
            quill.insertText(range.index, label, 'link', raw, 'user');
            quill.setSelection(range.index, label.length, 'silent');
        } else {
            quill.formatText(range.index, range.length, 'link', raw, 'user');
        }
    }

    quill = new Quill(mount, {
        theme: 'snow',
        placeholder: 'Write your article…',
        modules: {
            toolbar: {
                container: [
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ color: COLOR_PALETTE }, { background: COLOR_PALETTE }],
                    [{ size: SIZE_PALETTE }],
                    [{ header: [2, 3, false] }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    ['blockquote', 'code-block'],
                    ['link', 'image'],
                    ['clean'],
                ],
                handlers: {
                    header: function headerHandler(value) {
                        var range = this.quill.getSelection() || savedRange;
                        if (range && range.length > 0) {
                            /* Heading is a block format, so Quill would restyle
                               the whole paragraph. A selection means the author
                               wants those words bigger — that is `size`. */
                            var sizeForHeader = { '1': 'huge', '2': 'huge', '3': 'large' };
                            this.quill.setSelection(range.index, range.length, 'silent');
                            this.quill.format(
                                'size',
                                value ? (sizeForHeader[String(value)] || 'large') : false
                            );
                            return;
                        }
                        if (range) {
                            this.quill.setSelection(range.index, range.length, 'silent');
                        }
                        this.quill.format('header', value || false);
                    },
                    link: function linkHandler() {
                        applyLinkFromPrompt();
                    },
                    image: function imageHandler() {
                        var input = document.createElement('input');
                        input.setAttribute('type', 'file');
                        input.setAttribute('accept', 'image/*');
                        input.click();

                        input.onchange = function () {
                            var file = input.files && input.files[0];
                            if (!file) {
                                return;
                            }

                            var range = quill.getSelection() || savedRange || { index: Math.max(0, quill.getLength() - 1) };
                            uploadImage(file)
                                .then(function (url) {
                                    insertThumbAt(range.index, url);
                                })
                                .catch(function (error) {
                                    window.alert(error.message || 'Could not upload image.');
                                });
                        };
                    },
                },
            },
        },
    });

    editorRoot = quill.root;
    // Quill turns the mount node itself into .ql-container and inserts the
    // toolbar as its previous sibling, so toolbar lookups start at the shell.
    editorContainer = editorRoot.parentElement;
    editorShell = mount.closest('.wysiwyg-shell') || editorContainer;

    if (!editorContainer) {
        window.alert('Editor failed to initialize.');
        return;
    }

    setupColorPickers();

    quill.on('selection-change', function (range) {
        if (range) {
            savedRange = range;
        }
    });

    (function setupToolbarHints() {
        var sizePicker = editorShell.querySelector('.ql-size');
        if (sizePicker) {
            sizePicker.setAttribute('title', 'Text size — changes only the selected words');
        }
        var headerPicker = editorShell.querySelector('.ql-header');
        if (headerPicker) {
            headerPicker.setAttribute('title', 'Heading — whole paragraph. Select words and pick a size to enlarge just those.');
        }
        var linkBtn = editorShell.querySelector('.ql-link');
        if (linkBtn) {
            linkBtn.setAttribute('title', 'Insert or edit a link');
        }
    })();

    quill.clipboard.addMatcher('DIV.wiki-thumb', function (node) {
        var value = thumbValueFromNode(node);
        var delta = thumbInsertDelta(value);
        if (value.caption) {
            delta.insert(value.caption);
        }
        delta.insert('\n');
        return delta;
    });

    quill.clipboard.addMatcher('IMG', function (node) {
        if (node.closest('.wiki-thumb')) {
            return new Delta();
        }
        return thumbInsertDelta({
            src: node.getAttribute('src') || '',
            width: node.getAttribute('width') || '',
            height: node.getAttribute('height') || '',
            align: 'none',
            caption: node.getAttribute('alt') || '',
            alt: node.getAttribute('alt') || '',
        });
    });

    function preventImageDrag(event) {
        event.preventDefault();
    }

    /* A thumbnail is a block embed: with nothing after it there is no caret
       position below the photo and the article cannot be continued. Only run
       this after insert/load — never on every keystroke, or the caret jumps. */
    function ensureEditableSpace() {
        if (ensuringSpace || !quill || !editorRoot) {
            return;
        }

        ensuringSpace = true;
        try {
            var thumbs = editorRoot.querySelectorAll('.wiki-thumb');
            var i;
            for (i = thumbs.length - 1; i >= 0; i -= 1) {
                var thumb = thumbs[i];
                var next = thumb.nextElementSibling;
                if (next && !next.classList.contains('wiki-thumb')) {
                    continue;
                }
                var blot = Quill.find(thumb);
                if (!blot) {
                    continue;
                }
                quill.insertText(quill.getIndex(blot) + 1, '\n', 'silent');
            }

            var last = editorRoot.lastElementChild;
            if (last && last.classList.contains('wiki-thumb')) {
                quill.insertText(quill.getLength(), '\n', 'silent');
            }
        } finally {
            ensuringSpace = false;
        }
    }

    function hoistCaptionsOutOfThumbs() {
        var captions = Array.from(editorRoot.querySelectorAll('.wiki-thumb .wiki-thumb-caption'));
        captions.reverse().forEach(function (caption) {
            var thumb = caption.closest('.wiki-thumb');
            var text = (caption.textContent || '').trim();
            var blot = thumb && Quill.find(thumb);
            caption.remove();
            if (!blot || !text) {
                return;
            }
            quill.insertText(quill.getIndex(blot) + 1, text + '\n', 'silent');
        });
    }

    function prepareEditorImages() {
        editorRoot.querySelectorAll('img').forEach(function (img) {
            img.setAttribute('draggable', 'false');
            if (!img.dataset.dragFixed) {
                img.dataset.dragFixed = '1';
                img.addEventListener('dragstart', preventImageDrag);
            }
        });
    }

    editorRoot.addEventListener('dragstart', function (event) {
        if (event.target && event.target.tagName === 'IMG') {
            event.preventDefault();
        }
    });

    editorRoot.addEventListener('dragover', function (event) {
        var hasFiles = event.dataTransfer.types && Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') !== -1;
        if (!hasFiles) {
            event.preventDefault();
        }
    });

    editorRoot.addEventListener('drop', function (event) {
        if (!event.dataTransfer.files || !event.dataTransfer.files.length) {
            event.preventDefault();
            event.stopPropagation();
        }
    });

    var imageTools = (function createImageTools() {
        var activeImg = null;
        var activeThumb = null;
        var overlay = null;
        var frame = null;
        var handle = null;
        var toolbar = null;
        var dragState = null;

        overlay = document.createElement('div');
        overlay.className = 'image-resize-overlay';
        overlay.hidden = true;

        frame = document.createElement('div');
        frame.className = 'image-resize-frame';

        handle = document.createElement('div');
        handle.className = 'image-resize-handle image-resize-handle--corner';
        handle.title = 'Resize';

        frame.appendChild(handle);
        overlay.appendChild(frame);

        toolbar = document.createElement('div');
        toolbar.className = 'image-toolbar';
        toolbar.hidden = true;
        toolbar.innerHTML =
            '<div class="image-toolbar-group" role="group" aria-label="Image alignment">' +
                '<button type="button" class="image-toolbar-btn" data-align="left" title="Float left"><span aria-hidden="true">←</span></button>' +
                '<button type="button" class="image-toolbar-btn" data-align="center" title="Center"><span aria-hidden="true">↔</span></button>' +
                '<button type="button" class="image-toolbar-btn" data-align="right" title="Float right"><span aria-hidden="true">→</span></button>' +
                '<button type="button" class="image-toolbar-btn" data-align="wide" title="Full width"><span aria-hidden="true">▭</span></button>' +
                '<button type="button" class="image-toolbar-btn" data-align="none" title="Inline"><span aria-hidden="true">▪</span></button>' +
            '</div>' +
            '<div class="image-toolbar-group" role="group" aria-label="Move image">' +
                '<button type="button" class="image-toolbar-btn" data-move="up" title="Move up">↑</button>' +
                '<button type="button" class="image-toolbar-btn" data-move="down" title="Move down">↓</button>' +
            '</div>' +
            '<div class="image-toolbar-group" role="group" aria-label="Delete image">' +
                '<button type="button" class="image-toolbar-btn image-toolbar-btn--danger" data-action="delete" title="Delete image" aria-label="Delete image">×</button>' +
            '</div>';

        editorContainer.appendChild(overlay);
        editorContainer.appendChild(toolbar);

        function clampSize(value, min, max) {
            return Math.max(min, Math.min(max, value));
        }

        function editorMaxWidth() {
            return editorRoot.clientWidth - 16;
        }

        function thumbInnerMaxWidth(thumb) {
            if (thumb) {
                return Math.max(MIN_IMAGE_SIZE, thumb.clientWidth - 12);
            }
            return editorMaxWidth();
        }

        function getThumbMaxWidth() {
            if (!activeThumb) {
                return editorMaxWidth();
            }
            var align = parseThumbAlign(activeThumb);
            if (align === 'wide') {
                return thumbInnerMaxWidth(activeThumb);
            }
            if (align === 'left' || align === 'right') {
                return Math.min(editorMaxWidth(), 320);
            }
            if (align === 'center') {
                return Math.min(editorMaxWidth(), 420);
            }
            return Math.min(editorMaxWidth(), 360);
        }

        function normalizeThumbImage(thumb, align) {
            var img = thumb && thumb.querySelector('img');
            if (!img) {
                return;
            }

            img.style.width = '';
            img.style.height = '';
            img.style.maxWidth = '';

            if (align === 'wide') {
                img.removeAttribute('width');
                img.removeAttribute('height');
                if (thumb) {
                    thumb.style.width = '';
                }
            }
        }

        function syncThumbContainerWidth(width) {
            if (!activeThumb) {
                return;
            }

            var align = parseThumbAlign(activeThumb);
            if (align === 'wide') {
                activeThumb.style.width = '';
                return;
            }

            activeThumb.style.width = Math.min(width + 12, getThumbMaxWidth() + 12) + 'px';
        }

        function syncOverlay() {
            if (!activeImg || overlay.hidden || !editorContainer) {
                return;
            }

            var containerRect = editorContainer.getBoundingClientRect();
            var targetRect = activeImg.getBoundingClientRect();

            overlay.style.left = (targetRect.left - containerRect.left) + 'px';
            overlay.style.top = (targetRect.top - containerRect.top) + 'px';
            overlay.style.width = targetRect.width + 'px';
            overlay.style.height = targetRect.height + 'px';

            if (!toolbar.hidden) {
                var toolbarWidth = toolbar.offsetWidth || 0;
                var left = targetRect.left - containerRect.left + (targetRect.width / 2) - (toolbarWidth / 2);
                left = clampSize(left, 4, editorContainer.clientWidth - toolbarWidth - 4);
                toolbar.style.left = left + 'px';
                toolbar.style.top = Math.max(4, targetRect.top - containerRect.top - toolbar.offsetHeight - 8) + 'px';
            }
        }

        function updateToolbarState() {
            if (!activeThumb) {
                return;
            }
            var align = parseThumbAlign(activeThumb);
            toolbar.querySelectorAll('[data-align]').forEach(function (button) {
                button.classList.toggle('is-active', button.getAttribute('data-align') === align);
            });
        }

        function clearSelection() {
            activeImg = null;
            activeThumb = null;
            overlay.hidden = true;
            toolbar.hidden = true;
            editorRoot.querySelectorAll('img.is-selected').forEach(function (img) {
                img.classList.remove('is-selected');
            });
            editorRoot.querySelectorAll('.wiki-thumb.is-selected').forEach(function (thumb) {
                thumb.classList.remove('is-selected');
            });
        }

        function select(img) {
            if (!img || img.tagName !== 'IMG') {
                return;
            }

            activeImg = img;
            activeThumb = img.closest('.wiki-thumb');

            editorRoot.querySelectorAll('img.is-selected').forEach(function (node) {
                node.classList.remove('is-selected');
            });
            editorRoot.querySelectorAll('.wiki-thumb.is-selected').forEach(function (node) {
                node.classList.remove('is-selected');
            });

            img.classList.add('is-selected');
            if (activeThumb) {
                activeThumb.classList.add('is-selected');
            }

            overlay.hidden = false;
            toolbar.hidden = false;
            updateToolbarState();
            syncOverlay();
        }

        function applySize(width, height) {
            if (!activeImg) {
                return;
            }

            var align = activeThumb ? parseThumbAlign(activeThumb) : 'none';
            if (align === 'wide') {
                applyThumbAlign(activeThumb, 'center');
                align = 'center';
                updateToolbarState();
            }

            var aspect = dragState ? (dragState.startWidth / dragState.startHeight) : (width / height);
            if (dragState && aspect > 0) {
                height = Math.round(width / aspect);
            }

            var maxWidth = getThumbMaxWidth();
            width = clampSize(Math.round(width), MIN_IMAGE_SIZE, maxWidth);
            height = clampSize(Math.round(height), MIN_IMAGE_SIZE, 1200);

            activeImg.style.width = '';
            activeImg.style.height = '';
            activeImg.style.maxWidth = '';
            activeImg.setAttribute('width', String(width));
            activeImg.setAttribute('height', String(height));
            syncThumbContainerWidth(width);
            syncOverlay();
        }

        function setAlign(align) {
            if (!activeThumb) {
                return;
            }
            applyThumbAlign(activeThumb, align);
            if (align === 'wide') {
                normalizeThumbImage(activeThumb, align);
            } else {
                var img = activeThumb.querySelector('img');
                var imgWidth = img && img.getAttribute('width') ? parseInt(img.getAttribute('width'), 10) : 0;
                if (imgWidth) {
                    syncThumbContainerWidth(imgWidth);
                } else {
                    activeThumb.style.width = '';
                }
            }
            updateToolbarState();
            syncOverlay();
            syncBodyToSource();
        }

        function deleteSelectedThumb() {
            if (!activeImg) {
                return;
            }

            var thumb = activeThumb;
            var blot = Quill.find(thumb || activeImg);
            if (blot) {
                blot.remove();
            } else if (thumb) {
                thumb.remove();
            } else {
                activeImg.remove();
            }

            clearSelection();
            syncBodyToSource();
        }

        function moveThumb(direction) {
            if (!activeThumb) {
                return;
            }

            var thumb = activeThumb;
            var img = activeImg;
            var blot = Quill.find(thumb);

            if (!blot || !blot.parent) {
                return;
            }

            var refBlot = direction === 'up' ? blot.prev : blot.next;
            if (!refBlot) {
                return;
            }

            if (direction === 'up') {
                blot.parent.insertBefore(blot, refBlot);
            } else {
                blot.parent.insertBefore(blot, refBlot.next);
            }

            syncBodyToSource();

            requestAnimationFrame(function () {
                if (!editorRoot.contains(thumb)) {
                    return;
                }
                var nextImg = img && editorRoot.contains(img) ? img : thumb.querySelector('img');
                if (nextImg) {
                    select(nextImg);
                }
            });
        }

        function startDrag(mode, event) {
            if (!activeImg) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            var rect = activeImg.getBoundingClientRect();
            dragState = {
                mode: mode,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startWidth: rect.width,
                startHeight: rect.height,
            };

            if (event.currentTarget.setPointerCapture) {
                event.currentTarget.setPointerCapture(event.pointerId);
            }

            overlay.classList.add('is-dragging');
            document.body.classList.add('image-resize-active');
        }

        function onDrag(event) {
            if (!dragState || !activeImg) {
                return;
            }

            event.preventDefault();

            var deltaX = event.clientX - dragState.startX;
            var deltaY = event.clientY - dragState.startY;
            var width = dragState.startWidth + deltaX;
            var height = dragState.startHeight + deltaY;

            applySize(width, height);
        }

        function stopDrag(event) {
            if (!dragState) {
                return;
            }

            if (event && event.currentTarget.releasePointerCapture) {
                try {
                    event.currentTarget.releasePointerCapture(dragState.pointerId);
                } catch (error) {
                    // Ignore if capture was already released.
                }
            }

            dragState = null;
            overlay.classList.remove('is-dragging');
            document.body.classList.remove('image-resize-active');
            syncBodyToSource();
        }

        handle.addEventListener('pointerdown', function (event) {
            startDrag('corner', event);
        });
        handle.addEventListener('pointermove', function (event) {
            if (dragState) {
                onDrag(event);
            }
        });
        handle.addEventListener('pointerup', stopDrag);
        handle.addEventListener('pointercancel', stopDrag);

        toolbar.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });

        toolbar.addEventListener('click', function (event) {
            var alignBtn = event.target.closest('[data-align]');
            if (alignBtn) {
                event.preventDefault();
                setAlign(alignBtn.getAttribute('data-align'));
                return;
            }

            var moveBtn = event.target.closest('[data-move]');
            if (moveBtn) {
                event.preventDefault();
                moveThumb(moveBtn.getAttribute('data-move'));
                return;
            }

            var deleteBtn = event.target.closest('[data-action="delete"]');
            if (deleteBtn) {
                event.preventDefault();
                deleteSelectedThumb();
            }
        });

        editorRoot.addEventListener('click', function (event) {
            if (dragState) {
                return;
            }

            if (event.target.closest('.image-toolbar')) {
                return;
            }

            var img = event.target.closest('img');
            if (img && editorRoot.contains(img)) {
                select(img);
                return;
            }

            if (!overlay.contains(event.target)) {
                clearSelection();
            }
        });

        editorRoot.addEventListener('scroll', syncOverlay);
        window.addEventListener('scroll', syncOverlay, true);
        window.addEventListener('resize', syncOverlay);

        quill.on('text-change', function (delta, oldDelta, source) {
            if (source !== 'silent') {
                syncBodyToSource();
            }
            if (source === 'user' && activeImg && !editorRoot.contains(activeImg)) {
                clearSelection();
            } else {
                syncOverlay();
            }
        });

        editorRoot.addEventListener('keydown', function (event) {
            if (!activeImg) {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            var range = quill.getSelection();
            if (range) {
                return;
            }

            if (event.key === 'Escape') {
                clearSelection();
                return;
            }

            if (event.key === 'Delete' || event.key === 'Backspace') {
                deleteSelectedThumb();
                event.preventDefault();
            }
        });

        return {
            select: select,
            clear: clearSelection,
            sync: syncOverlay,
        };
    })();

    if (form) {
        ['#id_title', '#id_introduction'].forEach(function (selector) {
            var field = form.querySelector(selector);
            if (!field) {
                return;
            }
            field.addEventListener('mousedown', function () {
                lockPageScroll();
            });
            field.addEventListener('focus', function () {
                preservePageScroll(function () {
                    activeBasicsField = field;
                    blurQuillEditor();
                    setBasicsFocus(true);
                });
            });
        });

        form.addEventListener('focusin', function (event) {
            if (isBasicsField(event.target)) {
                preservePageScroll(function () {
                    activeBasicsField = event.target;
                    blurQuillEditor();
                    setBasicsFocus(true);
                });
                return;
            }
            if (editorShell && editorShell.contains(event.target)) {
                activeBasicsField = null;
                setBasicsFocus(false);
            }
        });

        form.addEventListener('mousedown', function (event) {
            if (event.target.closest(
                '.wysiwyg-shell, input, textarea, select, button, a, label, .profile-trigger, .profile-card, #cover-image-placeholder, .cover-image-preview-wrap'
            )) {
                return;
            }
            event.preventDefault();
            releaseFormFocus();
        });
    }

    if (editorShell) {
        editorShell.addEventListener('focusin', function (event) {
            if (!form || !form.classList.contains('article-form--basics-focus')) {
                return;
            }
            event.stopPropagation();
            preservePageScroll(function () {
                blurQuillEditor();
                if (activeBasicsField && document.activeElement !== activeBasicsField) {
                    activeBasicsField.focus({ preventScroll: true });
                }
            });
        }, true);

        editorShell.addEventListener('mousedown', function () {
            activeBasicsField = null;
            setBasicsFocus(false);
        });
    }

    var quillToolbar = editorShell.querySelector('.ql-toolbar');
    if (quillToolbar) {
        quillToolbar.addEventListener('mousedown', function (event) {
            var current = quill.getSelection();
            if (current) {
                savedRange = current;
            }
            if (event.target.closest('.ql-image') || event.target.closest('.ql-link')) {
                return;
            }
            if (event.target.closest('button')) {
                imageTools.clear();
            }
        }, true);
    }

    function migratePlainImages() {
        var tasks = [];

        Array.from(editorRoot.querySelectorAll('img')).forEach(function (img) {
            if (img.closest('.wiki-thumb')) {
                return;
            }

            var blot = Quill.find(img);
            if (!blot) {
                return;
            }

            var index = quill.getIndex(blot);
            var parent = img.parentNode;
            if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
                var parentBlot = Quill.find(parent);
                if (parentBlot) {
                    index = quill.getIndex(parentBlot);
                    blot = parentBlot;
                }
            }

            tasks.push({
                blot: blot,
                index: index,
                value: {
                    src: img.getAttribute('src') || '',
                    width: img.getAttribute('width') || '',
                    height: img.getAttribute('height') || '',
                    align: 'none',
                    caption: img.getAttribute('alt') || '',
                    alt: img.getAttribute('alt') || '',
                },
            });
        });

        tasks.sort(function (a, b) {
            return b.index - a.index;
        });

        tasks.forEach(function (task) {
            task.blot.remove();
            quill.insertEmbed(task.index, THUMB_BLOT_NAME, task.value, 'silent');
            quill.insertText(task.index + 1, '\n', 'silent');
        });

        prepareEditorImages();
    }

    function normalizeLoadedImages() {
        editorRoot.querySelectorAll('.wiki-thumb').forEach(function (thumb) {
            normalizeThumbImageForLoad(thumb);
        });
        editorRoot.querySelectorAll('.wiki-thumb img').forEach(function (img) {
            var thumb = img.closest('.wiki-thumb');
            var align = thumb ? parseThumbAlign(thumb) : 'none';
            if (align !== 'wide') {
                if (!img.getAttribute('width') && img.style.width) {
                    var width = parseInt(img.style.width, 10);
                    if (width) {
                        img.setAttribute('width', String(width));
                    }
                }
                if (!img.getAttribute('height') && img.style.height) {
                    var height = parseInt(img.style.height, 10);
                    if (height) {
                        img.setAttribute('height', String(height));
                    }
                }
            }
            img.style.width = '';
            img.style.height = '';
            img.style.maxWidth = '';
        });
        prepareEditorImages();
    }

    function normalizeThumbImageForLoad(thumb) {
        if (!thumb) {
            return;
        }
        var align = parseThumbAlign(thumb);
        var img = thumb.querySelector('img');
        if (!img) {
            return;
        }
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '';
        if (align === 'wide') {
            img.removeAttribute('width');
            img.removeAttribute('height');
        }
    }

    if (source.value.trim()) {
        quill.setContents(quill.clipboard.convert(source.value), 'silent');
        migratePlainImages();
        hoistCaptionsOutOfThumbs();
        normalizeLoadedImages();
    } else {
        prepareEditorImages();
    }
    ensureEditableSpace();
    preservePageScroll(blurQuillEditor);

    function clampLinkTooltip() {
        var tooltip = editorContainer.querySelector('.ql-tooltip');
        if (!tooltip || tooltip.classList.contains('ql-hidden')) {
            return;
        }

        var container = editorContainer;

        var padding = 8;
        var maxLeft = container.offsetWidth - tooltip.offsetWidth - padding;
        var left = parseFloat(tooltip.style.left) || 0;

        if (left < padding) {
            tooltip.style.left = padding + 'px';
        } else if (left > maxLeft) {
            tooltip.style.left = Math.max(padding, maxLeft) + 'px';
        }
    }

    var tooltip = editorContainer.querySelector('.ql-tooltip');
    if (tooltip) {
        var tooltipObserver = new MutationObserver(function () {
            requestAnimationFrame(clampLinkTooltip);
        });
        tooltipObserver.observe(tooltip, {
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
    }

    quill.on('selection-change', function () {
        requestAnimationFrame(function () {
            clampLinkTooltip();
            if (imageTools) {
                imageTools.sync();
            }
        });
    });

    var panel = editorShell;

    if (panel) {
        panel.addEventListener('dragover', function (event) {
            var hasFiles = event.dataTransfer.types && Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') !== -1;
            if (!hasFiles) {
                return;
            }
            event.preventDefault();
            panel.classList.add('wysiwyg-dragover');
        });

        panel.addEventListener('dragleave', function (event) {
            if (!panel.contains(event.relatedTarget)) {
                panel.classList.remove('wysiwyg-dragover');
            }
        });

        panel.addEventListener('drop', function (event) {
            var file = event.dataTransfer.files && event.dataTransfer.files[0];
            if (!file || !file.type.startsWith('image/')) {
                event.preventDefault();
                event.stopPropagation();
                panel.classList.remove('wysiwyg-dragover');
                return;
            }

            event.preventDefault();
            panel.classList.remove('wysiwyg-dragover');
            var range = quill.getSelection() || { index: quill.getLength() };
            uploadImage(file)
                .then(function (url) {
                    insertThumbAt(range.index, url);
                })
                .catch(function (error) {
                    window.alert(error.message || 'Could not upload image.');
                });
        });
    }

    function syncBodyToSource() {
        if (!source || !editorRoot) {
            return;
        }
        source.value = serializeEditorHtml();
    }

    editorRoot.addEventListener('input', function () {
        syncBodyToSource();
    });

    if (form) {
        form.addEventListener('submit', function () {
            unlockPageScroll();
            imageTools.clear();
            syncBodyToSource();
        });
    }

    var coverInput = document.getElementById('id_image');
    var coverPreview = document.getElementById('cover-image-preview');
    var coverPlaceholder = document.getElementById('cover-image-placeholder');
    var coverClearField = document.getElementById('id_clear_cover');
    var coverClear = document.getElementById('cover-image-clear');

    function showCoverPreview(file) {
        if (!coverPreview || !file) {
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            coverPreview.src = reader.result;
            coverPreview.hidden = false;
            if (coverPlaceholder) {
                coverPlaceholder.hidden = true;
            }
            if (coverClear) {
                coverClear.hidden = false;
            }
            if (coverClearField) {
                coverClearField.checked = false;
            }
        };
        reader.readAsDataURL(file);
    }

    if (coverInput) {
        coverInput.addEventListener('change', function () {
            var file = coverInput.files && coverInput.files[0];
            if (file) {
                showCoverPreview(file);
            }
        });
    }

    if (coverPlaceholder && coverInput) {
        coverPlaceholder.addEventListener('click', function () {
            coverInput.click();
        });
        coverPlaceholder.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                coverInput.click();
            }
        });
    }

    var coverPreviewWrap = document.querySelector('.cover-image-preview-wrap');
    if (coverPreviewWrap && coverInput) {
        coverPreviewWrap.addEventListener('click', function (event) {
            if (event.target.closest('#cover-image-clear')) {
                return;
            }
            if (coverPreview && !coverPreview.hidden) {
                return;
            }
            coverInput.click();
        });
    }

    if (coverClear) {
        coverClear.addEventListener('click', function () {
            if (coverInput) {
                coverInput.value = '';
            }
            if (coverPreview) {
                coverPreview.hidden = true;
                coverPreview.removeAttribute('src');
            }
            if (coverPlaceholder) {
                coverPlaceholder.hidden = false;
            }
            coverClear.hidden = true;
            if (coverClearField) {
                coverClearField.checked = true;
            }
        });
    }
})();
