from datetime import timedelta

from django.utils import timezone

ONLINE_THRESHOLD = timedelta(minutes=3)


def is_profile_online(profile):
    if not profile or not profile.last_seen:
        return False
    return timezone.now() - profile.last_seen <= ONLINE_THRESHOLD


def presence_label(profile):
    return 'Active' if is_profile_online(profile) else 'Offline'


def touch_profile_last_seen(user):
    if not user or not user.is_authenticated:
        return
    from .models import Profile

    Profile.objects.filter(user=user).update(last_seen=timezone.now())


def mark_profile_offline(user):
    if not user or not user.is_authenticated:
        return
    from .models import Profile

    Profile.objects.filter(user=user).update(last_seen=None)
