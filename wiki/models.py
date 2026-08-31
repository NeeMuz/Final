from django.conf import settings
from django.db import models
from django.utils.text import slugify


class PublishedArticleManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(status=Article.STATUS_PUBLISHED)


class Article(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_PUBLISHED = 'published'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = (
        (STATUS_PENDING, 'Pending review'),
        (STATUS_PUBLISHED, 'Published'),
        (STATUS_REJECTED, 'Rejected'),
    )

    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    introduction = models.CharField(max_length=500)
    body_text = models.TextField()
    image = models.ImageField(upload_to='articles/', blank=True)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='articles',
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
    )
    moderator_comment = models.TextField(blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_articles',
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = models.Manager()
    published = PublishedArticleManager()

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Wiki article'
        verbose_name_plural = 'Wiki articles'

    def __str__(self):
        return self.title

    @property
    def is_public(self):
        return self.status == self.STATUS_PUBLISHED

    @property
    def status_label(self):
        return dict(self.STATUS_CHOICES).get(self.status, self.status)

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.title) or 'article'
            slug = base
            counter = 1
            while Article.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{counter}'
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)

    def vote_score(self):
        return self.votes.aggregate(total=models.Sum('value'))['total'] or 0


class ArticleVote(models.Model):
    VALUE_LIKE = 1
    VALUE_DISLIKE = -1
    VALUE_CHOICES = (
        (VALUE_LIKE, 'Like'),
        (VALUE_DISLIKE, 'Dislike'),
    )

    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name='votes',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='article_votes',
    )
    value = models.SmallIntegerField(choices=VALUE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=('article', 'user'),
                name='unique_article_vote_per_user',
            ),
        ]
        ordering = ['-updated_at']
        verbose_name = 'Article vote'
        verbose_name_plural = 'Article votes'

    def __str__(self):
        label = 'like' if self.value == self.VALUE_LIKE else 'dislike'
        return f'{label} on {self.article.title} by {self.user.username}'


class ModerationLogEntry(models.Model):
    """Audit trail for the review queue.

    `target_title` is denormalised so the log survives article deletion.
    """

    ACTION_SUBMITTED = 'submitted'
    ACTION_APPROVED = 'approved'
    ACTION_REJECTED = 'rejected'
    ACTION_EDIT_SUBMITTED = 'edit_submitted'
    ACTION_EDIT_APPROVED = 'edit_approved'
    ACTION_EDIT_REJECTED = 'edit_rejected'
    ACTION_DELETED = 'deleted'
    ACTION_CHOICES = (
        (ACTION_SUBMITTED, 'Article submitted'),
        (ACTION_APPROVED, 'Article approved'),
        (ACTION_REJECTED, 'Article rejected'),
        (ACTION_EDIT_SUBMITTED, 'Edit submitted'),
        (ACTION_EDIT_APPROVED, 'Edit approved'),
        (ACTION_EDIT_REJECTED, 'Edit rejected'),
        (ACTION_DELETED, 'Article deleted'),
    )

    REVIEW_ACTIONS = frozenset({
        ACTION_APPROVED, ACTION_REJECTED, ACTION_EDIT_APPROVED, ACTION_EDIT_REJECTED,
    })

    action = models.CharField(max_length=32, choices=ACTION_CHOICES)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='moderation_log_entries',
    )
    article = models.ForeignKey(
        Article,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='moderation_log_entries',
    )
    target_title = models.CharField(max_length=200)
    target_slug = models.SlugField(max_length=220, blank=True)
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Moderation log entry'
        verbose_name_plural = 'Moderation log'
        indexes = [
            models.Index(fields=['-created_at']),
        ]

    def __str__(self):
        actor = self.actor.username if self.actor_id else 'system'
        return f'{self.get_action_display()} — {self.target_title} ({actor})'

    @property
    def is_review_decision(self):
        return self.action in self.REVIEW_ACTIONS

    @property
    def tone(self):
        if self.action in (self.ACTION_APPROVED, self.ACTION_EDIT_APPROVED):
            return 'approved'
        if self.action in (self.ACTION_REJECTED, self.ACTION_EDIT_REJECTED):
            return 'rejected'
        if self.action == self.ACTION_DELETED:
            return 'deleted'
        return 'pending'


class ArticleRevision(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = (
        (STATUS_PENDING, 'Pending review'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
    )

    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name='revisions',
    )
    title = models.CharField(max_length=200)
    introduction = models.CharField(max_length=500)
    body_text = models.TextField()
    image = models.ImageField(upload_to='articles/revisions/', blank=True)
    remove_cover = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
    )
    moderator_comment = models.TextField(blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='article_revisions',
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_revisions',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Revision for {self.article.title}'
