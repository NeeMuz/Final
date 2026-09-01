from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from django.db.models import Count, Q, Sum

from accounts.models import Notification, Profile
from wiki.moderation import approve_article, approve_revision, reject_article, reject_revision
from wiki.models import Article, ArticleRevision

admin.site.site_header = 'Bikibedia administration'
admin.site.site_title = 'Bikibedia admin'
admin.site.index_title = 'Site administration'
admin.site.enable_nav_sidebar = True

admin.site.unregister(User)
admin.site.unregister(Group)


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    search_fields = ('name',)
    ordering = ('name',)
    filter_horizontal = ('permissions',)


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    extra = 0
    fields = ('avatar', 'birth_date')


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        'username', 'email', 'article_count', 'is_staff', 'is_superuser',
        'is_active', 'date_joined',
    )
    list_filter = ('is_staff', 'is_superuser', 'is_active')
    search_fields = ('username', 'email')
    ordering = ('-date_joined',)
    inlines = (ProfileInline,)
    actions = ('activate_users', 'deactivate_users', 'grant_staff', 'revoke_staff')

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_article_count=Count('articles'))

    @admin.display(description='Articles', ordering='_article_count')
    def article_count(self, obj):
        return obj._article_count

    @admin.action(description='Activate selected users')
    def activate_users(self, request, queryset):
        updated = queryset.update(is_active=True)
        self.message_user(request, f'{updated} user(s) activated.', messages.SUCCESS)

    @admin.action(description='Deactivate selected users')
    def deactivate_users(self, request, queryset):
        updated = queryset.exclude(pk=request.user.pk).update(is_active=False)
        self.message_user(request, f'{updated} user(s) deactivated.', messages.SUCCESS)

    @admin.action(description='Grant staff (moderator) access')
    def grant_staff(self, request, queryset):
        updated = queryset.update(is_staff=True)
        self.message_user(request, f'{updated} user(s) can now moderate.', messages.SUCCESS)

    @admin.action(description='Revoke staff (moderator) access')
    def revoke_staff(self, request, queryset):
        updated = queryset.exclude(pk=request.user.pk).update(is_staff=False)
        self.message_user(request, f'Staff access revoked for {updated} user(s).', messages.SUCCESS)

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Personal info', {'fields': ('email',)}),
        ('Permissions', {
            'fields': ('is_active', 'is_staff', 'is_superuser', 'groups'),
            'description': (
                'Staff status gives access to this admin panel. '
                'Superuser status grants full permissions.'
            ),
        }),
        ('Important dates', {'fields': ('last_login', 'date_joined')}),
    )

    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('username', 'email', 'password1', 'password2', 'is_staff', 'is_active'),
        }),
    )

    filter_horizontal = ('groups',)


class ArticleRevisionInline(admin.TabularInline):
    model = ArticleRevision
    extra = 0
    fields = ('status', 'title', 'submitted_by', 'reviewed_by', 'created_at')
    readonly_fields = ('created_at',)
    show_change_link = True


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = (
        'title', 'author', 'status', 'score', 'pending_edits', 'created_at', 'updated_at',
    )
    list_display_links = ('title',)
    list_filter = ('status', 'created_at', 'author')
    search_fields = ('title', 'slug', 'introduction', 'body_text')
    prepopulated_fields = {'slug': ('title',)}
    readonly_fields = ('created_at', 'updated_at', 'submitted_at', 'reviewed_at')
    autocomplete_fields = ('author', 'reviewed_by')
    date_hierarchy = 'created_at'
    list_per_page = 25
    inlines = (ArticleRevisionInline,)
    actions = ('approve_articles', 'reject_articles', 'unpublish_articles')

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            _score=Sum('votes__value'),
            _pending=Count(
                'revisions',
                filter=Q(revisions__status=ArticleRevision.STATUS_PENDING),
            ),
        )

    @admin.display(description='Score', ordering='_score')
    def score(self, obj):
        return obj._score or 0

    @admin.display(description='Pending edits', ordering='_pending')
    def pending_edits(self, obj):
        return obj._pending

    @admin.action(description='Approve and publish selected articles')
    def approve_articles(self, request, queryset):
        count = 0
        for article in queryset.exclude(status=Article.STATUS_PUBLISHED):
            approve_article(article, request.user)
            count += 1
        self.message_user(request, f'{count} article(s) published. Authors were notified.', messages.SUCCESS)

    @admin.action(description='Reject selected articles')
    def reject_articles(self, request, queryset):
        count = 0
        for article in queryset.exclude(status=Article.STATUS_REJECTED):
            reject_article(article, request.user, 'Rejected from the admin panel.')
            count += 1
        self.message_user(request, f'{count} article(s) rejected. Authors were notified.', messages.WARNING)

    @admin.action(description='Send selected articles back to pending')
    def unpublish_articles(self, request, queryset):
        updated = queryset.exclude(status=Article.STATUS_PENDING).update(
            status=Article.STATUS_PENDING,
        )
        self.message_user(request, f'{updated} article(s) moved to the queue.', messages.SUCCESS)

    fieldsets = (
        (None, {
            'fields': ('title', 'slug', 'author', 'status'),
        }),
        ('Content', {
            'fields': ('introduction', 'body_text', 'image'),
        }),
        ('Moderation', {
            'fields': ('moderator_comment', 'submitted_at', 'reviewed_by', 'reviewed_at'),
        }),
        ('Dates', {
            'fields': ('created_at', 'updated_at'),
        }),
    )


@admin.register(ArticleRevision)
class ArticleRevisionAdmin(admin.ModelAdmin):
    list_display = ('title', 'article', 'status', 'submitted_by', 'reviewed_by', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('title', 'article__title', 'submitted_by__username')
    autocomplete_fields = ('article', 'submitted_by', 'reviewed_by')
    readonly_fields = ('created_at', 'reviewed_at')
    date_hierarchy = 'created_at'
    list_per_page = 25
    actions = ('approve_revisions', 'reject_revisions')

    @admin.action(description='Approve selected edits')
    def approve_revisions(self, request, queryset):
        count = 0
        for revision in queryset.filter(status=ArticleRevision.STATUS_PENDING):
            approve_revision(revision, request.user)
            count += 1
        self.message_user(request, f'{count} edit(s) approved.', messages.SUCCESS)

    @admin.action(description='Reject selected edits')
    def reject_revisions(self, request, queryset):
        count = 0
        for revision in queryset.filter(status=ArticleRevision.STATUS_PENDING):
            reject_revision(revision, request.user, 'Rejected from the admin panel.')
            count += 1
        self.message_user(request, f'{count} edit(s) rejected.', messages.WARNING)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'user', 'kind', 'title', 'is_read')
    list_filter = ('kind', 'is_read', 'created_at')
    search_fields = ('title', 'message', 'user__username')
    autocomplete_fields = ('user', 'article')
    readonly_fields = ('created_at',)
    date_hierarchy = 'created_at'
    list_per_page = 50
    actions = ('mark_read', 'mark_unread')

    @admin.action(description='Mark selected as read')
    def mark_read(self, request, queryset):
        updated = queryset.update(is_read=True)
        self.message_user(request, f'{updated} notification(s) marked read.', messages.SUCCESS)

    @admin.action(description='Mark selected as unread')
    def mark_unread(self, request, queryset):
        updated = queryset.update(is_read=False)
        self.message_user(request, f'{updated} notification(s) marked unread.', messages.SUCCESS)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'birth_date', 'last_seen', 'is_online')
    search_fields = ('user__username', 'user__email')
    autocomplete_fields = ('user',)
    readonly_fields = ('last_seen',)
    list_select_related = ('user',)

    @admin.display(boolean=True, description='Online')
    def is_online(self, obj):
        return obj.is_online
