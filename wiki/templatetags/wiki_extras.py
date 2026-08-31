from django import template

from wiki.markup import format_article_body

register = template.Library()


@register.filter(name='wiki_markup')
def wiki_markup(value):
    return format_article_body(value)
