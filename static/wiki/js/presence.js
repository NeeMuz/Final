(function () {
    'use strict';

    if (!window.BIKIBEDIA_USER_ID) {
        return;
    }

    var PING_INTERVAL_MS = 45000;

    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : '';
    }

    function pingPresence() {
        var body = new FormData();
        body.append('csrfmiddlewaretoken', getCookie('csrftoken'));
        if (window.BIKIBEDIA_TAB_ID) {
            body.append('_tab', window.BIKIBEDIA_TAB_ID);
        }

        var url = '/accounts/presence/';
        if (window.BIKIBEDIA_TAB_ID) {
            url += '?__tab=' + encodeURIComponent(window.BIKIBEDIA_TAB_ID);
        }

        fetch(url, {
            method: 'POST',
            body: body,
            credentials: 'same-origin',
        }).catch(function () {
            // Ignore network errors for background pings.
        });
    }

    pingPresence();
    window.setInterval(pingPresence, PING_INTERVAL_MS);
})();
