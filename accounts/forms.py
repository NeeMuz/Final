from django import forms
from django.contrib.auth.forms import AuthenticationForm, PasswordChangeForm, UserCreationForm
from django.contrib.auth.models import User
from django.utils import timezone

from .models import Profile

MIN_BIRTH_YEAR = 1900
BIRTH_DATE_INPUT_FORMATS = ['%d.%m.%Y']


MIN_USERNAME_LENGTH = 3
RESERVED_USERNAMES = {
    'admin', 'administrator', 'root', 'moderator', 'staff', 'system',
    'bikibedia', 'support', 'help', 'me', 'null', 'undefined', 'anonymous',
}


def normalize_username(value):
    return (value or '').strip()


def username_taken(username, exclude_pk=None):
    qs = User.objects.filter(username__iexact=username)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()


def email_taken(email, exclude_pk=None):
    qs = User.objects.filter(email__iexact=email)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()


class RegisterForm(UserCreationForm):
    email = forms.EmailField(label='Email')

    class Meta:
        model = User
        fields = ('username', 'email', 'password1', 'password2')
        widgets = {
            'username': forms.TextInput(attrs={'class': 'input'}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ('email', 'password1', 'password2'):
            self.fields[name].widget.attrs['class'] = 'input'

        self.fields['username'].widget.attrs.update({
            'autocomplete': 'username',
            'autofocus': 'autofocus',
            'minlength': str(MIN_USERNAME_LENGTH),
            'maxlength': '150',
            'data-validate': 'username',
        })
        self.fields['email'].widget.attrs.update({
            'autocomplete': 'email',
            'data-validate': 'email',
        })
        self.fields['password1'].widget.attrs.update({
            'autocomplete': 'new-password',
            'data-validate': 'password',
        })
        self.fields['password2'].widget.attrs.update({
            'autocomplete': 'new-password',
            'data-validate': 'password-confirm',
        })
        self.fields['username'].help_text = (
            'Letters, digits and @ . + - _ only. At least '
            f'{MIN_USERNAME_LENGTH} characters.'
        )
        self.fields['password1'].help_text = (
            'At least 8 characters. Avoid common passwords and anything close '
            'to your username.'
        )

    def clean_username(self):
        username = normalize_username(self.cleaned_data.get('username'))
        if len(username) < MIN_USERNAME_LENGTH:
            raise forms.ValidationError(
                f'Username must be at least {MIN_USERNAME_LENGTH} characters long.'
            )
        if username.lower() in RESERVED_USERNAMES:
            raise forms.ValidationError('This username is reserved. Pick another one.')
        if username_taken(username):
            raise forms.ValidationError('This username is already taken.')
        return username

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip().lower()
        if not email:
            raise forms.ValidationError('Email is required.')
        if email_taken(email):
            raise forms.ValidationError('An account with this email already exists.')
        return email


class LoginForm(AuthenticationForm):
    username = forms.CharField(
        label='Username',
        widget=forms.TextInput(attrs={
            'class': 'input',
            'autocomplete': 'username',
            'autofocus': 'autofocus',
        }),
    )
    password = forms.CharField(
        label='Password',
        widget=forms.PasswordInput(attrs={
            'class': 'input',
            'autocomplete': 'current-password',
        }),
    )

    error_messages = {
        **AuthenticationForm.error_messages,
        'invalid_login': 'Wrong username or password. Check both and try again.',
        'inactive': 'This account is disabled.',
    }


class ProfileForm(forms.ModelForm):
    username = forms.CharField(
        label='Username',
        max_length=150,
        widget=forms.TextInput(attrs={'class': 'input', 'autocomplete': 'username'}),
    )
    email = forms.EmailField(
        label='Email',
        widget=forms.EmailInput(attrs={'class': 'input', 'autocomplete': 'email'}),
    )
    avatar = forms.ImageField(
        required=False,
        label='Profile photo',
        widget=forms.FileInput(attrs={
            'class': 'profile-avatar-input',
            'accept': 'image/*',
            'id': 'id_avatar',
        }),
    )

    class Meta:
        model = Profile
        fields = ('birth_date', 'avatar')
        labels = {
            'birth_date': 'Date of birth',
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.fields['birth_date'] = forms.DateField(
            required=False,
            input_formats=BIRTH_DATE_INPUT_FORMATS,
            label='Date of birth',
            widget=forms.TextInput(attrs={
                'class': 'input birth-date-input',
                'placeholder': 'DD.MM.YYYY',
                'inputmode': 'numeric',
                'maxlength': '10',
                'autocomplete': 'bday',
                'data-birth-date-input': '',
            }),
        )
        if self.instance and self.instance.birth_date:
            self.initial['birth_date'] = self.instance.birth_date.strftime('%d.%m.%Y')
        if user:
            self.fields['username'].initial = user.username
            self.fields['email'].initial = user.email

    def clean_username(self):
        username = normalize_username(self.cleaned_data.get('username'))
        if not username:
            raise forms.ValidationError('Username is required.')
        if len(username) < MIN_USERNAME_LENGTH:
            raise forms.ValidationError(
                f'Username must be at least {MIN_USERNAME_LENGTH} characters long.'
            )
        current = normalize_username(self.user.username if self.user else '')
        if current and username.lower() == current.lower():
            # Existing accounts may predate reserved-name rules; only block renames.
            return username
        if username.lower() in RESERVED_USERNAMES:
            raise forms.ValidationError('This username is reserved. Pick another one.')
        exclude_pk = self.user.pk if self.user else None
        if username_taken(username, exclude_pk=exclude_pk):
            raise forms.ValidationError('This username is already taken.')
        return username

    def clean_email(self):
        email = (self.cleaned_data.get('email') or '').strip().lower()
        exclude_pk = self.user.pk if self.user else None
        if email and email_taken(email, exclude_pk=exclude_pk):
            raise forms.ValidationError('An account with this email already exists.')
        return email

    def clean_birth_date(self):
        birth_date = self.cleaned_data.get('birth_date')
        if not birth_date:
            return birth_date

        today = timezone.localdate()
        if birth_date.year < MIN_BIRTH_YEAR or birth_date.year > today.year:
            raise forms.ValidationError(
                f'Enter a real date from {MIN_BIRTH_YEAR} to {today.year}.'
            )
        if birth_date > today:
            raise forms.ValidationError('Date of birth cannot be in the future.')
        return birth_date

    def save(self, commit=True):
        profile = super().save(commit=commit)
        if self.user:
            self.user.username = self.cleaned_data['username']
            self.user.email = self.cleaned_data['email']
            self.user.save(update_fields=['username', 'email'])
        return profile


class StyledPasswordChangeForm(PasswordChangeForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs.setdefault('class', 'input')
        self.fields['old_password'].widget.attrs['autocomplete'] = 'current-password'
        self.fields['new_password1'].widget.attrs['autocomplete'] = 'new-password'
        self.fields['new_password2'].widget.attrs['autocomplete'] = 'new-password'
