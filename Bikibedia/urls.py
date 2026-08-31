from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path

import Bikibedia.admin  # noqa: F401

from accounts.views import (
    UserLoginView,
    UserLogoutView,
    auth_field_check,
    change_password_view,
    password_rules,
    notification_mark_read,
    notifications_mark_all_read,
    notification_delete,
    notifications_delete_all,
    notifications_view,
    presence_ping,
    profile_view,
    register_view,
)
from wiki import views
from wiki import moderation_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.home, name='home'),
    path('articles/', views.articles, name='articles'),
    path('articles/new/', views.article_create, name='article_create'),
    path('articles/upload-image/', views.upload_inline_image, name='upload_inline_image'),
    path('articles/<slug:slug>/edit/', views.article_edit, name='article_edit'),
    path('articles/<slug:slug>/delete/', views.article_delete, name='article_delete'),
    path('wiki/<slug:slug>/vote/', views.article_vote, name='article_vote'),
    path('wiki/<slug:slug>/', views.article_detail, name='article'),
    path('login/', UserLoginView.as_view(), name='login'),
    path('logout/', UserLogoutView.as_view(), name='logout'),
    path('register/', register_view, name='register'),
    path('profile/', profile_view, name='profile'),
    path('profile/password/', change_password_view, name='change_password'),
    path('notifications/', notifications_view, name='notifications'),
    path('notifications/<int:pk>/read/', notification_mark_read, name='notification_mark_read'),
    path('notifications/<int:pk>/delete/', notification_delete, name='notification_delete'),
    path('notifications/read-all/', notifications_mark_all_read, name='notifications_mark_all_read'),
    path('notifications/delete-all/', notifications_delete_all, name='notifications_delete_all'),
    path('accounts/presence/', presence_ping, name='presence_ping'),
    path('api/live/', views.live_state, name='live_state'),
    path('api/auth/check/', auth_field_check, name='auth_field_check'),
    path('api/auth/password-rules/', password_rules, name='password_rules'),
    path('moderation/', moderation_views.moderation_queue, name='moderation_queue'),
    path('moderation/log/', moderation_views.moderation_log, name='moderation_log'),
    path('moderation/article/<int:pk>/', moderation_views.moderation_review_article, name='moderation_review_article'),
    path('moderation/revision/<int:pk>/', moderation_views.moderation_review_revision, name='moderation_review_revision'),
    path('license/', views.license_page, name='license'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
