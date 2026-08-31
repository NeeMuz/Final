from django.utils import timezone

from .forms import ArticleForm
from .models import Article, ArticleRevision
from .moderation import notify_new_article_submission, notify_new_revision_submission


def build_revision_from_form(article, form, user):
    cleaned = form.cleaned_data
    revision = ArticleRevision.objects.filter(
        article=article,
        status=ArticleRevision.STATUS_PENDING,
    ).first()

    if revision is None:
        revision = ArticleRevision(article=article, submitted_by=user)
    else:
        revision.submitted_by = user

    revision.title = cleaned['title']
    revision.introduction = cleaned['introduction']
    revision.body_text = cleaned['body_text']
    revision.status = ArticleRevision.STATUS_PENDING
    revision.moderator_comment = ''
    revision.reviewed_by = None
    revision.reviewed_at = None

    if cleaned.get('image'):
        revision.image = cleaned['image']
        revision.remove_cover = False
    elif cleaned.get('clear_cover'):
        revision.remove_cover = True
    else:
        revision.remove_cover = False

    revision.save()
    return revision


def submit_new_article(form, user):
    article = form.save(commit=False)
    article.author = user
    article.status = Article.STATUS_PENDING
    article.moderator_comment = ''
    article.reviewed_by = None
    article.reviewed_at = None
    article.submitted_at = timezone.now()
    article.save()
    notify_new_article_submission(article)
    return article


def resubmit_article(form, article):
    updated = form.save(commit=False)
    updated.status = Article.STATUS_PENDING
    updated.moderator_comment = ''
    updated.reviewed_by = None
    updated.reviewed_at = None
    updated.submitted_at = timezone.now()
    if updated.title != article.title:
        updated.slug = ''
    updated.save()
    notify_new_article_submission(updated)
    return updated


def submit_article_revision(form, article, user):
    revision = build_revision_from_form(article, form, user)
    notify_new_revision_submission(revision)
    return revision
