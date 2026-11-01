"""Messages in the owner's language: Japanese when the repository variable LANGUAGE is "ja" (BLOCKMAP_LANG in the
workflows), English otherwise."""
import os

JA = os.environ.get('BLOCKMAP_LANG', 'en').lower().startswith('ja')


def t(ja, en):
    return ja if JA else en
