'use strict'
// Messages in the owner's language: English when the repository variable LANGUAGE is "en" (BLOCKMAP_LANG in the
// workflows), Japanese otherwise.
const JA = !/^en/i.test(process.env.BLOCKMAP_LANG || 'ja')
const t = (ja, en) => (JA ? ja : en)
module.exports = { t }
