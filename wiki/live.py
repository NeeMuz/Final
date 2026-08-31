"""State snapshot for the front-end polling loop.

One endpoint serves the article feed, the notification badge and the
moderation badge so a page only makes a single background request.
"""

from django.template.defaultfilters import date as date_filter
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from accounts.models import Notification

from .models import Article, ArticleRevision, ModerationLogEntry

FEED_LIMIT = 12
LOG_LIMIT = 15


def parse_since(raw):
    if not raw:
        return None
    parsed = parse_datetime(raw)
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_default_timezone())
    return parsed


def serialize_article(article):
    return {
        'id': article.pk,
        'slug': article.slug,
        'title': article.title,
        'introduction': article.introduction,
        'url': reverse('article', args=[article.slug]),
        'author': article.author.username if article.author_id else 'Anonymous',
        'updated_at': article.updated_at.isoformat(),
        'updated_label': date_filter(timezone.localtime(article.updated_at), 'M j, Y'),
    }


def serialize_log_entry(entry):
    return {
        'id': entry.pk,
        'action': entry.action,
        'action_label': entry.get_action_display(),
        'tone': entry.tone,
        'title': entry.target_title,
        'slug': entry.target_slug,
        'actor': entry.actor.username if entry.actor_id else 'system',
        'comment': entry.comment,
        'created_at': entry.created_at.isoformat(),
    }


def build_live_state(request, since=None):
    published = Article.published.select_related('author')

    state = {
        'server_time': timezone.now().isoformat(),
        'articles': {
            'count': published.count(),
            'latest': [serialize_article(a) for a in published.order_by('-updated_at')[:FEED_LIMIT]],
            'new': [],
        },
        'notifications': {'unread': 0},
        'moderation': {'pending': 0, 'log': []},
    }

    if since is not None:
        state['articles']['new'] = [
            serialize_article(a)
            for a in published.filter(updated_at__gt=since).order_by('-updated_at')[:FEED_LIMIT]
        ]

    user = request.user
    if user.is_authenticated:
        state['notifications']['unread'] = Notification.objects.filter(
            user=user, is_read=False,
        ).count()

    if user.is_authenticated and user.is_staff:
        state['moderation']['pending'] = (
            Article.objects.filter(status=Article.STATUS_PENDING).count()
            + ArticleRevision.objects.filter(status=ArticleRevision.STATUS_PENDING).count()
        )
        log_qs = ModerationLogEntry.objects.select_related('actor')[:LOG_LIMIT]
        state['moderation']['log'] = [serialize_log_entry(e) for e in log_qs]

    return state
