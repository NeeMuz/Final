from .models import Article


def site(request):
    page = ''
    if request.resolver_match:
        page = request.resolver_match.url_name or ''

    articles = Article.published.select_related('author').order_by('-created_at')

    return {
        'page': page,
        'sidebar_articles': articles[:20],
    }
