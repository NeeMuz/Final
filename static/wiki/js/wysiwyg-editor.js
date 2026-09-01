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

    function normalizeThumbText(value) {
        return String(value || '').trim();
    }

    function buildThumbTextNode(className, placeholder, text) {
        var normalized = normalizeThumbText(text);
        if (!normalized) {
            return null;
        }
        var node = document.createElement('p');
        node.className = className;
        node.setAttribute('data-placeholder', placeholder);
        node.textContent = normalized;
        return node;
    }

    function serializeEditorHtml() {
        var clone = editorRoot.cloneNode(true);
        clone.querySelectorAll('.wiki-thumb').forEach(function (thumb) {
            thumb.classList.remove('is-selected');
            thumb.querySelectorAll('img.is-selected').forEach(function (img) {
                img.classList.remove('is-selected');
            });

            var img = thumb.querySelector('img');
            var labelField = thumb.querySelector('.wiki-thumb-field--label');
            var captionField = thumb.querySelector('.wiki-thumb-field--caption');
            if (labelField) {
                var labelText = normalizeThumbText(labelField.value);
                labelField.remove();
                thumb.querySelectorAll('.wiki-thumb-label').forEach(function (node) {
                    node.remove();
                });
                if (labelText && img) {
                    thumb.insertBefore(buildThumbTextNode('wiki-thumb-label', 'Text above image', labelText), img);
                }
            }
            if (captionField) {
                var captionText = normalizeThumbText(captionField.value);
                captionField.remove();
                thumb.querySelectorAll('.wiki-thumb-caption').forEach(function (node) {
                    node.remove();
                });
                if (captionText) {
                    thumb.appendChild(buildThumbTextNode('wiki-thumb-caption', 'Caption', captionText));
                }
            }

            thumb.querySelectorAll('.wiki-thumb-label, .wiki-thumb-caption').forEach(function (node) {
                if (!normalizeThumbText(node.textContent)) {
                    node.remove();
                } else {
                    node.classList.remove('is-empty');
                }
            });
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
        var label = normalizeThumbText(value && value.label);
        var caption = normalizeThumbText(value && value.caption);
        var parts = ['<div class="wiki-thumb wiki-thumb--' + align + '">'];
        if (label) {
            parts.push('<p class="wiki-thumb-label">' + escapeAttr(label) + '</p>');
        }
        parts.push('<img src="' + src + '" draggable="false"' + width + height + '>');
        if (caption) {
            parts.push('<p class="wiki-thumb-caption">' + escapeAttr(caption) + '</p>');
        }
        parts.push('</div>');
        return parts.join('');
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
        var label = node.querySelector('.wiki-thumb-label');
        var caption = node.querySelector('.wiki-thumb-caption');
        return {
            src: img ? img.getAttribute('src') : '',
            width: img ? img.getAttribute('width') : '',
            height: img ? img.getAttribute('height') : '',
            align: parseThumbAlign(node),
            label: label ? readCaptionText(label) : '',
            caption: caption ? readCaptionText(caption) : '',
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

        var labelNode = buildThumbTextNode('wiki-thumb-label', 'Text above image', value && value.label);
        if (labelNode) {
            node.appendChild(labelNode);
        }

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

        var captionNode = buildThumbTextNode('wiki-thumb-caption', 'Caption', value && value.caption);
        if (captionNode) {
            node.appendChild(captionNode);
        }

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
            label: '',
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

    function isLinkTooltipActive() {
        if (!editorContainer) {
            return false;
        }
        var tooltip = editorContainer.querySelector('.ql-tooltip');
        return !!(tooltip && tooltip.classList.contains('ql-editing') && !tooltip.classList.contains('ql-hidden'));
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
        if (isLinkTooltipActive()) {
            return;
        }
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
                if (node !== editorRoot && node.closest('.ql-tooltip')) {
                    return;
                }
                if (node.closest('.wiki-thumb-field')) {
                    return;
                }
                if (node !== editorRoot && document.activeElement === node && typeof node.blur === 'function') {
                    node.blur();
                }
            });
        }
        if (document.activeElement === editorRoot ||
            (editorShell.contains(document.activeElement) && !document.activeElement.closest('.ql-tooltip'))) {
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
            blurQuillEditor();
            if (imageTools) {
                imageTools.clear();
            }
            return;
        }
        activeBasicsField = null;
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
        if (isLinkTooltipActive()) {
            return;
        }
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
        quill.setSelection(range.index, range.length, 'silent');
        window.setTimeout(function () {
            if (!quill.theme || !quill.theme.tooltip || typeof quill.theme.tooltip.edit !== 'function') {
                return;
            }
            var liveRange = quill.getSelection() || range;
            var tooltip = quill.theme.tooltip;
            if (liveRange.length > 0) {
                tooltip.linkRange = liveRange;
                tooltip.edit('link', quill.getText(liveRange));
            } else {
                delete tooltip.linkRange;
                tooltip.edit('link');
            }
        }, 0);
    }

    /* Quill Snow closes the link tooltip on every selection-change while
       ql-editing is set. Keep the editor open until Save, Remove, Escape,
       or an outside click explicitly dismisses it. */
    function patchQuillLinkTooltip() {
        var tooltip = quill.theme && quill.theme.tooltip;
        if (!tooltip || tooltip.__wikiLinkPatch) {
            return;
        }
        tooltip.__wikiLinkPatch = true;

        var nativeHide = tooltip.hide.bind(tooltip);

        function closeLinkEditor() {
            tooltip.root.classList.remove('ql-editing');
            nativeHide();
        }

        tooltip.hide = function () {
            if (tooltip.root.classList.contains('ql-editing')) {
                return;
            }
            nativeHide();
        };

        var nativeSave = tooltip.save.bind(tooltip);
        tooltip.save = function () {
            tooltip.root.classList.remove('ql-editing');
            nativeSave();
        };

        var nativeCancel = tooltip.cancel.bind(tooltip);
        tooltip.cancel = function () {
            tooltip.root.classList.remove('ql-editing');
            nativeCancel();
        };

        var removeBtn = tooltip.root.querySelector('a.ql-remove');
        if (removeBtn) {
            removeBtn.addEventListener('click', function () {
                tooltip.root.classList.remove('ql-editing');
            }, true);
        }

        document.addEventListener('click', function (event) {
            if (!tooltip.root.classList.contains('ql-editing') ||
                tooltip.root.classList.contains('ql-hidden')) {
                return;
            }
            if (tooltip.root.contains(event.target) || event.target.closest('.ql-link')) {
                return;
            }
            closeLinkEditor();
        }, true);
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
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    ['blockquote', 'code-block'],
                    ['image'],
                    ['clean'],
                ],
                handlers: {
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
    patchQuillLinkTooltip();

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
    })();

    quill.clipboard.addMatcher('DIV.wiki-thumb', function (node) {
        return thumbInsertDelta(thumbValueFromNode(node)).insert('\n');
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

        function autosizeThumbField(field) {
            if (!field) {
                return;
            }
            field.style.height = 'auto';
            field.style.height = Math.max(28, field.scrollHeight) + 'px';
        }

        function bindThumbField(field) {
            field.addEventListener('mousedown', function (event) {
                event.stopPropagation();
            });
            field.addEventListener('input', function () {
                autosizeThumbField(field);
                syncBodyToSource();
            });
        }

        function openThumbEditFields(thumb) {
            if (!thumb) {
                return;
            }
            var img = thumb.querySelector('img');
            if (!img) {
                return;
            }

            var labelNode = thumb.querySelector('.wiki-thumb-label');
            var captionNode = thumb.querySelector('.wiki-thumb-caption');
            var labelValue = labelNode ? readCaptionText(labelNode) : '';
            var captionValue = captionNode ? readCaptionText(captionNode) : '';
            if (labelNode) {
                labelNode.remove();
            }
            if (captionNode) {
                captionNode.remove();
            }

            var labelField = thumb.querySelector('.wiki-thumb-field--label');
            var captionField = thumb.querySelector('.wiki-thumb-field--caption');

            if (!labelField) {
                labelField = document.createElement('textarea');
                labelField.className = 'wiki-thumb-field wiki-thumb-field--label';
                labelField.placeholder = 'Текст над фото';
                labelField.rows = 1;
                labelField.setAttribute('aria-label', 'Text above image');
                bindThumbField(labelField);
                thumb.insertBefore(labelField, img);
            }
            if (!captionField) {
                captionField = document.createElement('textarea');
                captionField.className = 'wiki-thumb-field wiki-thumb-field--caption';
                captionField.placeholder = 'Подпись под фото';
                captionField.rows = 2;
                captionField.setAttribute('aria-label', 'Image caption');
                bindThumbField(captionField);
                thumb.appendChild(captionField);
            }

            labelField.value = labelValue;
            captionField.value = captionValue;
            autosizeThumbField(labelField);
            autosizeThumbField(captionField);
        }

        function commitThumbEditFields(thumb) {
            if (!thumb) {
                return;
            }

            var img = thumb.querySelector('img');
            var labelField = thumb.querySelector('.wiki-thumb-field--label');
            var captionField = thumb.querySelector('.wiki-thumb-field--caption');
            if (!labelField && !captionField) {
                return;
            }

            var labelText = labelField ? normalizeThumbText(labelField.value) : '';
            var captionText = captionField ? normalizeThumbText(captionField.value) : '';

            if (labelField) {
                labelField.remove();
            }
            if (captionField) {
                captionField.remove();
            }
            thumb.querySelectorAll('.wiki-thumb-label, .wiki-thumb-caption').forEach(function (node) {
                node.remove();
            });

            if (labelText && img) {
                thumb.insertBefore(buildThumbTextNode('wiki-thumb-label', 'Text above image', labelText), img);
            }
            if (captionText) {
                thumb.appendChild(buildThumbTextNode('wiki-thumb-caption', 'Caption', captionText));
            }

            syncBodyToSource();
        }

        function isThumbTextEditorTarget(target) {
            return !!(target && target.closest && target.closest('.wiki-thumb-field'));
        }

        function focusThumbTextField(kind) {
            if (!activeThumb) {
                return;
            }
            var selector = kind === 'label' ? '.wiki-thumb-field--label' : '.wiki-thumb-field--caption';
            var field = activeThumb.querySelector(selector);
            if (!field) {
                openThumbEditFields(activeThumb);
                field = activeThumb.querySelector(selector);
            }
            if (field) {
                window.setTimeout(function () {
                    field.focus();
                }, 0);
            }
        }

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
                var thumbRect = activeThumb ?
                    activeThumb.getBoundingClientRect() :
                    targetRect;
                var toolbarWidth = toolbar.offsetWidth || 0;
                var toolbarHeight = toolbar.offsetHeight || 0;
                var left = thumbRect.left - containerRect.left - toolbarWidth - 8;
                var top = thumbRect.top - containerRect.top + (thumbRect.height / 2) - (toolbarHeight / 2);

                if (left < 4) {
                    left = thumbRect.right - containerRect.left + 8;
                }
                left = clampSize(left, 4, editorContainer.clientWidth - toolbarWidth - 4);
                top = clampSize(top, 4, editorContainer.clientHeight - toolbarHeight - 4);

                toolbar.style.left = left + 'px';
                toolbar.style.top = top + 'px';
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
            if (activeThumb) {
                commitThumbEditFields(activeThumb);
            }
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

            var nextThumb = img.closest('.wiki-thumb');
            if (activeThumb && activeThumb !== nextThumb) {
                commitThumbEditFields(activeThumb);
            }

            activeImg = img;
            activeThumb = nextThumb;

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
            if (activeThumb) {
                openThumbEditFields(activeThumb);
            }
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
            if (align === 'left' || align === 'right') {
                ensureEditableSpace();
                var img = activeThumb.querySelector('img');
                if (img) {
                    focusAfterThumb(img);
                }
            }
        }

        function deleteSelectedThumb() {
            if (!activeImg) {
                return;
            }

            if (activeThumb) {
                commitThumbEditFields(activeThumb);
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

            if (event.target.closest('.image-toolbar') || isThumbTextEditorTarget(event.target)) {
                return;
            }

            var textTarget = event.target.closest('.wiki-thumb-label, .wiki-thumb-caption');
            if (textTarget) {
                var textThumb = textTarget.closest('.wiki-thumb');
                var textImg = textThumb && textThumb.querySelector('img');
                if (textImg) {
                    select(textImg);
                    focusThumbTextField(textTarget.classList.contains('wiki-thumb-label') ? 'label' : 'caption');
                }
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
            isTextEditorTarget: isThumbTextEditorTarget,
        };
    })();

    if (form) {
        ['#id_title', '#id_introduction'].forEach(function (selector) {
            var field = form.querySelector(selector);
            if (!field) {
                return;
            }
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

        form.addEventListener('click', function (event) {
            if (isLinkTooltipActive()) {
                return;
            }
            if (event.target.closest(
                '.wysiwyg-shell, input, textarea, select, button, a, label, .profile-trigger, .profile-card, #cover-image-placeholder, .cover-image-preview-wrap, .ql-tooltip'
            )) {
                return;
            }
            var selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            releaseFormFocus();
        });
    }

    if (editorShell) {
        editorShell.addEventListener('focusin', function (event) {
            if (isLinkTooltipActive() || event.target.closest('.ql-tooltip')) {
                return;
            }
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
            if (event.target.closest('.ql-image')) {
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

        var padding = 8;
        var maxLeft = editorContainer.offsetWidth - tooltip.offsetWidth - padding;
        var left = parseFloat(tooltip.style.left) || 0;

        if (left < padding) {
            tooltip.style.left = padding + 'px';
        } else if (left > maxLeft) {
            tooltip.style.left = Math.max(padding, maxLeft) + 'px';
        }
    }

    var linkTooltip = editorContainer.querySelector('.ql-tooltip');
    if (linkTooltip) {
        var linkTooltipObserver = new MutationObserver(function () {
            requestAnimationFrame(clampLinkTooltip);
        });
        linkTooltipObserver.observe(linkTooltip, {
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
