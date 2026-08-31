/*
 * Inline form feedback for signup and the article editor.
 *
 * Every rule here mirrors a server-side rule; the backend stays the source of
 * truth and this only shortens the feedback loop.
 */
(function () {
    'use strict';

    var CHECK_ENDPOINT = '/api/auth/check/';
    var DEBOUNCE_MS = 350;

    function withTab(url) {
        if (!window.BIKIBEDIA_TAB_ID) {
            return url;
        }
        return url + (url.indexOf('?') === -1 ? '?' : '&') +
            '__tab=' + encodeURIComponent(window.BIKIBEDIA_TAB_ID);
    }

    function debounce(fn, wait) {
        var timer = null;
        return function () {
            var args = arguments;
            window.clearTimeout(timer);
            timer = window.setTimeout(function () { fn.apply(null, args); }, wait);
        };
    }

    function hintFor(field) {
        var existing = field.parentElement.querySelector('[data-field-hint="' + field.id + '"]');
        if (existing) {
            return existing;
        }

        var hint = document.createElement('p');
        hint.className = 'field-hint';
        hint.setAttribute('data-field-hint', field.id);
        hint.setAttribute('aria-live', 'polite');
        field.insertAdjacentElement('afterend', hint);
        return hint;
    }

    function setState(field, state, message) {
        var hint = hintFor(field);
        hint.textContent = message || '';
        hint.className = 'field-hint' + (state && state !== 'idle' ? ' field-hint--' + state : '');
        field.classList.toggle('is-invalid', state === 'error');
        field.classList.toggle('is-valid', state === 'ok');
        if (state === 'error') {
            field.setAttribute('aria-invalid', 'true');
        } else {
            field.removeAttribute('aria-invalid');
        }
    }

    function remoteCheck(field, kind, extra) {
        var value = field.value;
        if (!value.trim()) {
            setState(field, 'idle', '');
            return;
        }

        var url = withTab(CHECK_ENDPOINT) +
            '&field=' + encodeURIComponent(kind) +
            '&value=' + encodeURIComponent(value);
        if (extra) {
            url += extra;
        }

        fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (field.value !== value) {
                    return;
                }
                setState(field, data.state, data.message);
                if (kind === 'password') {
                    renderStrength(field, data);
                }
            })
            .catch(function () {
                // Offline or throttled: fall back to submit-time validation.
            });
    }

    function strengthBar(field) {
        var existing = field.parentElement.querySelector('[data-strength-for="' + field.id + '"]');
        if (existing) {
            return existing;
        }

        var wrap = document.createElement('div');
        wrap.className = 'password-strength';
        wrap.setAttribute('data-strength-for', field.id);
        for (var i = 0; i < 4; i += 1) {
            var segment = document.createElement('span');
            segment.className = 'password-strength-segment';
            wrap.appendChild(segment);
        }
        field.insertAdjacentElement('afterend', wrap);
        return wrap;
    }

    function renderStrength(field, data) {
        var bar = strengthBar(field);
        var score = data.state === 'error' ? 1 : (data.score || 0);
        bar.setAttribute('data-score', String(score));
        Array.prototype.forEach.call(bar.children, function (segment, index) {
            segment.classList.toggle('is-filled', index < score);
        });
    }

    function setupAuthForm() {
        var username = document.querySelector('[data-validate="username"]');
        var email = document.querySelector('[data-validate="email"]');
        var password = document.querySelector('[data-validate="password"]');
        var confirm = document.querySelector('[data-validate="password-confirm"]');

        if (username) {
            var checkUsername = debounce(function () {
                remoteCheck(username, 'username');
            }, DEBOUNCE_MS);
            username.addEventListener('input', checkUsername);
            username.addEventListener('blur', checkUsername);
        }

        if (email) {
            var checkEmail = debounce(function () {
                remoteCheck(email, 'email');
            }, DEBOUNCE_MS);
            email.addEventListener('input', checkEmail);
            email.addEventListener('blur', checkEmail);
        }

        if (password) {
            // Django's UserAttributeSimilarityValidator compares against the
            // username, so send it along for an accurate verdict.
            var checkPassword = debounce(function () {
                var extra = username
                    ? '&username=' + encodeURIComponent(username.value)
                    : '';
                remoteCheck(password, 'password', extra);
            }, DEBOUNCE_MS);
            password.addEventListener('input', function () {
                strengthBar(password);
                checkPassword();
                if (confirm && confirm.value) {
                    comparePasswords();
                }
            });
        }

        function comparePasswords() {
            if (!password || !confirm) {
                return;
            }
            if (!confirm.value) {
                setState(confirm, 'idle', '');
                return;
            }
            if (confirm.value === password.value) {
                setState(confirm, 'ok', 'Passwords match.');
            } else {
                setState(confirm, 'error', 'Passwords do not match.');
            }
        }

        if (confirm) {
            confirm.addEventListener('input', comparePasswords);
        }
    }

    function setupCounters() {
        document.querySelectorAll('[data-counter-max]').forEach(function (field) {
            var max = parseInt(field.getAttribute('data-counter-max'), 10);
            var min = parseInt(field.getAttribute('data-counter-min') || '0', 10);

            var counter = document.createElement('p');
            counter.className = 'field-counter';
            counter.setAttribute('data-counter-for', field.id);
            field.insertAdjacentElement('afterend', counter);

            function update() {
                var length = field.value.trim().length;
                counter.textContent = length + ' / ' + max;
                counter.classList.toggle('is-short', length > 0 && length < min);
                counter.classList.toggle('is-full', length >= max);
            }

            field.addEventListener('input', update);
            update();
        });
    }

    function setupArticleForm() {
        var form = document.querySelector('.article-form');
        if (!form) {
            return;
        }

        setupCounters();

        form.addEventListener('submit', function (event) {
            var source = form.querySelector('[data-wysiwyg-source]');
            if (!source) {
                return;
            }

            var text = source.value
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            var hasImage = source.value.indexOf('<img') !== -1;

            if (!text && !hasImage) {
                event.preventDefault();
                var shell = form.querySelector('.wysiwyg-shell');
                if (shell) {
                    shell.classList.add('has-error');
                    shell.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    window.setTimeout(function () {
                        shell.classList.remove('has-error');
                    }, 2500);
                }
            }
        });
    }

    setupAuthForm();
    setupArticleForm();
})();
