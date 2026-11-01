'use strict'
// Messages in the owner's language: Japanese when the repository variable LANGUAGE is "ja" (BLOCKMAP_LANG in the
// workflows), English otherwise.
const JA = /^ja/i.test(process.env.BLOCKMAP_LANG || 'en')
const t = (ja, en) => (JA ? ja : en)
module.exports = { t }
