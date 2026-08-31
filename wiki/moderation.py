from django.contrib.auth.models import User
from django.utils import timezone

from accounts.models import Notification

from .models import Article, ArticleRevision, ModerationLogEntry


def log_moderation(action, *, article=None, actor=None, comment='', title='', slug=''):
    ModerationLogEntry.objects.create(
        action=action,
        actor=actor,
        article=article,
        target_title=title or (article.title if article else 'Unknown article'),
        target_slug=slug or (article.slug if article else ''),
        comment=(comment or '').strip(),
    )


def notify_user(user, *, kind, title, message, link='', article=None, revision=None):
    Notification.objects.create(
        user=user,
        kind=kind,
        title=title,
        message=message,
        link=link,
        article=article,
        revision=revision,
    )


def notify_staff(*, kind, title, message, link='', article=None, revision=None):
    staff_users = User.objects.filter(is_staff=True, is_active=True)
    notifications = [
        Notification(
            user=staff_user,
            kind=kind,
            title=title,
            message=message,
            link=link,
            article=article,
            revision=revision,
        )
        for staff_user in staff_users
    ]
    Notification.objects.bulk_create(notifications)


def notify_new_article_submission(article):
    author_name = article.author.username if article.author_id else 'Someone'
    notify_staff(
        kind=Notification.KIND_NEW_SUBMISSION,
        title='New article for review',
        message=f'{author_name} submitted «{article.title}» for moderation.',
        link=f'/moderation/article/{article.pk}/',
        article=article,
    )
    log_moderation(
        ModerationLogEntry.ACTION_SUBMITTED,
        article=article,
        actor=article.author,
    )


def notify_new_revision_submission(revision):
    author_name = revision.submitted_by.username
    notify_staff(
        kind=Notification.KIND_NEW_SUBMISSION,
        title='Article edit for review',
        message=f'{author_name} submitted edits to «{revision.article.title}».',
        link=f'/moderation/revision/{revision.pk}/',
        article=revision.article,
        revision=revision,
    )
    log_moderation(
        ModerationLogEntry.ACTION_EDIT_SUBMITTED,
        article=revision.article,
        actor=revision.submitted_by,
    )


def approve_article(article, reviewer, comment=''):
    now = timezone.now()
    article.status = Article.STATUS_PUBLISHED
    article.moderator_comment = comment.strip()
    article.reviewed_by = reviewer
    article.reviewed_at = now
    article.save(update_fields=[
        'status', 'moderator_comment', 'reviewed_by', 'reviewed_at', 'updated_at',
    ])
    log_moderation(
        ModerationLogEntry.ACTION_APPROVED,
        article=article,
        actor=reviewer,
        comment=comment,
    )

    if article.author_id:
        message = f'Your article «{article.title}» is now live on Bikibedia.'
        if comment.strip():
            message += f' Moderator note: {comment.strip()}'
        notify_user(
            article.author,
            kind=Notification.KIND_ARTICLE_APPROVED,
            title='Article approved',
            message=message,
            link=f'/wiki/{article.slug}/',
            article=article,
        )


def reject_article(article, reviewer, comment):
    now = timezone.now()
    article.status = Article.STATUS_REJECTED
    article.moderator_comment = comment.strip()
    article.reviewed_by = reviewer
    article.reviewed_at = now
    article.save(update_fields=[
        'status', 'moderator_comment', 'reviewed_by', 'reviewed_at', 'updated_at',
    ])
    log_moderation(
        ModerationLogEntry.ACTION_REJECTED,
        article=article,
        actor=reviewer,
        comment=comment,
    )

    if article.author_id:
        notify_user(
            article.author,
            kind=Notification.KIND_ARTICLE_REJECTED,
            title='Article needs changes',
            message=f'«{article.title}» was not approved. {comment.strip()}',
            link=f'/wiki/{article.slug}/',
            article=article,
        )


def apply_revision(revision):
    article = revision.article
    article.title = revision.title
    article.introduction = revision.introduction
    article.body_text = revision.body_text
    if revision.image:
        article.image = revision.image
    elif revision.remove_cover:
        article.image = None
    if article.title != revision.title:
        article.slug = ''
    article.save()


def approve_revision(revision, reviewer, comment=''):
    now = timezone.now()
    apply_revision(revision)
    revision.status = ArticleRevision.STATUS_APPROVED
    revision.moderator_comment = comment.strip()
    revision.reviewed_by = reviewer
    revision.reviewed_at = now
    revision.save(update_fields=[
        'status', 'moderator_comment', 'reviewed_by', 'reviewed_at',
    ])
    log_moderation(
        ModerationLogEntry.ACTION_EDIT_APPROVED,
        article=revision.article,
        actor=reviewer,
        comment=comment,
    )

    message = f'Your edits to «{revision.article.title}» are now live.'
    if comment.strip():
        message += f' Moderator note: {comment.strip()}'
    notify_user(
        revision.submitted_by,
        kind=Notification.KIND_REVISION_APPROVED,
        title='Edit approved',
        message=message,
        link=f'/wiki/{revision.article.slug}/',
        article=revision.article,
        revision=revision,
    )


def reject_revision(revision, reviewer, comment):
    now = timezone.now()
    revision.status = ArticleRevision.STATUS_REJECTED
    revision.moderator_comment = comment.strip()
    revision.reviewed_by = reviewer
    revision.reviewed_at = now
    revision.save(update_fields=[
        'status', 'moderator_comment', 'reviewed_by', 'reviewed_at',
    ])
    log_moderation(
        ModerationLogEntry.ACTION_EDIT_REJECTED,
        article=revision.article,
        actor=reviewer,
        comment=comment,
    )

    notify_user(
        revision.submitted_by,
        kind=Notification.KIND_REVISION_REJECTED,
        title='Edit needs changes',
        message=f'Edits to «{revision.article.title}» were not approved. {comment.strip()}',
        link=f'/wiki/{revision.article.slug}/',
        article=revision.article,
        revision=revision,
    )
