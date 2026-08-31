(function () {
    'use strict';

    var tabId = window.BIKIBEDIA_TAB_ID;
    if (!tabId) {
        return;
    }

    function shouldSkipPath(pathname) {
        return (
            pathname.indexOf('/static/') === 0 ||
            pathname.indexOf('/media/') === 0
        );
    }

    function addTabToUrl(url) {
        try {
            var parsed = new URL(url, window.location.origin);
            if (parsed.origin !== window.location.origin) {
                return url;
            }
            if (shouldSkipPath(parsed.pathname)) {
                return url;
            }
            parsed.searchParams.set('__tab', tabId);
            return parsed.pathname + parsed.search + parsed.hash;
        } catch (error) {
            return url;
        }
    }

    function patchLinks(root) {
        root.querySelectorAll('a[href]').forEach(function (link) {
            var href = link.getAttribute('href');
            if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) {
                return;
            }
            if (link.getAttribute('target') === '_blank') {
                return;
            }
            link.setAttribute('href', addTabToUrl(href));
        });
    }

    function patchForms(root) {
        root.querySelectorAll('form').forEach(function (form) {
            var method = (form.getAttribute('method') || 'get').toLowerCase();
            var action = form.getAttribute('action') || window.location.pathname;

            if (method === 'get') {
                form.setAttribute('action', addTabToUrl(action));
                return;
            }

            if (!form.querySelector('input[name="_tab"]')) {
                var input = document.createElement('input');
                input.type = 'hidden';
                input.name = '_tab';
                input.value = tabId;
                form.appendChild(input);
            }
        });
    }

    function patchDocument() {
        patchLinks(document);
        patchForms(document);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchDocument);
    } else {
        patchDocument();
    }
})();
