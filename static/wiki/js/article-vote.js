(function () {
    'use strict';

    var form = document.querySelector('[data-article-vote-form]');
    if (!form) {
        return;
    }

    var scoreNode = form.querySelector('[data-vote-score]');

    function applyState(data) {
        form.classList.remove('article-vote-pill--liked', 'article-vote-pill--disliked', 'article-vote-pill--neutral');
        if (data.user_vote === 1) {
            form.classList.add('article-vote-pill--liked');
        } else if (data.user_vote === -1) {
            form.classList.add('article-vote-pill--disliked');
        } else {
            form.classList.add('article-vote-pill--neutral');
        }
        if (scoreNode) {
            scoreNode.textContent = data.display;
        }
    }

    form.addEventListener('click', function (event) {
        var button = event.target.closest('.article-vote-btn');
        if (!button || !form.contains(button)) {
            return;
        }
        event.preventDefault();

        var body = new FormData(form);
        body.set('value', button.value);

        fetch(form.action, {
            method: 'POST',
            body: body,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            },
            credentials: 'same-origin',
        })
            .then(function (response) {
                return response.json().then(function (data) {
                    if (!response.ok) {
                        throw new Error(data.error || 'Could not save your vote.');
                    }
                    return data;
                });
            })
            .then(applyState)
            .catch(function (error) {
                window.alert(error.message || 'Could not save your vote.');
            });
    });
})();
