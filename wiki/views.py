from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_GET, require_POST
from uuid import uuid4

from accounts.models import Profile

from .forms import ArticleForm
from .live import build_live_state, parse_since
from .models import Article, ArticleRevision, ArticleVote, ModerationLogEntry
from .moderation import log_moderation
from .permissions import user_can_manage_article, user_can_view_article
from .submissions import resubmit_article, submit_article_revision, submit_new_article
from .votes import format_vote_score, get_vote_context, toggle_article_vote


def _published_qs():
    return Article.published.select_related('author')


def home(request):
    articles_qs = _published_qs()
    article_count = articles_qs.count()
    featured = None
    latest = []
    discover_article = None
    contributor_count = 0

    if article_count:
        featured = articles_qs.order_by('-updated_at').first()
        latest = articles_qs[:6]
        contributor_count = User.objects.filter(
            articles__status=Article.STATUS_PUBLISHED,
        ).distinct().count()
        if article_count > 1 and featured:
            discover_article = articles_qs.exclude(pk=featured.pk).order_by('?').first()

    return render(request, 'wiki/home.html', {
        'featured_article': featured,
        'latest_articles': latest,
        'article_count': article_count,
        'contributor_count': contributor_count,
        'discover_article': discover_article,
    })


def articles(request):
    query = request.GET.get('q', '').strip()
    article_list = _published_qs()
    if query:
        article_list = article_list.filter(
            Q(title__icontains=query)
            | Q(introduction__icontains=query)
            | Q(body_text__icontains=query)
        )
    return render(request, 'wiki/articles.html', {
        'article_list': article_list,
        'query': query,
    })


def article_detail(request, slug):
    item = get_object_or_404(Article.objects.select_related('author'), slug=slug)
    if not user_can_view_article(request.user, item):
        messages.error(request, 'This article is not available.')
        return redirect('articles')

    can_manage = user_can_manage_article(request.user, item)
    pending_revision = None
    if can_manage:
        pending_revision = item.revisions.filter(
            status=ArticleRevision.STATUS_PENDING,
        ).first()

    author_card = None
    if item.author_id:
        author_profile, _ = Profile.objects.get_or_create(user=item.author)
        author_card = {
            'user': item.author,
            'profile': author_profile,
            'articles_count': Article.objects.filter(author=item.author).count(),
            'role': 'Administrator' if item.author.is_staff else 'User',
        }

    return render(request, 'wiki/article.html', {
        'article': item,
        'can_manage': can_manage,
        'author_card': author_card,
        'pending_revision': pending_revision,
        **get_vote_context(item, request.user),
    })


@login_required
@require_POST
def article_vote(request, slug):
    item = get_object_or_404(Article.objects.select_related('author'), slug=slug)
    if not item.is_public:
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return JsonResponse({'error': 'Voting is only available on published articles.'}, status=403)
        messages.error(request, 'Voting is only available on published articles.')
        return redirect('article', slug=slug)

    if not user_can_view_article(request.user, item):
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return JsonResponse({'error': 'This article is not available.'}, status=403)
        messages.error(request, 'This article is not available.')
        return redirect('articles')

    try:
        value = int(request.POST.get('value', ''))
    except (TypeError, ValueError):
        value = None

    if value not in (ArticleVote.VALUE_LIKE, ArticleVote.VALUE_DISLIKE):
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return JsonResponse({'error': 'Invalid vote.'}, status=400)
        messages.error(request, 'Invalid vote.')
        return redirect('article', slug=slug)

    user_vote = toggle_article_vote(item, request.user, value)
    score = item.vote_score()

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return JsonResponse({
            'score': score,
            'display': format_vote_score(score),
            'user_vote': user_vote,
        })

    return redirect('article', slug=slug)


@login_required
def article_edit(request, slug):
    article = get_object_or_404(Article, slug=slug)
    if not user_can_manage_article(request.user, article):
        messages.error(request, 'You cannot edit this article.')
        return redirect('article', slug=slug)

    if article.status == Article.STATUS_PUBLISHED:
        pending = article.revisions.filter(status=ArticleRevision.STATUS_PENDING).exists()
        if pending:
            messages.info(
                request,
                'Your previous edit is still waiting for moderator review.',
            )

    form = ArticleForm(request.POST or None, request.FILES or None, instance=article)
    if request.method == 'POST' and form.is_valid():
        if article.status == Article.STATUS_PUBLISHED:
            submit_article_revision(form, article, request.user)
            messages.success(
                request,
                'Your edits were sent for review. You will be notified when they are approved.',
            )
            return redirect('article', slug=article.slug)

        resubmit_article(form, article)
        messages.success(
            request,
            'Article updated and sent for review again.',
        )
        return redirect('article', slug=article.slug)

    return render(request, 'wiki/article_form.html', {
        'form': form,
        'form_title': 'Edit article',
        'article': article,
        'requires_moderation': True,
    })


@login_required
def article_create(request):
    form = ArticleForm(request.POST or None, request.FILES or None)
    if request.method == 'POST' and form.is_valid():
        article = submit_new_article(form, request.user)
        messages.success(
            request,
            'Article submitted for review. You will be notified when it is approved.',
        )
        return redirect('article', slug=article.slug)

    return render(request, 'wiki/article_form.html', {
        'form': form,
        'form_title': 'Create article',
        'requires_moderation': True,
    })


@login_required
@require_POST
def article_delete(request, slug):
    article = get_object_or_404(Article, slug=slug)
    if not user_can_manage_article(request.user, article):
        messages.error(request, 'You cannot delete this article.')
        return redirect('article', slug=slug)

    log_moderation(
        ModerationLogEntry.ACTION_DELETED,
        article=None,
        actor=request.user,
        title=article.title,
        slug=article.slug,
    )
    article.delete()
    messages.success(request, 'Article deleted.')
    return redirect('articles')


@require_GET
def live_state(request):
    """Polled by static/wiki/js/live-updates.js to refresh pages in place."""
    since = parse_since(request.GET.get('since'))
    response = JsonResponse(build_live_state(request, since=since))
    response['Cache-Control'] = 'no-store'
    return response


def license_page(request):
    return render(request, 'wiki/license.html')


@login_required
@require_POST
def upload_inline_image(request):
    image = request.FILES.get('image')
    if not image:
        return JsonResponse({'error': 'No image provided.'}, status=400)

    if not image.content_type.startswith('image/'):
        return JsonResponse({'error': 'File must be an image.'}, status=400)

    if image.size > 5 * 1024 * 1024:
        return JsonResponse({'error': 'Image must be 5 MB or smaller.'}, status=400)

    ext = image.name.rsplit('.', 1)[-1].lower() if '.' in image.name else 'jpg'
    if ext not in {'jpg', 'jpeg', 'png', 'gif', 'webp'}:
        ext = 'jpg'

    saved_path = default_storage.save(
        f'articles/inline/{uuid4().hex}.{ext}',
        ContentFile(image.read()),
    )
    return JsonResponse({'url': default_storage.url(saved_path)})
