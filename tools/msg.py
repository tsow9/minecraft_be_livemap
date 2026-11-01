"""Messages in the owner's language: English when the repository variable LANGUAGE is "en" (BLOCKMAP_LANG in the
workflows), Japanese otherwise."""
import os

JA = not os.environ.get('BLOCKMAP_LANG', 'ja').lower().startswith('en')


def t(ja, en):
    return ja if JA else en
