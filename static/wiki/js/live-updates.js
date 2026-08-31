/*
 * Keeps pages fresh without a reload.
 *
 * A single poll to /api/live/ drives the article feed, the notification badge,
 * the moderation badge and the moderation activity log. Polling backs off while
 * the tab is hidden and resumes immediately when it becomes visible again.
 */
(function () {
    'use strict';

    var ACTIVE_INTERVAL_MS = 15000;
    var HIDDEN_INTERVAL_MS = 60000;
    var ENDPOINT = '/api/live/';
    var TOAST_TIMEOUT_MS = 9000;

    var lastSeenAt = null;
    var timer = null;
    var inFlight = false;
    var toastHost = null;
    // Slugs the reader has already been shown, so a repeat appearance reads as
    // an update rather than a fresh publication.
    var seenSlugs = new Set();

    function buildUrl() {
        var url = ENDPOINT + '?_=' + Date.now();
        if (lastSeenAt) {
            url += '&since=' + encodeURIComponent(lastSeenAt);
        }
        if (window.BIKIBEDIA_TAB_ID) {
            url += '&__tab=' + encodeURIComponent(window.BIKIBEDIA_TAB_ID);
        }
        return url;
    }

    function formatBadge(count) {
        return count > 0 ? ' (' + count + ')' : '';
    }

    function updateBadges(state) {
        var notifications = document.querySelector('[data-live-notification-badge]');
        if (notifications) {
            notifications.textContent = formatBadge(state.notifications.unread);
        }

        var moderation = document.querySelector('[data-live-moderation-badge]');
        if (moderation) {
            moderation.textContent = formatBadge(state.moderation.pending);
        }

        var moderationText = document.querySelector('[data-live-moderation-text]');
        if (moderationText) {
            var pending = state.moderation.pending;
            moderationText.textContent = pending + ' submission' + (pending === 1 ? '' : 's');
        }

        var count = document.querySelector('[data-live-article-count]');
        if (count) {
            count.textContent = state.articles.count;
        }
    }

    function buildArticleItem(article, listStyle) {
        var li = document.createElement('li');
        li.setAttribute('data-article-slug', article.slug);
        li.className = 'live-article-new';

        var link = document.createElement('a');
        link.href = article.url;
        link.textContent = article.title;
        if (listStyle === 'home') {
            link.className = 'home-latest-link';
        }
        li.appendChild(link);

        if (listStyle === 'home') {
            var time = document.createElement('time');
            time.setAttribute('datetime', article.updated_at);
            time.textContent = article.updated_label;
            li.appendChild(time);
        }

        return li;
    }

    function updateArticleLists(articles) {
        if (!articles.new.length) {
            return 0;
        }

        var added = 0;
        document.querySelectorAll('[data-live-article-list]').forEach(function (list) {
            var listStyle = list.classList.contains('home-latest-list') ? 'home' : 'plain';
            var limit = parseInt(list.getAttribute('data-live-limit') || '0', 10);

            // Oldest first so repeated prepends keep newest at the top.
            articles.new.slice().reverse().forEach(function (article) {
                if (list.querySelector('[data-article-slug="' + CSS.escape(article.slug) + '"]')) {
                    return;
                }
                list.prepend(buildArticleItem(article, listStyle));
                added += 1;
            });

            if (limit > 0) {
                while (list.children.length > limit) {
                    list.removeChild(list.lastElementChild);
                }
            }
        });

        return added;
    }

    function ensureToastHost() {
        if (toastHost) {
            return toastHost;
        }
        toastHost = document.createElement('div');
        toastHost.className = 'live-toast-host';
        toastHost.setAttribute('role', 'status');
        toastHost.setAttribute('aria-live', 'polite');
        document.body.appendChild(toastHost);
        return toastHost;
    }

    function showToast(article, isNew) {
        var host = ensureToastHost();
        var toast = document.createElement('div');
        toast.className = 'live-toast';

        var label = document.createElement('span');
        label.className = 'live-toast-label';
        label.textContent = isNew ? 'Just published' : 'Just updated';
        toast.appendChild(label);

        var link = document.createElement('a');
        link.className = 'live-toast-link';
        link.href = article.url;
        link.textContent = article.title;
        toast.appendChild(link);

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'live-toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '×';
        close.addEventListener('click', function () {
            toast.remove();
        });
        toast.appendChild(close);

        host.appendChild(toast);
        window.setTimeout(function () {
            toast.classList.add('is-leaving');
            window.setTimeout(function () { toast.remove(); }, 400);
        }, TOAST_TIMEOUT_MS);
    }

    function renderModerationLog(entries) {
        var host = document.querySelector('ul[data-live-moderation-log]');
        if (!host || !entries.length) {
            return;
        }

        // Server-rendered rows already carry data-log-id, so only genuinely
        // unseen entries get prepended.
        entries.filter(function (entry) {
            return !host.querySelector('[data-log-id="' + entry.id + '"]');
        }).reverse().forEach(function (entry) {
            host.prepend(buildLogItem(entry));
        });

        while (host.children.length > 8) {
            host.removeChild(host.lastElementChild);
        }
    }

    function buildLogItem(entry) {
        var li = document.createElement('li');
        li.className = 'mod-log-item mod-log-item--' + entry.tone + ' live-article-new';
        li.setAttribute('data-log-id', entry.id);

        var badge = document.createElement('span');
        badge.className = 'mod-log-badge mod-log-badge--' + entry.tone;
        badge.textContent = entry.action_label;
        li.appendChild(badge);

        var body = document.createElement('div');
        body.className = 'mod-log-body';

        var title = document.createElement('p');
        title.className = 'mod-log-title';
        if (entry.slug) {
            var link = document.createElement('a');
            link.href = '/wiki/' + entry.slug + '/';
            link.textContent = entry.title;
            title.appendChild(link);
        } else {
            title.textContent = entry.title;
        }
        body.appendChild(title);

        var meta = document.createElement('p');
        meta.className = 'mod-log-meta';
        var actor = document.createElement('strong');
        actor.textContent = entry.actor;
        meta.appendChild(actor);
        body.appendChild(meta);

        if (entry.comment) {
            var comment = document.createElement('p');
            comment.className = 'mod-log-comment';
            comment.textContent = entry.comment;
            body.appendChild(comment);
        }

        li.appendChild(body);
        return li;
    }

    function apply(state) {
        updateBadges(state);
        updateArticleLists(state.articles);

        // articles.new is only populated once a `since` marker exists, so the
        // very first poll seeds the seen set instead of raising toasts.
        state.articles.new.forEach(function (article) {
            showToast(article, !seenSlugs.has(article.slug));
        });

        state.articles.latest.forEach(function (article) {
            seenSlugs.add(article.slug);
        });

        renderModerationLog(state.moderation.log || []);
        lastSeenAt = state.server_time;
    }

    function poll() {
        if (inFlight) {
            return;
        }
        inFlight = true;

        fetch(buildUrl(), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('live poll failed');
                }
                return response.json();
            })
            .then(apply)
            .catch(function () {
                // Transient failures are fine; the next tick retries.
            })
            .finally(function () {
                inFlight = false;
            });
    }

    function schedule() {
        window.clearInterval(timer);
        var interval = document.hidden ? HIDDEN_INTERVAL_MS : ACTIVE_INTERVAL_MS;
        timer = window.setInterval(poll, interval);
    }

    document.addEventListener('visibilitychange', function () {
        schedule();
        if (!document.hidden) {
            poll();
        }
    });

    poll();
    schedule();
})();
