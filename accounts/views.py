import time

from django.contrib.auth import login, update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.contrib.auth.password_validation import (
    password_validators_help_texts,
    validate_password,
)
from django.contrib.auth.models import User
from django.contrib.auth.views import LoginView, LogoutView
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse_lazy
from django.views.decorators.http import require_GET, require_POST

from wiki.models import Article

from .forms import (
    MIN_USERNAME_LENGTH,
    RESERVED_USERNAMES,
    LoginForm,
    ProfileForm,
    RegisterForm,
    StyledPasswordChangeForm,
    email_taken,
    normalize_username,
    username_taken,
)
from .models import Notification, Profile
from .presence import mark_profile_offline, touch_profile_last_seen


class UserLoginView(LoginView):
    template_name = 'accounts/login.html'
    authentication_form = LoginForm
    redirect_authenticated_user = True

    def form_valid(self, form):
        response = super().form_valid(form)
        touch_profile_last_seen(self.request.user)
        return response


class UserLogoutView(LogoutView):
    next_page = reverse_lazy('home')

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            mark_profile_offline(request.user)
        return super().dispatch(request, *args, **kwargs)


FIELD_CHECK_LIMIT = 40
FIELD_CHECK_WINDOW_SECONDS = 60


def _field_check_allowed(request):
    """Cheap per-session throttle so the username lookup cannot be scraped."""
    now = time.time()
    bucket = request.session.get('_field_check_bucket')
    if not bucket or now - bucket.get('start', 0) > FIELD_CHECK_WINDOW_SECONDS:
        bucket = {'start': now, 'count': 0}

    bucket['count'] += 1
    request.session['_field_check_bucket'] = bucket
    request.session.modified = True
    return bucket['count'] <= FIELD_CHECK_LIMIT


def _password_report(password, username=''):
    if not password:
        return {'state': 'idle', 'score': 0, 'message': ''}

    probe = User(username=username) if username else None
    try:
        validate_password(password, user=probe)
    except ValidationError as error:
        return {'state': 'error', 'score': 1, 'message': ' '.join(error.messages)}

    score = 2
    if len(password) >= 12:
        score += 1
    variety = sum([
        any(c.islower() for c in password),
        any(c.isupper() for c in password),
        any(c.isdigit() for c in password),
        any(not c.isalnum() for c in password),
    ])
    if variety >= 3:
        score += 1

    labels = {2: 'Acceptable password.', 3: 'Good password.', 4: 'Strong password.'}
    return {
        'state': 'ok',
        'score': score,
        'message': labels.get(score, 'Acceptable password.'),
    }


@require_GET
def auth_field_check(request):
    """Live feedback for the signup form. Mirrors the server-side form rules."""
    field = request.GET.get('field', '')
    value = (request.GET.get('value') or '').strip()

    if not _field_check_allowed(request):
        return JsonResponse({'state': 'idle', 'message': ''}, status=429)

    if field == 'username':
        if not value:
            return JsonResponse({'state': 'idle', 'message': ''})
        if len(value) < MIN_USERNAME_LENGTH:
            return JsonResponse({
                'state': 'error',
                'message': f'At least {MIN_USERNAME_LENGTH} characters.',
            })
        if value.lower() in RESERVED_USERNAMES:
            return JsonResponse({'state': 'error', 'message': 'This username is reserved.'})
        exclude_pk = request.user.pk if request.user.is_authenticated else None
        if username_taken(normalize_username(value), exclude_pk=exclude_pk):
            return JsonResponse({'state': 'error', 'message': 'Already taken.'})
        return JsonResponse({'state': 'ok', 'message': 'Available.'})

    if field == 'email':
        if not value:
            return JsonResponse({'state': 'idle', 'message': ''})
        try:
            validate_email(value)
        except ValidationError:
            return JsonResponse({'state': 'error', 'message': 'Enter a valid email address.'})
        # Duplicate emails are rejected on submit rather than here, so this
        # endpoint cannot be used to enumerate registered addresses.
        return JsonResponse({'state': 'ok', 'message': 'Looks good.'})

    if field == 'password':
        return JsonResponse(_password_report(value, request.GET.get('username', '')))

    return JsonResponse({'state': 'idle', 'message': ''}, status=400)


@require_GET
def password_rules(request):
    return JsonResponse({'rules': list(password_validators_help_texts())})


def register_view(request):
    if request.user.is_authenticated:
        return redirect('profile')

    form = RegisterForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        touch_profile_last_seen(user)
        return redirect('profile')

    return render(request, 'accounts/register.html', {'form': form})


def get_user_profile(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return profile


@login_required
def profile_view(request):
    profile = get_user_profile(request.user)
    editing = request.GET.get('edit') == '1'

    if request.method == 'POST':
        form = ProfileForm(
            request.POST,
            request.FILES,
            instance=profile,
            user=request.user,
        )
        if form.is_valid():
            form.save()
            messages.success(request, 'Profile updated.')
            return redirect('profile')
        editing = True
    elif editing:
        form = ProfileForm(instance=profile, user=request.user)
    else:
        form = None

    articles = Article.objects.filter(author=request.user).order_by('-created_at')
    return render(request, 'accounts/profile.html', {
        'user_articles': articles,
        'profile': profile,
        'form': form,
        'editing': editing,
    })


@login_required
@require_POST
def presence_ping(request):
    touch_profile_last_seen(request.user)
    return JsonResponse({'status': 'active'})


@login_required
def change_password_view(request):
    form = StyledPasswordChangeForm(request.user, request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        update_session_auth_hash(request, user)
        messages.success(request, 'Password updated successfully.')
        return redirect('profile')

    return render(request, 'accounts/change_password.html', {
        'form': form,
    })


@login_required
def notifications_view(request):
    notifications = Notification.objects.filter(user=request.user).select_related('article')
    return render(request, 'accounts/notifications.html', {
        'notifications': notifications,
    })


@login_required
@require_POST
def notification_mark_read(request, pk):
    notification = get_object_or_404(Notification, pk=pk, user=request.user)
    notification.is_read = True
    notification.save(update_fields=['is_read'])
    if notification.link:
        return redirect(notification.link)
    return redirect('notifications')


@login_required
@require_POST
def notification_delete(request, pk):
    notification = get_object_or_404(Notification, pk=pk, user=request.user)
    notification.delete()
    messages.success(request, 'Notification deleted.')
    return redirect('notifications')


@login_required
@require_POST
def notifications_mark_all_read(request):
    Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    messages.success(request, 'All notifications marked as read.')
    return redirect('notifications')


@login_required
@require_POST
def notifications_delete_all(request):
    Notification.objects.filter(user=request.user).delete()
    messages.success(request, 'All notifications deleted.')
    return redirect('notifications')

