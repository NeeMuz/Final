(function () {
    'use strict';

    var STORAGE_KEY = 'bikibedia_theme';

    function getTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function updateToggleButtons(theme) {
        var isDark = theme === 'dark';
        var ariaText = isDark ? 'Switch to light mode' : 'Switch to dark mode';

        document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
            button.setAttribute('aria-checked', isDark ? 'true' : 'false');
            button.setAttribute('aria-label', ariaText);
            button.title = ariaText;
        });
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);
        document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
        updateToggleButtons(theme);
        document.dispatchEvent(new CustomEvent('bikibedia:theme-change', { detail: { theme: theme } }));
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-theme-toggle]');
        if (!button) {
            return;
        }
        event.preventDefault();
        applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });

    updateToggleButtons(getTheme());
})();
