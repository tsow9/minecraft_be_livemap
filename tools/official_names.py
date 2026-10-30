"""Official Japanese block names from Mojang's published language file (Mojang/bedrock-samples, ja_JP.lang;
en_US.lang gives the English ones the same way).

Many blocks are listed there under older internal names (oak log = "log.oak"), so we try
the modern ID first and then the older spellings.
"""
import re
import urllib.request

LANG_URL = 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/texts/{}.lang'

COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'silver',
          'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']
WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo',
         'crimson', 'warped', 'poplar']
COLORED = {'wool': ['wool'], 'concrete': ['concrete'], 'concrete_powder': ['concretePowder'], 'carpet': ['carpet'],
           'terracotta': ['stained_hardened_clay'], 'glazed_terracotta': ['glazedTerracotta'],
           'stained_glass': ['stained_glass'], 'stained_glass_pane': ['stained_glass_pane'], 'shulker_box': ['shulkerBox']}
ALIASES = {
    'grass_block': ['grass'], 'short_grass': ['tallgrass.grass'], 'fern': ['tallgrass.fern'], 'deadbush': ['deadbush'],
    'tall_grass': ['double_plant.grass'], 'large_fern': ['double_plant.fern'], 'sunflower': ['double_plant.sunflower'],
    'lilac': ['double_plant.syringa'], 'rose_bush': ['double_plant.rose'], 'peony': ['double_plant.paeonia'],
    'poppy': ['red_flower.poppy'], 'allium': ['red_flower.allium'], 'azure_bluet': ['red_flower.houstonia'],
    'cornflower': ['red_flower.cornflower'], 'oxeye_daisy': ['red_flower.oxeyeDaisy'], 'blue_orchid': ['red_flower.blueOrchid'],
    'lily_of_the_valley': ['red_flower.lilyOfTheValley'], 'orange_tulip': ['red_flower.tulipOrange'],
    'white_tulip': ['red_flower.tulipWhite'], 'red_tulip': ['red_flower.tulipRed'], 'pink_tulip': ['red_flower.tulipPink'],
    'dandelion': ['yellow_flower.dandelion'],
    'stone': ['stone.stone'], 'granite': ['stone.granite'], 'polished_granite': ['stone.graniteSmooth'],
    'diorite': ['stone.diorite'], 'polished_diorite': ['stone.dioriteSmooth'], 'andesite': ['stone.andesite'],
    'polished_andesite': ['stone.andesiteSmooth'],
    'stone_bricks': ['stonebrick.default'], 'mossy_stone_bricks': ['stonebrick.mossy'],
    'cracked_stone_bricks': ['stonebrick.cracked'], 'chiseled_stone_bricks': ['stonebrick.chiseled'],
    'chiseled_sandstone': ['sandstone.chiseled'], 'cut_sandstone': ['sandstone.cut'], 'smooth_sandstone': ['sandstone.smooth'],
    'chiseled_red_sandstone': ['red_sandstone.chiseled'], 'cut_red_sandstone': ['red_sandstone.cut'],
    'coarse_dirt': ['dirt.coarse'], 'dirt': ['dirt.default', 'dirt'],
    'infested_stone': ['monster_egg.stone'], 'infested_cobblestone': ['monster_egg.cobble'],
    'infested_stone_bricks': ['monster_egg.brick'], 'infested_mossy_stone_bricks': ['monster_egg.mossybrick'],
    'infested_cracked_stone_bricks': ['monster_egg.crackedbrick'], 'infested_chiseled_stone_bricks': ['monster_egg.chiseledbrick'],
    'smooth_stone_slab': ['stone_slab.stone'], 'normal_stone_slab': ['stone_slab4.stone'], 'cobblestone_slab': ['stone_slab.cobble'],
    'brick_slab': ['stone_slab.brick'], 'stone_brick_slab': ['stone_slab.smoothStoneBrick'], 'sandstone_slab': ['stone_slab.sand'],
    'quartz_slab': ['stone_slab.quartz'], 'nether_brick_slab': ['stone_slab.nether_brick'],
    'mossy_stone_brick_slab': ['stone_slab4.mossy_stone_brick'], 'smooth_quartz_slab': ['stone_slab4.smooth_quartz'],
    'cut_sandstone_slab': ['stone_slab4.cut_sandstone'], 'cut_red_sandstone_slab': ['stone_slab4.cut_red_sandstone'],
    'red_sandstone_slab': ['stone_slab2.red_sandstone'], 'purpur_slab': ['stone_slab2.purpur'],
    'prismarine_slab': ['stone_slab2.prismarine.rough'], 'dark_prismarine_slab': ['stone_slab2.prismarine.dark'],
    'prismarine_brick_slab': ['stone_slab2.prismarine.bricks'], 'mossy_cobblestone_slab': ['stone_slab2.mossy_cobblestone'],
    'red_nether_brick_slab': ['stone_slab2.red_nether_brick'], 'smooth_sandstone_slab': ['stone_slab2.sandstone.smooth'],
    'end_stone_brick_slab': ['stone_slab3.end_brick'], 'smooth_red_sandstone_slab': ['stone_slab3.red_sandstone.smooth'],
    'polished_andesite_slab': ['stone_slab3.andesite.smooth'], 'andesite_slab': ['stone_slab3.andesite'],
    'diorite_slab': ['stone_slab3.diorite'], 'polished_diorite_slab': ['stone_slab3.diorite.smooth'],
    'granite_slab': ['stone_slab3.granite'], 'polished_granite_slab': ['stone_slab3.granite.smooth'],
    'cobblestone_wall': ['cobblestone_wall.normal'], 'mossy_cobblestone_wall': ['cobblestone_wall.mossy'],
    'brick_wall': ['cobblestone_wall.brick'], 'stone_brick_wall': ['cobblestone_wall.stone_brick'],
    'mossy_stone_brick_wall': ['cobblestone_wall.mossy_stone_brick'], 'andesite_wall': ['cobblestone_wall.andesite'],
    'diorite_wall': ['cobblestone_wall.diorite'], 'granite_wall': ['cobblestone_wall.granite'],
    'sandstone_wall': ['cobblestone_wall.sandstone'], 'red_sandstone_wall': ['cobblestone_wall.red_sandstone'],
    'nether_brick_wall': ['cobblestone_wall.nether_brick'], 'red_nether_brick_wall': ['cobblestone_wall.red_nether_brick'],
    'end_stone_brick_wall': ['cobblestone_wall.end_brick'], 'prismarine_wall': ['cobblestone_wall.prismarine'],
    'prismarine': ['prismarine.rough'], 'prismarine_bricks': ['prismarine.bricks'], 'dark_prismarine': ['prismarine.dark'],
    'sea_lantern': ['seaLantern'], 'trip_wire': ['tripWire'], 'mushroom_stem': ['brown_mushroom_block.stem'],
    'brown_mushroom_block': ['brown_mushroom_block.cap'], 'red_mushroom_block': ['red_mushroom_block.cap'],
    'crimson_roots': ['crimson_roots.crimsonRoots'], 'anvil': ['anvil.intact'], 'chipped_anvil': ['anvil.slightlyDamaged'],
    'damaged_anvil': ['anvil.veryDamaged'], 'terracotta': ['hardened_clay'], 'hardened_clay': ['hardened_clay'],
}


# Where the official block name alone is unclear on a map (planted wheat is just "作物").
OVERRIDES = {'wheat': '小麦'}
OVERRIDES_EN = {'wheat': 'Wheat'}


def parse_lang(text):
    out = {}
    for line in text.splitlines():
        line = line.split('\t#')[0].strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip()
    return out


def download(locale='ja_JP'):
    """The game's language file: ja_JP (Japanese) or en_US (English)."""
    with urllib.request.urlopen(LANG_URL.format(locale), timeout=30) as res:
        return parse_lang(res.read().decode('utf-8-sig'))


def _color_variants(c):
    camel = re.sub(r'_(\w)', lambda m: m.group(1).upper(), c)
    out = [c, camel]
    if c == 'light_gray':
        out.append('silver')
    return out


def _bases(bid, state):
    """Possible language-file names (without 'tile.' and '.name') for one block."""
    out = []
    if state:
        out += [f'{bid}.{state}']
    out += [bid, f'minecraft:{bid}', f'{bid}.default']
    out += ALIASES.get(bid, [])
    double = bid.replace('_double_slab', '_slab') if bid.endswith('_double_slab') else None
    if double:
        for a in ALIASES.get(double, []):
            out.append('double_' + a)
    for c in sorted(COLORS, key=len, reverse=True):
        if bid.startswith(c + '_'):
            rest = bid[len(c) + 1:]
            for legacy in COLORED.get(rest, []):
                out += [f'{legacy}.{v}' for v in _color_variants(c)]
            break
    m = re.match(r'^(stripped_)?(\w+?)_(log|leaves|planks|sapling|slab|double_slab|wood)$', bid)
    if m and m.group(2) in WOODS:
        stripped, wood, part = m.groups()
        legacy = 'big_oak' if wood == 'dark_oak' else wood
        if part == 'wood':
            out.append(f'wood.stripped.{wood}' if stripped else f'wood.{wood}')
        elif part in ('slab', 'double_slab'):
            out.append(f'wooden_slab.{legacy}')
        elif not stripped:
            out += [f'{part}.{legacy}', f'{part}2.{legacy}']
    return out


def japanese(key, lang, overrides=OVERRIDES):
    """The block's name in that language file (despite the name, also used with the English file)."""
    bid, _, state = key.partition(':')
    if bid in overrides:
        return overrides[bid]
    for base in _bases(bid, state):
        for k in (f'tile.{base}.name', f'item.{base}.name'):
            if k in lang:
                return lang[k]
    return None
