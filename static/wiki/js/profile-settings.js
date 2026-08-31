(function () {
    'use strict';

    var MIN_YEAR = 1900;

    function maxYear() {
        return new Date().getFullYear();
    }

    function formatBirthDateValue(raw) {
        var digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
        if (!digits) {
            return '';
        }
        if (digits.length <= 2) {
            return digits;
        }
        if (digits.length <= 4) {
            return digits.slice(0, 2) + '.' + digits.slice(2);
        }
        return digits.slice(0, 2) + '.' + digits.slice(2, 4) + '.' + digits.slice(4);
    }

    function isRealDate(day, month, year) {
        var date = new Date(year, month - 1, day);
        return (
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        );
    }

    function validateBirthDateInput(input) {
        if (!input) {
            return;
        }

        var value = input.value.trim();
        if (!value) {
            input.setCustomValidity('');
            return;
        }

        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
            input.setCustomValidity('Enter the full date as DD.MM.YYYY.');
            return;
        }

        var parts = value.split('.');
        var day = parseInt(parts[0], 10);
        var month = parseInt(parts[1], 10);
        var year = parseInt(parts[2], 10);

        if (month < 1 || month > 12) {
            input.setCustomValidity('Month must be between 01 and 12.');
            return;
        }

        if (day < 1 || day > 31) {
            input.setCustomValidity('Day must be between 01 and 31.');
            return;
        }

        if (year < MIN_YEAR || year > maxYear()) {
            input.setCustomValidity('Year must be between ' + MIN_YEAR + ' and ' + maxYear() + '.');
            return;
        }

        if (!isRealDate(day, month, year)) {
            input.setCustomValidity('This date does not exist.');
            return;
        }

        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var entered = new Date(year, month - 1, day);
        if (entered > today) {
            input.setCustomValidity('Date of birth cannot be in the future.');
            return;
        }

        input.setCustomValidity('');
    }

    function applyBirthDateMask(input) {
        var formatted = formatBirthDateValue(input.value);
        input.value = formatted;
        validateBirthDateInput(input);
    }

    var avatarInput = document.getElementById('id_avatar');
    var preview = document.getElementById('profile-avatar-preview');
    var placeholder = document.getElementById('profile-avatar-placeholder');
    if (avatarInput && preview) {
        avatarInput.addEventListener('change', function () {
            var file = avatarInput.files && avatarInput.files[0];
            if (!file || !file.type.startsWith('image/')) {
                return;
            }

            var reader = new FileReader();
            reader.onload = function () {
                preview.src = reader.result;
                preview.hidden = false;
                if (placeholder) {
                    placeholder.hidden = true;
                }
            };
            reader.readAsDataURL(file);
        });
    }

    var birthInput = document.querySelector('[data-birth-date-input]');
    if (birthInput) {
        birthInput.addEventListener('input', function () {
            applyBirthDateMask(birthInput);
        });
        birthInput.addEventListener('blur', function () {
            applyBirthDateMask(birthInput);
        });
        birthInput.addEventListener('paste', function (event) {
            event.preventDefault();
            var pasted = (event.clipboardData || window.clipboardData).getData('text');
            birthInput.value = formatBirthDateValue(pasted);
            validateBirthDateInput(birthInput);
        });
        validateBirthDateInput(birthInput);
    }
})();
