def user_can_manage_article(user, article):
    if not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    return article.author_id is not None and article.author_id == user.pk


def user_can_view_article(user, article):
    if article.status == article.STATUS_PUBLISHED:
        return True
    if not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    return article.author_id is not None and article.author_id == user.pk
