'use strict';
// Japanese names for Bedrock block IDs. Unknown blocks fall back to a readable English name.
const BLOCK_JA = (() => {
  const exact = {
    air: '空気', water: '水', flowing_water: '水', lava: '溶岩', flowing_lava: '溶岩', bubble_column: '気泡柱',
    grass_block: '草ブロック', grass: '草ブロック', short_grass: '草', tall_grass: '背の高い草', tallgrass: '草', fern: 'シダ', large_fern: '大きなシダ',
    dirt: '土', coarse_dirt: '粗い土', rooted_dirt: '根付いた土', dirt_with_roots: '根付いた土', podzol: 'ポドゾル', mycelium: '菌糸',
    grass_path: '土の道', dirt_path: '土の道', farmland: '耕地', mud: '泥', packed_mud: '固めた泥', mud_bricks: '泥レンガ', clay: '粘土',
    gravel: '砂利', sand: '砂', red_sand: '赤い砂', suspicious_sand: '怪しげな砂', suspicious_gravel: '怪しげな砂利',
    sandstone: '砂岩', red_sandstone: '赤い砂岩', stone: '石', cobblestone: '丸石', mossy_cobblestone: '苔むした丸石', smooth_stone: '滑らかな石',
    stonebrick: '石レンガ', stone_bricks: '石レンガ', mossy_stone_bricks: '苔むした石レンガ', cracked_stone_bricks: 'ひび割れた石レンガ',
    granite: '花崗岩', diorite: '閃緑岩', andesite: '安山岩', polished_granite: '磨かれた花崗岩', polished_diorite: '磨かれた閃緑岩', polished_andesite: '磨かれた安山岩',
    tuff: '凝灰岩', calcite: '方解石', dripstone_block: '鍾乳石ブロック', pointed_dripstone: '鍾乳石', deepslate: '深層岩', cobbled_deepslate: '深層岩の丸石',
    bedrock: '岩盤', obsidian: '黒曜石', crying_obsidian: '泣く黒曜石', bricks: 'レンガ', brick_block: 'レンガ',
    snow: '雪ブロック', snow_layer: '雪', powder_snow: '粉雪', ice: '氷', packed_ice: '氷塊', blue_ice: '青氷', frosted_ice: '薄氷',
    magma: 'マグマブロック', netherrack: 'ネザーラック', soul_sand: 'ソウルサンド', soul_soil: 'ソウルソイル', basalt: '玄武岩', polished_basalt: '磨かれた玄武岩',
    smooth_basalt: '滑らかな玄武岩', blackstone: 'ブラックストーン', glowstone: 'グロウストーン', nether_wart_block: 'ネザーウォートブロック',
    warped_wart_block: '歪んだウォートブロック', crimson_nylium: '真紅のナイリウム', warped_nylium: '歪んだナイリウム', shroomlight: 'シュルームライト',
    nether_gold_ore: 'ネザー金鉱石', quartz_ore: 'ネザークォーツ鉱石', nether_brick: 'ネザーレンガ', nether_bricks: 'ネザーレンガ', red_nether_brick: '赤いネザーレンガ',
    ancient_debris: '古代の残骸', end_stone: 'エンドストーン', end_bricks: 'エンドストーンレンガ', purpur_block: 'プルプァブロック',
    chorus_plant: 'コーラスプラント', chorus_flower: 'コーラスフラワー', end_rod: 'エンドロッド',
    cactus: 'サボテン', pumpkin: 'カボチャ', carved_pumpkin: 'くり抜かれたカボチャ', lit_pumpkin: 'ジャック・オ・ランタン', melon_block: 'スイカ',
    hay_block: '干草の俵', reeds: 'サトウキビ', sugar_cane: 'サトウキビ', waterlily: 'スイレンの葉', lily_pad: 'スイレンの葉', vine: 'ツタ',
    kelp: '昆布', seagrass: '海草', moss_block: '苔ブロック', moss_carpet: '苔のカーペット', bamboo: '竹', sculk: 'スカルク',
    brown_mushroom_block: '茶色いキノコブロック', red_mushroom_block: '赤いキノコブロック', mushroom_stem: 'キノコの柄',
    glass: 'ガラス', glass_pane: '板ガラス', tinted_glass: '遮光ガラス', bookshelf: '本棚', chiseled_bookshelf: '模様入りの本棚',
    crafting_table: '作業台', chest: 'チェスト', trapped_chest: 'トラップチェスト', ender_chest: 'エンダーチェスト', barrel: '樽',
    furnace: 'かまど', lit_furnace: 'かまど', blast_furnace: '溶鉱炉', lit_blast_furnace: '溶鉱炉', smoker: '燻製器', lit_smoker: '燻製器',
    iron_block: '鉄ブロック', gold_block: '金ブロック', diamond_block: 'ダイヤモンドブロック', emerald_block: 'エメラルドブロック',
    lapis_block: 'ラピスラズリブロック', redstone_block: 'レッドストーンブロック', coal_block: '石炭ブロック', netherite_block: 'ネザライトブロック',
    raw_iron_block: '鉄の原石ブロック', raw_gold_block: '金の原石ブロック', raw_copper_block: '銅の原石ブロック',
    amethyst_block: 'アメジストブロック', prismarine: 'プリズマリン', sea_lantern: 'シーランタン', quartz_block: 'クォーツブロック',
    rail: 'レール', golden_rail: 'パワードレール', detector_rail: 'ディテクターレール', activator_rail: 'アクティベーターレール',
    torch: '松明', soul_torch: '魂の松明', lantern: 'ランタン', soul_lantern: '魂のランタン', campfire: '焚き火', soul_campfire: '魂の焚き火',
    slime: 'スライムブロック', honey_block: 'ハチミツブロック', beehive: '養蜂箱', bee_nest: 'ハチの巣', composter: 'コンポスター',
    tnt: 'TNT', web: 'クモの巣', bed: 'ベッド', bell: '鐘', bone_block: '骨ブロック', brewing_stand: '醸造台', cauldron: '大釜',
    cartography_table: '製図台', anvil: '金床', chipped_anvil: '欠けた金床', damaged_anvil: '壊れかけの金床', decorated_pot: '飾り壺',
    dispenser: 'ディスペンサー', dropper: 'ドロッパー', enchanting_table: 'エンチャントテーブル', fence_gate: 'フェンスゲート', fence: 'フェンス',
    fire: '火', soul_fire: '魂の火', frame: '額縁', glow_frame: '輝く額縁', hopper: 'ホッパー', iron_chain: '鎖', chain: '鎖', ladder: 'はしご',
    lectern: '書見台', loom: '機織り機', grindstone: '砥石', stonecutter_block: '石切台', smithing_table: '鍛冶台', fletching_table: '矢細工台',
    scaffolding: '足場', beacon: 'ビーコン', conduit: 'コンジット', lightning_rod: '避雷針', flower_pot: '植木鉢', skull: '頭',
    standing_banner: '旗', wall_banner: '旗', standing_sign: '看板', wall_sign: '看板', trapdoor: 'トラップドア', wooden_door: '木のドア',
    iron_door: '鉄のドア', iron_trapdoor: '鉄のトラップドア', iron_bars: '鉄格子', wooden_button: 'ボタン', wooden_pressure_plate: '感圧板', lever: 'レバー',
    redstone_wire: 'レッドストーンワイヤー', redstone_torch: 'レッドストーントーチ', unlit_redstone_torch: 'レッドストーントーチ',
    redstone_lamp: 'レッドストーンランプ', lit_redstone_lamp: 'レッドストーンランプ', observer: 'オブザーバー', piston: 'ピストン', sticky_piston: '粘着ピストン',
    piston_arm_collision: 'ピストン', sticky_piston_arm_collision: '粘着ピストン', unpowered_repeater: 'リピーター', powered_repeater: 'リピーター',
    unpowered_comparator: 'コンパレーター', powered_comparator: 'コンパレーター', daylight_detector: '日照センサー', target: '的', respawn_anchor: 'リスポーンアンカー',
    lodestone: 'ロードストーン', crafter: 'クラフター', trial_spawner: 'トライアルスポナー', vault: '宝庫', mob_spawner: 'スポナー', jukebox: 'ジュークボックス',
    noteblock: '音符ブロック', end_portal_frame: 'エンドポータルフレーム', portal: 'ネザーポータル', trip_wire: 'トリップワイヤー', tripwire_hook: 'トリップワイヤーフック',
    weeping_vines: 'しだれツタ', twisting_vines: 'ねじれツタ', glow_lichen: 'ヒカリゴケ', hanging_roots: '垂れ根', spore_blossom: '胞子の花',
    cave_vines: '洞窟のツタ', cave_vines_body_with_berries: '洞窟のツタ(実)', cave_vines_head_with_berries: '洞窟のツタ(実)', sea_pickle: 'シーピクルス',
    azalea: 'ツツジ', flowering_azalea: '開花したツツジ', big_dripleaf: '大きなドリップリーフ', small_dripleaf_block: '小さなドリップリーフ',
    deadbush: '枯れ木', bush: '茂み', firefly_bush: 'ホタルの茂み', leaf_litter: '落ち葉', short_dry_grass: '短い枯れ草', tall_dry_grass: '背の高い枯れ草',
    allium: 'アリウム', azure_bluet: 'ヒナソウ', dandelion: 'タンポポ', yellow_flower: 'タンポポ', poppy: 'ポピー', red_flower: 'ポピー',
    cornflower: 'ヤグルマギク', lily_of_the_valley: 'スズラン', oxeye_daisy: 'フランスギク', sunflower: 'ヒマワリ', lilac: 'ライラック', rose_bush: 'バラの低木',
    peony: 'ボタン', pink_petals: 'ピンクの花びら', wildflowers: '野花', wither_rose: 'ウィザーローズ', torchflower: 'トーチフラワー', pitcher_plant: 'ウツボカズラ',
    open_eyeblossom: '開いたヒトミバナ', closed_eyeblossom: '閉じたヒトミバナ', cactus_flower: 'サボテンの花',
    wheat: '小麦', carrots: 'ニンジン', potatoes: 'ジャガイモ', beetroot: 'ビートルート', nether_wart: 'ネザーウォート', sweet_berry_bush: 'スイートベリーの低木',
    cocoa: 'カカオ', melon_stem: 'スイカの茎', pumpkin_stem: 'カボチャの茎', torchflower_crop: 'トーチフラワーの苗', pitcher_crop: 'ウツボカズラの苗',
    pale_moss_block: '青白い苔ブロック', pale_moss_carpet: '青白い苔のカーペット', pale_hanging_moss: '青白い垂れ苔', resin_clump: '樹脂の塊', resin_block: '樹脂ブロック',
    creaking_heart: 'きしむ心臓', dried_ghast: 'ひからびたガスト', straw_bed: 'わらのベッド', cinnabar: '辰砂',
    sulfur: '硫黄', potent_sulfur: '強力な硫黄', sulfur_spike: '硫黄の棘',
    stone_brick: '石レンガ', mossy_stone_brick: '苔むした石レンガ', brick: 'レンガ', mud_brick: '泥レンガ', end_stone_brick: 'エンドストーンレンガ', end_brick: 'エンドストーンレンガ',
    deepslate_brick: '深層岩レンガ', deepslate_tile: '深層岩タイル', polished_deepslate: '磨かれた深層岩', polished_blackstone: '磨かれたブラックストーン',
    polished_blackstone_brick: '磨かれたブラックストーンレンガ', prismarine_brick: 'プリズマリンレンガ', dark_prismarine: 'ダークプリズマリン', quartz: 'クォーツ',
    smooth_quartz: '滑らかなクォーツ', smooth_sandstone: '滑らかな砂岩', cut_sandstone: '研がれた砂岩', purpur: 'プルプァ', tuff_brick: '凝灰岩レンガ',
    polished_tuff: '磨かれた凝灰岩', resin_brick: '樹脂レンガ', normal_stone: '石',
    wool: '羊毛', concrete: 'コンクリート', concrete_powder: 'コンクリートパウダー', stained_glass: '色付きガラス', stained_glass_pane: '色付き板ガラス',
    terracotta: 'テラコッタ', hardened_clay: 'テラコッタ', stained_hardened_clay: '色付きテラコッタ', carpet: 'カーペット', shulker_box: 'シュルカーボックス',
  };
  const colors = {
    white: '白色の', orange: '橙色の', magenta: '赤紫色の', light_blue: '空色の', yellow: '黄色の', lime: '黄緑色の', pink: '桃色の', gray: '灰色の',
    light_gray: '薄灰色の', silver: '薄灰色の', cyan: '青緑色の', purple: '紫色の', blue: '青色の', brown: '茶色の', green: '緑色の', red: '赤色の', black: '黒色の',
  };
  const woods = {
    oak: 'オーク', spruce: 'トウヒ', birch: 'シラカバ', jungle: 'ジャングル', acacia: 'アカシア', dark_oak: 'ダークオーク', mangrove: 'マングローブ',
    cherry: 'サクラ', pale_oak: 'ペールオーク', bamboo: '竹', crimson: '真紅の', warped: '歪んだ', poplar: 'ポプラ', big_oak: 'ダークオーク',
  };
  const parts = {
    planks: 'の板材', log: 'の原木', wood: 'の木', stem: 'の幹', hyphae: 'の菌糸', leaves: 'の葉', sapling: 'の苗木', stairs: 'の階段', slab: 'のハーフブロック',
    double_slab: 'のハーフブロック', fence: 'のフェンス', fence_gate: 'のフェンスゲート', door: 'のドア', trapdoor: 'のトラップドア', button: 'のボタン',
    pressure_plate: 'の感圧板', standing_sign: 'の看板', wall_sign: 'の看板', hanging_sign: 'の吊り看板', roots: 'の根', propagule: 'の担根体',
  };
  const shapes = { stairs: 'の階段', slab: 'のハーフブロック', double_slab: 'のハーフブロック', wall: 'の塀' };
  const ore = { coal: '石炭', iron: '鉄', gold: '金', diamond: 'ダイヤモンド', emerald: 'エメラルド', lapis: 'ラピスラズリ', redstone: 'レッドストーン', copper: '銅' };

  function pretty(id) { return id.replace(/_/g, ' '); }

  function lookup(id) {
    if (exact[id]) return exact[id];
    let m = id.match(/^(stripped_)?(.+?)_(planks|log|wood|stem|hyphae|leaves|sapling|stairs|slab|double_slab|fence_gate|fence|door|trapdoor|button|pressure_plate|standing_sign|wall_sign|hanging_sign|roots|propagule)$/);
    if (m && woods[m[2]]) return (m[1] ? '樹皮を剥いだ' : '') + woods[m[2]] + parts[m[3]];
    m = id.match(/^(deepslate_)?(.+)_ore$/);
    if (m && ore[m[2]]) return (m[1] ? '深層' : '') + ore[m[2]] + '鉱石';
    for (const [c, ja] of Object.entries(colors).sort((a, b) => b[0].length - a[0].length)) {
      if (id.startsWith(c + '_')) {
        const rest = id.slice(c.length + 1);
        if (exact[rest]) return ja + exact[rest];
        if (rest === 'glazed_terracotta') return ja + '彩釉テラコッタ';
        if (rest === 'candle') return ja + 'ろうそく';
        if (rest === 'bed') return ja + 'ベッド';
        if (rest === 'banner') return ja + '旗';
      }
    }
    m = id.match(/^(.+)_(stairs|slab|double_slab|wall)$/);
    if (m) return lookup(m[1]) + shapes[m[2]];
    if (/copper/.test(id)) return '銅系ブロック(' + pretty(id) + ')';
    return pretty(id);
  }

  return function jaBlockName(key) {
    if (!key) return '';
    const [id, state] = key.split(':');
    if (state && colors[state] && exact[id]) return colors[state] + exact[id];
    if (state && woods[state]) {
      const kind = /leaves|leaf/.test(id) ? 'leaves' : /log|wood/.test(id) ? 'log' : 'planks';
      return woods[state] + parts[kind];
    }
    return lookup(id);
  };
})();
