"""Approximate top-down map colors for Bedrock block names."""

AIR = {'air', 'structure_void', 'barrier', 'light_block', 'light', 'camera', 'moving_block', 'invisible_bedrock'}
WATER = {'water', 'flowing_water', 'bubble_column'}

DYES = {
    'white': (233, 236, 236), 'orange': (240, 118, 19), 'magenta': (189, 68, 179), 'light_blue': (58, 175, 217),
    'yellow': (248, 197, 39), 'lime': (112, 185, 25), 'pink': (237, 141, 172), 'gray': (62, 68, 71),
    'light_gray': (142, 142, 134), 'silver': (142, 142, 134), 'cyan': (21, 137, 145), 'purple': (121, 42, 172),
    'blue': (53, 57, 157), 'brown': (114, 71, 40), 'green': (84, 109, 27), 'red': (161, 39, 34), 'black': (21, 21, 26),
}

WOODS = {
    'oak': ((162, 130, 78), (109, 85, 50)), 'spruce': ((114, 84, 48), (58, 37, 16)),
    'birch': ((192, 175, 121), (216, 215, 210)), 'jungle': ((160, 115, 80), (85, 67, 25)),
    'acacia': ((168, 90, 50), (103, 96, 86)), 'dark_oak': ((66, 43, 20), (60, 46, 26)),
    'mangrove': ((117, 54, 48), (84, 66, 36)), 'cherry': ((226, 178, 172), (54, 33, 44)),
    'pale_oak': ((227, 217, 216), (87, 79, 75)), 'bamboo': ((193, 173, 80), (127, 145, 58)),
    'crimson': ((101, 48, 70), (92, 25, 29)), 'warped': ((43, 104, 99), (58, 58, 77)),
}
LEAVES = {
    'birch': (104, 140, 66), 'spruce': (61, 99, 61), 'cherry': (229, 172, 194), 'azalea': (90, 117, 44),
    'flowering_azalea': (100, 111, 61), 'pale_oak': (160, 168, 160), 'mangrove': (78, 138, 46),
}

EXACT = {
    'grass_block': (95, 159, 53), 'grass': (95, 159, 53), 'short_grass': (95, 159, 53), 'tall_grass': (95, 159, 53),
    'tallgrass': (95, 159, 53), 'fern': (80, 140, 50), 'large_fern': (80, 140, 50), 'double_plant': (95, 159, 53),
    'dirt': (134, 96, 67), 'coarse_dirt': (119, 85, 59), 'rooted_dirt': (144, 103, 76), 'podzol': (91, 63, 24),
    'mycelium': (111, 99, 105), 'grass_path': (148, 122, 65), 'dirt_path': (148, 122, 65), 'farmland': (110, 73, 45),
    'mud': (60, 57, 60), 'clay': (160, 166, 179), 'gravel': (131, 127, 126), 'sand': (219, 207, 163),
    'red_sand': (190, 102, 33), 'suspicious_sand': (219, 207, 163), 'suspicious_gravel': (131, 127, 126),
    'sandstone': (216, 203, 155), 'red_sandstone': (186, 99, 29),
    'stone': (125, 125, 125), 'cobblestone': (127, 127, 127), 'mossy_cobblestone': (110, 118, 94),
    'granite': (149, 103, 85), 'diorite': (188, 188, 188), 'andesite': (136, 136, 136), 'tuff': (108, 109, 102),
    'calcite': (223, 224, 220), 'dripstone_block': (134, 107, 92), 'pointed_dripstone': (134, 107, 92),
    'deepslate': (80, 80, 82), 'cobbled_deepslate': (77, 77, 80), 'bedrock': (85, 85, 85), 'obsidian': (15, 10, 24),
    'crying_obsidian': (32, 10, 60), 'bricks': (150, 97, 83), 'brick_block': (150, 97, 83),
    'snow': (249, 254, 254), 'snow_layer': (249, 254, 254), 'powder_snow': (248, 253, 253),
    'ice': (145, 183, 253), 'packed_ice': (141, 180, 250), 'blue_ice': (116, 167, 253), 'frosted_ice': (140, 181, 252),
    'lava': (207, 92, 20), 'flowing_lava': (207, 92, 20), 'magma': (142, 63, 31),
    'netherrack': (97, 38, 38), 'soul_sand': (81, 62, 50), 'soul_soil': (75, 57, 46), 'basalt': (80, 81, 86),
    'polished_basalt': (99, 98, 100), 'blackstone': (42, 36, 41), 'glowstone': (171, 131, 84),
    'nether_wart_block': (114, 2, 2), 'warped_wart_block': (22, 119, 121), 'crimson_nylium': (130, 31, 31),
    'warped_nylium': (43, 114, 101), 'shroomlight': (240, 146, 70), 'nether_gold_ore': (115, 54, 42),
    'quartz_ore': (117, 65, 62), 'nether_bricks': (44, 21, 26), 'nether_brick': (44, 21, 26),
    'red_nether_brick': (69, 7, 9), 'ancient_debris': (94, 66, 58),
    'end_stone': (219, 222, 158), 'end_bricks': (218, 224, 162), 'purpur_block': (169, 125, 169),
    'chorus_plant': (93, 57, 93), 'chorus_flower': (151, 120, 151), 'end_rod': (220, 220, 220),
    'cactus': (85, 127, 43), 'pumpkin': (198, 118, 24), 'carved_pumpkin': (198, 118, 24), 'lit_pumpkin': (198, 118, 24),
    'melon_block': (111, 145, 30), 'hay_block': (166, 136, 38), 'reeds': (148, 192, 101), 'sugar_cane': (148, 192, 101),
    'waterlily': (32, 128, 48), 'lily_pad': (32, 128, 48), 'vine': (72, 110, 30), 'kelp': (80, 130, 40),
    'seagrass': (40, 100, 30), 'moss_block': (89, 109, 45), 'moss_carpet': (89, 109, 45),
    'brown_mushroom_block': (149, 111, 81), 'red_mushroom_block': (200, 46, 45), 'mushroom_stem': (203, 196, 185),
    'bamboo': (93, 144, 19), 'sculk': (12, 29, 36), 'glass': (200, 220, 230), 'glass_pane': (200, 220, 230),
    'tinted_glass': (44, 38, 46), 'bookshelf': (117, 94, 59), 'crafting_table': (119, 85, 52), 'chest': (165, 117, 40),
    'barrel': (138, 102, 59), 'furnace': (110, 110, 110), 'iron_block': (220, 220, 220), 'gold_block': (246, 208, 61),
    'diamond_block': (98, 237, 228), 'emerald_block': (42, 203, 87), 'lapis_block': (30, 67, 140),
    'redstone_block': (175, 24, 5), 'coal_block': (16, 15, 15), 'netherite_block': (66, 61, 63),
    'amethyst_block': (133, 97, 191), 'prismarine': (99, 156, 151), 'sea_lantern': (172, 199, 190),
    'quartz_block': (235, 229, 222), 'smooth_stone': (158, 158, 158), 'rail': (125, 110, 90), 'torch': (255, 200, 80),
    'mud_bricks': (137, 103, 79), 'packed_mud': (142, 106, 79), 'slime': (111, 192, 91), 'honey_block': (251, 185, 52),
    'beehive': (182, 146, 94), 'bee_nest': (196, 150, 77), 'campfire': (110, 85, 50), 'composter': (115, 80, 40),
    'tnt': (180, 60, 40), 'web': (220, 220, 220), 'cobweb': (220, 220, 220),
}

KEYWORDS = [
    ('deepslate', (80, 80, 82)), ('copper', (192, 107, 79)), ('ore', (125, 125, 125)), ('terracotta', (152, 94, 67)),
    ('hardened_clay', (152, 94, 67)), ('prismarine', (99, 156, 151)), ('quartz', (235, 229, 222)),
    ('purpur', (169, 125, 169)), ('end_stone', (219, 222, 158)), ('blackstone', (42, 36, 41)),
    ('nether_brick', (44, 21, 26)), ('sandstone', (216, 203, 155)), ('stone_brick', (122, 121, 122)),
    ('stonebrick', (122, 121, 122)), ('brick', (150, 97, 83)), ('cobblestone', (127, 127, 127)),
    ('granite', (149, 103, 85)), ('diorite', (188, 188, 188)), ('andesite', (136, 136, 136)), ('tuff', (108, 109, 102)),
    ('mud_brick', (137, 103, 79)), ('glass', (200, 220, 230)), ('ice', (145, 183, 253)), ('snow', (249, 254, 254)),
    ('coral', (200, 80, 120)), ('flower', (200, 60, 60)), ('tulip', (200, 60, 60)), ('sapling', (70, 130, 40)),
    ('mushroom', (150, 110, 80)), ('stone', (125, 125, 125)), ('sand', (219, 207, 163)), ('wool', (233, 236, 236)),
    ('sculk', (12, 29, 36)), ('amethyst', (133, 97, 191)), ('rail', (125, 110, 90)),
]

# name: (young color, ripe color, max growth). Color shifts with the growth/age state.
CROPS = {
    'wheat': ((88, 140, 40), (220, 190, 80), 7),
    'carrots': ((88, 140, 40), (150, 150, 50), 7),
    'potatoes': ((88, 140, 40), (120, 160, 60), 7),
    'beetroot': ((88, 140, 40), (160, 80, 70), 7),
    'nether_wart': ((110, 30, 30), (170, 40, 40), 3),
    'sweet_berry_bush': ((60, 100, 40), (150, 40, 50), 3),
    'cocoa': ((120, 140, 60), (150, 90, 40), 2),
    'melon_stem': ((88, 140, 40), (150, 150, 60), 7),
    'pumpkin_stem': ((88, 140, 40), (150, 150, 60), 7),
    'torchflower_crop': ((88, 140, 40), (200, 120, 60), 1),
    'pitcher_crop': ((88, 140, 40), (90, 120, 160), 4),
}

FALLBACK = (128, 128, 128)
unknown = set()
_cache = {}


def _crop_color(name, states):
    crop = CROPS.get(name)
    if crop is None:
        return None
    young, ripe, top = crop
    stage = states.get('growth', states.get('age', top))
    t = min(max(stage, 0), top) / top if isinstance(stage, (int, float)) and top else 1.0
    return tuple(int(a + (b - a) * t) for a, b in zip(young, ripe))


def _wood_color(name):
    for wood, (plank, bark) in sorted(WOODS.items(), key=lambda kv: -len(kv[0])):
        if wood not in name:
            continue
        if 'leaves' in name:
            return LEAVES.get(wood, (72, 120, 40))
        if any(k in name for k in ('log', 'stem', 'wood', 'hyphae')) and 'stripped' not in name:
            return bark
        return plank
    return None


def _state_color(name, states):
    color = states.get('color')
    if isinstance(color, str) and color in DYES:
        base = DYES[color]
        if 'terracotta' in name or 'hardened_clay' in name:
            return tuple(int(c * 0.65 + 40) for c in base)
        return base
    for key in ('wood_type', 'old_log_type', 'new_log_type', 'old_leaf_type', 'new_leaf_type'):
        wood = states.get(key)
        if isinstance(wood, str):
            kind = 'leaves' if 'leaf' in key or 'leaves' in name else ('log' if 'log' in name or 'wood' in name else 'planks')
            return _wood_color(f'{wood}_{kind}')
    return None


def color_of(name, states=None):
    """Return ((r, g, b), kind) where kind is 'air', 'water' or 'solid'."""
    states = states or {}
    simple = name.split(':', 1)[-1]
    cache_key = (simple, states.get('color'), states.get('wood_type'), states.get('old_log_type'),
                 states.get('new_log_type'), states.get('old_leaf_type'), states.get('new_leaf_type'),
                 states.get('growth'), states.get('age'))
    if cache_key in _cache:
        return _cache[cache_key]
    if simple in AIR or simple.startswith('light_block'):
        result = ((0, 0, 0), 'air')
    elif simple in WATER:
        result = ((63, 118, 228), 'water')
    else:
        rgb = _crop_color(simple, states) or _state_color(simple, states) or EXACT.get(simple)
        if rgb is None:
            for dye, base in sorted(DYES.items(), key=lambda kv: -len(kv[0])):
                if simple.startswith(dye + '_'):
                    rgb = base if 'terracotta' not in simple else tuple(int(c * 0.65 + 40) for c in base)
                    break
        if rgb is None:
            rgb = _wood_color(simple)
        if rgb is None and 'leaves' in simple:
            rgb = (72, 120, 40)
        if rgb is None:
            rgb = next((c for kw, c in KEYWORDS if kw in simple), None)
        if rgb is None:
            unknown.add(simple)
            rgb = FALLBACK
        result = (rgb, 'solid')
    _cache[cache_key] = result
    return result
