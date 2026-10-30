'use strict';
// Japanese biome names (the game's own wording) by Bedrock biome ID (IDs from Mojang's bedrock-samples, mojang-biomes.json).
// Old variants that new worlds no longer make share the name of the biome they became.
const BIOME_JA = {
  0: '海洋', 1: '平原', 2: '砂漠', 3: '吹きさらしの丘', 4: '森林', 5: 'タイガ', 6: '沼地', 7: '河川',
  8: 'ネザーの荒地', 9: 'ジ・エンド', 10: '凍った海', 11: '凍った川', 12: '雪原', 13: '雪山',
  14: 'キノコ島', 15: 'キノコ島の海岸', 16: '砂浜', 17: '砂漠の丘', 18: '森林の丘', 19: 'タイガの丘',
  20: '吹きさらしの丘のふち', 21: 'ジャングル', 22: 'ジャングルの丘', 23: 'まばらなジャングル', 24: '深海',
  25: '石だらけの海岸', 26: '雪の砂浜', 27: 'シラカバの森', 28: 'シラカバの森の丘', 29: '暗い森',
  30: '雪のタイガ', 31: '雪のタイガの丘', 32: 'マツの原生林', 33: 'マツの原生林の丘', 34: '吹きさらしの森',
  35: 'サバンナ', 36: 'サバンナの高原', 37: '荒野', 38: '森のある荒野', 39: '荒野の台地',
  40: '暖かい海', 41: '暖かい深海', 42: 'ぬるい海', 43: 'ぬるい深海', 44: '冷たい海', 45: '冷たい深海',
  46: '凍った海', 47: '凍った深海', 48: '竹林', 49: '竹林の丘',
  129: 'ヒマワリ平原', 130: '砂漠', 131: '吹きさらしの砂利の丘', 132: '花の森', 133: 'タイガ', 134: '沼地',
  140: '氷樹', 149: 'ジャングル', 151: 'まばらなジャングル', 155: 'シラカバの原生林', 156: 'シラカバの原生林',
  157: '暗い森', 158: '雪のタイガ', 160: 'トウヒの原生林', 161: 'トウヒの原生林', 162: '吹きさらしの森',
  163: '吹きさらしのサバンナ', 164: 'サバンナの高原', 165: '侵食された荒野', 166: '森のある荒野', 167: '荒野',
  178: 'ソウルサンドの谷', 179: '真紅の森', 180: '歪んだ森', 181: '玄武岩の三角州',
  182: '尖った山頂', 183: '凍った山頂', 184: '雪の斜面', 185: '林', 186: '草地', 187: '繁茂した洞窟',
  188: '鍾乳洞', 189: '石だらけの山頂', 190: 'ディープダーク', 191: 'マングローブの沼地', 192: 'サクラの林',
  193: 'ペールガーデン', 194: '硫黄の洞窟', 195: 'まだらな森',
};
// The same biomes by their English names (the game's current wording).
const BIOME_EN = {
  0: 'Ocean', 1: 'Plains', 2: 'Desert', 3: 'Windswept Hills', 4: 'Forest', 5: 'Taiga', 6: 'Swamp', 7: 'River',
  8: 'Nether Wastes', 9: 'The End', 10: 'Frozen Ocean', 11: 'Frozen River', 12: 'Snowy Plains',
  13: 'Snowy Mountains', 14: 'Mushroom Fields', 15: 'Mushroom Field Shore', 16: 'Beach', 17: 'Desert Hills',
  18: 'Wooded Hills', 19: 'Taiga Hills', 20: 'Windswept Hills Edge', 21: 'Jungle', 22: 'Jungle Hills',
  23: 'Sparse Jungle', 24: 'Deep Ocean', 25: 'Stony Shore', 26: 'Snowy Beach', 27: 'Birch Forest',
  28: 'Birch Forest Hills', 29: 'Dark Forest', 30: 'Snowy Taiga', 31: 'Snowy Taiga Hills',
  32: 'Old Growth Pine Taiga', 33: 'Old Growth Pine Taiga Hills', 34: 'Windswept Forest', 35: 'Savanna',
  36: 'Savanna Plateau', 37: 'Badlands', 38: 'Wooded Badlands', 39: 'Badlands Plateau', 40: 'Warm Ocean',
  41: 'Deep Warm Ocean', 42: 'Lukewarm Ocean', 43: 'Deep Lukewarm Ocean', 44: 'Cold Ocean', 45: 'Deep Cold Ocean',
  46: 'Frozen Ocean', 47: 'Deep Frozen Ocean', 48: 'Bamboo Jungle', 49: 'Bamboo Jungle Hills',
  129: 'Sunflower Plains', 130: 'Desert', 131: 'Windswept Gravelly Hills', 132: 'Flower Forest', 133: 'Taiga',
  134: 'Swamp', 140: 'Ice Spikes', 149: 'Jungle', 151: 'Sparse Jungle', 155: 'Old Growth Birch Forest',
  156: 'Old Growth Birch Forest', 157: 'Dark Forest', 158: 'Snowy Taiga', 160: 'Old Growth Spruce Taiga',
  161: 'Old Growth Spruce Taiga', 162: 'Windswept Forest', 163: 'Windswept Savanna', 164: 'Savanna Plateau',
  165: 'Eroded Badlands', 166: 'Wooded Badlands', 167: 'Badlands', 178: 'Soul Sand Valley', 179: 'Crimson Forest',
  180: 'Warped Forest', 181: 'Basalt Deltas', 182: 'Jagged Peaks', 183: 'Frozen Peaks', 184: 'Snowy Slopes',
  185: 'Grove', 186: 'Meadow', 187: 'Lush Caves', 188: 'Dripstone Caves', 189: 'Stony Peaks', 190: 'Deep Dark',
  191: 'Mangrove Swamp', 192: 'Cherry Grove', 193: 'Pale Garden', 194: 'Sulfur Caves', 195: 'Dappled Forest',
};
