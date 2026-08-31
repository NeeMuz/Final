from django.contrib.auth.decorators import user_passes_test
from django.contrib import messages
from django.core.paginator import Paginator
from django.shortcuts import get_object_or_404, redirect, render

from .forms import ModerationDecisionForm
from .models import Article, ArticleRevision, ModerationLogEntry
from .moderation import approve_article, approve_revision, reject_article, reject_revision

LOG_PAGE_SIZE = 50
QUEUE_LOG_PREVIEW = 8


def staff_required(view):
    return user_passes_test(lambda user: user.is_authenticated and user.is_staff)(view)


@staff_required
def moderation_queue(request):
    pending_articles = (
        Article.objects.filter(status=Article.STATUS_PENDING)
        .select_related('author')
        .order_by('submitted_at', 'created_at')
    )
    pending_revisions = (
        ArticleRevision.objects.filter(status=ArticleRevision.STATUS_PENDING)
        .select_related('article', 'submitted_by')
        .order_by('created_at')
    )
    return render(request, 'wiki/moderation/queue.html', {
        'pending_articles': pending_articles,
        'pending_revisions': pending_revisions,
        'pending_count': pending_articles.count() + pending_revisions.count(),
        'recent_log': ModerationLogEntry.objects.select_related(
            'actor', 'article',
        )[:QUEUE_LOG_PREVIEW],
    })


@staff_required
def moderation_log(request):
    entries = ModerationLogEntry.objects.select_related('actor', 'article')

    action = request.GET.get('action', '')
    if action:
        entries = entries.filter(action=action)

    actor = request.GET.get('actor', '').strip()
    if actor:
        entries = entries.filter(actor__username__icontains=actor)

    paginator = Paginator(entries, LOG_PAGE_SIZE)
    page = paginator.get_page(request.GET.get('page'))

    return render(request, 'wiki/moderation/log.html', {
        'page_obj': page,
        'entries': page.object_list,
        'action_choices': ModerationLogEntry.ACTION_CHOICES,
        'selected_action': action,
        'actor_query': actor,
        'total_count': paginator.count,
    })


@staff_required
def moderation_review_article(request, pk):
    article = get_object_or_404(
        Article.objects.select_related('author'),
        pk=pk,
        status=Article.STATUS_PENDING,
    )
    form = ModerationDecisionForm(request.POST or None)

    if request.method == 'POST' and form.is_valid():
        action = request.POST.get('action')
        comment = form.cleaned_data.get('comment', '').strip()
        if action == 'approve':
            approve_article(article, request.user, comment)
            messages.success(request, f'«{article.title}» is now published.')
            return redirect('moderation_queue')
        if action == 'reject':
            if not comment:
                form.add_error('comment', 'Add a comment explaining what needs to be fixed.')
            else:
                reject_article(article, request.user, comment)
                messages.success(request, f'«{article.title}» was sent back to the author.')
                return redirect('moderation_queue')

    return render(request, 'wiki/moderation/review_article.html', {
        'submission': article,
        'submission_type': 'article',
        'form': form,
    })


@staff_required
def moderation_review_revision(request, pk):
    revision = get_object_or_404(
        ArticleRevision.objects.select_related('article', 'submitted_by'),
        pk=pk,
        status=ArticleRevision.STATUS_PENDING,
    )
    form = ModerationDecisionForm(request.POST or None)
    article = revision.article

    if request.method == 'POST' and form.is_valid():
        action = request.POST.get('action')
        comment = form.cleaned_data.get('comment', '').strip()
        if action == 'approve':
            approve_revision(revision, request.user, comment)
            messages.success(request, f'Edits to «{article.title}» are now live.')
            return redirect('moderation_queue')
        if action == 'reject':
            if not comment:
                form.add_error('comment', 'Add a comment explaining what needs to be fixed.')
            else:
                reject_revision(revision, request.user, comment)
                messages.success(request, f'Edits to «{article.title}» were rejected.')
                return redirect('moderation_queue')

    return render(request, 'wiki/moderation/review_revision.html', {
        'revision': revision,
        'article': article,
        'submission_type': 'revision',
        'form': form,
    })
