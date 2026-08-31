from .models import Article, ArticleVote


def format_vote_score(score):
    if score > 0:
        return f'+{score}'
    return str(score)


def get_user_vote(article, user):
    if not user.is_authenticated:
        return None
    vote = ArticleVote.objects.filter(article=article, user=user).first()
    return vote.value if vote else None


def get_vote_context(article, user):
    score = article.vote_score()
    user_vote = get_user_vote(article, user)
    return {
        'vote_score': score,
        'vote_score_display': format_vote_score(score),
        'user_vote': user_vote,
    }


def toggle_article_vote(article, user, value):
    if value not in (ArticleVote.VALUE_LIKE, ArticleVote.VALUE_DISLIKE):
        raise ValueError('Invalid vote value.')

    vote = ArticleVote.objects.filter(article=article, user=user).first()
    if vote is None:
        ArticleVote.objects.create(article=article, user=user, value=value)
        return value

    if vote.value == value:
        vote.delete()
        return None

    vote.value = value
    vote.save(update_fields=['value', 'updated_at'])
    return value
