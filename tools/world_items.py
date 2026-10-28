"""What is stored where: the contents of chests and other containers, and what villagers sell.

Writes items.json for the site's search ("鉄インゴット" finds the chests holding it, "修繕" finds the
librarians selling mending books, "農場" finds signs saying so, "ポチ" finds the dog of that name). Containers and signs come from each chunk's
block entities, villagers and tamed or named animals from the world's actors. Japanese names for items, enchantments and villager jobs come from the game's own
language file when it could be downloaded.
"""
import json
import os
import re
import struct
import tempfile

import bedrock_db
import nbt
import players

DIM_NAMES = {0: 'overworld', 1: 'nether', 2: 'end'}
BLOCK_ENTITY, OLD_ENTITY = 49, 50  # chunk key tags
CONTAINERS = {
    'Chest': 'chest', 'Barrel': 'barrel', 'ShulkerBox': 'shulker_box', 'Hopper': 'hopper', 'Dispenser': 'dispenser',
    'Dropper': 'dropper', 'Furnace': 'furnace', 'BlastFurnace': 'blast_furnace', 'Smoker': 'smoker',
    'BrewingStand': 'brewing_stand', 'Crafter': 'crafter', 'ChiseledBookshelf': 'chiseled_bookshelf', 'DecoratedPot': 'decorated_pot',
}
SIGNS = {'Sign': 0, 'HangingSign': 1}  # block entity id -> 1 for a hanging sign
# Things that are not animals even when they carry a name.
NOT_ANIMALS = {'minecraft:item', 'minecraft:xp_orb', 'minecraft:arrow', 'minecraft:thrown_trident', 'minecraft:player',
               'minecraft:falling_block', 'minecraft:tnt', 'minecraft:fireworks_rocket', 'minecraft:snowball', 'minecraft:egg'}
VILLAGERS = {'minecraft:villager_v2', 'minecraft:villager', 'minecraft:wandering_trader'}
JOBS = ['farmer', 'fisherman', 'shepherd', 'fletcher', 'librarian', 'cartographer', 'cleric', 'armorer', 'weaponsmith',
        'toolsmith', 'butcher', 'leatherworker', 'mason', 'nitwit', 'unemployed', 'wandering_trader']
JOB_LANG = {'armorer': 'armor', 'leatherworker': 'leather', 'toolsmith': 'tool', 'weaponsmith': 'weapon'}
JOB_JA = {'nitwit': 'ニトウィット', 'unemployed': '無職の村人', 'wandering_trader': '行商人'}
# Bedrock enchantment numbers and their language-file names.
ENCH_KEYS = ['protect.all', 'protect.fire', 'protect.fall', 'protect.explosion', 'protect.projectile', 'thorns', 'oxygen',
             'waterWalker', 'waterWorker', 'damage.all', 'damage.undead', 'damage.arthropods', 'knockback', 'fire',
             'lootBonus', 'digging', 'untouching', 'durability', 'lootBonusDigger', 'arrowDamage', 'arrowKnockback',
             'arrowFire', 'arrowInfinite', 'lootBonusFishing', 'fishingSpeed', 'frostwalker', 'mending', 'curse.binding',
             'curse.vanishing', 'tridentImpaling', 'tridentRiptide', 'tridentLoyalty', 'tridentChanneling',
             'crossbowMultishot', 'crossbowPiercing', 'crossbowQuickCharge', 'soul_speed', 'swift_sneak']
ENCH_EXTRA = {38: '突風', 39: '重撃', 40: '破砕'}


def _compounds(data):
    """A run of NBT compounds stored back to back (block entities, old-style entities)."""
    pos = 0
    while pos < len(data):
        try:
            value, pos = nbt.root_compound(data, pos)
        except (ValueError, IndexError, struct.error):
            return
        yield value


def _short(name):
    name = str(name or '')
    return name[10:] if name.startswith('minecraft:') else name


def _item(it):
    """[name, count] or [name, count, [[enchantment, level], ...]]; None for an empty slot."""
    if not isinstance(it, dict):
        return None
    name, count = _short(it.get('Name')), it.get('Count')
    if not name or name == 'air' or not isinstance(count, int) or count <= 0:
        return None
    tag = it.get('tag') if isinstance(it.get('tag'), dict) else {}
    ench = [[e.get('id'), e.get('lvl')] for e in tag.get('ench') or [] if isinstance(e, dict) and isinstance(e.get('id'), int)]
    return [name, count, ench] if ench else [name, count]


def _items(raw):
    """Items of a container, including what is inside shulker boxes kept in it."""
    out = []
    for it in raw or []:
        item = _item(it)
        if not item:
            continue
        out.append(item)
        inner = (it.get('tag') or {}).get('Items') if isinstance(it.get('tag'), dict) else None
        out += [i for i in (_item(x) for x in inner or []) if i]
    return out


def _sign_text(be):
    """What is written on a sign, front then back, without colour codes; '' when blank."""
    sides = [be.get('FrontText'), be.get('BackText')] if isinstance(be.get('FrontText'), dict) else [be]
    out = []
    for side in sides:
        text = side.get('Text') if isinstance(side, dict) else None
        if isinstance(text, str):
            lines = [re.sub(r'§.', '', line).strip() for line in text.split('\n')]
            text = '\n'.join(line for line in lines if line)
            if text and text not in out:
                out.append(text)
    return '\n'.join(out)[:200]


def _owners(db_dir, secret):
    """Player number in the world -> the hashed player key live.json uses (pets store their owner's number)."""
    out = {}
    if not secret:
        return out
    for key, value in bedrock_db.scan(db_dir, lambda k: k.startswith(b'player_server_')):
        try:
            root, _ = nbt.root_compound(value, 0)
        except (ValueError, IndexError, struct.error):
            continue
        if isinstance(root.get('UniqueID'), int):
            out[root['UniqueID']] = players._hash(secret, key.decode('latin-1'))
    return out


def _animal(actor, dim, owners):
    """A tamed animal or one with a name tag; None for anything else."""
    kind = actor.get('identifier')
    if not isinstance(kind, str) or kind in VILLAGERS or kind in NOT_ANIMALS:
        return None
    name = str(actor.get('CustomName') or '')[:40]
    tamed = actor.get('IsTamed') == 1
    pos = actor.get('Pos')
    if not (name or tamed) or not (isinstance(pos, list) and len(pos) == 3):
        return None
    owner = owners.get(actor.get('OwnerNew')) if tamed else None
    # Coat colour or pattern (horses, cats, llamas...), so the map can draw the animal as it looks.
    variant = actor.get('Variant') if isinstance(actor.get('Variant'), int) else None
    return {'dim': dim, 'x': int(pos[0] // 1), 'y': int(pos[1] // 1), 'z': int(pos[2] // 1), 'kind': _short(kind),
            'name': name or None, 'tamed': tamed, 'owner': owner, 'variant': variant}


def _villager(actor, dim):
    pos = actor.get('Pos')
    if not (isinstance(pos, list) and len(pos) == 3):
        return None
    defs = [str(d) for d in actor.get('definitions') or []]
    job = 'wandering_trader' if actor.get('identifier') == 'minecraft:wandering_trader' else next(
        (j for j in JOBS if f'+{j}' in defs or f'+minecraft:{j}' in defs), None)
    tier = actor.get('TradeTier') if isinstance(actor.get('TradeTier'), int) else None
    trades = []
    for r in ((actor.get('Offers') or {}).get('Recipes') or []) if isinstance(actor.get('Offers'), dict) else []:
        if not isinstance(r, dict):
            continue
        if tier is not None and isinstance(r.get('tier'), int) and r['tier'] > tier:
            continue  # not unlocked yet
        sell = _item(r.get('sell'))
        if not sell:
            continue
        buy = [b for b in (_item(r.get('buyA')), _item(r.get('buyB'))) if b]
        trades.append([buy, sell])
    return {'dim': dim, 'x': int(pos[0] // 1), 'y': int(pos[1] // 1), 'z': int(pos[2] // 1), 'job': job,
            'name': str(actor.get('CustomName') or '')[:40] or None, 'trades': trades}


def scan(db_dir, secret=''):
    containers, villagers, signs, animals, actor_dims, actors = [], [], [], [], {}, {}
    owners = _owners(db_dir, secret)

    def want(key):
        if key.startswith(b'actorprefix') or key.startswith(b'digp'):
            return True
        return (len(key) == 9 and key[8] in (BLOCK_ENTITY, OLD_ENTITY)) or (len(key) == 13 and key[12] in (BLOCK_ENTITY, OLD_ENTITY))

    for key, value in bedrock_db.scan(db_dir, want):
        if key.startswith(b'digp'):
            dim = struct.unpack_from('<i', key, 12)[0] if len(key) == 16 else 0
            for i in range(0, len(value) - 7, 8):
                actor_dims[value[i:i + 8]] = dim
            continue
        if key.startswith(b'actorprefix'):
            try:
                actors[key[11:]], _ = nbt.root_compound(value, 0)
            except (ValueError, IndexError, struct.error):
                pass
            continue
        dim = struct.unpack_from('<i', key, 8)[0] if len(key) == 13 else 0
        if (key[-1]) == OLD_ENTITY:
            for actor in _compounds(value):
                if actor.get('identifier') in VILLAGERS:
                    v = _villager(actor, dim)
                    if v:
                        villagers.append(v)
                else:
                    a = _animal(actor, dim, owners)
                    if a:
                        animals.append(a)
            continue
        for be in _compounds(value):
            if be.get('id') in SIGNS and all(isinstance(be.get(k), int) for k in 'xyz'):
                text = _sign_text(be)
                if text:
                    signs.append({'dim': dim, 'x': be['x'], 'y': be['y'], 'z': be['z'], 'text': text, 'hanging': SIGNS[be['id']]})
                continue
            kind = CONTAINERS.get(be.get('id'))
            if not kind or not all(isinstance(be.get(k), int) for k in 'xyz'):
                continue
            items = _items(be.get('Items'))
            if be.get('LootTable') or be.get('Findable') == 1:
                continue  # a structure's chest or barrel nobody has opened yet: its loot is only made when opened
            pair = (be.get('pairx'), be.get('pairz')) if isinstance(be.get('pairx'), int) else None
            containers.append({'dim': dim, 'x': be['x'], 'y': be['y'], 'z': be['z'], 'kind': kind, 'items': items,
                               'pair': pair, 'lead': be.get('pairlead') == 1})
    for uid, actor in actors.items():
        if actor.get('identifier') in VILLAGERS:
            v = _villager(actor, actor_dims.get(uid, 0))
            if v:
                villagers.append(v)
        else:
            a = _animal(actor, actor_dims.get(uid, 0), owners)
            if a:
                animals.append(a)
    # Empty containers are left out (after joining double chests, so a half-empty double chest still shows).
    return [c for c in _merge_pairs(containers) if c['items']], villagers, signs, animals


def _merge_pairs(containers):
    """A double chest is two block entities; show it once, at its lead half."""
    at = {(c['dim'], c['x'], c['y'], c['z']): c for c in containers}
    out = []
    for c in containers:
        other = at.get((c['dim'], c['pair'][0], c['y'], c['pair'][1])) if c['pair'] else None
        if other is not None and not c['lead'] and other['lead']:
            continue
        if other is not None and c['lead']:
            c = {**c, 'items': c['items'] + other['items'], 'kind': 'large_chest'}
        out.append(c)
    return out


# Items the language file lists under older names (lava bucket = "item.bucketLava").
ITEM_KEYS = {
    'water_bucket': 'item.bucketWater', 'lava_bucket': 'item.bucketLava', 'milk_bucket': 'item.milk',
    'cod_bucket': 'item.bucketFish', 'salmon_bucket': 'item.bucketSalmon', 'tropical_fish_bucket': 'item.bucketTropical',
    'pufferfish_bucket': 'item.bucketPuffer', 'axolotl_bucket': 'item.bucketAxolotl', 'filled_map': 'item.map',
    'empty_map': 'item.emptyMap', 'ink_sac': 'item.dye.black', 'lapis_lazuli': 'item.dye.blue', 'cocoa_beans': 'item.dye.brown',
    'bone_meal': 'item.dye.white', 'black_dye': 'item.dye.black_new', 'blue_dye': 'item.dye.blue_new',
    'brown_dye': 'item.dye.brown_new', 'white_dye': 'item.dye.white_new', 'light_gray_dye': 'item.dye.silver',
    'light_blue_dye': 'item.dye.lightBlue', 'cod': 'item.fish', 'cooked_cod': 'item.cooked_fish', 'tropical_fish': 'item.clownfish',
    'sugar_cane': 'item.reeds', 'oak_fence': 'tile.fence', 'quartz_pillar': 'tile.quartz_block.lines',
    'melon_slice': 'item.melon', 'glistering_melon_slice': 'item.speckled_melon', 'banner': 'item.banner.white',
    'tube_coral_block': 'tile.coral_block.blue', 'brain_coral_block': 'tile.coral_block.pink',
    'bubble_coral_block': 'tile.coral_block.purple', 'fire_coral_block': 'tile.coral_block.red',
    'horn_coral_block': 'tile.coral_block.yellow', 'dark_oak_boat': 'item.boat.big_oak',
}
ITEM_JA = {'potion': 'ポーション', 'bundle': 'バンドル', 'spruce_fence': 'トウヒのフェンス', 'birch_fence': 'シラカバのフェンス',
           'jungle_fence': 'ジャングルのフェンス', 'acacia_fence': 'アカシアのフェンス', 'dark_oak_fence': 'ダークオークのフェンス'}
for _c in ['cyan', 'gray', 'green', 'lime', 'magenta', 'orange', 'pink', 'purple', 'red', 'yellow']:
    ITEM_KEYS[f'{_c}_dye'] = f'item.dye.{_c}'
for _w in ['oak', 'spruce', 'birch', 'jungle', 'acacia']:
    ITEM_KEYS[f'{_w}_boat'] = f'item.boat.{_w}'


def _names(lang, ids):
    if not lang:
        return dict(ITEM_JA)
    import official_names
    out = {}
    for i in ids:
        key = ITEM_KEYS.get(i)
        ja = lang.get(f'{key}.name') if key else None
        ja = ja or official_names.japanese(i, lang) or ITEM_JA.get(i)
        if not ja and i.startswith('music_disc_'):
            ja = '音楽ディスク'
        if ja:
            out[i] = ja
    return out


def _faces(site, animals):
    """Faces for the pet marks, made from the game's own files; last time's when those can't be fetched."""
    wanted = {(a['kind'], a['variant']) for a in animals} | {('wolf', None)}  # the wolf is the pet chip's face
    try:
        import pet_faces
        with tempfile.TemporaryDirectory(prefix='mcassets-') as repo:
            return pet_faces.build(wanted, os.path.join(repo, 'pack'))
    except Exception as e:  # git missing, no network, the pack changed shape...
        print(f'ペットの顔を作れませんでした(前回の顔を使います): {e}')
        try:
            with open(os.path.join(site, 'items.json'), encoding='utf-8') as f:
                return json.load(f).get('faces') or {}
        except (OSError, ValueError):
            return {}


def write(site, db_dir, lang, secret=''):
    containers, villagers, signs, animals = scan(db_dir, secret)
    ids = {it[0] for c in containers for it in c['items']}
    ids |= {it[0] for v in villagers for t in v['trades'] for it in t[0] + [t[1]]}
    ids |= set(CONTAINERS.values()) | {'large_chest'}
    names = _names(lang, sorted(ids))
    if 'chest' in names:
        names.setdefault('large_chest', 'ラージチェスト')
    ench = {}
    for n, key in enumerate(ENCH_KEYS):
        v = (lang or {}).get(f'enchantment.{key}')
        if v:
            ench[n] = v
    ench.update({k: v for k, v in ENCH_EXTRA.items() if k not in ench})
    mobs = {}
    for k in sorted({a['kind'] for a in animals}):
        v = (lang or {}).get(f'entity.{k}.name')
        if v:
            mobs[k] = v
    jobs = {}
    for j in JOBS:
        v = JOB_JA.get(j) or (lang or {}).get(f'entity.villager.{JOB_LANG.get(j, j)}')
        if v:
            jobs[j] = v
    dims = {}
    def of(dim):
        return dims.setdefault(DIM_NAMES.get(dim, str(dim)), {'containers': [], 'villagers': [], 'signs': [], 'animals': []})
    for c in containers:
        of(c['dim'])['containers'].append([c['x'], c['y'], c['z'], c['kind'], c['items']])
    for v in villagers:
        of(v['dim'])['villagers'].append([v['x'], v['y'], v['z'], v['job'], v['name'], v['trades']])
    for g in signs:
        of(g['dim'])['signs'].append([g['x'], g['y'], g['z'], g['text'], g['hanging']])
    for a in animals:
        of(a['dim'])['animals'].append([a['x'], a['y'], a['z'], a['kind'], a['name'], int(a['tamed']), a['owner'], a['variant']])
    out = {'dims': dims, 'names': names, 'ench': ench, 'jobs': jobs, 'mobs': mobs, 'faces': _faces(site, animals)}
    with open(os.path.join(site, 'items.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    traded = sum(1 for v in villagers if v['trades'])
    owned = sum(1 for a in animals if a['owner'])
    return len(containers), len(villagers), traded, len(signs), len(animals), owned
