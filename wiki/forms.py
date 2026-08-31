import re

from django import forms
from django.utils.html import strip_tags

from .models import Article
from .sanitize import sanitize_article_html

TITLE_MIN_LENGTH = 3
TITLE_MAX_LENGTH = 200
INTRO_MIN_LENGTH = 20
INTRO_MAX_LENGTH = 500
BODY_MIN_CHARS = 50
COVER_MAX_BYTES = 5 * 1024 * 1024

WHITESPACE_RE = re.compile(r'\s+')


def collapse_whitespace(value):
    return WHITESPACE_RE.sub(' ', (value or '')).strip()


def body_text_length(html):
    """Visible character count, ignoring markup and image placeholders."""
    text = re.sub(r'<[^>]+>', ' ', html or '')
    text = text.replace('&nbsp;', ' ')
    return len(collapse_whitespace(text))


class ArticleForm(forms.ModelForm):
    clear_cover = forms.BooleanField(required=False, widget=forms.HiddenInput())

    class Meta:
        model = Article
        fields = ('title', 'introduction', 'body_text', 'image')
        widgets = {
            'title': forms.TextInput(attrs={
                'class': 'input',
                'maxlength': str(TITLE_MAX_LENGTH),
                'minlength': str(TITLE_MIN_LENGTH),
                'autocomplete': 'off',
                'data-counter-max': str(TITLE_MAX_LENGTH),
                'data-counter-min': str(TITLE_MIN_LENGTH),
            }),
            'introduction': forms.Textarea(attrs={
                'rows': 2,
                'class': 'input input-compact',
                'maxlength': str(INTRO_MAX_LENGTH),
                'data-counter-max': str(INTRO_MAX_LENGTH),
                'data-counter-min': str(INTRO_MIN_LENGTH),
            }),
            'body_text': forms.Textarea(attrs={
                'class': 'wysiwyg-source',
                'data-wysiwyg-source': '',
                'tabindex': '-1',
                'aria-hidden': 'true',
            }),
            'image': forms.FileInput(attrs={
                'class': 'input-file cover-image-input',
                'accept': 'image/jpeg,image/png,image/gif,image/webp',
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['body_text'].required = False
        self.fields['body_text'].widget.is_required = False
        self.fields['title'].help_text = (
            f'{TITLE_MIN_LENGTH}–{TITLE_MAX_LENGTH} characters.'
        )
        self.fields['introduction'].help_text = (
            f'A short summary, {INTRO_MIN_LENGTH}–{INTRO_MAX_LENGTH} characters.'
        )

    def clean_title(self):
        title = collapse_whitespace(self.cleaned_data.get('title'))
        if len(title) < TITLE_MIN_LENGTH:
            raise forms.ValidationError(
                f'Title must be at least {TITLE_MIN_LENGTH} characters long.'
            )
        if not re.search(r'[^\W\d_]', title, re.UNICODE):
            raise forms.ValidationError('Title must contain at least one letter.')

        duplicates = Article.objects.filter(title__iexact=title)
        if self.instance.pk:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise forms.ValidationError('An article with this title already exists.')
        return title

    def clean_introduction(self):
        intro = collapse_whitespace(strip_tags(self.cleaned_data.get('introduction')))
        if len(intro) < INTRO_MIN_LENGTH:
            raise forms.ValidationError(
                f'Introduction must be at least {INTRO_MIN_LENGTH} characters long.'
            )
        return intro

    def clean_body_text(self):
        body = self.cleaned_data.get('body_text', '')
        cleaned = sanitize_article_html(body).strip()
        if cleaned in ('', '<p></p>', '<p><br></p>'):
            raise forms.ValidationError('Add article text or at least one photo.')

        has_image = '<img' in cleaned
        if not has_image and body_text_length(cleaned) < BODY_MIN_CHARS:
            raise forms.ValidationError(
                f'Article text is too short — write at least {BODY_MIN_CHARS} '
                'characters or add a photo.'
            )
        return cleaned

    def clean_image(self):
        image = self.cleaned_data.get('image')
        if not image or not hasattr(image, 'size'):
            return image

        if image.size > COVER_MAX_BYTES:
            raise forms.ValidationError('Cover image must be 5 MB or smaller.')

        content_type = getattr(image, 'content_type', '')
        if content_type and not content_type.startswith('image/'):
            raise forms.ValidationError('Cover must be an image file.')
        return image

    def save(self, commit=True):
        instance = super().save(commit=False)
        if self.cleaned_data.get('clear_cover') and not self.cleaned_data.get('image'):
            instance.image = None
        if commit:
            instance.save()
        return instance


class ModerationDecisionForm(forms.Form):
    comment = forms.CharField(
        label='Comment for the author',
        required=False,
        widget=forms.Textarea(attrs={
            'class': 'input',
            'rows': 4,
            'placeholder': 'Explain what should be fixed, or leave empty when approving.',
        }),
    )
