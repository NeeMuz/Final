from django.conf import settings
from django.db import models

from .presence import is_profile_online, presence_label


class Profile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile',
    )
    avatar = models.ImageField(upload_to='avatars/', blank=True)
    birth_date = models.DateField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Profile'
        verbose_name_plural = 'Profiles'

    def __str__(self):
        return f'Profile of {self.user.username}'

    @property
    def initials(self):
        return self.user.username[0].upper()

    @property
    def is_online(self):
        return is_profile_online(self)

    @property
    def presence_status(self):
        return presence_label(self)


class Notification(models.Model):
    KIND_ARTICLE_APPROVED = 'article_approved'
    KIND_ARTICLE_REJECTED = 'article_rejected'
    KIND_REVISION_APPROVED = 'revision_approved'
    KIND_REVISION_REJECTED = 'revision_rejected'
    KIND_NEW_SUBMISSION = 'new_submission'
    KIND_CHOICES = (
        (KIND_ARTICLE_APPROVED, 'Article approved'),
        (KIND_ARTICLE_REJECTED, 'Article rejected'),
        (KIND_REVISION_APPROVED, 'Edit approved'),
        (KIND_REVISION_REJECTED, 'Edit rejected'),
        (KIND_NEW_SUBMISSION, 'New submission'),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    title = models.CharField(max_length=200)
    message = models.TextField()
    link = models.CharField(max_length=500, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    article = models.ForeignKey(
        'wiki.Article',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notifications',
    )
    revision = models.ForeignKey(
        'wiki.ArticleRevision',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notifications',
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.title} → {self.user.username}'
