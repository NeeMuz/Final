from wiki.models import Article, ArticleRevision

from .models import Notification, Profile


def user_profile(request):
    if not request.user.is_authenticated:
        return {'user_profile': None, 'user_stats': None}

    profile, _ = Profile.objects.get_or_create(user=request.user)
    return {
        'user_profile': profile,
        'user_stats': {
            'articles': Article.objects.filter(author=request.user).count(),
            'role': 'Administrator' if request.user.is_staff else 'User',
        },
    }


def tab_session(request):
    return {
        'bikibedia_tab_id': getattr(request, 'bikibedia_tab_id', None),
    }


def notifications(request):
    if not request.user.is_authenticated:
        return {
            'unread_notifications_count': 0,
            'moderation_pending_count': 0,
        }

    unread = Notification.objects.filter(user=request.user, is_read=False).count()
    moderation_pending = 0
    if request.user.is_staff:
        moderation_pending = (
            Article.objects.filter(status=Article.STATUS_PENDING).count()
            + ArticleRevision.objects.filter(status=ArticleRevision.STATUS_PENDING).count()
        )

    return {
        'unread_notifications_count': unread,
        'moderation_pending_count': moderation_pending,
    }
