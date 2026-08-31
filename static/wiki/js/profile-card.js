(function () {
    'use strict';

    var openCard = null;

    function closeCard() {
        if (!openCard) {
            return;
        }
        openCard.card.hidden = true;
        openCard.trigger.setAttribute('aria-expanded', 'false');
        openCard = null;
    }

    function openProfileCard(trigger, card) {
        closeCard();
        card.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        openCard = { trigger: trigger, card: card };

        var rect = trigger.getBoundingClientRect();
        var cardRect = card.getBoundingClientRect();
        var top = rect.top + window.scrollY - cardRect.height - 10;
        var left = rect.left + window.scrollX + rect.width / 2 - cardRect.width / 2;

        if (left < 8) {
            left = 8;
        }
        if (left + cardRect.width > window.innerWidth - 8) {
            left = window.innerWidth - cardRect.width - 8;
        }
        if (top < window.scrollY + 8) {
            top = rect.bottom + window.scrollY + 10;
            card.classList.add('profile-card--below');
        } else {
            card.classList.remove('profile-card--below');
        }

        card.style.top = top + 'px';
        card.style.left = left + 'px';
    }

    document.querySelectorAll('.profile-trigger').forEach(function (wrap) {
        var trigger = wrap.querySelector('[data-profile-card-trigger]');
        var card = wrap.querySelector('.profile-card');
        if (!trigger || !card) {
            return;
        }

        trigger.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (openCard && openCard.card === card) {
                closeCard();
                return;
            }
            card.hidden = true;
            card.style.visibility = 'hidden';
            card.hidden = false;
            openProfileCard(trigger, card);
            card.style.visibility = '';
        });
    });

    document.addEventListener('click', function (event) {
        if (!openCard) {
            return;
        }
        if (openCard.card.contains(event.target) || openCard.trigger.contains(event.target)) {
            return;
        }
        closeCard();
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeCard();
        }
    });

    window.addEventListener('resize', closeCard);
    window.addEventListener('scroll', closeCard, true);
})();
