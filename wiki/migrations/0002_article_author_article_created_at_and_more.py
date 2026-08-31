import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone
from django.utils.text import slugify


def forwards(apps, schema_editor):
    Article = apps.get_model('wiki', 'Article')
    for article in Article.objects.all():
        if not article.slug:
            base = slugify(article.title) or f'article-{article.pk}'
            slug = base
            counter = 1
            while Article.objects.filter(slug=slug).exclude(pk=article.pk).exists():
                slug = f'{base}-{counter}'
                counter += 1
            article.slug = slug
        if not article.created_at:
            article.created_at = getattr(article, 'creation_date', None) or timezone.now()
        article.save()


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('wiki', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='article',
            name='author',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='articles',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='article',
            name='created_at',
            field=models.DateTimeField(default=timezone.now),
        ),
        migrations.AddField(
            model_name='article',
            name='slug',
            field=models.SlugField(blank=True, max_length=220),
        ),
        migrations.AddField(
            model_name='article',
            name='updated_at',
            field=models.DateTimeField(default=timezone.now),
        ),
        migrations.AlterField(
            model_name='article',
            name='title',
            field=models.CharField(max_length=200),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='article',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True),
        ),
        migrations.AlterField(
            model_name='article',
            name='slug',
            field=models.SlugField(blank=True, max_length=220, unique=True),
        ),
        migrations.AlterField(
            model_name='article',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.RemoveField(
            model_name='article',
            name='creation_date',
        ),
    ]
