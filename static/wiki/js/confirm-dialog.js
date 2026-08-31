(function () {
    'use strict';

    var dialog = document.getElementById('confirm-dialog');
    if (!dialog) {
        return;
    }

    var panel = dialog.querySelector('.confirm-dialog-panel');
    var titleEl = document.getElementById('confirm-dialog-title');
    var messageEl = document.getElementById('confirm-dialog-message');
    var cancelBtn = dialog.querySelector('[data-confirm-cancel]');
    var okBtn = dialog.querySelector('[data-confirm-ok]');
    var dismissTargets = dialog.querySelectorAll('[data-confirm-dismiss]');

    var pendingForm = null;
    var lastFocused = null;

    function getFocusable() {
        return [cancelBtn, okBtn].filter(Boolean);
    }

    function closeDialog() {
        dialog.hidden = true;
        dialog.setAttribute('aria-hidden', 'true');
        dialog.classList.remove('confirm-dialog--open');
        document.body.classList.remove('confirm-dialog-open');
        pendingForm = null;

        if (lastFocused && typeof lastFocused.focus === 'function') {
            lastFocused.focus();
        }
    }

    function openDialog(options) {
        lastFocused = document.activeElement;
        titleEl.textContent = options.title || 'Are you sure?';
        messageEl.textContent = options.message || '';
        okBtn.textContent = options.confirmLabel || 'Confirm';

        panel.classList.toggle('confirm-dialog-panel--danger', options.variant !== 'default');
        okBtn.classList.toggle('btn-danger', options.variant !== 'default');
        okBtn.classList.toggle('btn-primary', options.variant === 'default');

        dialog.hidden = false;
        dialog.setAttribute('aria-hidden', 'false');
        dialog.classList.add('confirm-dialog--open');
        document.body.classList.add('confirm-dialog-open');

        window.requestAnimationFrame(function () {
            cancelBtn.focus();
        });
    }

    function onConfirm() {
        var form = pendingForm;
        closeDialog();
        if (form) {
            form.dataset.confirmBypass = '1';
            form.submit();
        }
    }

    cancelBtn.addEventListener('click', closeDialog);
    okBtn.addEventListener('click', onConfirm);

    dismissTargets.forEach(function (target) {
        target.addEventListener('click', closeDialog);
    });

    document.addEventListener('keydown', function (event) {
        if (dialog.hidden) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
            return;
        }

        if (event.key === 'Tab') {
            var focusable = getFocusable();
            if (!focusable.length) {
                return;
            }

            var first = focusable[0];
            var last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    document.addEventListener('submit', function (event) {
        var form = event.target;
        if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-confirm')) {
            return;
        }

        if (form.dataset.confirmBypass === '1') {
            delete form.dataset.confirmBypass;
            return;
        }

        event.preventDefault();
        pendingForm = form;

        openDialog({
            title: form.getAttribute('data-confirm-title') || 'Are you sure?',
            message: form.getAttribute('data-confirm-message') || '',
            confirmLabel: form.getAttribute('data-confirm-ok') || 'Confirm',
            variant: form.getAttribute('data-confirm-variant') || 'danger',
        });
    }, true);
})();
